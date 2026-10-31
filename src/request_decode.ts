// decodeRequest: the inverse of encodeRequest for the ChatOpenAI wire shape
// (ADR-098 RQC-007..013). Hand-written per SDK, like the encoding transforms
// (RQC-009); the option keys come from the generated override tables
// (RQC-008).

import { PROVIDERS, type ProviderName, type ProviderSpec } from "./providers/providers.ts";
import {
  OptionKeys,
  type OptionKey,
  modelOptionOverrides,
  supportedOptions,
  wireShapeOptionOverrides,
} from "./providers/options.ts";
import { ValidationError } from "./errors.ts";
import { withWireShape } from "./request.ts";
import type { Message, Request, WireRequest } from "./structs.ts";

type JSONObject = Record<string, unknown>;

function isObject(v: unknown): v is JSONObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * decodeRequest decodes a chat request into a Request, the inverse of
 * encodeRequest (ADR-098). It is keyless and makes no network call. An empty
 * chatWireShape selects the provider's default.
 *
 * It decodes the ChatOpenAI wire shape only (RQC-011): the model, the turns
 * (a leading system turn becomes request.system) with text content, and every
 * option some provider of the wire shape writes, under any key the encoder may
 * write for it (owner decision 5, HANDOFF-105 F4). So max_tokens and
 * max_completion_tokens both decode to maxTokens (RQC-010), and top_k decodes
 * for OpenAI, which does not take it: encodeRequest checks support (RQC-017).
 * A bare-string stop decodes as a one-item list, stream false as no stream,
 * and a developer turn as the system turn where the provider declares that
 * role (OpenAI, OpenRouter). The model comes from the body, or
 * from wire.path where the provider puts it in the URL. Any field the Request does not model, such as stream, tools or
 * a content list, throws a ValidationError that names it (RQC-007).
 */
export function decodeRequest(
  provider: string,
  chatWireShape: string,
  wire: WireRequest,
): Request {
  const base = PROVIDERS[provider as ProviderName];
  if (!base) {
    throw new ValidationError("provider", `unknown: ${provider}`);
  }
  const cfg = chatWireShape ? withWireShape(base, chatWireShape) : base;
  if (!cfg) {
    throw new ValidationError(
      "chatWireShape",
      `provider "${provider}" does not support wire shape "${chatWireShape}"`,
    );
  }
  if (cfg.chatWireShape !== "ChatOpenAI") {
    throw new ValidationError(
      "chatWireShape",
      `decodeRequest decodes ChatOpenAI only, not "${cfg.chatWireShape}"`,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(wire.body), exactIntegers);
  } catch {
    body = undefined;
  }
  if (!isObject(body)) {
    throw new ValidationError("body", "must be a JSON object");
  }

  const req: Request = {};
  decodeModel(req, cfg, body, wire.path);
  decodeOptions(req, cfg, body);
  const hasTurns = "messages" in body;
  const turns = body.messages;
  delete body.messages;
  // stream false asks for what an absent stream does (HANDOFF-105 R3b).
  if (body.stream === false) delete body.stream;
  rejectUnmodeled(body, "");
  if (hasTurns) decodeTurns(req, cfg, turns);
  return req;
}

// decodeModel reads the model from the body, or from the path where the
// provider's endpoint carries it ({model}, as encodeRequest fills it in).
function decodeModel(req: Request, cfg: ProviderSpec, body: JSONObject, path: string): void {
  if (!cfg.modelInBody) {
    const at = cfg.endpoint.indexOf("{model}");
    if (at < 0) return;
    const prefix = cfg.endpoint.slice(0, at);
    const suffix = cfg.endpoint.slice(at + "{model}".length);
    if (path.length <= prefix.length + suffix.length || !path.startsWith(prefix) || !path.endsWith(suffix)) {
      throw new ValidationError("path", `must match ${cfg.endpoint}`);
    }
    req.model = path.slice(prefix.length, path.length - suffix.length);
    return;
  }
  if (!("model" in body)) return;
  const model = body.model;
  delete body.model;
  if (typeof model !== "string") {
    throw new ValidationError("model", "must be a string");
  }
  req.model = model;
}

// decodeOptionKeys maps every wire key some provider of the wire shape may
// write for an option to that option (owner decision 5, HANDOFF-105 F4).
// decodeRequest reads what the client sent, which need not be what the named
// provider takes; the target's encoder checks support (RQC-017). CQ-OPT-011
// checks that no key maps to two options on one shape.
function decodeOptionKeys(chatWireShape: string): Map<string, OptionKey> {
  const keys = new Map<string, OptionKey>();
  for (const [name, cfg] of Object.entries(PROVIDERS)) {
    if (!withWireShape(cfg, chatWireShape)) continue;
    for (const [key, param] of providerOptionKeys(name as ProviderName, chatWireShape)) {
      keys.set(key, param);
    }
  }
  return keys;
}

