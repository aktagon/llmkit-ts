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
import { accumulateUsage, attachRaw, decodeResponse } from "./response.ts";
import { matchingBlocks } from "./paths.ts";
import {
  encodeBody,
  executeRequest,
  prepareRequest,
  toolCallInput,
  type SendOptions,
} from "./request.ts";
import { firePost, firePre } from "./middleware.ts";
import type { Event } from "./providers/middleware.ts";
import { applyCaching } from "./caching.ts";
import type {
  Provider,
  Request,
  Response as PromptResponse,
  Tool,
  Usage,
} from "./types.ts";
import type { Message, Part, ToolCall } from "./structs.ts";

const DEFAULT_MAX_TOOL_ITERATIONS = 10;

// AgentSendOptions are the Agent's send options plus its loop control
// (ADR-098 RQC-002).
export interface AgentSendOptions extends SendOptions {
  maxToolIterations?: number;
}

export class Agent {
  private readonly provider: Provider;
  // The Request every turn sends, without its messages: the model, system,
  // tool definitions and options (ADR-098 RQC-001). The history fills
  // messages on each turn.
  private readonly request: Request;
  // The functions that run the tools, kept beside the Request, which holds
  // only their definitions (RQC-018).
  private readonly tools: Tool[];
  private readonly options: AgentSendOptions;
  // The public Message list (ADR-100). An assistant turn the loop received
  // carries its providerTurn (ADR-085) beside its parts, which stay what the
  // loop reads to run tools; the next request replays the providerTurn.
  private readonly history: Message[] = [];

  constructor(
    provider: Provider,
    request: Request = {},
    tools: Tool[] = [],
    options: AgentSendOptions = {},
  ) {
    if (!PROVIDERS[provider.name]) {
      throw new ValidationError("provider", `unknown: ${provider.name}`);
    }
    if (!provider.apiKey) {
      throw new ValidationError("apiKey", "required");
    }
    this.provider = provider;
    this.request = request;
    this.tools = tools;
    this.options = options;
  }

  // historyView exposes the agent's conversation history to the typed
  // builder's `bot.messages` reader (ADR-020 HIST-004). The returned array
  // and each parts array are fresh copies so callers can iterate without
  // invalidation when the agent appends mid-loop; the part payloads are
  // shared with runtime state by the shallow-immutability rule documented
  // on `bot.messages`.
  historyView(): readonly Message[] {
    return copyMessages(this.history);
  }

  // seedHistory replaces the history with the public Message list passed
  // via the typed builder's `bot.history(...)` chain (ADR-020 HIST-007). A
  // turn restored from loadHistory carries its providerTurn back into the
  // loop, which is what makes cross-process resume (ADR-023) replay rather
  // than reconstruct.
  seedHistory(messages: readonly Message[]): void {
    this.history.length = 0;
    this.history.push(...copyMessages(messages));
  }

  async chat(message: string): Promise<PromptResponse> {
    this.history.push({ role: "user", parts: textParts(message) });
    return this.runToolLoop();
  }

  private async runToolLoop(): Promise<PromptResponse> {
    const cfg = PROVIDERS[this.provider.name]!;
    const maxIters =
      this.options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    // Seeded from the first turn, not from zeros: absorbing addition's identity
    // is a REPORTED zero, and an all-unreported seed would absorb every turn to
    // nothing (ADR-081 AVAIL-005).
    let totalUsage: Usage | undefined;

    const mw = this.options.middleware;

    for (let i = 0; i < maxIters; i++) {
      // The shared setup step and encoder (ADR-026 PIPE-001, ADR-098 RQC-001,
      // RQC-017): the history becomes the Request's messages, so validation,
      // model resolution and every transform run as on the Text/batch path.
      const request = prepareRequest(this.provider, cfg, {
        ...this.request,
        messages: [...this.history],
      });
      const model = request.model;
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
      let respText = "";
      let decoded: PromptResponse;
      try {
        const { body, headers } = encodeBody(this.provider.name, cfg, request);
        // Caching is a shared request-construction step (ADR-026): applied on
        // every send path by construction, like Text/batch. Before this, a
        // .caching() agent silently paid full input price every turn (BUG-004).
        if (this.options.caching) {
          await applyCaching(body, this.provider, cfg, model, this.options);
        }
        const resp = await executeRequest(
          this.provider,
          cfg,
          model,
          body,
          this.options,
          headers,
        );
        if (!resp.ok) {
          throw new APIError(
            resp.status,
            resp.text,
            resp.status === 429 || resp.status >= 500,
          );
        }
        respText = resp.text;
        raw = JSON.parse(respText);
        // ADR-076 SYM-004: the tool loop reads through the public codec, so a
        // turn sees the same projection Text.prompt does. Before this it read
        // usage inline and never populated cache or reasoning tokens.
        decoded = decodeResponse(
          this.provider.name,
          cfg.chatWireShape,
          resp.text,
        );
        totalUsage =
          totalUsage === undefined
            ? decoded.usage
            : accumulateUsage(totalUsage, decoded.usage);
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
        usage: decoded.usage,
        duration: performance.now() - llmStart,
      });

      const calls = extractToolCalls(raw, cfg);
      if (calls.length === 0) {
        // The terminal turn is captured too: an agent kept alive for another
        // chat() replays it like any other, and Response carries it so a caller
        // running their own loop can thread the turn forward without parsing raw
        // per provider (ADR-085 § 6).
        const terminal: Message = {
          role: "assistant",
          parts: textParts(decoded.text),
        };
        if (decoded.providerTurn) terminal.providerTurn = decoded.providerTurn;
        this.history.push(terminal);
        const result: PromptResponse = {
          text: decoded.text,
          usage: totalUsage ?? {},
        };
        if (decoded.providerTurn) result.providerTurn = decoded.providerTurn;
        if (decoded.finishReason) result.finishReason = decoded.finishReason;
        if (decoded.finishMessage) result.finishMessage = decoded.finishMessage;
        return attachRaw(result, respText, !!this.options.raw);
      }

      // Record the assistant turn. Its tool call parts are the projection the
      // loop runs tools from; providerTurn is the same turn as the provider wrote
      // it, and is what the NEXT request sends (ADR-085). Before this, the turn
      // was rebuilt from the calls alone, which silently dropped any prose the
      // model emitted alongside the call.
      const assistantTurn: Message = {
        role: "assistant",
        parts: calls.map((toolCall) => ({ toolCall })),
      };
      if (decoded.providerTurn) assistantTurn.providerTurn = decoded.providerTurn;
      this.history.push(assistantTurn);
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
        // One tool turn per result (ADR-100 MSG-009).
        this.history.push({
          role: "tool",
          parts: [{ toolResult: { toolUseId: call.id, content } }],
        });
      }
    }

    throw new Error(`max tool iterations (${maxIters}) reached`);
  }
}

// textParts is one text part, or none for empty text: a turn with no parts
// sends "" as before ADR-100, and matches the other SDKs' agent history.
function textParts(text: string): Part[] {
  return text ? [{ text }] : [];
}

// copyMessages copies the outer array and each parts array.
export function copyMessages(messages: readonly Message[]): Message[] {
  return messages.map((m) => ({ ...m, parts: [...m.parts] }));
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

// The N=1 proof for matchingBlocks: this is the SAME call the text reader
// makes, with a different marker value. Before BUG-053 these were two
// hand-rolled scans over one array that happened to agree; agreement by
// coincidence is what let text extraction break on thinking blocks while
// tool-call extraction, scanning the very same array, kept working.
function extractAnthropicToolCalls(raw: unknown): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const b of matchingBlocks(raw, "content", "type", "tool_use")) {
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
