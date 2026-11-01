// The response's assistant turn as ordered parts (owner decision 1,
// HANDOFF-105 F4). One reader and one writer, both driven by the generated
// RESPONSE_TEXT_CONFIGS and TOOL_CALL_RESPONSE_CONFIGS tables, replace the
// four handwritten tool-call extractors (owner decision 2).

import {
  RESPONSE_TEXT_CONFIGS,
  TOOL_CALL_RESPONSE_CONFIGS,
  type ProviderSpec,
  type ResponseTextConfig,
  type ToolCallResponseConfig,
} from "./providers/providers.ts";
import { ValidationError } from "./errors.ts";
import { extractPath, extractRaw, setWirePath } from "./paths.ts";
import { compactJson, JsonText } from "./json_text.ts";
import { extractRawJsonElements, extractRawJsonPath } from "./provider_turn.ts";
import type { Part, Response, ToolCall } from "./structs.ts";
import { hasPart } from "./part_kinds.ts";

/**
 * responseText is the response text: the text parts joined with no separator,
 * in order. A block-array wire splits one reply into consecutive text blocks
 * (Anthropic around a citation), so the blocks join as they are. Empty when
 * the response carries no text, such as a turn that only calls a tool; the
 * finish reason tells why.
 */
export function responseText(response: Response): string {
  return partsText(response.parts);
}

/**
 * responseToolCalls is the tool calls the model asked for, in the order it
 * sent them, not run. Empty when the model called no tool.
 */
export function responseToolCalls(response: Response): ToolCall[] {
  return partsToolCalls(response.parts);
}

/**
 * partsText is the text rule of responseText over any turn's parts. The
 * request encoder reads an assistant turn with it, so the turn carries the
 * text the response did (owner decision 4, HANDOFF-105 F5, F11).
 */
export function partsText(parts: readonly Part[]): string {
  let text = "";
  for (const p of parts) if (hasPart(p, "text")) text += p.text;
  return text;
}

/**
 * partsToolCalls is the tool-call rule of responseToolCalls over any turn's
 * parts, in order. The request encoder reads a turn's calls with it.
 */
export function partsToolCalls(parts: readonly Part[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const p of parts) if (hasPart(p, "toolCall")) calls.push(p.toolCall);
  return calls;
}

/**
 * blockMatches applies the generated marker semantics to one array element:
 * no marker path matches every element; a marker path with no value matches
 * when the key is PRESENT; both set match when the key EQUALS the value.
 */
function blockMatches(
  block: Record<string, unknown>,
  markerPath: string,
  markerValue: string,
): boolean {
  if (markerPath === "") return true;
  if (!(markerPath in block)) return false;
  return markerValue === "" || block[markerPath] === markerValue;
}

/**
 * decodeChatParts reads a Chat Completions-family body's assistant turn as
 * ordered parts. A shape whose text is a scalar (ChatOpenAI) yields its text
 * first, then its tool calls. A block-array shape yields its text and
 * tool-call blocks in array order, because the two configs name the same
 * array.
 *
 * A tool-call block the caller could not run is a ValidationError on
 * "toolCalls", never dropped (HANDOFF-105 F5): a block of a provider with no
 * tool-call config, and, in an array of tool calls only (one no text config
 * names, ChatOpenAI), an element that fails the marker, such as an OpenAI
 * call of type "custom". In an array shared with text the marker selects, so
 * a block that matches neither config (a thinking block) is not a part.
 *
 * Each block is decoded once, from its own text in body: its marker, name and
 * id come from that decode, and a map-format argument is read from the same
 * text, so input keeps the provider's tokens (readToolCall). Before F9 the
 * blocks came from a parse of the body and the arguments from a second walk of
 * the body, matched by index, so the two could name different blocks
 * (HANDOFF-105 F9).
 */
