//
//
//
//
//
//

import type { Message, ToolCall, ToolResult } from "./structs.ts";
import { WIRE_SCHEMA_VERSION } from "./wire_version.ts";

export class UnsupportedWireVersionError extends Error {
  readonly got: number;
  readonly want: number;
  constructor(got: number, want: number) {
    super(
      `llmkit: unsupported wire schema version: got ${got}, want <= ${want}`,
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
  content: string;
  tool_calls: WireToolCall[];
  tool_result: WireToolResult | null;
  //
  //
  //
  //
  //
  provider_turn?: WireProviderTurn;
}

interface WireProviderTurn {
  wire_shape: string;
  wire: string;
}

interface WireToolCall {
  id: string;
  name: string;
  input?: unknown;
}

interface WireToolResult {
  tool_use_id: string;
  content: string;
}








export function saveHistory(messages: readonly Message[]): string {
  const wire: WireMessage[] = messages.map(toWireMessage);
  const doc: WireDoc = { _v: WIRE_SCHEMA_VERSION, messages: wire };
  return JSON.stringify(doc);
}










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
  if (version > WIRE_SCHEMA_VERSION) {
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
  return rawMsgs.map(fromWireMessage);
}

function toWireMessage(m: Message): WireMessage {
  const out: WireMessage = {
    role: m.role,
    content: m.content,
    tool_calls: m.toolCalls.map(toWireToolCall),
    tool_result:
      m.toolResult === null || m.toolResult === undefined
        ? null
        : toWireToolResult(m.toolResult),
  };
  if (m.providerTurn) {
    out.provider_turn = {
      wire_shape: m.providerTurn.wireShape,
      wire: m.providerTurn.wire,
    };
  }
  return out;
}

function toWireToolCall(tc: ToolCall): WireToolCall {
  const out: WireToolCall = { id: tc.id, name: tc.name };
  if (tc.input !== undefined && tc.input !== null) out.input = tc.input;
  return out;
}

function toWireToolResult(tr: ToolResult): WireToolResult {
  return { tool_use_id: tr.toolUseId, content: tr.content };
}

function fromWireMessage(raw: unknown): Message {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new MalformedWireDocumentError(
      `message entry is not an object: ${JSON.stringify(raw)}`,
    );
  }
  const obj = raw as Record<string, unknown>;
  let tcRaw: unknown[] = [];
  if (obj.tool_calls !== undefined && obj.tool_calls !== null) {
    if (!Array.isArray(obj.tool_calls)) {
      throw new MalformedWireDocumentError(
        `tool_calls is not an array: ${JSON.stringify(obj.tool_calls)}`,
      );
    }
    tcRaw = obj.tool_calls;
  }
  const toolCalls: ToolCall[] = [];
  for (const tc of tcRaw) {
    if (tc === null || typeof tc !== "object" || Array.isArray(tc)) continue;
    const tcObj = tc as Record<string, unknown>;
    toolCalls.push({
      id: String(tcObj.id ?? ""),
      name: String(tcObj.name ?? ""),
      input: tcObj.input,
    });
  }
  let toolResult: ToolResult | null = null;
  const trRaw = obj.tool_result;
  if (trRaw !== null && typeof trRaw === "object" && !Array.isArray(trRaw)) {
    const trObj = trRaw as Record<string, unknown>;
    toolResult = {
      toolUseId: String(trObj.tool_use_id ?? ""),
      content: String(trObj.content ?? ""),
    };
  }
  //
  //
  //
  //
  //
  //
  //
  const out: Message = {
    role: String(obj.role ?? ""),
    content: String(obj.content ?? ""),
    toolCalls,
    toolResult,
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
