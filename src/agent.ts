// Agent — multi-turn conversations with optional tool calling.
//
// @invariant history is mutated only inside chat() and grows append-only;
//   on a non-2xx response or a max-iterations throw, the partial history
//   is preserved so callers can inspect what happened.
// @invariant tool execution failures never propagate out of the loop —
//   they are surfaced as `"error: ..."` tool-result content so the LLM
//   can recover (matches Go behaviour at go/agent.go:189).

import { PROVIDERS, type ProviderConfig } from "./providers/providers.ts";
import { APIError, ValidationError } from "./errors.ts";
import { extractIntPath, extractPath } from "./paths.ts";
import { executeRequest, isBedrock, validateOptions } from "./request.ts";
import { firePost, firePre } from "./middleware.ts";
import type { Event } from "./providers/middleware.ts";
import { OptionKeys, supportedOptions } from "./providers/options.ts";
import type {
  AgentOptions,
  Provider,
  Response as PromptResponse,
  Tool,
  Usage,
} from "./types.ts";

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultMsg {
  toolUseId: string;
  content: string;
}

interface InternalMessage {
  role: "user" | "assistant" | "tool_result";
  content?: string;
  toolCalls?: ToolCall[];
  toolResult?: ToolResultMsg;
}

const DEFAULT_MAX_TOOL_ITERATIONS = 10;

export class Agent {
  private readonly provider: Provider;
  private readonly options: AgentOptions;
  private readonly history: InternalMessage[] = [];
  private tools: Tool[] = [];
  private system = "";

  constructor(provider: Provider, options: AgentOptions = {}) {
    if (!PROVIDERS[provider.name]) {
      throw new ValidationError("provider", `unknown: ${provider.name}`);
    }
    if (!provider.apiKey) {
      throw new ValidationError("apiKey", "required");
    }
    validateOptions(provider.name, options);
    this.provider = provider;
    this.options = options;
  }

  setSystem(system: string): void {
    this.system = system;
  }

  addTool(tool: Tool): void {
    this.tools.push(tool);
  }

  async chat(message: string): Promise<PromptResponse> {
    this.history.push({ role: "user", content: message });
    return this.runToolLoop();
  }

  private async runToolLoop(): Promise<PromptResponse> {
    const cfg = PROVIDERS[this.provider.name]!;
    const maxIters =
      this.options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    const totalUsage: Usage = {
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
      reasoning: 0,
    };

    const model = this.provider.model || cfg.defaultModel;
    const mw = this.options.middleware;

    for (let i = 0; i < maxIters; i++) {
      const llmEvent: Event = {
        op: "llm_request",
        phase: "pre",
        provider: this.provider.name,
        model,
      };
      const veto = firePre(mw, llmEvent);
      if (veto) throw veto;
      const llmStart = performance.now();

      let raw: unknown;
      let turnUsage: Usage;
      try {
        const body = this.buildAgentRequest(cfg);
        const resp = await executeRequest(
          this.provider,
          cfg,
          body,
          this.options,
        );
        if (!resp.ok) {
          throw new APIError(
            resp.status,
            resp.text,
            resp.status === 429 || resp.status >= 500,
          );
        }
        raw = JSON.parse(resp.text);
        turnUsage = {
          input: extractIntPath(raw, cfg.usageInputPath),
          output: extractIntPath(raw, cfg.usageOutputPath),
          cacheWrite: 0,
          cacheRead: 0,
          reasoning: 0,
        };
        totalUsage.input += turnUsage.input;
        totalUsage.output += turnUsage.output;
      } catch (err) {
        firePost(mw, {
          ...llmEvent,
          err: err instanceof Error ? err : new Error(String(err)),
          duration: performance.now() - llmStart,
        });
        throw err;
      }
      firePost(mw, {
        ...llmEvent,
        usage: turnUsage,
        duration: performance.now() - llmStart,
      });

      const calls = extractToolCalls(raw, cfg);
      if (calls.length === 0) {
        const text = extractPath(raw, cfg.responseTextPath);
        this.history.push({ role: "assistant", content: text });
        const result: PromptResponse = { text, usage: totalUsage };
        if (cfg.finishReasonPath) {
          const reason = extractPath(raw, cfg.finishReasonPath);
          if (reason) result.finishReason = reason;
        }
        if (cfg.finishMessagePath) {
          const message = extractPath(raw, cfg.finishMessagePath);
          if (message) result.finishMessage = message;
        }
        if (this.options.raw) result.raw = raw;
        return result;
      }

      this.history.push({ role: "assistant", toolCalls: calls });
      for (const call of calls) {
        const tool = this.tools.find((t) => t.name === call.name);
        const toolEvent: Event = {
          op: "tool_call",
          phase: "pre",
          provider: this.provider.name,
          model,
          tool: call.name,
          args: call.input,
        };
        const toolVeto = firePre(mw, toolEvent);
        if (toolVeto) throw toolVeto;
        const toolStart = performance.now();

        let content: string;
        let runErr: Error | undefined;
        if (!tool) {
          content = `error: unknown tool "${call.name}"`;
        } else {
          try {
            content = await tool.run(call.input);
          } catch (err) {
            runErr = err instanceof Error ? err : new Error(String(err));
            content = `error: ${runErr.message}`;
          }
        }
        firePost(mw, {
          ...toolEvent,
          result: content,
          err: runErr,
          duration: performance.now() - toolStart,
        });
        this.history.push({
          role: "tool_result",
          toolResult: { toolUseId: call.id, content },
        });
      }
    }

    throw new Error(`max tool iterations (${maxIters}) reached`);
  }

