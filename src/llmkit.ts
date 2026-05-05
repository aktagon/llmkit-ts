import { PROVIDERS } from "./providers/providers.ts";
import { type StreamDef, streamConfig } from "./providers/stream.ts";
import { APIError, ValidationError } from "./errors.ts";
import { extractPath, extractIntPath } from "./paths.ts";
import { applyCaching, parseCacheUsage } from "./caching.ts";
import {
  buildRequest,
  buildAuthHeaders,
  buildUrl,
  executeRequest,
  validateOptions,
} from "./request.ts";
import { firePost, firePre } from "./middleware.ts";
import type { Event } from "./providers/middleware.ts";
import type {
  Provider,
  Request as PromptRequest,
  Response as PromptResponse,
  PromptOptions,
} from "./types.ts";

export type {
  Provider,
  Request,
  Response,
  PromptOptions,
  Message,
  Usage,
  File,
  BatchHandle,
} from "./types.ts";
export { Providers } from "./providers/providers.ts";
export { APIError, ValidationError } from "./errors.ts";
export { uploadFile } from "./upload.ts";
export { promptBatch, submitBatch, waitBatch } from "./batch.ts";
export { Agent } from "./agent.ts";
export { MiddlewareVetoError } from "./middleware.ts";
export type { Event, MiddlewareFn } from "./providers/middleware.ts";
export type { Tool, AgentOptions } from "./types.ts";

export async function prompt(
  provider: Provider,
  request: PromptRequest,
  options: PromptOptions = {},
): Promise<PromptResponse> {
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
    const body = buildRequest(provider, request, cfg, options);
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
    const result: PromptResponse = {
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

export async function promptStream(
  provider: Provider,
  request: PromptRequest,
  onChunk: (text: string) => void,
  options: PromptOptions = {},
): Promise<PromptResponse> {
  const cfg = PROVIDERS[provider.name];
  if (!cfg) {
    throw new ValidationError("provider", `unknown: ${provider.name}`);
  }
  if (!provider.apiKey) {
    throw new ValidationError("apiKey", "required");
  }
  const streamCfg = streamConfig(provider.name);
  if (!streamCfg) {
    throw new ValidationError(
      "provider",
      `streaming not supported: ${provider.name}`,
    );
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
    const body = buildRequest(provider, request, cfg, options);
    if (streamCfg.param) {
      body[streamCfg.param] =
        streamCfg.paramValue === "true" ? true : streamCfg.paramValue;
    }
    const headers = buildAuthHeaders(provider, cfg);
    const baseUrl = provider.baseUrl || cfg.baseUrl;
    const endpoint = streamCfg.endpoint || cfg.endpoint;
    const url = buildUrl(baseUrl + endpoint, provider, cfg);

    const httpResp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!httpResp.ok) {
      const errText = await httpResp.text();
      throw new APIError(
        httpResp.status,
        errText,
        httpResp.status === 429 || httpResp.status >= 500,
      );
    }
    if (!httpResp.body) {
      throw new APIError(0, "stream response had no body", false);
    }

    const chunks: string[] = [];
    const usage = await consumeSSE(httpResp.body, streamCfg, (text) => {
      chunks.push(text);
      onChunk(text);
    });

    const result: PromptResponse = {
      text: chunks.join(""),
      tokens: {
        input: usage.input,
        output: usage.output,
        cacheWrite: 0,
        cacheRead: 0,
        reasoning: 0,
      },
    };
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

interface StreamUsage {
  input: number;
  output: number;
}

async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  cfg: StreamDef,
  emit: (text: string) => void,
): Promise<StreamUsage> {
  const usage: StreamUsage = { input: 0, output: 0 };
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let currentEvent = "";
  let stopped = false;

  while (!stopped) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      stopped = processBuffer() || true;
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    if (processBuffer()) stopped = true;
  }

  return usage;

  function processBuffer(): boolean {
    let newlineIdx = buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx).replace(/\r$/, "");
      buffer = buffer.slice(newlineIdx + 1);
      if (handleLine(line)) return true;
      newlineIdx = buffer.indexOf("\n");
    }
    return false;
  }

  function handleLine(line: string): boolean {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice("event: ".length);
      return false;
    }
    if (!line.startsWith("data: ")) return false;
    const data = line.slice("data: ".length);

    if (cfg.doneSignal && data === cfg.doneSignal) return true;
    if (cfg.usesEventTypes && cfg.doneEvent && currentEvent === cfg.doneEvent)
      return true;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return false;
    }
    if (typeof parsed !== "object" || parsed === null) return false;

    if (cfg.usesEventTypes) {
      if (currentEvent === cfg.contentEvent) {
        const text = extractPath(parsed, cfg.deltaTextPath);
        if (text) emit(text);
      }
      if (currentEvent === cfg.usageEvent && cfg.usageOutputPath) {
        usage.output = extractIntPath(parsed, cfg.usageOutputPath);
      }
    } else {
      const text = extractPath(parsed, cfg.deltaTextPath);
      if (text) emit(text);
      if (cfg.usageInputPath) {
        const v = extractIntPath(parsed, cfg.usageInputPath);
        if (v > 0) usage.input = v;
      }
      if (cfg.usageOutputPath) {
        const v = extractIntPath(parsed, cfg.usageOutputPath);
        if (v > 0) usage.output = v;
      }
    }
    currentEvent = "";
    return false;
  }
}
