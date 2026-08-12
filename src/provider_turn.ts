// Verbatim assistant-turn capture (ADR-085).
//
// llmkit keeps a canonical projection of every turn — role, content, tool calls
// — and used to rebuild the next request's assistant turn from it. That
// projection is lossy in three ways (ADR-085 §1): it has nowhere to put
// reasoning, it drops assistant prose that accompanies a tool call, and it has no
// slot for per-part provider metadata. The fix is not a richer projection but a
// second representation alongside it: keep the provider's own bytes for the turn
// and send those back unchanged.
//
// Nothing here parses the payload. The only structure this file reads is the path
// down to the turn — everything at and below it is carried as the provider wrote
// it.
//
// TypeScript-specific note. JSON.parse yields a plain object with no memory of
// the source text, and JSON.stringify would then re-render it — whitespace gone,
// and any integer past 2^53 silently rewritten through a double. So capture
// SLICES the response text: the walk below finds the span of the value at the
// path and returns that substring. It is a scanner, not a parser: it locates
// where each value ends and never interprets what is inside one.

import { PROVIDERS } from "./providers/providers.ts";
import type { ProviderSpec } from "./providers/providers.ts";
import type { ProviderTurn } from "./structs.ts";
import type { Msg } from "./request.ts";

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

/**
 * splitPathSegment splits one dot-notation path segment into a field name and an
 * array index: "choices[0]" -> ["choices", 0]; "message" -> ["message", -1].
 *
 *
 * single parser here, so capture cannot drift from the path facts it reads. A
 * malformed segment yields the whole segment as a field name and no index, which
 * resolves to "no such field" one step later — never a silently widened match to
 * the whole array, which is what a negative index would read back as.
 */
export function splitPathSegment(part: string): [string, number] {
  const bracket = part.indexOf("[");
  if (bracket === -1 || !part.endsWith("]")) return [part, -1];
  const inner = part.slice(bracket + 1, -1);
  // /^\d+$/, not Number(): Number("") is 0, Number(" 1") is 1, and Number("-1")
  // is a valid negative that would read back as "no index".
  if (!/^\d+$/.test(inner)) return [part, -1];
  return [part.slice(0, bracket), Number(inner)];
}

function skipWs(text: string, i: number): number {
  while (i < text.length && WHITESPACE.has(text[i]!)) i++;
  return i;
}

/**
 * skipValue returns the index just past the JSON value starting at `i`, or -1
 * when the text there is not a value. Strings are scanned with escape awareness;
 * objects and arrays by nesting depth, which is why the string scan has to be
 * exact — a `}` inside a string must not close an object.
 */
function skipValue(text: string, i: number): number {
  i = skipWs(text, i);
  if (i >= text.length) return -1;
  const ch = text[i]!;
  if (ch === '"') return skipString(text, i);
  if (ch === "{" || ch === "[") {
    let depth = 0;
    while (i < text.length) {
      const c = text[i]!;
      if (c === '"') {
        const end = skipString(text, i);
        if (end === -1) return -1;
        i = end;
        continue;
      }
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    return -1;
  }
  // A literal or number: everything up to the next structural character.
  const start = i;
  while (i < text.length && !",}]".includes(text[i]!) && !WHITESPACE.has(text[i]!)) {
    i++;
  }
  return i > start ? i : -1;
}

function skipString(text: string, i: number): number {
  if (text[i] !== '"') return -1;
  i++;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === '"') return i + 1;
    i++;
  }
  return -1;
}

/** spanOfMember returns the [start, end) span of `field`'s value in the object
 * beginning at `start`, or null when that is not an object or has no such key. */
function spanOfMember(
  text: string,
  start: number,
  field: string,
): [number, number] | null {
  let i = skipWs(text, start);
  if (text[i] !== "{") return null;
  i++;
  for (;;) {
    i = skipWs(text, i);
    if (i >= text.length || text[i] === "}") return null;
    const keyEnd = skipString(text, i);
    if (keyEnd === -1) return null;
    // The key is a JSON string, so JSON.parse decodes its escapes correctly.
    let key: string;
    try {
      key = JSON.parse(text.slice(i, keyEnd)) as string;
    } catch {
      return null;
    }
    i = skipWs(text, keyEnd);
    if (text[i] !== ":") return null;
    const valueStart = skipWs(text, i + 1);
    const valueEnd = skipValue(text, valueStart);
    if (valueEnd === -1) return null;
    if (key === field) return [valueStart, valueEnd];
    i = skipWs(text, valueEnd);
    if (text[i] !== ",") return null;
    i++;
  }
}

/** spanOfElement returns the [start, end) span of element `index` in the array
 * beginning at `start`, or null when that is not an array or is too short. */
function spanOfElement(
  text: string,
  start: number,
  index: number,
): [number, number] | null {
  let i = skipWs(text, start);
  if (text[i] !== "[") return null;
  i++;
  let position = 0;
  for (;;) {
    i = skipWs(text, i);
    if (i >= text.length || text[i] === "]") return null;
    const valueEnd = skipValue(text, i);
    if (valueEnd === -1) return null;
    if (position === index) return [i, valueEnd];
    position++;
    i = skipWs(text, valueEnd);
    if (text[i] !== ",") return null;
    i++;
  }
}