export function decodeChatParts(
  body: string,
  provider: string,
  cfg: ProviderSpec,
  chatWireShape: string,
): Part[] {
  const textCfg = RESPONSE_TEXT_CONFIGS[chatWireShape];
  const toolCfg = TOOL_CALL_RESPONSE_CONFIGS[chatWireShape];
  const parts: Part[] = [];
  if (!textCfg) {
    const text = extractPath(JSON.parse(body), cfg.responseTextPath);
    if (text) parts.push({ text });
  }
  for (const path of blockArrayPaths(textCfg, toolCfg)) {
    const blocks = extractRawJsonElements(body, path);
    if (!blocks) continue;
    const toolsOnly = toolCfg?.blocksPath === path && textCfg?.blocksPath !== path;
    blocks.forEach((blockText: string, i: number) => {
      const elem: unknown = JSON.parse(blockText);
      const block = isObject(elem) ? elem : undefined;
      if (
        textCfg?.blocksPath === path &&
        block &&
        blockMatches(block, textCfg.markerPath, textCfg.markerValue)
      ) {
        const text = extractPath(block, textCfg.valuePath);
        if (text) parts.push({ text });
      } else if (
        toolsOnly &&
        !(block && blockMatches(block, toolCfg.markerPath, toolCfg.markerValue))
      ) {
        throw otherToolCallType(path, i, block, toolCfg);
      } else if (
        toolCfg?.blocksPath === path &&
        block &&
        blockMatches(block, toolCfg.markerPath, toolCfg.markerValue)
      ) {
        if (!cfg.toolArgsFormat) throw noToolCallConfigError(provider, chatWireShape);
        const rawArgs = extractRawJsonPath(blockText, toolCfg.argsPath);
        parts.push({ toolCall: readToolCall(block, rawArgs, toolCfg, cfg) });
      }
    });
  }
  return parts;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * otherToolCallType is the rejection for an element of a tool-call-only array
 * that is not a tool call of the kind the config marks (owner decision 1,
 * HANDOFF-105 F5): it is a call the caller cannot run, so it is not dropped.
 */
function otherToolCallType(
  path: string,
  i: number,
  block: Record<string, unknown> | undefined,
  toolCfg: ToolCallResponseConfig,
): ValidationError {
  if (!block) return malformedToolCall(`${path}[${i}] is not an object`);
  return malformedToolCall(
    `${path}[${i}] has ${toolCfg.markerPath} ${String(extractRaw(block, toolCfg.markerPath))}, want "${toolCfg.markerValue}"`,
  );
}

/** blockArrayPaths lists the arrays the two configs scan, each once, text first. */
function blockArrayPaths(
  textCfg: ResponseTextConfig | undefined,
  toolCfg: ToolCallResponseConfig | undefined,
): string[] {
  const paths: string[] = [];
  if (textCfg) paths.push(textCfg.blocksPath);
  if (toolCfg && toolCfg.blocksPath !== textCfg?.blocksPath) paths.push(toolCfg.blocksPath);
  return paths;
}

/**
 * readToolCall reads one tool-call block. An empty idPath means the family
 * carries no id on the wire; the id is the tool name when the provider's
 * toolCallIDSource says so (Google). The arguments are read per the
 * provider's args format: a JSON string (json_string) or a JSON value (map),
 * whose text in the body is rawArgs. Absent or null arguments, and an empty
 * json_string argument, leave input unset: an empty argument set is no input. A block
 * with no tool name, or arguments that do not decode, is a ValidationError on
 * field "toolCalls": it is not a call the caller can run.
 *
 * input is the provider's text, validated and never re-encoded (HANDOFF-105
 * F6 owner decision 1, F7 owner decision 2): JSON.parse turns an integer past
 * 2^53 into the nearest double, so the parse cannot carry the text. A
 * json_string argument is kept exactly, spaces included: the string is the
 * text, and "null" is the text null. A map-format argument is a value inside
 * the body, so its text is its tokens: compactJson drops only the whitespace
 * between them, the body's layout, as Go's json.Compact does. A map-format
 * argument is read from rawArgs alone, for where it is and what it is: one
 * scan, so the parse cannot name other arguments than the text (HANDOFF-105
 * F8). Its null is no input; its JSON string "" is an argument value, the
 * text "" (HANDOFF-105 F9, owner decision 2).
 */
function readToolCall(
  block: Record<string, unknown>,
  rawArgs: string | undefined,
  toolCfg: ToolCallResponseConfig,
  cfg: ProviderSpec,
): ToolCall {
  const name = extractPath(block, toolCfg.namePath);
  if (!name) throw malformedToolCall(`no tool name at ${toolCfg.namePath}`);
  let id = "";
  if (toolCfg.idPath) id = extractPath(block, toolCfg.idPath);
  else if (cfg.toolIdSource === "function_name") id = name;
  const call: ToolCall = { id, name };
  if (cfg.toolArgsFormat !== "json_string") {
    if (rawArgs === undefined) return call;
    const text = compactJson(rawArgs);
    if (text !== "null") call.input = text;
    return call;
  }
  const args = extractRaw(block, toolCfg.argsPath);
  if (args === undefined || args === null) return call;
  if (typeof args !== "string") {
    throw malformedToolCall(`"${name}": arguments at ${toolCfg.argsPath} are not a JSON string`);
  }
  if (args === "") return call;
  try {
    JSON.parse(args);
  } catch (err) {
    throw malformedToolCall(`"${name}": arguments at ${toolCfg.argsPath}: ${String(err)}`);
  }
  call.input = args;
  return call;
}

/**
 * toolCallInput is a tool call's arguments as a parsed value, read from
 * ToolCall.input, the JSON text (HANDOFF-105 F7, owner decision 2), or
 * undefined when the call has no input. JSON.parse turns an integer past 2^53
 * into the nearest double; input keeps the exact text.
 */
export function toolCallInput(call: ToolCall): unknown {
  return call.input === undefined ? undefined : (JSON.parse(call.input) as unknown);
}

/**
 * malformedToolCall is the rejection for a tool-call block that is not a call
 * the caller can run, on field "toolCalls", the field encodeResponse rejects
 * with too.
 */
function malformedToolCall(message: string): ValidationError {
  return new ValidationError("toolCalls", `decode tool call ${message}`);
}

/**
 * encodeChatParts writes the parts into a Chat Completions-family body, in
 * part order, through the same configs decodeChatParts reads. Text and tool
 * calls that share a block array (Anthropic, Google, Bedrock) go into it in
 * the parts' order; a scalar-text shape (ChatOpenAI) writes the text at its
 * path and the tool calls into their own array. A tool call on a shape or
 * provider with no tool-call config is a ValidationError on field "toolCalls":
 * there is nowhere to write it, and dropping it would lose it.
 */
export function encodeChatParts(
  raw: Record<string, unknown>,
  provider: string,
  cfg: ProviderSpec,
  chatWireShape: string,
  parts: Part[],
): void {
  const textCfg = RESPONSE_TEXT_CONFIGS[chatWireShape];
  const toolCfg = TOOL_CALL_RESPONSE_CONFIGS[chatWireShape];
  const arrays = new Map<string, Record<string, unknown>[]>();
  const append = (path: string, block: Record<string, unknown>) => {
    const arr = arrays.get(path) ?? [];
    arr.push(block);
    arrays.set(path, arr);
  };
  for (const p of parts) {
    if (hasPart(p, "toolCall")) {
      if (!toolCfg || !cfg.toolArgsFormat) throw noToolCallConfigError(provider, chatWireShape);
      append(toolCfg.blocksPath, writeToolCall(p.toolCall, toolCfg, cfg));
    } else if (hasPart(p, "text") && textCfg) {
      const block: Record<string, unknown> = {};
      if (textCfg.markerValue !== "") setWirePath(block, textCfg.markerPath, textCfg.markerValue);
      setWirePath(block, textCfg.valuePath, p.text);
      append(textCfg.blocksPath, block);
    }
  }
  if (!textCfg) setWirePath(raw, cfg.responseTextPath, responseText({ parts } as Response));
  for (const [path, blocks] of arrays) setWirePath(raw, path, blocks);
}

/**
 * writeToolCall renders one tool call as a block of the shape. encodeResponse
 * and the request encoder both write through it (owner decision 3,
 * HANDOFF-105 F5), so a request turn carries the block the response did. The
 * marker is written when it is a value (Anthropic type=tool_use, OpenAI
 * type=function); a presence marker is the key the name path starts with, so
 * writing the name writes it (the generator checks this). No id is written
 * where the shape has no id path (Google): exceptGoogleToolCallID is
 * OneWay (owner decision 3, F4).
 */
export function writeToolCall(
  call: ToolCall,
  toolCfg: ToolCallResponseConfig,
  cfg: ProviderSpec,
): Record<string, unknown> {
  const block: Record<string, unknown> = {};
  if (toolCfg.markerValue !== "") setWirePath(block, toolCfg.markerPath, toolCfg.markerValue);
  setWirePath(block, toolCfg.idPath, call.id);
  setWirePath(block, toolCfg.namePath, call.name);
  if (call.input === undefined) return block;
  // The text goes out as it is: as the JSON string itself (json_string), or
  // as a JsonText that writeJson splices into the body (map), so no parse
  // changes it (HANDOFF-105 F7, owner decision 1). checkTurnParts has already
  // rejected text that is not JSON.
  const args = cfg.toolArgsFormat === "json_string" ? call.input : new JsonText(call.input);
  setWirePath(block, toolCfg.argsPath, args);
  return block;
}

/**
 * noToolCallConfigError is the rejection for a response with tool calls on a
 * shape that declares no ToolCallResponseConfig (ChatResponsesOpenAI), or
 * for a provider with no tool-call config.
 */
export function noToolCallConfigError(provider: string, chatWireShape: string): ValidationError {
  return new ValidationError(
    "toolCalls",
    `provider "${provider}" has no tool-call response shape on chat wire shape "${chatWireShape}"`,
  );
}
