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

import { PROVIDERS } from "../providers/providers.ts";
import type { ProviderName } from "../providers/providers.ts";
import { APIError, ValidationError } from "../errors.ts";
import { extractPath, extractIntPath } from "../paths.ts";
import { applyCaching, parseCacheUsage } from "../caching.ts";
import {
  buildRequest as buildLegacyRequest,
  executeRequest,
  validateOptions,
} from "../request.ts";
import { firePost, firePre } from "../middleware.ts";
import type { Event } from "../providers/middleware.ts";
import type { PromptOptions, Provider, Request, Response } from "../types.ts";
import type { Text } from "./builders.ts";








export function buildPromptArgs(
  b: Text,
  finalText: string,
): { provider: Provider; request: Request; options: PromptOptions } {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
  };
  if (b._model) provider.model = b._model;
  if (b.client.provider.baseUrl) provider.baseUrl = b.client.provider.baseUrl;

  //
  const textSegments: string[] = [];
  for (const p of b._parts) {
    if ("text" in p) textSegments.push(p.text);
  }
  if (finalText) textSegments.push(finalText);
  const user = textSegments.join("");

  //
  //
  //
  //
  const request: Request = {};
  if (b._system) request.system = b._system;
  if (b._history.length > 0) {
    const messages = [...b._history];
    if (user) messages.push({ role: "user", content: user });
    request.messages = messages;
  } else if (user) {
    request.user = user;
  }
  if (b._schema) request.schema = b._schema;

  const options: PromptOptions = {};
  if (b._maxTokens !== undefined) options.maxTokens = b._maxTokens;
  if (b._temperature !== undefined) options.temperature = b._temperature;
  if (b._topP !== undefined) options.topP = b._topP;
  if (b._topK !== undefined) options.topK = b._topK;
  if (b._frequencyPenalty !== undefined)
    options.frequencyPenalty = b._frequencyPenalty;
  if (b._presencePenalty !== undefined)
    options.presencePenalty = b._presencePenalty;
  if (b._seed !== undefined) options.seed = b._seed;
  if (b._stopSequences.length > 0) options.stopSequences = b._stopSequences;
  if (b._thinkingBudget !== undefined)
    options.thinkingBudget = b._thinkingBudget;
  if (b._reasoningEffort) options.reasoningEffort = b._reasoningEffort;
  if (b._caching) options.caching = true;
  if (b._middleware.length > 0) options.middleware = b._middleware;
  if (b._safetySettings.length > 0) options.safetySettings = b._safetySettings;
  if (b._raw) options.raw = true;

  return { provider, request, options };
}

export async function textPrompt(b: Text, msg: string): Promise<Response> {
  const { provider, request, options } = buildPromptArgs(b, msg);

  const cfg = PROVIDERS[provider.name];
  if (!cfg) {
    throw new ValidationError("provider", `unknown: ${provider.name}`);
  }
  if (!provider.apiKey) {
    throw new ValidationError("apiKey", "required");
  }

  validateOptions(provider.name, options);

  const baseEvent: Event = {
    op: "llm_request",
    phase: "pre",
    provider: provider.name,
    model: provider.model || cfg.defaultModel,
  };
  const veto = firePre(options.middleware, baseEvent);
  if (veto) throw veto;
  const start = performance.now();

  try {
    const body = buildLegacyRequest(provider, request, cfg, options);
    if (options.caching) {
      await applyCaching(body, provider, cfg, options);
    }

    const resp = await executeRequest(provider, cfg, body, options);
    if (!resp.ok) {
      throw new APIError(
        resp.status,
        resp.text,
        resp.status === 429 || resp.status >= 500,
      );
    }

    const raw = JSON.parse(resp.text) as unknown;
    const cache = parseCacheUsage(raw, provider.name);
    const result: Response = {
      text: extractPath(raw, cfg.responseTextPath),
      tokens: {
        input: extractIntPath(raw, cfg.usageInputPath),
        output: extractIntPath(raw, cfg.usageOutputPath),
        cacheWrite: cache.write,
        cacheRead: cache.read,
        reasoning: cfg.reasoningTokensPath
          ? extractIntPath(raw, cfg.reasoningTokensPath)
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
    if (b._raw) result.raw = raw;
    firePost(options.middleware, {
      ...baseEvent,
      usage: result.tokens,
      duration: performance.now() - start,
    });
    return result;
  } catch (err) {
    firePost(options.middleware, {
      ...baseEvent,
      err: err instanceof Error ? err : new Error(String(err)),
      duration: performance.now() - start,
    });
    throw err;
  }
}
