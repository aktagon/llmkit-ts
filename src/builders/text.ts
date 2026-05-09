//
//
//
//
//
//

import { prompt as legacyPrompt } from "../llmkit.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { PromptOptions, Provider, Request, Response } from "../types.ts";
import type { Text } from "./builders.ts";
















export function buildRequest(
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

  return { provider, request, options };
}

export async function textPrompt(b: Text, msg: string): Promise<Response> {
  const { provider, request, options } = buildRequest(b, msg);
  return await legacyPrompt(provider, request, options);
}
