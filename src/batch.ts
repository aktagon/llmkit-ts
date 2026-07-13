import { PROVIDERS, type ProviderSpec } from "./providers/providers.ts";
import {
  type BatchDef,
  type BatchLifecycle,
  batchConfig,
} from "./providers/batch.ts";
import { APIError, ValidationError } from "./errors.ts";
import { extractPath, extractIntPath, extractFloatPath } from "./paths.ts";
import { applyCaching, parseCacheUsage } from "./caching.ts";
import {
  buildAuthHeaders,
  buildRequest,
  resolveModel,
  validateOptions,
} from "./request.ts";
import { firePost, firePre } from "./middleware.ts";
import type { Event, MiddlewareFn } from "./providers/middleware.ts";
import {
  classifyByConfig,
  nonEmptyValues,
  PollBody,
  pollJob,
  pollOnce,
  type Classification,
  type JobAdapter,
  type JobStatus,
  type LifecycleConfig,
} from "./job.ts";
import type {
  BatchHandle,
  PromptOptions,
  Provider,
  Request as PromptRequest,
  Response as PromptResponse,
} from "./types.ts";

//
//
//
//
//
//
export interface BatchOptions extends Partial<PromptOptions> {
  pollIntervalMs?: number;






  pollTimeoutMs?: number;




