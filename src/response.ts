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
import type { ProviderName } from "./providers/providers.ts";
import { cachingConfig } from "./providers/caching.ts";
import { ValidationError } from "./errors.ts";
import {
  extractPath,
  extractIntPath,
  extractFloatPath,
  setWirePath,
} from "./paths.ts";
import { parseCacheUsage } from "./caching.ts";
import type { Response } from "./types.ts";












export function decodeResponse(
  provider: ProviderName,
  chatWireShape: string,
  body: string,
): Response {
  const raw: unknown = JSON.parse(body);
  if (chatWireShape === "ChatResponsesOpenAI") {
    return parseResponsesEnvelope(raw);
  }

  const cfg = PROVIDERS[provider];
  const cache = parseCacheUsage(raw, provider);
  const result: Response = {
    text: extractPath(raw, cfg.responseTextPath),
    usage: {
      input: extractIntPath(raw, cfg.usageInputPath),
      output: extractIntPath(raw, cfg.usageOutputPath),
      cacheWrite: cache.write,
      cacheRead: cache.read,
      reasoning: cfg.reasoningTokensPath
        ? extractIntPath(raw, cfg.reasoningTokensPath)
        : 0,
      cost: cfg.usageCostPath
        ? extractFloatPath(raw, cfg.usageCostPath) * cfg.usageCostScale
        : 0,
    },
  };
  if (cfg.finishReasonPath) {
    const reason = extractPath(raw, cfg.finishReasonPath);
    if (reason) result.finishReason = reason;
  }
  if (cfg.finishMessagePath) {
    const message = extractPath(raw, cfg.finishMessagePath);
    if (message) result.finishMessage = message;
  }
  return result;
}













export function encodeResponse(
  provider: ProviderName,
  chatWireShape: string,
  response: Response,
): string {
  guardOneWayFields(provider, response);
  if (chatWireShape === "ChatResponsesOpenAI") {
    return JSON.stringify(encodeResponsesEnvelope(response));
  }

  const cfg = PROVIDERS[provider];
  const raw: Record<string, unknown> = {};
  setWirePath(raw, cfg.responseTextPath, response.text);
  setWirePath(raw, cfg.usageInputPath, response.usage.input);
  setWirePath(raw, cfg.usageOutputPath, response.usage.output);
  const cc = cachingConfig(provider);
  if (cc) {
    setWirePath(raw, cc.writeTokensPath, response.usage.cacheWrite);
    setWirePath(raw, cc.readTokensPath, response.usage.cacheRead);
  }
  if (cfg.usageCostScale) {
    setWirePath(raw, cfg.usageCostPath, response.usage.cost / cfg.usageCostScale);
  }
  setWirePath(raw, cfg.reasoningTokensPath, response.usage.reasoning);
  setWirePath(raw, cfg.finishReasonPath, response.finishReason);
  setWirePath(raw, cfg.finishMessagePath, response.finishMessage);
  return JSON.stringify(raw);
}

//
//
//
//
//
//
//
//
//
function guardOneWayFields(provider: ProviderName, response: Response): void {
  if (provider === "vertex" && response.finishReason) {
    throw new ValidationError(
      "response.finish_reason",
      "Vertex carries no finish-reason field. Its path reads predictions[0].raiFilteredReason — a safety-filter explanation surfaced AS the finish reason. Extraction is a deliberate fusion, so the reverse leg cannot decide whether a given canonical finish_reason originated as a safety verdict, and writing an ordinary stop signal into that field would fabricate one.",
    );
  }
}

//
//
//
//
//
//
//
function parseResponsesEnvelope(raw: unknown): Response {
  const result: Response = {
    text: extractResponsesText(raw),
    usage: {
      input: extractIntPath(raw, "usage.input_tokens"),
      output: extractIntPath(raw, "usage.output_tokens"),
      cacheWrite: 0,
      cacheRead: extractIntPath(raw, "usage.input_tokens_details.cached_tokens"),
      reasoning: extractIntPath(
        raw,
        "usage.output_tokens_details.reasoning_tokens",
      ),
      cost: 0,
    },
  };
  const status = extractPath(raw, "status");
  if (status) result.finishReason = status;
  return result;
}

//
//
//
//
//
function encodeResponsesEnvelope(response: Response): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  if (response.text) {
    raw.output = [
      {
        type: "message",
        content: [{ type: "output_text", text: response.text }],
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
  setWirePath(raw, "status", response.finishReason);
  return raw;
}

//
//
//
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
