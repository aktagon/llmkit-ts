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
function batchInputs(
  b: Text,
  prompts: string[],
): { provider: Provider; requests: Request[]; options: BatchOptions } {
  const requests: Request[] = [];
  let providerOut: Provider | undefined;
  for (const p of prompts) {
    const built = buildPromptArgs(b, p);
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
