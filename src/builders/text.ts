// D2.1 (plan-018) — owns the runtime for *Text.prompt. The body
// previously lived in `prompt(provider, request, options)` exported
// from llmkit.ts; that public free function was absorbed here so the
// typed-builder is the single canonical entry point.
//
// `buildPromptArgs` translates a chained Text builder + final user
// message into the (provider, Request, SendOptions) triple consumed by
// request.ts. The Request carries the model, every turn and every
// request-shaping option (ADR-098 RQC-001); SendOptions carries what does
// not shape the request (RQC-002).
//
// The final user turn (ADR-100 MSG-004): the `_files` as file parts, then
// the image parts, then one text part joining the text parts and
// `finalText` with newlines. The text part is left out when there is no
// text. Image parts reach the wire as native image blocks (ADR-060).

import { PROVIDERS } from "../providers/providers.ts";
import type { ProviderName } from "../providers/providers.ts";
import { APIError, ValidationError } from "../errors.ts";
import { applyCaching } from "../caching.ts";
import { decodeResponseRaw } from "../response.ts";
import {
  encodeBody,
  executeRequest,
  prepareRequest,
  resolveChatProtocol,
  type SendOptions,
} from "../request.ts";
import { firePost, firePre } from "../middleware.ts";
import type { Event } from "../providers/middleware.ts";
import type { Provider, Request, Response } from "../types.ts";
import type { Message, Part } from "../structs.ts";
import type { Text } from "./builders.ts";

/**
 * Translates a chained Text builder + final prompt text into the
 * triple the send paths consume: provider, Request, SendOptions. The
 * builder's model goes into Request.model, so the provider carries none.
 */
export function buildPromptArgs(
  b: Text,
  finalText: string,
): { provider: Provider; request: Request; options: SendOptions } {
  const provider = textProvider(b);

  // The final user turn, ordered so every request golden keeps its bytes:
  // files, then images, then the text parts and finalText joined with
  // newlines (the text-parts-openai request-wire golden holds every SDK to
  // the join). It follows the history (BUG-108).
  const turn: Part[] = b._files.map((file) => ({ file }));
  const textSegments: string[] = [];
  for (const p of b._parts) {
    if ("text" in p) {
      if (p.text) textSegments.push(p.text);
    } else if ("image" in p) {
      turn.push(p);
    }
  }
  if (finalText) textSegments.push(finalText);
  if (textSegments.length > 0) turn.push({ text: textSegments.join("\n") });

  const request: Request = {};
  if (b._model) request.model = b._model;
  if (b._system) request.system = b._system;
  const messages: Message[] = [...b._history];
  if (turn.length > 0) messages.push({ role: "user", parts: turn });
  if (messages.length > 0) request.messages = messages;
  if (b._tools.length > 0) request.tools = b._tools;
  if (b._schema) request.schema = b._schema;
  if (b._maxTokens !== undefined) request.maxTokens = b._maxTokens;
  if (b._temperature !== undefined) request.temperature = b._temperature;
  if (b._topP !== undefined) request.topP = b._topP;
  if (b._topK !== undefined) request.topK = b._topK;
  if (b._frequencyPenalty !== undefined)
    request.frequencyPenalty = b._frequencyPenalty;
  if (b._presencePenalty !== undefined)
    request.presencePenalty = b._presencePenalty;
  if (b._seed !== undefined) request.seed = b._seed;
  if (b._stopSequences.length > 0) request.stop = b._stopSequences;
  if (b._thinkingBudget !== undefined)
    request.thinkingBudget = b._thinkingBudget;
  if (b._reasoningEffort !== undefined)
    request.reasoningEffort = b._reasoningEffort;
  if (b._safetySettings.length > 0) request.safetySettings = b._safetySettings;

  return { provider, request, options: textSendOptions(b) };
}

/**
 * The body of the generated Text.request chain method (ADR-098 RQC-005), the
 * inverse of buildPromptArgs: every request-shaping field takes req's value.
 * req.messages become the history, and the text, image and file parts are
 * dropped, because req.messages already holds every turn. The send settings
 * (textSendOptions) and the protocol are not request fields, so they stay.
 */
