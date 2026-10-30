// The symmetric response codec (ADR-076): one public decode/encode pair over
// the generated response-path tables.
//
// Before this module the reader was inlined three times — in the Text send
// path, in the Agent tool loop and in batch result parsing — and the three
// copies had drifted (the agent read neither cache nor reasoning usage). All
// three now call decodeResponse, which is what SYM-004 requires: the public
// entry point IS the function the send path calls, not a second implementation
// beside it.

import {
  PROVIDERS,
  wireShapeFinishReasonFallback,
  wireShapeFinishReasons,
  wireShapeFixedValues,
  wireShapeResponseCreatedPath,
  wireShapeResponseIdPath,
  wireShapeResponseModelPath,
} from "./providers/providers.ts";
import type {
  FinishReason,
  FinishReasonEntry,
  ProviderName,
  ProviderSpec,
} from "./providers/providers.ts";
import { cachingConfig } from "./providers/caching.ts";
import {
  extractPath,
  optIntPath,
  optFloatPath,
  setWirePath,
} from "./paths.ts";
import { parseCacheUsage } from "./caching.ts";
import { captureProviderTurn } from "./provider_turn.ts";
import { ValidationError } from "./errors.ts";
import { checkTurnParts, withWireShape } from "./request.ts";
import {
  decodeChatParts,
  encodeChatParts,
  noToolCallConfigError,
  responseText,
  responseToolCalls,
} from "./response_parts.ts";
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
 * It runs the served-shape check encodeResponse runs (servedChatWireShape,
 * HANDOFF-105 F4): a shape the provider does not serve, or a provider with no
 * chat shape, is a ValidationError on field "chatWireShape", and an unknown
 * provider one on "provider".
 */
/**
 * Fill in an unspecified wire shape with the provider's DEFAULT chat protocol.
 * 
 * Callers that decode a body they know is Chat Completions — batch result lines,
 * chiefly — pass "" to mean "not the Responses envelope". Harmless while the shape
 * only chose between the Responses arm and the provider's declared paths; NOT
 * harmless once it also selects the TEXT READER, because "" resolved to no config,
 * which is the positional reader BUG-053 removed. Batched Anthropic replies with a
 * leading thinking block decoded to "" long after the send path was fixed.
 * 
 * Resolving here keeps N=1. ADR-055 requires every provider's default protocol to
 * be a Chat Completions family, so this can never resolve INTO the Responses arm.
 */
function resolveChatWireShape(provider: ProviderName, chatWireShape: string): string {
  return chatWireShape !== "" ? chatWireShape : PROVIDERS[provider].chatWireShape;
}

export function decodeResponse(
  provider: ProviderName,
  chatWireShape: string,
  body: string,
): Response {
  chatWireShape = servedChatWireShape(provider, chatWireShape);
  const raw: unknown = JSON.parse(body);
  const cfg = PROVIDERS[provider];
  // ADR-085: capture the assistant turn as the provider serialized it, from the
  // ORIGINAL text rather than from `raw` — re-encoding the parsed value would
  // emit JavaScript's rendering, not the provider's.
  const providerTurn = captureProviderTurn(body, cfg, chatWireShape);

  if (chatWireShape === "ChatResponsesOpenAI") {
    const envelope = parseResponsesEnvelope(raw);
    if (providerTurn) envelope.providerTurn = providerTurn;
    envelope.chatWireShape = chatWireShape;
    return envelope;
  }

  const cache = parseCacheUsage(raw, provider);
  const result: Response = {
    parts: decodeChatParts(body, raw, provider, cfg, chatWireShape),
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
    if (reason) setFinishReason(result, chatWireShape, reason, raw);
  }
  if (cfg.finishMessagePath) {
    const message = extractPath(raw, cfg.finishMessagePath);
    if (message) result.finishMessage = message;
  }
  setResponseIdentity(result, raw, cfg.responseIdPath, cfg.responseModelPath);
  setCreated(result, raw, chatWireShape);
  if (providerTurn) result.providerTurn = providerTurn;
  if (chatWireShape) result.chatWireShape = chatWireShape;
  return result;
}

/**
 * setCreated sets the response's creation time (owner decision 4, HANDOFF-105
 * section 3b) from the shape's created path. Absent when the shape declares
 * none (Anthropic, Google, Bedrock) or the body has no value there.
 */
function setCreated(result: Response, raw: unknown, chatWireShape: string): void {
  const created = optIntPath(raw, wireShapeResponseCreatedPath(chatWireShape));
  if (created !== undefined) result.created = created;
}

/**
 * servedChatWireShape resolves the shape decodeResponse reads (HANDOFF-105 F4)
 * and encodeResponse writes: the named one,
 * or the provider's default when chatWireShape is "". An unknown provider is a
 * ValidationError on field "provider", as in Go. A shape the provider does
 * not serve is a ValidationError on field "chatWireShape", the name
 * encodeRequest uses (owner decision 2, HANDOFF-105 section 3b), and so is a provider that serves no chat shape at
 * all: writing provider paths into another family's body produces a body
 * neither family reads.
 */
