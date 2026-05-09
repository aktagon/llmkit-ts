// D2.2 (plan-018) — owns the runtime for *Text.stream. The body
// previously lived in `promptStream(provider, request, onChunk, options)`
// exported from llmkit.ts; that public free function (and its private
// `consumeSSE` helper) was absorbed here.
//
// The bridge: the legacy SSE consumer takes an onChunk callback and
// resolves with a final Response when streaming completes. The
// typed-builder API exposes an AsyncIterable<string>. We adapt by
// running runStream concurrently with the iterator, parking chunks
// in an in-memory queue and waking the iterator when each chunk
// arrives.
//
// Cancellation: the consumer's `for await ... break` triggers the
// generator's `finally` block; we abort the underlying fetch via
// AbortController so the producer task unwinds promptly. AbortError
// from a consumer-initiated abort is swallowed (clean cancellation);
// any other producer error is re-thrown to the consumer at the next
// pull.

import { PROVIDERS } from "../providers/providers.ts";
import { type StreamDef, streamConfig } from "../providers/stream.ts";
import { APIError, ValidationError } from "../errors.ts";
import { extractPath, extractIntPath } from "../paths.ts";
import {
  buildRequest as buildLegacyRequest,
  buildAuthHeaders,
  buildUrl,
  validateOptions,
} from "../request.ts";
import { firePost, firePre } from "../middleware.ts";
import type { Event } from "../providers/middleware.ts";
import type {
  PromptOptions,
  Provider,
  Request as PromptRequest,
  Response as PromptResponse,
} from "../types.ts";
import type { Text } from "./builders.ts";
import { buildPromptArgs } from "./text.ts";

// Maximum chunks held in the bridge queue before the producer
// pauses. Matches Go chan(64) and Python asyncio.Queue(maxsize=64)
// for cross-SDK consistency. A hostile or buggy provider streaming
// faster than the consumer drains will block at this ceiling
// instead of growing the queue unboundedly.
const STREAM_QUEUE_MAX = 64;

interface StreamUsage {
  input: number;
  output: number;
}

async function runStream(
  provider: Provider,
  request: PromptRequest,
  onChunk: (text: string) => void | Promise<void>,
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
    const body = buildLegacyRequest(provider, request, cfg, options);
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
    const usage = await consumeSSE(httpResp.body, streamCfg, async (text) => {
      chunks.push(text);
      await onChunk(text);
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

async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  cfg: StreamDef,
  emit: (text: string) => void | Promise<void>,
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
      stopped = (await processBuffer()) || true;
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    if (await processBuffer()) stopped = true;
  }

  return usage;

  async function processBuffer(): Promise<boolean> {
    let newlineIdx = buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx).replace(/\r$/, "");
      buffer = buffer.slice(newlineIdx + 1);
      if (await handleLine(line)) return true;
      newlineIdx = buffer.indexOf("\n");
    }
    return false;
  }

  async function handleLine(line: string): Promise<boolean> {
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
        if (text) await emit(text);
      }
      if (currentEvent === cfg.usageEvent && cfg.usageOutputPath) {
        usage.output = extractIntPath(parsed, cfg.usageOutputPath);
      }
    } else {
      const text = extractPath(parsed, cfg.deltaTextPath);
      if (text) await emit(text);
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

export async function* textStream(b: Text, msg: string): AsyncIterable<string> {
  const { provider, request, options } = buildPromptArgs(b, msg);
  const ac = new AbortController();
  const opts = { ...options, signal: ac.signal };

  const queue: string[] = [];
  let consumerWaiter: { resolve: () => void } | null = null;
  let producerWaiter: { resolve: () => void } | null = null;
  let done = false;
  let error: Error | null = null;

  const wakeConsumer = () => {
    const w = consumerWaiter;
    consumerWaiter = null;
    w?.resolve();
  };

  const wakeProducer = () => {
    const w = producerWaiter;
    producerWaiter = null;
    w?.resolve();
  };

  runStream(
    provider,
    request,
    async (chunk) => {
      queue.push(chunk);
      wakeConsumer();
      // Backpressure: wait for consumer to drain when at capacity.
      // runStream awaits this Promise (its onChunk type is
      // `(text: string) => void | Promise<void>`), so the underlying
      // SSE reader pauses until space frees up.
      while (queue.length >= STREAM_QUEUE_MAX) {
        await new Promise<void>((resolve) => {
          producerWaiter = { resolve };
        });
      }
    },
    opts,
  ).then(
    () => {
      done = true;
      wakeConsumer();
    },
    (err) => {
      // Consumer-initiated abort is clean cancellation, not an error.
      if (!(err instanceof Error) || err.name !== "AbortError") {
        error = err instanceof Error ? err : new Error(String(err));
      }
      done = true;
      wakeConsumer();
    },
  );

  try {
    while (true) {
      if (queue.length > 0) {
        const chunk = queue.shift() as string;
        wakeProducer();
        yield chunk;
        continue;
      }
      if (done) {
        if (error) throw error;
        return;
      }
      await new Promise<void>((resolve) => {
        consumerWaiter = { resolve };
      });
    }
  } finally {
    if (!done) ac.abort();
    // Unblock any parked producer so it can observe abort and exit.
    wakeProducer();
  }
}