export function textSetRequest(b: Text, req: Request): void {
  b._model = req.model ?? "";
  b._system = req.system ?? "";
  b._history = [...(req.messages ?? [])];
  b._parts = [];
  b._files = [];
  b._tools = [...(req.tools ?? [])];
  b._schema = req.schema ?? "";
  b._maxTokens = req.maxTokens;
  b._temperature = req.temperature;
  b._topP = req.topP;
  b._topK = req.topK;
  b._stopSequences = [...(req.stop ?? [])];
  b._seed = req.seed;
  b._frequencyPenalty = req.frequencyPenalty;
  b._presencePenalty = req.presencePenalty;
  b._reasoningEffort = req.reasoningEffort;
  b._thinkingBudget = req.thinkingBudget;
  b._safetySettings = [...(req.safetySettings ?? [])];
}

// textSendOptions are the chain settings that do not shape the request
// (RQC-002): caching and its TTL, middleware and raw. Prompt and batch read
// them from here.
export function textSendOptions(b: Text): SendOptions {
  const options: SendOptions = {};
  if (b._caching) options.caching = true;
  if (b._cacheTTL !== undefined) options.cacheTTL = b._cacheTTL;
  if (b._middleware.length > 0) options.middleware = b._middleware;
  if (b._raw) options.raw = true;
  return options;
}

// textProvider is the client's provider as the send paths read it: name, key,
// caller headers, timeout and base URL. It carries no model: the builder's
// model is Request.model.
export function textProvider(b: Text): Provider {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
    headers: b.client.provider.headers,
    timeoutMs: b.client.provider.timeoutMs,
  };
  if (b.client.provider.baseUrl) provider.baseUrl = b.client.provider.baseUrl;
  return provider;
}

export async function textPrompt(b: Text, msg: string): Promise<Response> {
  const { provider, request: built, options } = buildPromptArgs(b, msg);

  const cfg = PROVIDERS[provider.name];
  if (!cfg) {
    throw new ValidationError("provider", `unknown: ${provider.name}`);
  }
  if (!provider.apiKey) {
    throw new ValidationError("apiKey", "required");
  }

  // ADR-055: opt into a non-default chat protocol (Responses). Overrides the
  // endpoint + wire shape on this call's cfg copy; empty keeps the default.
  // Throws ValidationError(field:"protocol") before any network call when the
  // token is unknown or the provider does not expose it.
  const effCfg = resolveChatProtocol(cfg, b._protocol);
  const request = prepareRequest(provider, effCfg, built);

  const baseEvent: Event = {
    op: "llm_request",
    phase: "pre",
    provider: provider.name,
    model: request.model,
  };
  const veto = firePre(options.middleware, baseEvent);
  if (veto) throw veto;
  const start = performance.now();

  try {
    const { body, headers } = encodeBody(provider.name, effCfg, request);
    if (options.caching) {
      await applyCaching(body, provider, effCfg, request.model, options);
    }

    const resp = await executeRequest(
      provider,
      effCfg,
      request.model,
      body,
      options,
      headers,
    );
    if (!resp.ok) {
      throw new APIError(
        resp.status,
        resp.text,
        resp.status === 429 || resp.status >= 500,
      );
    }

    // ADR-076 SYM-004: the public decodeResponse IS this send path's reader.
    // ADR-055's ChatResponsesOpenAI arm is selected inside it by the effective
    // wire shape, so the branch does not live here.
    const result: Response = decodeResponseRaw(
      provider.name,
      effCfg.chatWireShape,
      resp.text,
      !!b._raw,
    );
    firePost(options.middleware, {
      ...baseEvent,
      usage: result.usage,
      duration: performance.now() - start,
    });
    return result;
  } catch (err) {
    firePost(options.middleware, {
      ...baseEvent,
      err: err instanceof Error ? err : new Error(String(err)),
      duration: performance.now() - start,
    });
    throw err;
  }
}
