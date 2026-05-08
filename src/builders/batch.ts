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
  promptBatch as legacyPromptBatch,
  submitBatch as legacySubmitBatch,
  waitBatch as legacyWaitBatch,
  type BatchOptions,
} from "../batch.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { Provider, Request, Response } from "../types.ts";
import type { Text } from "./builders.ts";
import { buildRequest } from "./text.ts";

export class BatchHandle {
  id: string;
  provider: Provider;

  constructor(id: string, provider: Provider) {
    this.id = id;
    this.provider = provider;
  }

  async wait(options: BatchOptions = {}): Promise<Response[]> {
    return await legacyWaitBatch(
      { id: this.id, provider: this.provider },
      options,
    );
  }
}

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
  for (const p of prompts) {
    const built = buildRequest(b, p);
    requests.push(built.request);
    providerOut = built.provider;
  }
  if (!providerOut) {
    //
    providerOut = {
      name: b.client.provider.name as ProviderName,
      apiKey: b.client.provider.apiKey,
    };
    if (b._model) providerOut.model = b._model;
    if (b.client.provider.baseUrl)
      providerOut.baseUrl = b.client.provider.baseUrl;
  }
  const options: BatchOptions = {};
  if (b._middleware.length > 0) options.middleware = b._middleware;
  return { provider: providerOut, requests, options };
}

export async function textBatch(
  b: Text,
  ...prompts: string[]
): Promise<Response[]> {
  const { provider, requests, options } = batchInputs(b, prompts);
  return await legacyPromptBatch(provider, requests, options);
}

export async function textSubmitBatch(
  b: Text,
  ...prompts: string[]
): Promise<BatchHandle> {
  const { provider, requests, options } = batchInputs(b, prompts);
  const legacy = await legacySubmitBatch(provider, requests, options);
  return new BatchHandle(legacy.id, legacy.provider);
}
