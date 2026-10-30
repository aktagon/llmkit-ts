// Tool-call extraction: the tool calls a chat response asked for, per wire
// shape. One reader for the Agent's loop and decodeResponse (owner decision 3,
// HANDOFF-105 section 3b: Text.request returns them without running them).
// Moved out of agent.ts so the codec can call it without an import cycle.

import { matchingBlocks } from "./paths.ts";
import type { ToolCall } from "./structs.ts";

export function extractToolCalls(raw: unknown, chatWireShape: string): ToolCall[] {
  if (chatWireShape === "ChatBedrock") return extractBedrockToolCalls(raw);
  if (chatWireShape === "ChatAnthropic") {
    return extractAnthropicToolCalls(raw);
  }
  if (chatWireShape === "ChatGoogle") {
    return extractGoogleToolCalls(raw);
  }
  if (chatWireShape === "ChatOpenAI") {
    return extractOpenAIToolCalls(raw);
  }
  return [];
}

function extractBedrockToolCalls(raw: unknown): ToolCall[] {
  if (typeof raw !== "object" || raw === null) return [];
  const output = (raw as Record<string, unknown>).output as
    | Record<string, unknown>
    | undefined;
  const message = output?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  const calls: ToolCall[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const tu = (block as Record<string, unknown>).toolUse as
      | Record<string, unknown>
      | undefined;
    if (!tu) continue;
    calls.push({
      id: String(tu.toolUseId ?? ""),
      name: String(tu.name ?? ""),
      input: (tu.input as Record<string, unknown>) ?? {},
    });
  }
  return calls;
}

function extractGoogleToolCalls(raw: unknown): ToolCall[] {
  if (typeof raw !== "object" || raw === null) return [];
  const candidates = (raw as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const cand = candidates[0] as Record<string, unknown> | undefined;
  const content = cand?.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts)) return [];
  const calls: ToolCall[] = [];
  for (const p of parts) {
    if (typeof p !== "object" || p === null) continue;
    const fc = (p as Record<string, unknown>).functionCall as
      | Record<string, unknown>
      | undefined;
    if (!fc) continue;
    calls.push({
      id: String(fc.name ?? ""),
      name: String(fc.name ?? ""),
      input: (fc.args as Record<string, unknown>) ?? {},
    });
  }
  return calls;
}

// The N=1 proof for matchingBlocks: this is the SAME call the text reader
// makes, with a different marker value. Before BUG-053 these were two
// hand-rolled scans over one array that happened to agree; agreement by
// coincidence is what let text extraction break on thinking blocks while
// tool-call extraction, scanning the very same array, kept working.
function extractAnthropicToolCalls(raw: unknown): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const b of matchingBlocks(raw, "content", "type", "tool_use")) {
    calls.push({
      id: String(b.id ?? ""),
      name: String(b.name ?? ""),
      input: (b.input as Record<string, unknown>) ?? {},
    });
  }
  return calls;
}

function extractOpenAIToolCalls(raw: unknown): ToolCall[] {
  if (typeof raw !== "object" || raw === null) return [];
  const choices = (raw as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const choice = choices[0] as Record<string, unknown> | undefined;
  const message = choice?.message as Record<string, unknown> | undefined;
  const tcs = message?.tool_calls;
  if (!Array.isArray(tcs)) return [];
  const calls: ToolCall[] = [];
  for (const tc of tcs) {
    if (typeof tc !== "object" || tc === null) continue;
    const tcMap = tc as Record<string, unknown>;
    const fn = tcMap.function as Record<string, unknown> | undefined;
    if (!fn) continue;
    let input: Record<string, unknown> = {};
    const args = fn.arguments;
    if (typeof args === "string") {
      try {
        input = JSON.parse(args) as Record<string, unknown>;
      } catch {
        input = {};
      }
    } else if (typeof args === "object" && args !== null) {
      input = args as Record<string, unknown>;
    }
    calls.push({
      id: String(tcMap.id ?? ""),
      name: String(fn.name ?? ""),
      input,
    });
  }
  return calls;
}
