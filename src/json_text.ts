// The one JSON writer for every body llmkit sends or encodes: the chat request
// on every send path, encodeRequest, encodeResponse and saveHistory
// (HANDOFF-105 F7, owner decision 1).
//
// A tool call's arguments are JSON text (ToolCall.input). A map-format
// argument (Anthropic, Google, Bedrock) is a value inside the body, and
// JSON.parse cannot carry its text: it turns an integer past 2^53 into the
// nearest double and moves integer-like keys first. So the body holds the text
// in a JsonText, and writeJson writes that text where the value goes. This is
// the splice; there is no other place a body is turned into bytes.

/**
 * JsonText is a JSON value held as its text, which writeJson writes as it is.
 * The constructor rejects text that is not one JSON value, so a body cannot
 * carry broken JSON. JSON.stringify cannot write it and throws, so a send path
 * that skips writeJson fails at once instead of sending {"text": ...}.
 *
 * The constructor also compacts the text, once: the tokens (key order, number
 * spelling, escapes) stay, the whitespace between them goes, as Go's encoder
 * writes an embedded value (HANDOFF-105 F8, owner decision 1).
 */
export class JsonText {
  readonly text: string;

  constructor(text: string) {
    JSON.parse(text);
    this.text = compactJson(text);
  }

  toJSON(): never {
    throw new TypeError("llmkit: a JsonText is written by writeJson, not JSON.stringify");
  }
}

/**
 * writeJson is JSON.stringify(value) with each JsonText written as its text.
 * Everything else is written as JSON.stringify writes it: an undefined member
 * is left out, an undefined array element is null, and a value with toJSON is
 * written through it.
 *
 * One difference: U+2028 and U+2029 are written as the escapes \u2028 and
 * \u2029, as Go writes them, where JSON.stringify writes the characters
 * (HANDOFF-105 F9, owner decision 1). A JsonText, the provider's or the
 * caller's text, is escaped so too (F10): the escape keeps the JSON value.
 */
export function writeJson(value: unknown): string {
  const text = write(value);
  if (text === undefined) throw new TypeError("llmkit: writeJson has no JSON for the value");
  return text;
}

function write(value: unknown): string | undefined {
  if (value instanceof JsonText) return escapeLineSeparators(value.text);
  if (Array.isArray(value)) return `[${value.map((v) => write(v) ?? "null").join(",")}]`;
  if (value !== null && typeof value === "object" && !("toJSON" in value)) {
    const members: string[] = [];
    for (const [key, member] of Object.entries(value)) {
      const text = write(member);
      if (text !== undefined) members.push(`${stringify(key)}:${text}`);
    }
    return `{${members.join(",")}}`;
  }
  return stringify(value);
}

/** stringify is JSON.stringify(value) with U+2028 and U+2029 escaped. */
function stringify(value: unknown): string | undefined {
  const text = JSON.stringify(value) as string | undefined;
  return text === undefined ? undefined : escapeLineSeparators(text);
}

/**
 * escapeLineSeparators is text, valid JSON, with U+2028 and U+2029 written as
 * their escapes. In valid JSON either character can only stand inside a
 * string, so the escape keeps the value.
 */
function escapeLineSeparators(text: string): string {
  return text.replace(LINE_SEPARATORS, escapeLineSeparator);
}

const LINE_SEPARATORS = /[\u2028\u2029]/g;

function escapeLineSeparator(c: string): string {
  return c === "\u2028" ? "\\u2028" : "\\u2029";
}

/**
 * compactJson is text, valid JSON, with the whitespace between tokens removed
 * and every token kept as written (key order, number spelling, string
 * escapes).
 */
export function compactJson(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const c of text) {
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") {
      inString = c === '"';
      out += c;
    }
  }
  return out;
}
