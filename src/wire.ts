// ADR-023 wire-format stability for serialized *Agent history.
//
// saveHistory + loadHistory are the ONLY guaranteed-stable
// serialization path (STAB-009). Direct JSON.stringify on a Message
// produces valid JSON but lacks the `_v` envelope and loadHistory
// rejects it with MissingWireVersionError (STAB-011).

import type { MediaRef, Message, Part, ToolCall } from "./structs.ts";
import { base64ToBytes, bytesToBase64 } from "./image.ts";
import { compactJson, JsonText, writeJson } from "./json_text.ts";
import { checkProviderTurn, extractRawJsonElements, extractRawJsonPath } from "./provider_turn.ts";
import { ValidationError } from "./errors.ts";
import { checkChatPart } from "./part_kinds.ts";
import { PART_KINDS } from "./structs.ts";
import { WIRE_SCHEMA_VERSION } from "./wire_version.ts";

/**
 * UnsupportedWireVersionError is thrown when a document's `_v` is not the
 * SDK's WIRE_SCHEMA_VERSION. A newer document needs a newer SDK. An older
 * one, such as version 1 before ADR-100, has no migrator (ADR-100 MSG-014,
 * an exception to ADR-023 STAB-006): the caller must rebuild it.
 */
export class UnsupportedWireVersionError extends Error {
  readonly got: number;
  readonly want: number;
  constructor(got: number, want: number) {
    super(
      `llmkit: unsupported wire schema version: got ${got}, want ${want}`,
    );
    this.name = "UnsupportedWireVersionError";
    this.got = got;
    this.want = want;
  }
}

export class MissingWireVersionError extends Error {
  constructor() {
    super("llmkit: wire document missing _v key");
    this.name = "MissingWireVersionError";
  }
}

export class UnknownWireKeyError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`llmkit: unknown top-level wire key: ${JSON.stringify(key)}`);
    this.name = "UnknownWireKeyError";
    this.key = key;
  }
}

/**
 * MalformedWireDocumentError is thrown when a wire document satisfies
 * the version envelope but its shape violates the wire schema
 * (non-object root, non-integer `_v`, non-array `messages`, non-object
 * message entry). Symmetric with the Missing / Unsupported /
 * UnknownWireKey errors so consumers can branch typed on every
 * failure mode.
 */
export class MalformedWireDocumentError extends Error {
  constructor(detail: string) {
    super(`llmkit: malformed wire document: ${detail}`);
    this.name = "MalformedWireDocumentError";
  }
}

interface WireDoc {
  _v: number;
  messages: WireMessage[];
  _meta?: Record<string, unknown>;
}

interface WireMessage {
  role: string;
  // A part is an object with exactly one key, its variant name (ADR-100
  // MSG-012).
  parts: Record<string, unknown>[];
  // ADR-085. Optional: a turn that never had a payload and a turn whose
  // payload was dropped are the same thing to a reader. Omitting also keeps the
  // canonical messages.json golden byte-identical, since the wire.ttl fixture
  // declares no payload.
  provider_turn?: WireProviderTurn;
}

interface WireProviderTurn {
  wire_shape: string;
  wire: string;
}

/**
 * saveHistory serializes a Message list into the canonical versioned
 * wire format (ADR-023 STAB-002, version 2 per ADR-100 MSG-012). The
 * output carries a `_v` integer and a `messages` array of {role, parts}.
 * Each part is an object with one key, its variant name; media bytes are
 * inline standard base64 (MSG-013).
 */
export function saveHistory(messages: readonly Message[]): string {
  const wire: WireMessage[] = messages.map((m, i) => toWireMessage(m, i));
  const doc: WireDoc = { _v: WIRE_SCHEMA_VERSION, messages: wire };
  return writeJson(doc);
}