  private buildAgentRequest(cfg: ProviderConfig): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    const model = this.provider.model || cfg.defaultModel;
    if (cfg.modelInBody) body.model = model;

    const supportedMap = new Map(
      supportedOptions(this.provider.name).map((o) => [o.key, o.jsonKey]),
    );
    const maxTokensKey = supportedMap.get(OptionKeys.MAX_TOKENS);
    if (maxTokensKey !== undefined) {
      body[maxTokensKey] = this.options.maxTokens ?? cfg.defaultMaxTokens;
    }

    if (isBedrock(cfg)) {
      if (this.system) body.system = [{ text: this.system }];
      body.messages = this.buildBedrockMessages(cfg);
    } else if (cfg.systemPlacement === "SiblingObject") {
      if (this.system) {
        body.system_instruction = { parts: [{ text: this.system }] };
      }
      body.contents = this.buildGoogleContents(cfg);
    } else {
      if (cfg.systemPlacement === "TopLevelField" && this.system) {
        body.system = this.system;
      }
      body.messages = this.buildHistoryMessages(cfg);
    }

    if (this.tools.length > 0) {
      attachToolDefs(body, this.tools, cfg);
    }
    return body;
  }

  private buildHistoryMessages(
    cfg: ProviderConfig,
  ): Array<Record<string, unknown>> {
    const msgs: Array<Record<string, unknown>> = [];
    if (cfg.systemPlacement === "MessageInArray" && this.system) {
      msgs.push({
        role: cfg.roleMappings.system ?? "system",
        content: this.system,
      });
    }
    for (const m of this.history) {
      if (m.toolResult) {
        msgs.push(toolResultMsg(m.toolResult, cfg));
      } else if (m.toolCalls && m.toolCalls.length > 0) {
        msgs.push(toolCallMsg(m.toolCalls, cfg));
      } else {
        msgs.push({
          role: cfg.roleMappings[m.role] ?? m.role,
          content: m.content ?? "",
        });
      }
    }
    return msgs;
  }

  private buildBedrockMessages(
    cfg: ProviderConfig,
  ): Array<Record<string, unknown>> {
    const msgs: Array<Record<string, unknown>> = [];
    for (const m of this.history) {
      if (m.toolResult) {
        msgs.push({
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: m.toolResult.toolUseId,
                content: [{ text: m.toolResult.content }],
              },
            },
          ],
        });
      } else if (m.toolCalls && m.toolCalls.length > 0) {
        msgs.push({
          role: cfg.roleMappings.assistant ?? "assistant",
          content: m.toolCalls.map((c) => ({
            toolUse: { toolUseId: c.id, name: c.name, input: c.input },
          })),
        });
      } else {
        msgs.push({
          role: cfg.roleMappings[m.role] ?? m.role,
          content: [{ text: m.content ?? "" }],
        });
      }
    }
    return msgs;
  }

  private buildGoogleContents(
    cfg: ProviderConfig,
  ): Array<Record<string, unknown>> {
    const contents: Array<Record<string, unknown>> = [];
    for (const m of this.history) {
      if (m.toolResult) {
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: m.toolResult.toolUseId,
                response: { result: m.toolResult.content },
              },
            },
          ],
        });
      } else if (m.toolCalls && m.toolCalls.length > 0) {
        contents.push({
          role: cfg.roleMappings.assistant ?? "model",
          parts: m.toolCalls.map((c) => ({
            functionCall: { name: c.name, args: c.input },
          })),
        });
      } else {
        contents.push({
          role: cfg.roleMappings[m.role] ?? m.role,
          parts: [{ text: m.content ?? "" }],
        });
      }
    }
    return contents;
  }
}