// providerOptionKeys maps every wire key the encoder may write for an option
// of (provider, wire shape) to that option (RQC-008): the wire shape's key,
// which replaces the others for every model (BUG-075), else the provider's key
// and each per-model override key (ADR-024).
function providerOptionKeys(provider: ProviderName, chatWireShape: string): Map<string, OptionKey> {
  const shapeKeys = wireShapeOptionOverrides(chatWireShape);
  const supported = new Set<OptionKey>();
  const keys = new Map<string, OptionKey>();
  for (const opt of supportedOptions(provider)) {
    supported.add(opt.key);
    keys.set(shapeKeys[opt.key] ?? opt.jsonKey, opt.key);
  }
  for (const ov of modelOptionOverrides(provider)) {
    if (supported.has(ov.key) && shapeKeys[ov.key] === undefined) {
      keys.set(ov.jsonKey, ov.key);
    }
  }
  return keys;
}

// decodeOptions takes each option out of the body, or out of the provider's
// options container (wrapsOptionsIn), into its Request field (RQC-010).
function decodeOptions(req: Request, cfg: ProviderSpec, body: JSONObject): void {
  let container = body;
  let prefix = "";
  if (cfg.wrapsOptionsIn) {
    if (!(cfg.wrapsOptionsIn in body)) return;
    const wrapped = body[cfg.wrapsOptionsIn];
    if (!isObject(wrapped)) {
      throw new ValidationError(cfg.wrapsOptionsIn, "must be an object");
    }
    container = wrapped;
    prefix = `${cfg.wrapsOptionsIn}.`;
  }
  const byKey = decodeOptionKeys(cfg.chatWireShape);
  const seen = new Set<OptionKey>();
  for (const key of [...byKey.keys()].sort()) {
    const taken = takeNested(container, key);
    if (!taken.found) continue;
    const param = byKey.get(key)!;
    if (seen.has(param)) {
      throw new ValidationError(prefix + key, `sets ${param} a second time`);
    }
    seen.add(param);
    const problem = setOption(req, param, taken.value);
    if (problem) throw new ValidationError(prefix + key, problem);
  }
  if (cfg.wrapsOptionsIn) {
    rejectUnmodeled(container, prefix);
    delete body[cfg.wrapsOptionsIn];
  }
}

// exactIntegers is the JSON.parse reviver decodeRequest reads the body with.
// JSON.parse turns an integer past 2^53 into the nearest double, so the
// reviver returns such an integer as a bigint: read from its source text when
// that is a literal integer, which keeps it exact, as Go and Rust read it, and
// from the double for any other notation (1e18), as Go and Rust read that
// (HANDOFF-105 F12). On a runtime whose reviver gets no source text, the
// double stays, and integerOption rejects it as out of range, as before.
function exactIntegers(_key: string, value: unknown, context?: { source?: string }): unknown {
  if (typeof value !== "number" || !Number.isInteger(value) || Number.isSafeInteger(value)) return value;
  const source = context?.source;
  if (source === undefined) return value;
  return /^-?\d+$/.test(source) ? BigInt(source) : BigInt(value);
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

// integerOption reads an integer option, or returns the problem with its
// value. JSON has one number type, so an integral number in any notation
// (4096, 4096.0, 4.096e3) is an integer, and a fraction is not (owner decision
// 3, HANDOFF-105 F3). JSON.parse reads 1e999 as Infinity, which is out of
// range. A seed is a 64-bit value (xsd:long), read exactly over the int64
// range, as a bigint past 2^53 (F12); a number below. The other integer
// options are numbers, so an integer past 2^53 is out of range for them.
function integerOption(v: unknown, wide: boolean): { value: number | bigint } | { problem: string } {
  if (typeof v === "bigint") {
    if (wide && v >= INT64_MIN && v <= INT64_MAX) return { value: v };
    return { problem: "is out of range" };
  }
  if (typeof v !== "number" || (!Number.isInteger(v) && Number.isFinite(v))) return { problem: "must be an integer" };
  if (!Number.isSafeInteger(v)) return { problem: "is out of range" };
  return { value: v };
}

// numberOption reads a real-number option, or returns the problem with its
// value. exactIntegers gives an integer past 2^53 as a bigint; as a real
// number it is the nearest double, as JSON.parse reads it.
function numberOption(v: unknown): { value: number } | { problem: string } {
  const n = typeof v === "bigint" ? Number(v) : v;
  if (typeof n !== "number") return { problem: "must be a number" };
  if (!Number.isFinite(n)) return { problem: "is out of range" };
  return { value: n };
}

// setOption stores one decoded option value in its Request field, the
// inverse of applyOptions. It returns the problem with the value, if any.
function setOption(req: Request, param: OptionKey, v: unknown): string | undefined {
  switch (param) {
    case OptionKeys.MAX_TOKENS:
    case OptionKeys.TOP_K:
    case OptionKeys.THINKING_BUDGET:
    case OptionKeys.SEED: {
      const read = integerOption(v, param === OptionKeys.SEED);
      if ("problem" in read) return read.problem;
      const n = read.value;
      if (typeof n === "bigint") req.seed = n;
      else if (param === OptionKeys.MAX_TOKENS) req.maxTokens = n;
      else if (param === OptionKeys.TOP_K) req.topK = n;
      else if (param === OptionKeys.THINKING_BUDGET) req.thinkingBudget = n;
      else req.seed = n;
      return undefined;
    }
    case OptionKeys.TEMPERATURE:
    case OptionKeys.TOP_P:
    case OptionKeys.FREQUENCY_PENALTY:
    case OptionKeys.PRESENCE_PENALTY: {
      const read = numberOption(v);
      if ("problem" in read) return read.problem;
      const n = read.value;
      if (param === OptionKeys.TEMPERATURE) req.temperature = n;
      else if (param === OptionKeys.TOP_P) req.topP = n;
      else if (param === OptionKeys.FREQUENCY_PENALTY) req.frequencyPenalty = n;
      else req.presencePenalty = n;
      return undefined;
    }
    case OptionKeys.REASONING_EFFORT:
      if (typeof v !== "string") return "must be a string";
      req.reasoningEffort = v;
      return undefined;
    case OptionKeys.STOP_SEQUENCES:
      // A bare string is a one-item list (HANDOFF-105 R3b).
      if (typeof v === "string") {
        req.stop = [v];
        return undefined;
      }
      if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) {
        return "must be a string or a list of strings";
      }
      req.stop = v as string[];
      return undefined;
  }
}

