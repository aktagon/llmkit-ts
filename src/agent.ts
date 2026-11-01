// Agent — multi-turn conversations with optional tool calling.
//
// @invariant history is mutated only inside chat(), once, when the call
//   succeeds. chat() is all-or-nothing (owner decision 4, HANDOFF-105 F4): on
//   any throw after the call starts — a non-2xx response, a middleware veto,
//   max iterations — the history is what it was before the call. The error
//   thrown is the one that stopped the call, and unsavedView() returns the
//   turns the call made, tool results included (owner decision 2, F5).
// @invariant tool execution failures never propagate out of the loop —
//   they are surfaced as `"error: ..."` tool-result content so the LLM
//   can recover (matches Go behaviour at go/agent.go:189).

import { PROVIDERS, type ProviderSpec } from "./providers/providers.ts";
import { APIError, ValidationError } from "./errors.ts";
import { accumulateUsage, attachRaw, decodeResponse } from "./response.ts";
import { responseToolCalls } from "./response_parts.ts";
import {
  encodeChat,
  executeRequest,
  prepareRequest,
  toolRunArgs,
  type PreparedRequest,
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
import { chatModelListed } from "./model_lookup.ts";

const DEFAULT_MAX_TOOL_ITERATIONS = 10;

// AgentSendOptions are the Agent's send options plus its loop control
// (ADR-098 RQC-002).
export interface AgentSendOptions extends SendOptions {
  maxToolIterations?: number | bigint;
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
  private history: Message[] = [];
  // The turns of the last call, when it failed; empty after a call that
  // succeeded (HANDOFF-105 F5, owner decision 2).
  private unsaved: Message[] = [];

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

  // unsavedView exposes the turns of the last failed call to the typed
  // builder's `bot.unsavedTurns` reader, copied as historyView copies.
  unsavedView(): readonly Message[] {
    return copyMessages(this.unsaved);
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

  // The request is prepared (validated, model resolved) with the user turn
  // before the turn joins the history, so a rejected request leaves the
  // history as it was (HANDOFF-105 F3). Every turn of the loop sends the same
  // Request with a longer history, so one preparation holds for all of them.
  // Once the call starts it is all-or-nothing (owner decision 4, F4). The call
  // builds its turns in a list of its own and adds them to the history only
  // when it succeeds (HANDOFF-105 F5), so bot.messages never shows a running
  // call's turns. A finished call replaces the history with the history it
  // started from plus its own turns, as in Go and Rust (HANDOFF-105 F7, owner
  // decision 3): of two overlapping calls, the one that finishes last wins.
  async chat(message: string): Promise<PromptResponse> {
    this.unsaved = [];
    const cfg = PROVIDERS[this.provider.name]!;
    const history = [...this.history];
    const prepared = prepareRequest(this.provider, cfg, {
      ...this.request,
      messages: [...history, { role: "user", parts: textParts(message) }],
    });
    // The call's turns start with the user turn prepareRequest returned, as
    // in Go and Rust: the saved turn is the one the call sends (HANDOFF-105 F6).
    const turns: Message[] = (prepared.messages ?? []).slice(history.length);
    let response: PromptResponse;
    try {
      response = await this.runToolLoop(cfg, prepared, history, turns);
    } catch (err) {
      this.unsaved = turns;
      throw err;
    }
    this.history = [...history, ...turns];
    return response;
  }

  // runToolLoop sends the history and the call's turns so far on each request,
  // and appends each new turn to turns.
  private async runToolLoop(
    cfg: ProviderSpec,
    prepared: PreparedRequest,
    history: readonly Message[],
    turns: Message[],
  ): Promise<PromptResponse> {
    const maxIters =
      this.options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    // Seeded from the first turn, not from zeros: absorbing addition's identity
    // is a REPORTED zero, and an all-unreported seed would absorb every turn to
    // nothing (ADR-081 AVAIL-005).
    let totalUsage: Usage | undefined;

    const mw = this.options.middleware;

    for (let i = 0; i < maxIters; i++) {
      // The shared encoder (ADR-026 PIPE-001, ADR-098 RQC-001, RQC-017): the
      // history becomes the Request's messages, and encodeChat checks every
      // turn before the pre hook fires, as on the Text/batch path.
      const { request, body, headers } = encodeChat(this.provider, cfg, {
        ...prepared,
        messages: [...history, ...turns],
      });
      const model = request.model;
      const llmEvent: Event = {
        op: "llm_request",
        phase: "pre",
        provider: this.provider.name,
        model,
        modelUnlisted: !chatModelListed(this.provider.name, model),
      };
      const veto = firePre(mw, llmEvent);
      if (veto) throw veto;
      const llmStart = performance.now();

      let respText = "";
      let decoded: PromptResponse;
      try {
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

      // Record the assistant turn as the response's parts: its text and its
      // tool calls, in the order the provider sent them (owner decision 1,
      // HANDOFF-105 F4). providerTurn is the same turn as the provider wrote
      // it, and is what the NEXT request sends (ADR-085). Before F4 the loop
      // kept only the tool calls of a tool turn, which dropped the model's
      // text beside them.
      const assistantTurn: Message = { role: "assistant", parts: [...decoded.parts] };
      if (decoded.providerTurn) assistantTurn.providerTurn = decoded.providerTurn;
      turns.push(assistantTurn);
      const calls = responseToolCalls(decoded);
      if (calls.length === 0) {
        // The terminal Response is the decoder's, with the loop's usage
        // total (ADR-076 SYM-004: one reader).
        const result: PromptResponse = { ...decoded, usage: totalUsage ?? {} };
        return attachRaw(result, respText, !!this.options.raw);
      }
      for (const call of calls) {
        const callArgs = toolRunArgs(call);
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
        turns.push({
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