function servedChatWireShape(provider: ProviderName, chatWireShape: string): string {
  if (!PROVIDERS[provider]) {
    throw new ValidationError("provider", `unknown: ${provider}`);
  }
  const shape = resolveChatWireShape(provider, chatWireShape);
  if (shape === "" || !withWireShape(PROVIDERS[provider], shape)) {
    throw new ValidationError(
      "chatWireShape",
      `provider "${provider}" does not serve chat wire shape "${chatWireShape}"`,
    );
  }
  return shape;
}

/**
 * encodeFixedValues writes the fields every body of the shape carries with the
 * same value (shapeFixedValue, owner decision 4): on ChatOpenAI the object
 * type, the choice index and the message role.
 */
function encodeFixedValues(raw: Record<string, unknown>, chatWireShape: string): void {
  for (const fv of wireShapeFixedValues(chatWireShape)) setWirePath(raw, fv.path, fv.value);
}

/**
 * decodeFinishReason maps the provider's finish-reason string to its canonical
 * value through the chat wire shape's generated table (ADR-099 CRF-001). A
 * string with no entry is "other" (CRF-011). `raw` is read only for an entry
 * whose wire value fuses two canonical values (CRF-007); a caller with no body
 * passes undefined, and such an entry then does not match.
 */
export function decodeFinishReason(
  chatWireShape: string,
  wire: string,
  raw: unknown,
): FinishReason {
  const entry = wireShapeFinishReasons(chatWireShape).find(
    (e) =>
      e.wireValue === wire &&
      (e.detailPath === "" || extractPath(raw, e.detailPath) === e.detailValue),
  );
  return entry ? entry.canonical : "other";
}

/**
 * setFinishReason sets both finish-reason fields from the provider's string:
 * providerFinishReason verbatim (CRF-002), finishReason canonical.
 */
export function setFinishReason(
  result: Response,
  chatWireShape: string,
  wire: string,
  raw: unknown,
): void {
  result.providerFinishReason = wire;
  result.finishReason = decodeFinishReason(chatWireShape, wire, raw);
}

/**
 * encodeFinishReason picks the wire value encodeResponse writes (ADR-099
 * CRF-010). The provider's own string wins when the target shape knows it with
 * the same canonical value, so a same-format round trip is exact (Google
 * RECITATION stays RECITATION). A response decoded from the target shape also
 * keeps a string the table does not know (owner decision 1, HANDOFF-105 F3):
 * Anthropic pause_turn decodes as other and encodes back as pause_turn.
 * Otherwise the preferred entry for the canonical
 * value is written (Anthropic end_turn becomes OpenAI stop). A canonical value
 * the shape has no entry for is written as the shape's declared fallback
 * (owner decision 1, HANDOFF-105 section 3b): ChatOpenAI other is stop. An
 * unmapped provider string, such as Google LANGUAGE, is not a known wire
 * value, so it too encodes as the fallback (CRF-010).
 *
 * Undefined only when the response reports no finish reason, or the shape
 * declares no table: there is nothing to write.
 */
function encodeFinishReason(
  chatWireShape: string,
  response: Response,
): FinishReasonEntry | undefined {
  const canonical = response.finishReason;
  if (canonical === undefined) return undefined;
  const table = wireShapeFinishReasons(chatWireShape);
  const known = table.find(
    (e) => e.wireValue === response.providerFinishReason && e.canonical === canonical,
  );
  if (known) return known;
  // After the table, so a fused entry (CRF-007) keeps its detail.
  if (response.providerFinishReason !== undefined && response.chatWireShape === chatWireShape) {
    return {
      wireValue: response.providerFinishReason,
      detailPath: "",
      detailValue: "",
      canonical,
      preferred: false,
    };
  }
  const entry = table.find((e) => e.preferred && e.canonical === canonical);
  if (entry) return entry;
  const fallback = wireShapeFinishReasonFallback(chatWireShape, canonical);
  return fallback === undefined
    ? undefined
    : { wireValue: fallback, detailPath: "", detailValue: "", canonical, preferred: false };
}

/**
 * setResponseIdentity sets the response id and the reported model (ADR-099
 * CRF-012) from the given paths. Each stays absent when its path is empty
 * (Bedrock) or the body has no value there.
 */
function setResponseIdentity(
  result: Response,
  raw: unknown,
  idPath: string,
  modelPath: string,
): void {
  const id = idPath ? extractPath(raw, idPath) : "";
  if (id) result.id = id;
  const model = modelPath ? extractPath(raw, modelPath) : "";
  if (model) result.model = model;
}

/**
 * decodeResponseRaw is decodeResponse plus the ADR-014 raw opt-in. Every
 * Response send path (prompt, agent, batch) decodes or attaches through here,
 * so none can forget the caller's .raw() (BUG-073). Internal: the public codec
 * keeps its signature (ADR-076).
 */
