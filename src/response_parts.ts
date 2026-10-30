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
import type { Part, Response, ToolCall } from "./structs.ts";

/**
 * responseText is the response text: the text parts joined with no separator,
 * in order. A block-array wire splits one reply into consecutive text blocks
 * (Anthropic around a citation), so the blocks join as they are. Empty when
 * the response carries no text, such as a turn that only calls a tool; the
 * finish reason tells why.
 */
export function responseText(response: Response): string {
  let text = "";
  for (const p of response.parts) if ("text" in p) text += p.text;
  return text;
}

/**
 * responseToolCalls is the tool calls the model asked for, in the order it
 * sent them, not run. Empty when the model called no tool.
 */
export function responseToolCalls(response: Response): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const p of response.parts) if ("toolCall" in p) calls.push(p.toolCall);
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
 */
export function decodeChatParts(
  raw: unknown,
  provider: string,
  cfg: ProviderSpec,
  chatWireShape: string,
): Part[] {
  const textCfg = RESPONSE_TEXT_CONFIGS[chatWireShape];
  const toolCfg = TOOL_CALL_RESPONSE_CONFIGS[chatWireShape];
  const parts: Part[] = [];
  if (!textCfg) {
    const text = extractPath(raw, cfg.responseTextPath);
    if (text) parts.push({ text });
  }
  for (const path of blockArrayPaths(textCfg, toolCfg)) {
    const arr = extractRaw(raw, path);
    if (!Array.isArray(arr)) continue;
    const toolsOnly = toolCfg?.blocksPath === path && textCfg?.blocksPath !== path;
    arr.forEach((elem: unknown, i: number) => {
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
        parts.push({ toolCall: readToolCall(block, toolCfg, cfg) });
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
 * toolCallIDSource says so (Google). The arguments are decoded per the
 * provider's args format: a JSON string (json_string) or a JSON value (map).
 * Absent arguments leave input unset. A block with no tool name, or arguments
 * that do not decode, is a ValidationError on field "toolCalls": it is not a
 * call the caller can run.
 */
function readToolCall(
  block: Record<string, unknown>,
  toolCfg: ToolCallResponseConfig,
  cfg: ProviderSpec,
): ToolCall {
  const name = extractPath(block, toolCfg.namePath);
  if (!name) throw malformedToolCall(`no tool name at ${toolCfg.namePath}`);
  let id = "";
  if (toolCfg.idPath) id = extractPath(block, toolCfg.idPath);
  else if (cfg.toolIdSource === "function_name") id = name;
  const call: ToolCall = { id, name };
  const args = extractRaw(block, toolCfg.argsPath);
  if (args === undefined || args === null) return call;
  if (cfg.toolArgsFormat === "json_string") {
    if (typeof args !== "string") {
      throw malformedToolCall(`"${name}": arguments at ${toolCfg.argsPath} are not a JSON string`);
    }
    try {
      call.input = JSON.parse(args) as unknown;
    } catch (err) {
      throw malformedToolCall(`"${name}": arguments at ${toolCfg.argsPath}: ${String(err)}`);
    }
  } else {
    call.input = args;
  }
  return call;
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
    if ("toolCall" in p) {
      if (!toolCfg || !cfg.toolArgsFormat) throw noToolCallConfigError(provider, chatWireShape);
      append(toolCfg.blocksPath, writeToolCall(p.toolCall, toolCfg, cfg));
    } else if ("text" in p && textCfg) {
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
  if (call.input === undefined || call.input === null) return block;
  setWirePath(
    block,
    toolCfg.argsPath,
    cfg.toolArgsFormat === "json_string" ? JSON.stringify(call.input) : call.input,
  );
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
