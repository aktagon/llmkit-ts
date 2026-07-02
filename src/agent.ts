// Agent — multi-turn conversations with optional tool calling.
//
// @invariant history is mutated only inside chat() and grows append-only;
//   on a non-2xx response or a max-iterations throw, the partial history
//   is preserved so callers can inspect what happened.
// @invariant tool execution failures never propagate out of the loop —
//   they are surfaced as `"error: ..."` tool-result content so the LLM
//   can recover (matches Go behaviour at go/agent.go:189).

import { PROVIDERS, type ProviderSpec } from "./providers/providers.ts";
import { APIError, ValidationError } from "./errors.ts";
import { extractIntPath, extractFloatPath, extractPath } from "./paths.ts";
import {
  buildRequest,
  executeRequest,
  resolveModel,
  toolCallInput,
  validateOptions,
} from "./request.ts";
import { firePost, firePre } from "./middleware.ts";
import type { Event } from "./providers/middleware.ts";
import { applyCaching } from "./caching.ts";
import type {
  AgentOptions,
  Provider,
  Request,
  Response as PromptResponse,
  Tool,
  Usage,
} from "./types.ts";
import type { Message, ToolCall, ToolResult } from "./structs.ts";

interface InternalMessage {
  role: "user" | "assistant" | "tool_result";
  content?: string;
  toolCalls?: ToolCall[];
  toolResult?: ToolResult;
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

  // historyView exposes the agent's internal conversation history to
  // the typed builder's `bot.messages` reader (ADR-020 HIST-004). The
  // returned array is a fresh shallow copy so callers can iterate
  // without invalidation when the agent appends mid-loop; each
  // InternalMessage's inner arrays are shared with runtime state by
  // the shallow-immutability rule documented on `bot.messages`.
  historyView(): readonly InternalMessage[] {
    return [...this.history];
  }

  // seedHistory replaces the internal history with a translation of
  // the public Message list passed via the typed builder's
  // `bot.history(...)` chain (ADR-020 HIST-007). Mechanical field
  // copy; the wire `tool` role is restored to the internal
  // `tool_result` discriminator.
  seedHistory(messages: readonly import("./structs.ts").Message[]): void {
    this.history.length = 0;
    for (const m of messages) {
      const role =
        m.role === "tool"
          ? "tool_result"
          : (m.role as "user" | "assistant" | "tool_result");
      const entry: InternalMessage = { role };
      if (m.content) entry.content = m.content;
      if (m.toolCalls && m.toolCalls.length > 0) entry.toolCalls = m.toolCalls;
      if (m.toolResult) entry.toolResult = m.toolResult;
      this.history.push(entry);
    }
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
      cost: 0,
    };

    const model = resolveModel(this.provider, cfg);
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
        const extraHeaders: Record<string, string> = {};
        const body = buildRequest(
          this.provider,
          this.toRequest(),
          cfg,
          this.options,
          this.tools,
          extraHeaders,
        );
        // Caching is a shared request-construction step (ADR-026): applied on
        // every send path by construction, like Text/batch. Before this, a
        // .caching() agent silently paid full input price every turn (BUG-004).
        if (this.options.caching) {
          await applyCaching(body, this.provider, cfg, this.options);
        }
        const resp = await executeRequest(
          this.provider,
          cfg,
          body,
          this.options,
          extraHeaders,
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
          cost: cfg.usageCostPath
            ? extractFloatPath(raw, cfg.usageCostPath) * cfg.usageCostScale
            : 0,
        };
        totalUsage.input += turnUsage.input;
        totalUsage.output += turnUsage.output;
        totalUsage.cost += turnUsage.cost;
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
        const callArgs = toolCallInput(call);
        const tool = this.tools.find((t) => t.name === call.name);
        const toolEvent: Event = {
          op: "tool_call",
          phase: "pre",
          provider: this.provider.name,
          model,
          tool: call.name,
          args: callArgs,
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
            content = await tool.run(callArgs);
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

  // toRequest projects the agent's internal history onto the public
  // ADR-020 Message shape so the shared buildRequest (request.ts) constructs
  // the body — caching, options, tool defs, system placement and message/tool
  // transforms all run once, identically to the Text/batch paths (ADR-026
  // PIPE-001/004). This is what closed BUG-006: the agent no longer hand-rolls
  // a partial body that applied only max_tokens.
  private toRequest(): Request {
    const messages: Message[] = this.history.map((m) => ({
      role: m.role,
      content: m.content ?? "",
      toolCalls: m.toolCalls ?? [],
      toolResult: m.toolResult ?? null,
    }));
    const request: Request = { messages };
    if (this.system) request.system = this.system;
    return request;
  }
}

function extractToolCalls(raw: unknown, cfg: ProviderSpec): ToolCall[] {
  if (cfg.chatWireShape === "ChatBedrock") return extractBedrockToolCalls(raw);
  if (cfg.chatWireShape === "ChatAnthropic") {
    return extractAnthropicToolCalls(raw);
  }
  if (cfg.chatWireShape === "ChatGoogle") {
    return extractGoogleToolCalls(raw);
  }
  if (cfg.chatWireShape === "ChatOpenAI") {
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
