// The symmetric response codec (ADR-076): one public decode/encode pair over
// the generated response-path tables.
//
// Before this module the reader was inlined three times — in the Text send
// path, in the Agent tool loop and in batch result parsing — and the three
// copies had drifted (the agent read neither cache nor reasoning usage). All
// three now call decodeResponse, which is what SYM-004 requires: the public
// entry point IS the function the send path calls, not a second implementation
// beside it.

import { PROVIDERS } from "./providers/providers.ts";
import type { ProviderName } from "./providers/providers.ts";
import { cachingConfig } from "./providers/caching.ts";
import { ValidationError } from "./errors.ts";
import {
  extractPath,
  optIntPath,
  optFloatPath,
  setWirePath,
} from "./paths.ts";
import { parseCacheUsage } from "./caching.ts";
import { captureProviderTurn } from "./provider_turn.ts";
import type { Response, Usage } from "./types.ts";

/**
 * decodeResponse extracts text and usage from a provider response body into the
 * canonical Response. `chatWireShape` is the EFFECTIVE wire shape for this
 * request (after `.protocol(...)` resolution, ADR-055): only
 * ChatResponsesOpenAI diverges (the output[] envelope); every other value uses
 * the provider's declared response paths.
 *
 * Keyless, IO-free and pure (ADR-076 SYM-002): no Client, no credential, no
 * network, no clock. The wire shape is required, not derived — one provider can
 * serve two chat protocols, and inferring it silently mis-parses (SYM-003).
 */
export function decodeResponse(
  provider: ProviderName,
  chatWireShape: string,
  body: string,
): Response {
  const raw: unknown = JSON.parse(body);
  const cfg = PROVIDERS[provider];
  // ADR-085: capture the assistant turn as the provider serialized it, from the
  // ORIGINAL text rather than from `raw` — re-encoding the parsed value would
  // emit JavaScript's rendering, not the provider's.
  const providerTurn = captureProviderTurn(body, cfg, chatWireShape);

  if (chatWireShape === "ChatResponsesOpenAI") {
    const envelope = parseResponsesEnvelope(raw);
    if (providerTurn) envelope.providerTurn = providerTurn;
    return envelope;
  }

  const cache = parseCacheUsage(raw, provider);
  const result: Response = {
    text: extractPath(raw, cfg.responseTextPath),
    usage: {
      input: optIntPath(raw, cfg.usageInputPath),
      output: optIntPath(raw, cfg.usageOutputPath),
      cacheWrite: cache.write,
      cacheRead: cache.read,
      reasoning: optIntPath(raw, cfg.reasoningTokensPath),
      // Scaling preserves absence: an unreported cost stays unreported rather
      // than becoming 0 x scale (AVAIL-007).
      cost: scaleCost(optFloatPath(raw, cfg.usageCostPath), cfg.usageCostScale),
    },
  };
  if (cfg.finishReasonPath) {
    const reason = extractPath(raw, cfg.finishReasonPath);
    if (reason) result.finishReason = reason;
  }
  if (cfg.finishMessagePath) {
    const message = extractPath(raw, cfg.finishMessagePath);
    if (message) result.finishMessage = message;
  }
  if (providerTurn) result.providerTurn = providerTurn;
  return result;
}

/**
 * encodeResponse is decodeResponse's inverse: it renders a canonical Response
 * back onto the wire for `provider` + `chatWireShape`. Every write location
 * comes from the same generated path accessors decodeResponse reads — there is
 * no second table and no path literal here (ADR-076 SYM-005).
 *
 * Keyless, IO-free and pure, like its mirror. The result is NOT byte-identical
 * to the body a provider would send: a provider body carries fields the
 * canonical Response does not model (ADR-014's `raw` exists for exactly that).
 * The contract is the canonical fixed point,
 * decode(encode(decode(b))) === decode(b) (SYM-006).
 */
export function encodeResponse(
  provider: ProviderName,
  chatWireShape: string,
  response: Response,
): string {
  guardOneWayFields(provider, response);
  if (chatWireShape === "ChatResponsesOpenAI") {
    return JSON.stringify(encodeResponsesEnvelope(response));
  }

  const cfg = PROVIDERS[provider];
  const raw: Record<string, unknown> = {};
  setWirePath(raw, cfg.responseTextPath, response.text);
  setWirePath(raw, cfg.usageInputPath, response.usage.input);
  setWirePath(raw, cfg.usageOutputPath, response.usage.output);
  const cc = cachingConfig(provider);
  if (cc) {
    setWirePath(raw, cc.writeTokensPath, response.usage.cacheWrite);
    setWirePath(raw, cc.readTokensPath, response.usage.cacheRead);
  }
  if (cfg.usageCostScale && response.usage.cost !== undefined) {
    setWirePath(raw, cfg.usageCostPath, response.usage.cost / cfg.usageCostScale);
  }
  setWirePath(raw, cfg.reasoningTokensPath, response.usage.reasoning);
  setWirePath(raw, cfg.finishReasonPath, response.finishReason);
  setWirePath(raw, cfg.finishMessagePath, response.finishMessage);
  return JSON.stringify(raw);
}