function attachToolDefs(
  body: Record<string, unknown>,
  tools: Tool[],
  cfg: ProviderConfig,
): void {
  if (isBedrock(cfg)) {
    body.toolConfig = {
      tools: tools.map((t) => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.schema },
        },
      })),
    };
    return;
  }
  if (cfg.systemPlacement === "TopLevelField") {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema,
    }));
    return;
  }
  if (cfg.systemPlacement === "SiblingObject") {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.schema,
        })),
      },
    ];
    return;
  }
  if (cfg.systemPlacement === "MessageInArray") {
    body.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.schema,
      },
    }));
    return;
  }
  throw new ValidationError(
    "provider",
    `agent tools not yet supported in TS for systemPlacement=${cfg.systemPlacement}`,
  );
}

function toolCallMsg(
  calls: ToolCall[],
  cfg: ProviderConfig,
): Record<string, unknown> {
  if (cfg.systemPlacement === "TopLevelField") {
    return {
      role: cfg.roleMappings.assistant ?? "assistant",
      content: calls.map((c) => ({
        type: "tool_use",
        id: c.id,
        name: c.name,
        input: c.input,
      })),
    };
  }
  return {
    role: cfg.roleMappings.assistant ?? "assistant",
    tool_calls: calls.map((c) => ({
      id: c.id,
      type: "function",
      function: {
        name: c.name,
        arguments: JSON.stringify(c.input),
      },
    })),
  };
}

function toolResultMsg(
  result: ToolResultMsg,
  cfg: ProviderConfig,
): Record<string, unknown> {
  if (cfg.systemPlacement === "TopLevelField") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: result.toolUseId,
          content: result.content,
        },
      ],
    };
  }
  return {
    role: "tool",
    content: result.content,
    tool_call_id: result.toolUseId,
  };
}

function extractToolCalls(raw: unknown, cfg: ProviderConfig): ToolCall[] {
  if (isBedrock(cfg)) return extractBedrockToolCalls(raw);
  if (cfg.systemPlacement === "TopLevelField") {
    return extractAnthropicToolCalls(raw);
  }
  if (cfg.systemPlacement === "SiblingObject") {
    return extractGoogleToolCalls(raw);
  }
  if (cfg.systemPlacement === "MessageInArray") {
    return extractOpenAIToolCalls(raw);
  }
  return [];
}

function extractBedrockToolCalls(raw: unknown): ToolCall[] {
  if (typeof raw !== "object" || raw === null) return [];
  const output = (raw as Record<string, unknown>).output as
    | Record<string, unknown>
    | undefined;
  const message = output?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  const calls: ToolCall[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const tu = (block as Record<string, unknown>).toolUse as
      | Record<string, unknown>
      | undefined;
    if (!tu) continue;
    calls.push({
      id: String(tu.toolUseId ?? ""),
      name: String(tu.name ?? ""),
      input: (tu.input as Record<string, unknown>) ?? {},
    });
  }
  return calls;
}

function extractGoogleToolCalls(raw: unknown): ToolCall[] {
  if (typeof raw !== "object" || raw === null) return [];
  const candidates = (raw as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const cand = candidates[0] as Record<string, unknown> | undefined;
  const content = cand?.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts)) return [];
  const calls: ToolCall[] = [];
  for (const p of parts) {
    if (typeof p !== "object" || p === null) continue;
    const fc = (p as Record<string, unknown>).functionCall as
      | Record<string, unknown>
      | undefined;
    if (!fc) continue;
    calls.push({
      id: String(fc.name ?? ""),
      name: String(fc.name ?? ""),
      input: (fc.args as Record<string, unknown>) ?? {},
    });
  }
  return calls;
}

function extractAnthropicToolCalls(raw: unknown): ToolCall[] {
  if (typeof raw !== "object" || raw === null) return [];
  const content = (raw as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  const calls: ToolCall[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "tool_use") continue;
    calls.push({
      id: String(b.id ?? ""),
      name: String(b.name ?? ""),
      input: (b.input as Record<string, unknown>) ?? {},
    });
  }
  return calls;
}

function extractOpenAIToolCalls(raw: unknown): ToolCall[] {
  if (typeof raw !== "object" || raw === null) return [];
  const choices = (raw as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const choice = choices[0] as Record<string, unknown> | undefined;
  const message = choice?.message as Record<string, unknown> | undefined;
  const tcs = message?.tool_calls;
  if (!Array.isArray(tcs)) return [];
  const calls: ToolCall[] = [];
  for (const tc of tcs) {
    if (typeof tc !== "object" || tc === null) continue;
    const tcMap = tc as Record<string, unknown>;
    const fn = tcMap.function as Record<string, unknown> | undefined;
    if (!fn) continue;
    let input: Record<string, unknown> = {};
    const args = fn.arguments;
    if (typeof args === "string") {
      try {
        input = JSON.parse(args) as Record<string, unknown>;
      } catch {
        input = {};
      }
    } else if (typeof args === "object" && args !== null) {
      input = args as Record<string, unknown>;
    }
    calls.push({
      id: String(tcMap.id ?? ""),
      name: String(fn.name ?? ""),
      input,
    });
  }
  return calls;
}