/**
 * extractRawJsonPath returns the VERBATIM JSON text of the value at `path`, or
 * undefined when the path does not resolve.
 *
 * The distinction from paths.extractPath is the whole point: that walker
 * descends an object that has already been through JSON.parse, so re-encoding
 * its result emits JavaScript's rendering of the value rather than the
 * provider's — and for an integer past Number.MAX_SAFE_INTEGER, a different
 * number.
 */
export function extractRawJsonPath(
  text: string,
  path: string,
): string | undefined {
  if (!path) return undefined;
  let start = 0;
  let end = text.length;
  for (const part of path.split(".")) {
    const [field, index] = splitPathSegment(part);
    if (field) {
      const span = spanOfMember(text, start, field);
      if (!span) return undefined;
      [start, end] = span;
    }
    if (index >= 0) {
      const span = spanOfElement(text, start, index);
      if (!span) return undefined;
      [start, end] = span;
    }
  }
  return text.slice(start, end);
}

/**
 * assistantTurnPath is where one replayable assistant turn sits in a response
 * body for this provider under this wire shape, or "" when the shape declares no
 * position.
 *
 * An empty result is a DECLARED absence, not a missing lookup: ChatBedrock
 * carries assistantTurnUnanchored rather than a path, because nobody has
 *
 * gate refuses a wire shape that says neither, so "" here always means "declared
 * unanchored" and never "somebody forgot".
 */
export function assistantTurnPath(
  cfg: ProviderSpec,
  chatWireShape: string,
): string {
  for (const protocol of cfg.chatProtocols) {
    if (protocol.wireShape === chatWireShape) return protocol.assistantTurnPath;
  }
  return "";
}

// effectiveChatWireShape resolves the shape a response was produced under. An
// empty argument means the caller did not route through `.protocol(...)` — the
// batch path passes "" because batch is Chat-Completions-only (ADR-055) — so the
// provider's default shape applies.
function effectiveChatWireShape(
  cfg: ProviderSpec,
  chatWireShape: string,
): string {
  return chatWireShape || cfg.chatWireShape;
}

/**
 * captureProviderTurn lifts the assistant turn out of a response body, or
 * returns undefined when this shape declares no turn position or the body carries
 * nothing there.
 */
export function captureProviderTurn(
  body: string,
  cfg: ProviderSpec,
  chatWireShape: string,
): ProviderTurn | undefined {
  const shape = effectiveChatWireShape(cfg, chatWireShape);
  const wire = extractRawJsonPath(body, assistantTurnPath(cfg, shape));
  // A JSON null at the path is the provider declining to send a turn, not a turn
  // whose content is null — Google nulls candidates[0].content on a safety block,
  // and OpenAI-compatible proxies null choices[0].message on a content filter. A
  // bare `null` is four characters of a perfectly good JSON value, so an
  // emptiness check alone captures it and the next request appends a bare null to
  // the message array, which is a 400.
  if (wire === undefined) return undefined;
  const trimmed = wire.trim();
  if (!trimmed || trimmed === "null") return undefined;
  return { wireShape: shape, wire };
}

/**
 * captureProviderTurnByName is captureProviderTurn keyed by provider name, for
 * the call sites that hold a name rather than a resolved spec.
 */
export function captureProviderTurnByName(
  provider: keyof typeof PROVIDERS,
  chatWireShape: string,
  body: string,
): ProviderTurn | undefined {
  const cfg = PROVIDERS[provider];
  if (!cfg) return undefined;
  return captureProviderTurn(body, cfg, chatWireShape);
}

/**
 * resolveTurns is the RSN-006 boundary: a captured payload is replayed only
 * under the shape that produced it, and a mismatch drops it and reconstructs the
 * turn from the canonical projection instead.
 *
 * One unconditional rule, applied once per request where the config and the
 * message list first meet, so no builder has to remember the check. The draft ADR
 * made this branch on whether the provider mandates the echo and raised an error
 * on the mandating ones; RESEARCH-017 measured that set to be empty, so only the
 * drop arm was ever reachable.
 *
 * Dropping is the safe direction here, and the measurement is why: every probed
 * provider ACCEPTS a request with the payload omitted, while a mangled payload is
 * the single 400 anywhere in the matrix. Replaying an Anthropic block array into
 * Google's contents array would be exactly that mangling.
 */
export function resolveTurns(msgs: Msg[], cfg: ProviderSpec): Msg[] {
  return msgs.map((m) => {
    // Two conditions, not one. Matching the shape is not enough: the shape must
    // also DECLARE a turn position. A payload claiming an unanchored shape can
    // only come from caller-supplied or loadHistory()ed data, and the builder for
    // such a shape has no replay arm — so without the second check, a history
    // carrying {wireShape: "ChatBedrock"} reaches a builder with nowhere to put
    // it.
    if (
      m.kind === "turn" &&
      !(m.shape === cfg.chatWireShape && assistantTurnPath(cfg, m.shape))
    ) {
      return m.fallback;
    }
    return m;
  });
}