// guardOneWayFields refuses to encode a canonical field whose mapping is
// OneWay for this provider — the result set of CQ-WMAP-011 (ADR-076
// SYM-007). Only one member is in Phase 2's scope; the other,
// exceptGoogleToolCallID, covers tool calls, which are out (SYM-008).
//
// An empty value is not an error: there is nothing to write, so the common path
// stays usable and only the lying path fails. The ValidationError's field and
// message carry the mapping's canonicalPath and invertibilityNote
// verbatim.
function guardOneWayFields(provider: ProviderName, response: Response): void {
  if (provider === "vertex" && response.finishReason) {
    throw new ValidationError(
      "response.finish_reason",
      "Vertex carries no finish-reason field. Its path reads predictions[0].raiFilteredReason — a safety-filter explanation surfaced AS the finish reason. Extraction is a deliberate fusion, so the reverse leg cannot decide whether a given canonical finish_reason originated as a safety verdict, and writing an ordinary stop signal into that field would fabricate one.",
    );
  }
}

// parseResponsesEnvelope extracts text + usage from OpenAI's Responses reply
// (ADR-055). Unlike Chat Completions (choices[].message.content), the reply is
// an output[] array whose message item carries content[] blocks of type
// "output_text"; usage is input_tokens/output_tokens with cached + reasoning
// sub-details. Live-anchored 2026-07-02. Hand-coded per wire shape, symmetric
// with the ChatResponsesOpenAI request arm (ADR-028: behavior held by tests,
// not by declared response paths).
function parseResponsesEnvelope(raw: unknown): Response {
  const result: Response = {
    text: extractResponsesText(raw),
    usage: {
      input: optIntPath(raw, "usage.input_tokens"),
      output: optIntPath(raw, "usage.output_tokens"),
      cacheWrite: undefined,
      cacheRead: optIntPath(raw, "usage.input_tokens_details.cached_tokens"),
      reasoning: optIntPath(
        raw,
        "usage.output_tokens_details.reasoning_tokens",
      ),
      cost: undefined,
    },
  };
  const status = extractPath(raw, "status");
  if (status) result.finishReason = status;
  return result;
}

// encodeResponsesEnvelope mirrors parseResponsesEnvelope: it rebuilds OpenAI's
// Responses reply (ADR-055) — an output[] array whose message item carries
// content[] blocks of type "output_text", with input_tokens/output_tokens usage
// and cached + reasoning sub-details. Hand-coded per wire shape on both legs,
// symmetric with the reader, for the same reason the reader is.
function encodeResponsesEnvelope(response: Response): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  if (response.text) {
    raw.output = [
      {
        type: "message",
        content: [{ type: "output_text", text: response.text }],
      },
    ];
  }
  setWirePath(raw, "usage.input_tokens", response.usage.input);
  setWirePath(raw, "usage.output_tokens", response.usage.output);
  setWirePath(
    raw,
    "usage.input_tokens_details.cached_tokens",
    response.usage.cacheRead,
  );
  setWirePath(
    raw,
    "usage.output_tokens_details.reasoning_tokens",
    response.usage.reasoning,
  );
  setWirePath(raw, "status", response.finishReason);
  return raw;
}

// extractResponsesText walks the Responses output[] array for the first message
// item and returns its first output_text block. Iterating (rather than a fixed
// output[0].content[0] path) tolerates a leading reasoning item.
function extractResponsesText(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return "";
  const output = (raw as Record<string, unknown>).output;
  if (!Array.isArray(output)) return "";
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const m = item as Record<string, unknown>;
    if (m.type !== "message" || !Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (typeof block !== "object" || block === null) continue;
      const cm = block as Record<string, unknown>;
      if (cm.type === "output_text" && typeof cm.text === "string") {
        return cm.text;
      }
    }
  }
  return "";
}


// scaleCost applies the provider's USD conversion while preserving absence.
function scaleCost(
  cost: number | undefined,
  scale: number,
): number | undefined {
  return cost === undefined ? undefined : cost * scale;
}

// addOpt sums one dimension across two responses. Absence is ABSORBING
// (ADR-081 AVAIL-005): if either side did not report the dimension, neither
// does the sum. Summing what is present and calling it a total is the defect at
// aggregate scale — nine reported turns would hide the tenth unreported one,
// and the answer gets less trustworthy the longer a loop runs while looking
// more authoritative.
function addOpt(a: number | undefined, b: number | undefined) {
  return a === undefined || b === undefined ? undefined : a + b;
}

/**
 * accumulateUsage folds one turn's usage into a run's running total, every
 * dimension, absorbing. Named and single so there is exactly one place in this
 * SDK where "add a turn's usage to a run's usage" is defined — three of the
 * seven SDKs hand-wrote it with three of the six dimensions (BUG-045), which is
 * what having no such place produces.
 *
 * Callers seed from the first turn rather than from a zero value: the identity
 * for absorbing addition is a REPORTED zero, so an all-unreported seed would
 * absorb every subsequent turn to nothing.
 */
export function accumulateUsage(total: Usage, turn: Usage): Usage {
  return {
    input: addOpt(total.input, turn.input),
    output: addOpt(total.output, turn.output),
    cacheWrite: addOpt(total.cacheWrite, turn.cacheWrite),
    cacheRead: addOpt(total.cacheRead, turn.cacheRead),
    reasoning: addOpt(total.reasoning, turn.reasoning),
    cost: addOpt(total.cost, turn.cost),
  };
}
