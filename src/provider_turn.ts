//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//

import { PROVIDERS } from "./providers/providers.ts";
import type { ProviderSpec } from "./providers/providers.ts";
import type { ProviderTurn } from "./structs.ts";
import type { Msg } from "./request.ts";

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);











export function splitPathSegment(part: string): [string, number] {
  const bracket = part.indexOf("[");
  if (bracket === -1 || !part.endsWith("]")) return [part, -1];
  const inner = part.slice(bracket + 1, -1);
  //
  //
  if (!/^\d+$/.test(inner)) return [part, -1];
  return [part.slice(0, bracket), Number(inner)];
}

function skipWs(text: string, i: number): number {
  while (i < text.length && WHITESPACE.has(text[i]!)) i++;
  return i;
}







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
  //
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
    //
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












export function assistantTurnPath(
  cfg: ProviderSpec,
  chatWireShape: string,
): string {
  for (const protocol of cfg.chatProtocols) {
    if (protocol.wireShape === chatWireShape) return protocol.assistantTurnPath;
  }
  return "";
}

//
//
//
//
function effectiveChatWireShape(
  cfg: ProviderSpec,
  chatWireShape: string,
): string {
  return chatWireShape || cfg.chatWireShape;
}






export function captureProviderTurn(
  body: string,
  cfg: ProviderSpec,
  chatWireShape: string,
): ProviderTurn | undefined {
  const shape = effectiveChatWireShape(cfg, chatWireShape);
  const wire = extractRawJsonPath(body, assistantTurnPath(cfg, shape));
  //
  //
  //
  //
  //
  //
  if (wire === undefined) return undefined;
  const trimmed = wire.trim();
  if (!trimmed || trimmed === "null") return undefined;
  return { wireShape: shape, wire };
}





export function captureProviderTurnByName(
  provider: keyof typeof PROVIDERS,
  chatWireShape: string,
  body: string,
): ProviderTurn | undefined {
  const cfg = PROVIDERS[provider];
  if (!cfg) return undefined;
  return captureProviderTurn(body, cfg, chatWireShape);
}

















export function resolveTurns(msgs: Msg[], cfg: ProviderSpec): Msg[] {
  return msgs.map((m) => {
    //
    //
    //
    //
    //
    //
    if (
      m.kind === "turn" &&
      !(m.shape === cfg.chatWireShape && assistantTurnPath(cfg, m.shape))
    ) {
      return m.fallback;
    }
    return m;
  });
}