// takeNested removes the value at a dotted key ("a.b") from m and returns it.
// A parent object left empty is removed too, so it does not read as an
// unmodeled field.
function takeNested(m: JSONObject, key: string): { found: boolean; value?: unknown } {
  const dot = key.indexOf(".");
  const head = dot < 0 ? key : key.slice(0, dot);
  if (!(head in m)) return { found: false };
  if (dot < 0) {
    const value = m[head];
    delete m[head];
    return { found: true, value };
  }
  const child = m[head];
  if (!isObject(child)) return { found: false };
  const out = takeNested(child, key.slice(dot + 1));
  if (out.found && Object.keys(child).length === 0) delete m[head];
  return out;
}

// rejectUnmodeled throws on the first field left in m, in key order, so every
// SDK names the same field (RQC-007).
function rejectUnmodeled(m: JSONObject, prefix: string): void {
  const keys = Object.keys(m).sort();
  if (keys.length > 0) {
    throw new ValidationError(prefix + keys[0], "is not a field decodeRequest decodes");
  }
}

// decodeTurns reads the messages array: a leading system turn into
// request.system, then user and assistant turns with text content. Roles are
// read back through the provider's role mappings.
function decodeTurns(req: Request, cfg: ProviderSpec, v: unknown): void {
  if (!Array.isArray(v)) {
    throw new ValidationError("messages", "must be a list");
  }
  // A wire role decodes through the provider's role mappings, then through
  // its decode-only ones (decodeOnly, HANDOFF-105 F3): OpenAI and
  // OpenRouter take developer as the system role. The role mappings win, in
  // every SDK; extract.py rejects a wire role that is in both.
  const roles = new Map<string, string>();
  for (const [canonical, onWire] of Object.entries(cfg.roleMappings)) {
    roles.set(onWire, canonical);
  }
  for (const [onWire, canonical] of Object.entries(cfg.decodeRoleMappings)) {
    if (!roles.has(onWire)) roles.set(onWire, canonical);
  }
  const messages: Message[] = [];
  v.forEach((item, i) => {
    const field = `messages[${i}]`;
    if (!isObject(item)) {
      throw new ValidationError(field, "must be an object");
    }
    const { role, content, ...rest } = item;
    rejectUnmodeled(rest, `${field}.`);
    if (typeof role !== "string") {
      throw new ValidationError(`${field}.role`, "must be a string");
    }
    if (typeof content !== "string") {
      throw new ValidationError(`${field}.content`, "only text content is decoded");
    }
    const canonical = roles.get(role);
    if (canonical === "system") {
      if (i !== 0 || cfg.systemPlacement !== "MessageInArray") {
        throw new ValidationError(`${field}.role`, "a system turn is decoded only as the first message");
      }
      req.system = content;
    } else if (canonical === "user" || canonical === "assistant") {
      messages.push({ role: canonical, parts: content ? [{ text: content }] : [] });
    } else {
      throw new ValidationError(`${field}.role`, `role "${role}" is not decoded`);
    }
  });
  if (messages.length > 0) req.messages = messages;
}
