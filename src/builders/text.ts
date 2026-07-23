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
import { applyCaching } from "../caching.ts";
import { decodeResponse } from "../response.ts";
import {
  buildRequest as buildLegacyRequest,
  executeRequest,
  resolveChatProtocol,
  validateOptions,
} from "../request.ts";
import { firePost, firePre } from "../middleware.ts";
import type { Event } from "../providers/middleware.ts";
import type {
  InputImage,
  PromptOptions,
  Provider,
  Request,
  Response,
} from "../types.ts";
import { bytesToBase64 } from "../image.ts";
import type { Text } from "./builders.ts";








export function buildPromptArgs(
  b: Text,
  finalText: string,
): { provider: Provider; request: Request; options: PromptOptions } {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
    headers: b.client.provider.headers,
  };
  if (b._model) provider.model = b._model;
  if (b.client.provider.baseUrl) provider.baseUrl = b.client.provider.baseUrl;

  //
  //
  //
  const textSegments: string[] = [];
  const images: InputImage[] = [];
  for (const p of b._parts) {
    if ("text" in p) {
      textSegments.push(p.text);
    } else if ("image" in p) {
      images.push({
        url: `data:${p.image.mimeType};base64,${bytesToBase64(p.image.bytes)}`,
        mimeType: p.image.mimeType,
        detail: "",
      });
    }
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
    if (user)
      messages.push({
        role: "user",
        content: user,
        toolCalls: [],
        toolResult: null,
      });
    request.messages = messages;
  } else if (user) {
    request.user = user;
  }
  if (b._files.length > 0) request.files = b._files;
  if (images.length > 0) request.images = images;
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

  //
  //
  //
  //
  const effCfg = resolveChatProtocol(cfg, b._protocol);

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
    const extraHeaders: Record<string, string> = {};
    const body = buildLegacyRequest(
      provider,
      request,
      effCfg,
      options,
      [],
      extraHeaders,
    );
    if (options.caching) {
      await applyCaching(body, provider, effCfg, options);
    }

    const resp = await executeRequest(
      provider,
      effCfg,
      body,
      options,
      extraHeaders,
    );
    if (!resp.ok) {
      throw new APIError(
        resp.status,
        resp.text,
        resp.status === 429 || resp.status >= 500,
      );
    }

    //
    //
    //
    const result: Response = decodeResponse(
      provider.name,
      effCfg.chatWireShape,
      resp.text,
    );
    if (b._raw) result.raw = JSON.parse(resp.text) as unknown;
    firePost(options.middleware, {
      ...baseEvent,
      usage: result.usage,
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
