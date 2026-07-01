// D2.5 (plan-018) — owns Text.batch + Text.submitBatch + BatchHandle.wait
// translation. The legacy free functions (`promptBatch`, `submitBatch`,
// `waitBatch`, formerly exported from llmkit.ts) are now reachable only
// as internal helpers imported from batch.ts; the typed-builder methods
// are the only public entry point for batched prompts.
//
// BatchHandle is promoted from a plain interface (legacy types.ts) to a
// class here so the typed-builder API can offer `.wait()` as a method —
// matching Go's `BatchHandle.Wait` value-receiver shape. The class fields
// (`id`, `provider`) preserve the legacy data shape, so a plain object
// returned by the internal `submitBatch` can be wrapped via `new BatchHandle`
// without conversion.

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
  /** ADR-014: remembered so handle.wait() inherits the .raw() opt-in
   * the user set on the *Text builder that produced the handle. */
  raw: boolean;

  constructor(id: string, provider: Provider, raw: boolean = false) {
    this.id = id;
    this.provider = provider;
    this.raw = raw;
  }

  async wait(options: BatchOptions = {}): Promise<Response[]> {
    return await runWaitBatch(
      { id: this.id, provider: this.provider },
      { ...options, raw: options.raw ?? this.raw },
    );
  }
}

// Per-prompt Request slice. Each prompt inherits the chain's accumulated
// config (system, schema, files-via-Part). Mirrors Go's batchInputs:
// `buildRequest` is reused so chain config (System, Schema, ...) lands
// identically across single-prompt and batch paths.
//
// ADR-012 REQ-PROP-003: every chain field set on the Text builder must
// propagate to every helper. Sampling options (max_tokens, temperature,
// ...) and caching MUST reach the batch wire body — buildPromptArgs
// returns them; this helper forwards them via BatchOptions (which
// extends PromptOptions). Reading b._<field> directly here keeps the
// propagation lint honest (it can't see the buildPromptArgs return
// destructure).
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
      headers: b.client.provider.headers,
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
  if (b._raw) options.raw = true;
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
  return new BatchHandle(legacy.id, legacy.provider, !!b._raw);
}