export function decodeResponseRaw(
  provider: ProviderName,
  chatWireShape: string,
  body: string,
  raw: boolean,
): Response {
  return attachRaw(decodeResponse(provider, chatWireShape, body), body, raw);
}

/** attachRaw sets resp.raw to the parsed body when the caller opted in. */
export function attachRaw(resp: Response, body: string, raw: boolean): Response {
  if (raw) resp.raw = JSON.parse(body) as unknown;
  return resp;
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
  chatWireShape = servedChatWireShape(provider, chatWireShape);
  guardOneWayFields(provider, response);
  checkTurnParts("assistant", response.parts, "parts");
  if (chatWireShape === "ChatResponsesOpenAI") {
    return JSON.stringify(encodeResponsesEnvelope(provider, chatWireShape, response));
  }

  const cfg = PROVIDERS[provider];
  const raw: Record<string, unknown> = {};
  encodeChatParts(raw, provider, cfg, chatWireShape, response.parts);
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
  const finish = encodeFinishReason(chatWireShape, response);
  if (finish) {
    setWirePath(raw, cfg.finishReasonPath, finish.wireValue);
    setWirePath(raw, finish.detailPath, finish.detailValue);
  }
  setWirePath(raw, cfg.finishMessagePath, response.finishMessage);
  setWirePath(raw, cfg.responseIdPath, response.id);
  setWirePath(raw, cfg.responseModelPath, response.model);
  setWirePath(raw, wireShapeResponseCreatedPath(chatWireShape), response.created);
  encodeFixedValues(raw, chatWireShape);
  return JSON.stringify(raw);
}

// guardOneWayFields refuses to encode a canonical field whose mapping is
// OneWay for this provider — the result set of CQ-WMAP-011 restricted to
// Response (ADR-076 SYM-007). That set is empty today:
// exceptGoogleToolCallID is on ToolCall, whose Google id the config
// never writes (HANDOFF-105 F4), and
// exceptVertexFinishReason is on the image response since ADR-099 slice
// C4 (CRF-006). A Vertex chat Response writes no finish reason anyway: Vertex
// has no chat wire shape, so encodeFinishReason finds no table.
//
// The guard stays so a new whole-field exception on Response fails
// lint_response_codec.py until it is guarded here. An empty value is not an
// error: there is nothing to write. The ValidationError's field and message
// carry the mapping's canonicalPath and invertibilityNote verbatim.
function guardOneWayFields(_provider: ProviderName, _response: Response): void {
  // No whole-field one-way exception on Response today.
}

// parseResponsesEnvelope extracts text + usage from OpenAI's Responses reply
// (ADR-055). Unlike Chat Completions (choices[].message.content), the reply is
// an output[] array whose message item carries content[] blocks of type
// "output_text"; usage is input_tokens/output_tokens with cached + reasoning
// sub-details. Live-anchored 2026-07-02. Hand-coded per wire shape, symmetric
// with the ChatResponsesOpenAI request arm (ADR-028: behavior held by tests,
// not by declared response paths).
function parseResponsesEnvelope(raw: unknown): Response {
  const text = extractResponsesText(raw);
  const result: Response = {
    parts: text ? [{ text }] : [],
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
  if (status) setFinishReason(result, "ChatResponsesOpenAI", status, raw);
  setResponseIdentity(
    result,
    raw,
    wireShapeResponseIdPath("ChatResponsesOpenAI"),
    wireShapeResponseModelPath("ChatResponsesOpenAI"),
  );
  setCreated(result, raw, "ChatResponsesOpenAI");
  return result;
}

// encodeResponsesEnvelope mirrors parseResponsesEnvelope: it rebuilds OpenAI's
// Responses reply (ADR-055) — an output[] array whose message item carries
// content[] blocks of type "output_text", with input_tokens/output_tokens usage
// and cached + reasoning sub-details. Hand-coded per wire shape on both legs,
// symmetric with the reader, for the same reason the reader is. The shape
// declares no ToolCallResponseConfig, so a response with tool calls is a
// ValidationError on field "toolCalls" (HANDOFF-105 F4 decision 2).
function encodeResponsesEnvelope(
  provider: ProviderName,
  chatWireShape: string,
  response: Response,
): Record<string, unknown> {
  if (responseToolCalls(response).length > 0) {
    throw noToolCallConfigError(provider, chatWireShape);
  }
  const raw: Record<string, unknown> = {};
  const text = responseText(response);
  if (text) {
    raw.output = [
      {
        type: "message",
        content: [{ type: "output_text", text }],
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
  const finish = encodeFinishReason(chatWireShape, response);
  if (finish) {
    setWirePath(raw, "status", finish.wireValue);
    setWirePath(raw, finish.detailPath, finish.detailValue);
  }
  setWirePath(raw, wireShapeResponseIdPath("ChatResponsesOpenAI"), response.id);
  setWirePath(raw, wireShapeResponseModelPath("ChatResponsesOpenAI"), response.model);
  setWirePath(raw, wireShapeResponseCreatedPath("ChatResponsesOpenAI"), response.created);
  encodeFixedValues(raw, chatWireShape);
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