  signal?: AbortSignal;
  middleware?: MiddlewareFn[];
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
//
//
//
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export async function promptBatch(
  provider: Provider,
  requests: PromptRequest[],
  options: BatchOptions = {},
): Promise<PromptResponse[]> {
  const handle = await submitBatch(provider, requests, options);
  return waitBatch(handle, options);
}

export async function submitBatch(
  provider: Provider,
  requests: PromptRequest[],
  options: BatchOptions = {},
): Promise<BatchHandle> {
  const cfg = PROVIDERS[provider.name];
  if (!cfg) {
    throw new ValidationError("provider", `unknown: ${provider.name}`);
  }
  if (!provider.apiKey) {
    throw new ValidationError("apiKey", "required");
  }
  const bc = batchConfig(provider.name);
  if (!bc || !bc.lifecycle) {
    throw new ValidationError(
      "provider",
      `batching not supported: ${provider.name}`,
    );
  }
  validateOptions(provider.name, {});

  const baseEvent: Event = {
    op: "batch_submit",
    phase: "pre",
    provider: provider.name,
    model: resolveModel(provider, cfg),
  };
  const veto = firePre(options.middleware, baseEvent);
  if (veto) throw veto;
  const start = performance.now();

  try {
    const base = provider.baseUrl || cfg.baseUrl;
    const headers = buildAuthHeaders(provider, cfg);

    let body: Uint8Array;
    if (bc.inputMode === "FileReferenceInput") {
      const jsonl = await buildBatchJsonl(requests, provider, cfg, bc, options);
      const fileId = await uploadBatchFile(base, jsonl, bc, headers);
      const payload: Record<string, unknown> = {
        [bc.inputField]: fileId,
        endpoint: bc.endpointPath,
        completion_window: bc.completionWindow,
      };
      body = new TextEncoder().encode(JSON.stringify(payload));
    } else {
      const payload = await buildBatchBody(
        requests,
        provider,
        cfg,
        bc,
        options,
      );
      body = new TextEncoder().encode(JSON.stringify(payload));
    }

    const createUrl = base + bc.lifecycle.createEndpoint;
    const httpResp = await fetch(createUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
    const respText = await httpResp.text();
    if (!httpResp.ok) {
      throw new APIError(
        httpResp.status,
        respText,
        httpResp.status === 429 || httpResp.status >= 500,
      );
    }
    const raw: unknown = JSON.parse(respText);
    const id = extractPath(raw, bc.lifecycle.responseIdPath);
    if (!id) {
      throw new APIError(0, "batch create: empty batch ID", false);
    }
    firePost(options.middleware, {
      ...baseEvent,
      duration: performance.now() - start,
    });
    return { id, provider, raw: !!options.raw };
  } catch (err) {
    firePost(options.middleware, {
      ...baseEvent,
      err: err instanceof Error ? err : new Error(String(err)),
      duration: performance.now() - start,
    });
    throw err;
  }
}

//
//
//
//
//
//
export async function waitBatch(
  handle: BatchHandle,
  options: BatchOptions = {},
): Promise<PromptResponse[]> {
  const adapter = newBatchAdapter(handle, options);
  return pollJob<PromptResponse[]>(adapter, options.signal);
}

//
//
//
//
//
export async function pollBatch(
  handle: BatchHandle,
  options: BatchOptions = {},
): Promise<JobStatus<PromptResponse[]>> {
  const adapter = newBatchAdapter(handle, options);
  return pollOnce<PromptResponse[]>(adapter, options.signal);
}

//
//
//
class BatchJobAdapter implements JobAdapter<PromptResponse[]> {
  constructor(
    private readonly lc: LifecycleConfig,
    private readonly handle: BatchHandle,
    private readonly base: string,
    private readonly bc: BatchDef,
    private readonly headers: Record<string, string>,
    private readonly pollUrl: string,
    private readonly raw: boolean,
  ) {}

  config(): LifecycleConfig {
    return this.lc;
  }

  async poll(signal?: AbortSignal): Promise<PollBody> {
    const text = await fetchText(this.pollUrl, this.headers, signal);
    return new PollBody(JSON.parse(text) as Record<string, unknown>);
  }

  classify(body: PollBody): Classification {
    return classifyByConfig(this.lc, body);
  }

  async result(body: PollBody, signal?: AbortSignal): Promise<PromptResponse[]> {
    //
    //
    //
    return fetchBatchResults(
      this.handle,
      this.base,
      this.bc,
      this.headers,
      body.raw,
      this.raw,
      signal,
    );
  }
}

//
//
//
//
//
//
function newBatchAdapter(
  handle: BatchHandle,
  options: BatchOptions,
): BatchJobAdapter {
  const cfg = PROVIDERS[handle.provider.name];
  if (!cfg) {
    throw new ValidationError("provider", `unknown: ${handle.provider.name}`);
  }
  const bc = batchConfig(handle.provider.name);
  if (!bc || !bc.lifecycle) {
    throw new APIError(
      0,
      `batch polling not available for ${handle.provider.name}`,
      false,
    );
  }

  const base = handle.provider.baseUrl || cfg.baseUrl;
  const headers = buildAuthHeaders(handle.provider, cfg);
  const lifecycle = bc.lifecycle;
  const pollUrl = lifecycle.pollingEndpoint
    ? base + lifecycle.pollingEndpoint.replace("{id}", handle.id)
    : base + lifecycle.createEndpoint + "/" + handle.id;

  const lc: LifecycleConfig = {
    noun: "batch",
    statusPath: lifecycle.pollingStatusPath,
    doneValues: nonEmptyValues(lifecycle.pollingDoneValue),
    errorValues: lifecycle.pollingErrorValues,
    errorMessagePath: "",
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs: options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
  };
  //
  //
  const raw = !!options.raw || !!handle.raw;
  return new BatchJobAdapter(lc, handle, base, bc, headers, pollUrl, raw);
}

async function fetchBatchResults(
  handle: BatchHandle,
  base: string,
  bc: BatchDef,
  headers: Record<string, string>,
  finalStatus: unknown,
  raw: boolean,
  signal?: AbortSignal,
): Promise<PromptResponse[]> {
  const lc = bc.lifecycle as BatchLifecycle;
  let body: string;
  if (lc.resultFileIdPath) {
    const fileId = extractPath(finalStatus, lc.resultFileIdPath);
    if (!fileId) {
      throw new APIError(0, "batch results: empty output file ID", false);
    }
    const fileUrl = base + lc.fileContentEndpoint.replace("{id}", fileId);
    body = await fetchText(fileUrl, headers, signal);
  } else if (lc.resultEndpoint) {
    const url = base + lc.resultEndpoint.replace("{id}", handle.id);
    body = await fetchText(url, headers, signal);
  } else {
    throw new APIError(
      0,
      `batch result endpoint not configured for ${handle.provider.name}`,
      false,
    );
  }
  return parseBatchResults(handle.provider.name, body, bc, raw);
}

async function buildBatchBody(
  requests: PromptRequest[],
  provider: Provider,
  cfg: ProviderSpec,
  bc: BatchDef,
  options: BatchOptions,
): Promise<Record<string, unknown>> {
  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < requests.length; i++) {
    const req = requests[i]!;
    const reqBody = buildRequest(provider, req, cfg, options);
    if (options.caching) {
      await applyCaching(reqBody, provider, cfg, options);
    }
    if (bc.itemBodyField) {
      items.push({ custom_id: `req-${i}`, [bc.itemBodyField]: reqBody });
    } else {
      items.push(reqBody);
    }
  }
  if (bc.requestWrapper) {
    return { [bc.requestWrapper]: items };
  }
  return { requests: items };
}

async function buildBatchJsonl(
  requests: PromptRequest[],
  provider: Provider,
  cfg: ProviderSpec,
  bc: BatchDef,
  options: BatchOptions,
): Promise<Uint8Array> {
  const lines: string[] = [];
  for (let i = 0; i < requests.length; i++) {
    const req = requests[i]!;
    const reqBody = buildRequest(provider, req, cfg, options);
    if (options.caching) {
      await applyCaching(reqBody, provider, cfg, options);
    }
    lines.push(
      JSON.stringify({
        custom_id: `req-${i}`,
        method: "POST",
        url: bc.endpointPath,
        body: reqBody,
      }),
    );
  }
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

async function uploadBatchFile(
  base: string,
  jsonl: Uint8Array,
  bc: BatchDef,
  headers: Record<string, string>,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([jsonl]), "batch_input.jsonl");
  form.append("purpose", bc.filePurpose);

  const httpResp = await fetch(base + "/v1/files", {
    method: "POST",
    headers,
    body: form,
  });
  const text = await httpResp.text();
  if (!httpResp.ok) {
    throw new APIError(
      httpResp.status,
      text,
      httpResp.status === 429 || httpResp.status >= 500,
    );
  }
  const raw: unknown = JSON.parse(text);
  const id = extractPath(raw, "id");
  if (!id) {
    throw new APIError(0, "batch file upload: empty file ID", false);
  }
  return id;
}

function parseBatchResults(
  provider: string,
  data: string,
  bc: BatchDef,
  raw: boolean,
): PromptResponse[] {
  const cfg = PROVIDERS[provider as keyof typeof PROVIDERS];
  const out: PromptResponse[] = [];
  for (const rawLine of data.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const inner = bc.resultBodyPath
      ? navigatePath(parsed, bc.resultBodyPath)
      : parsed;
    if (!inner || typeof inner !== "object") continue;
    const cache = parseCacheUsage(inner, provider as keyof typeof PROVIDERS);
    const entry: PromptResponse = {
      text: extractPath(inner, cfg.responseTextPath),
      usage: {
        input: extractIntPath(inner, cfg.usageInputPath),
        output: extractIntPath(inner, cfg.usageOutputPath),
        cacheWrite: cache.write,
        cacheRead: cache.read,
        reasoning: cfg.reasoningTokensPath
          ? extractIntPath(inner, cfg.reasoningTokensPath)
          : 0,
        cost: cfg.usageCostPath
          ? extractFloatPath(inner, cfg.usageCostPath) * cfg.usageCostScale
          : 0,
      },
    };
    if (cfg.finishReasonPath) {
      const reason = extractPath(inner, cfg.finishReasonPath);
      if (reason) entry.finishReason = reason;
    }
    if (cfg.finishMessagePath) {
      const message = extractPath(inner, cfg.finishMessagePath);
      if (message) entry.finishMessage = message;
    }
    if (raw) entry.raw = inner;
    out.push(entry);
  }
  return out;
}

function navigatePath(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const part of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

async function fetchText(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<string> {
  const resp = await fetch(url, { headers, signal });
  const text = await resp.text();
  if (!resp.ok) {
    throw new APIError(
      resp.status,
      text,
      resp.status === 429 || resp.status >= 500,
    );
  }
  return text;
}