/**
 * loadHistory parses a wire document and returns the in-memory
 * Message array. Throws MissingWireVersionError when `_v` is absent,
 * UnsupportedWireVersionError when `_v` is not the SDK's
 * WIRE_SCHEMA_VERSION (a version 1 document included, ADR-100 MSG-014),
 * UnknownWireKeyError on a top-level key outside (`_v`, `messages`,
 * `_meta`), and MalformedWireDocumentError on a part with zero keys, two
 * keys or an unknown key (MSG-012). Unknown keys nested inside a Message
 * or a part's payload are tolerated for additive forward compatibility
 * (STAB-003).
 */
export function loadHistory(data: string): Message[] {
  const parsed = JSON.parse(data);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MalformedWireDocumentError("not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (!("_v" in obj)) throw new MissingWireVersionError();
  const version = obj._v;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new MalformedWireDocumentError(
      `_v is not a non-negative integer: ${String(version)}`,
    );
  }
  if (version !== WIRE_SCHEMA_VERSION) {
    throw new UnsupportedWireVersionError(version, WIRE_SCHEMA_VERSION);
  }
  for (const key of Object.keys(obj)) {
    if (key !== "_v" && key !== "messages" && key !== "_meta") {
      throw new UnknownWireKeyError(key);
    }
  }
  const rawMsgs = obj.messages;
  if (rawMsgs === undefined) return [];
  if (!Array.isArray(rawMsgs)) {
    throw new MalformedWireDocumentError(
      "messages is not an array of message objects",
    );
  }
  // A tool call's input is JSON text (HANDOFF-105 F7, owner decision 1): it is
  // read from the document's text, not from the parse, which would round an
  // integer past 2^53 and reorder integer-like keys.
  const rawMsgTexts = extractRawJsonElements(data, "messages") ?? [];
  return rawMsgs.map((m, i) => {
    const message = fromWireMessage(m, rawMsgTexts[i]);
    checkProviderTurn(message.providerTurn, `messages[${i}].provider_turn`);
    return message;
  });
}

function toWireMessage(m: Message, i: number): WireMessage {
  const out: WireMessage = {
    role: m.role,
    parts: m.parts.map((p, j) => {
      const field = `messages[${i}].parts[${j}]`;
      checkChatPart(p, field);
      return toWirePart(p, field);
    }),
  };
  if (m.providerTurn) {
    out.provider_turn = {
      wire_shape: m.providerTurn.wireShape,
      wire: m.providerTurn.wire,
    };
  }
  return out;
}

function wireInput(tc: ToolCall, field: string): JsonText {
  try {
    return new JsonText(tc.input as string);
  } catch {
    throw new ValidationError(field, `tool call "${tc.name}" input is not JSON`);
  }
}

function toWireMedia(m: MediaRef): Record<string, unknown> {
  return { mime_type: m.mimeType, bytes: bytesToBase64(m.bytes) };
}

function toWirePart(p: Part, field: string): Record<string, unknown> {
  if ("text" in p) return { text: p.text };
  if ("image" in p) return { image: toWireMedia(p.image) };
  if ("file" in p) {
    const f = p.file;
    return { file: { id: f.id, uri: f.uri, mime_type: f.mimeType, name: f.name } };
  }
  if ("toolCall" in p) {
    const tc = p.toolCall;
    const call: Record<string, unknown> = { id: tc.id, name: tc.name };
    // The wire document holds the input as a JSON value, written from its
    // text (HANDOFF-105 F7, owner decision 1). Text that is not JSON is the
    // caller's error, named by part, so a saved document is never broken
    // (F8): JsonText would throw JSON.parse's SyntaxError.
    if (tc.input !== undefined) call.input = wireInput(tc, field);
    return { tool_call: call };
  }
  if ("toolResult" in p) {
    const tr = p.toolResult;
    return { tool_result: { tool_use_id: tr.toolUseId, content: tr.content } };
  }
  if ("lyrics" in p) return { lyrics: p.lyrics };
  if ("audioUrl" in p) return { audio_url: p.audioUrl };
  return { audio: toWireMedia(p.audio) };
}

