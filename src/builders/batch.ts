// Owns the `Text.batch` terminal + BatchHandle.wait/poll translation. Batch
// is a text execution mode (parallel to `stream`): `c.text.<config>.batch(...)`
// queues the batch and returns a BatchHandle without blocking. The blocking
// one-liner is the explicit compose `(await c.text.batch(...)).wait()` — there
// is no blocking-sugar terminal. The legacy free functions (`submitBatch`,
// `waitBatch`) are reachable only as internal helpers imported from batch.ts.
//
// BatchHandle is promoted from a plain interface (legacy types.ts) to a
// class here so the typed-builder API can offer `.wait()` as a method —
// matching Go's `BatchHandle.Wait` value-receiver shape. The class fields
// (`id`, `provider`) preserve the legacy data shape, so a plain object
// returned by the internal `submitBatch` can be wrapped via `new BatchHandle`
// without conversion.
//
// AJU-007: BatchHandle is deliberately NOT a thenable / PromiseLike — it has
// no `then` method, so a stray `await handle` or Promise.all cannot silently
// run a minutes-long job. The blocking path is the explicit `.wait()`.

import {
  pollBatch as runPollBatch,
  submitBatch as runSubmitBatch,
  waitBatch as runWaitBatch,
  type BatchOptions,
} from "../batch.ts";
import type { JobStatus } from "../job.ts";
import { ValidationError } from "../errors.ts";
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

  /**
   * poll performs exactly ONE provider round-trip and returns the normalized
   * JobStatus (ADR-063 POLL-001) — the non-blocking primitive for callers driving
   * their own poll loop from an orchestrator (Temporal, a queue, cron). When the
   * batch has completed, JobStatus.result carries the ordered responses (the
   * two-hop result fetch is performed inline); a provider-reported terminal
   * failure yields state "failed" with the status on JobStatus.cause; otherwise
   * state is "running". Honors this.raw like wait(), and is safe on a
   * reconstituted handle (ADR-014 cross-process resume; POLL-005).
   */
  async poll(options: BatchOptions = {}): Promise<JobStatus<Response[]>> {
    return await runPollBatch(
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
  // ADR-055: Protocol (e.g. Responses) is prompt-only in slice 1. Reject a
  // non-default protocol loudly rather than silently sending a Chat
  // Completions batch (uniform across the four SDKs).
  if (b._protocol) {
    throw new ValidationError(
      "protocol",
      "protocol (e.g. Responses) is only supported on the prompt terminal, not batch (ADR-055)",
    );
  }
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

// The single batch terminal on the Text builder: c.text.<config>.batch(...).
// Queues the batch and returns a BatchHandle without blocking; the chain's
// .raw() opt-in is remembered on the handle so handle.wait()/poll() honor it
// (ADR-014). The blocking one-liner is the compose (await batch(...)).wait().
export async function textBatch(
  b: Text,
  ...prompts: string[]
): Promise<BatchHandle> {
  const { provider, requests, options } = batchInputs(b, prompts);
  const legacy = await runSubmitBatch(provider, requests, options);
  return new BatchHandle(legacy.id, legacy.provider, !!b._raw);
}
