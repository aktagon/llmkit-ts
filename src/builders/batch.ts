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

import {
  promptBatch as runBatch,
  submitBatch as runSubmitBatch,
  waitBatch as runWaitBatch,
  type BatchOptions,
} from "../batch.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { Provider, Request, Response } from "../types.ts";
import type { Text } from "./builders.ts";
import { buildPromptArgs } from "./text.ts";

export class BatchHandle {
  id: string;
  provider: Provider;

  constructor(id: string, provider: Provider) {
    this.id = id;
    this.provider = provider;
  }

  async wait(options: BatchOptions = {}): Promise<Response[]> {
    return await runWaitBatch(
      { id: this.id, provider: this.provider },
      options,
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
//
//
//
//
//
function batchInputs(
  b: Text,
  prompts: string[],
): { provider: Provider; requests: Request[]; options: BatchOptions } {
  const requests: Request[] = [];
  let providerOut: Provider | undefined;
  let promptOpts: BatchOptions = {};
  for (const p of prompts) {
    const built = buildPromptArgs(b, p);
    requests.push(built.request);
    providerOut = built.provider;
    promptOpts = built.options;
  }
  if (!providerOut) {
    providerOut = {
      name: b.client.provider.name as ProviderName,
      apiKey: b.client.provider.apiKey,
    };
    if (b._model) providerOut.model = b._model;
    if (b.client.provider.baseUrl)
      providerOut.baseUrl = b.client.provider.baseUrl;
  }
  const options: BatchOptions = { ...promptOpts };
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
  return { provider: providerOut, requests, options };
}

export async function textBatch(
  b: Text,
  ...prompts: string[]
): Promise<Response[]> {
  const { provider, requests, options } = batchInputs(b, prompts);
  return await runBatch(provider, requests, options);
}

export async function textSubmitBatch(
  b: Text,
  ...prompts: string[]
): Promise<BatchHandle> {
  const { provider, requests, options } = batchInputs(b, prompts);
  const legacy = await runSubmitBatch(provider, requests, options);
  return new BatchHandle(legacy.id, legacy.provider);
}