function objectOf(raw: unknown, what: string): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new MalformedWireDocumentError(`${what} is not an object: ${JSON.stringify(raw)}`);
  }
  return raw as Record<string, unknown>;
}

function fromWireMedia(raw: unknown): MediaRef {
  const m = objectOf(raw, "media");
  return {
    mimeType: String(m.mime_type ?? ""),
    bytes: base64ToBytes(String(m.bytes ?? "")),
  };
}

// fromWirePart reads one part: an object with exactly one key, a known
// variant name (ADR-100 MSG-012). rawText is the part's text in the document,
// where a tool call's input text is read.
function fromWirePart(raw: unknown, rawText: string | undefined): Part {
  const obj = objectOf(raw, "part");
  const keys = Object.keys(obj);
  if (keys.length !== 1) {
    throw new MalformedWireDocumentError(`a part has exactly one key, got ${keys.length}`);
  }
  const key = keys[0]!;
  const value = obj[key];
  switch (key) {
    case "text":
      return { text: String(value ?? "") };
    case "lyrics":
      return { lyrics: String(value ?? "") };
    case "audio_url":
      return { audioUrl: String(value ?? "") };
    case "image":
      return { image: fromWireMedia(value) };
    case "audio":
      return { audio: fromWireMedia(value) };
    case "file": {
      const f = objectOf(value, "file");
      return {
        file: {
          id: String(f.id ?? ""),
          uri: String(f.uri ?? ""),
          mimeType: String(f.mime_type ?? ""),
          name: String(f.name ?? ""),
        },
      };
    }
    case "tool_call": {
      const tc = objectOf(value, "tool_call");
      const toolCall: ToolCall = { id: String(tc.id ?? ""), name: String(tc.name ?? "") };
      if (tc.input !== undefined) {
        const input = rawText === undefined ? undefined : extractRawJsonPath(rawText, "tool_call.input");
        if (input === undefined) {
          throw new MalformedWireDocumentError("tool_call input is not in the document text");
        }
        toolCall.input = compactJson(input);
      }
      return { toolCall };
    }
    case "tool_result": {
      const tr = objectOf(value, "tool_result");
      return {
        toolResult: {
          toolUseId: String(tr.tool_use_id ?? ""),
          content: String(tr.content ?? ""),
        },
      };
    }
  }
  throw new MalformedWireDocumentError(
    `unknown part key ${JSON.stringify(key)}; want one of ${Object.values(PART_KINDS).join(", ")}`,
  );
}

function fromWireMessage(raw: unknown, rawText: string | undefined): Message {
  const obj = objectOf(raw, "message entry");
  let rawParts: unknown[] = [];
  if (obj.parts !== undefined && obj.parts !== null) {
    if (!Array.isArray(obj.parts)) {
      throw new MalformedWireDocumentError(
        `parts is not an array: ${JSON.stringify(obj.parts)}`,
      );
    }
    rawParts = obj.parts;
  }
  const rawPartTexts = rawText === undefined ? undefined : extractRawJsonElements(rawText, "parts");
  // ADR-085 RSN-009, the unknown-field hazard. An OLD reader — one built before
  // provider_turn existed — silently drops this key, and on Anthropic a dropped
  // payload is a REJECTED request once the provider enforces the echo, not a
  // degraded one. Unknown-field tolerance is benign in general and is not benign
  // here; it is documented so a consumer reading a document written by a newer
  // SDK knows what a silent reconstruction means.
  const out: Message = {
    role: String(obj.role ?? ""),
    parts: rawParts.map((p, j) => fromWirePart(p, rawPartTexts?.[j])),
  };
  const ptRaw = obj.provider_turn;
  if (ptRaw !== null && typeof ptRaw === "object" && !Array.isArray(ptRaw)) {
    const pt = ptRaw as Record<string, unknown>;
    out.providerTurn = {
      wireShape: String(pt.wire_shape ?? ""),
      wire: String(pt.wire ?? ""),
    };
  }
  return out;
}
