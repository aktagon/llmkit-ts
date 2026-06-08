// Owns Video.submit translation + the VideoHandle poll loop (ADR-034).
// Mirror of go/video.go + go/video_builder.go.
//
// The typed-builder `submit` method is the only public entry point for
// video submission; the internal videoSubmit helper here holds the runtime.
//
// VideoHandle is promoted from a plain interface (generated structs.ts) to a
// class here so the async-handle API can offer `.wait()` as a method —
// matching Go's `VideoHandle.Wait` value-receiver shape, exactly as
// BatchHandle (ADR-014) does in batch.ts. The class fields (id, provider,
// raw) preserve the generated value shape, so cross-process callers can
// reconstruct a handle via `new VideoHandle(id, provider, raw)`.

import { PROVIDERS } from "../providers/providers.ts";
import {
  type VideoGenDef,
  type VideoModelDef,
  videoGenConfig,
} from "../providers/video_gen.ts";
import { APIError, ValidationError } from "../errors.ts";
import { buildAuthHeaders } from "../request.ts";
import { firePost, firePre } from "../middleware.ts";
import type { Event, MiddlewareFn } from "../providers/middleware.ts";
import type { Part } from "../image.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { Provider } from "../types.ts";
import type { VideoData, VideoResponse } from "../structs.ts";
import type { Video } from "./builders.ts";

// Default poll cadence for VideoHandle.wait. xAI documents up-to-several-minute
// generations; the poll loop checks every pollIntervalMs until pollTimeoutMs
// elapses. Both are overridable per call (so tests can run fast); the
// generated-struct value carries no timers.
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export interface VideoWaitOptions {
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /**
   * Opt-in: populate VideoResponse.raw with the parsed provider poll body
   * (ADR-014). The .raw() chain method sets this on the handle at submit
   * time; cross-process callers can pass it here.
   */
  raw?: boolean;
}

export class VideoHandle {
  id: string;
  provider: Provider;
  /** ADR-014: remembered so handle.wait() inherits the .raw() opt-in the
   * user set on the *Video builder that produced the handle. */
  raw: boolean;

  constructor(id: string, provider: Provider, raw: boolean = false) {
    this.id = id;
    this.provider = provider;
    this.raw = raw;
  }

  /**
   * Polls the provider until the video job reaches a terminal state, then
   * resolves with the finished VideoResponse. A failed or expired job
   * rejects with an Error carrying the provider's error.message. Mirror of
   * go/video.go VideoHandle.Wait.
   */
  async wait(options: VideoWaitOptions = {}): Promise<VideoResponse> {
    const cfg = PROVIDERS[this.provider.name];
    if (!cfg) {
      throw new ValidationError("provider", `unknown: ${this.provider.name}`);
    }
    const vgCfg = videoGenConfig(this.provider.name);
    if (!vgCfg) {
      throw new ValidationError(
        "provider",
        `${this.provider.name} does not support video generation`,
      );
    }

    const base = this.provider.baseUrl || cfg.baseUrl;
    const headers = buildAuthHeaders(this.provider, cfg);
    const pollUrl = videoPollURL(vgCfg.wireShape, base, this.id);
    const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeout = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    const wantRaw = !!options.raw || this.raw;

    const deadline = performance.now() + timeout;
    while (true) {
      if (performance.now() > deadline) {
        throw new APIError(
          0,
          `video poll: timed out waiting for ${this.id}`,
          false,
        );
      }
      const respText = await fetchText(pollUrl, headers);
      const raw = JSON.parse(respText) as unknown;
      const result = parseVideoPoll(vgCfg, raw);
      if (result) {
        if (wantRaw) result.raw = raw;
        return result;
      }
      await sleep(interval);
    }
  }
}

/**
 * videoSubmit submits an asynchronous text-to-video job and returns a
 * VideoHandle immediately. Poll the handle with wait(). Pre-flight validation
 * rejects unknown models and unsupported part kinds before any HTTP call.
 * Mirror of go/video.go submitVideo + go/video_builder.go Submit.
 */
export async function videoSubmit(
  b: Video,
  msg: string,
): Promise<VideoHandle> {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
  };
  if (b.client.provider.baseUrl) {
    provider.baseUrl = b.client.provider.baseUrl;
  }

  // Mirror go/video_builder.go: chain-accumulated parts plus an optional
  // trailing text part from submit(msg).
  const cfg = PROVIDERS[provider.name];
  if (!cfg) {
    throw new ValidationError("provider", `unknown: ${provider.name}`);
  }
  if (!provider.apiKey) {
    throw new ValidationError("apiKey", "required");
  }
  if (!b._model) {
    throw new ValidationError("model", "required for video generation");
  }

  const requestParts: Part[] = msg ? [...b._parts, { text: msg }] : b._parts;
  const parts = normalizeVideoParts(requestParts);
  parts.forEach((part, i) => {
    if ("lyrics" in part) {
      throw new ValidationError(
        `parts[${i}]`,
        "video generation does not accept lyrics parts",
      );
    }
    if ("image" in part) {
      throw new ValidationError(
        `parts[${i}]`,
        "image-to-video is not yet wired (slice 1 is text-to-video)",
      );
    }
    if (!("text" in part) || !part.text) {
      throw new ValidationError(`parts[${i}]`, "must have text set");
    }
  });

  const vgCfg = videoGenConfig(provider.name);
  if (!vgCfg) {
    throw new ValidationError(
      "provider",
      `${provider.name} does not support video generation`,
    );
  }
  const model = findVideoModel(vgCfg, b._model);
  if (!model) {
    throw new ValidationError(
      "model",
      `${b._model} is not a known video-generation model for ${provider.name}`,
    );
  }

  const baseEvent: Event = {
    op: "video_generation",
    phase: "pre",
    provider: provider.name,
    model: b._model,
  };
  const veto = firePre(b._middleware as MiddlewareFn[], baseEvent);
  if (veto) throw veto;
  const start = performance.now();

  try {
    const baseUrl = provider.baseUrl || cfg.baseUrl;
    const headers = buildAuthHeaders(provider, cfg);
    const requestId = await dispatchVideoSubmit(
      vgCfg,
      baseUrl,
      headers,
      b._model,
      parts,
    );
    firePost(b._middleware as MiddlewareFn[], {
      ...baseEvent,
      duration: performance.now() - start,
    });
    return new VideoHandle(requestId, provider, !!b._raw);
  } catch (err) {
    firePost(b._middleware as MiddlewareFn[], {
      ...baseEvent,
      err: err instanceof Error ? err : new Error(String(err)),
      duration: performance.now() - start,
    });
    throw err;
  }
}

// dispatchVideoSubmit POSTs the submit body per wire shape (never by provider
// name — the wire shape is the single discriminator) and returns the
// provider-assigned request id.
//
//   - VideoGrok (xAI): POST {model, prompt} to genEndpoint; the response is
//     {"request_id": "..."}.
async function dispatchVideoSubmit(
  vgCfg: VideoGenDef,
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
  parts: Part[],
): Promise<string> {
  switch (vgCfg.wireShape) {
    default: {
      // VideoGrok
      const body = { model, prompt: joinPromptText(parts) };
      const respText = await postJson(
        baseUrl + vgCfg.genEndpoint,
        body,
        headers,
      );
      const raw = JSON.parse(respText) as { request_id?: unknown };
      const requestId =
        typeof raw.request_id === "string" ? raw.request_id : "";
      if (!requestId) {
        throw new APIError(0, "video submit: empty request_id", false);
      }
      return requestId;
    }
  }
}

// videoPollURL builds the per-wire-shape poll URL.
//   - VideoGrok: GET {base}/v1/videos/{id}.
function videoPollURL(wireShape: string, base: string, id: string): string {
  switch (wireShape) {
    default: // VideoGrok
      return base + "/v1/videos/" + id;
  }
}

// parseVideoPoll decodes one poll response. Returns the finished VideoResponse
// when the job reached terminal-success, null while still pending, and throws
// when the job failed or expired.
//   - VideoGrok: {"status": "done", "video": {"url", "duration"}} or
//     {"status": "failed", "error": {"code", "message"}}.
function parseVideoPoll(
  vgCfg: VideoGenDef,
  raw: unknown,
): VideoResponse | null {
  const root = raw as { status?: unknown; error?: unknown };
  const status = typeof root.status === "string" ? root.status : "";
  switch (status) {
    case "done":
      return videoResultFromGrok(vgCfg, raw);
    case "failed":
    case "expired": {
      let msg: string = status;
      const errObj = root.error as { message?: unknown } | undefined;
      if (errObj && typeof errObj.message === "string" && errObj.message) {
        msg = errObj.message;
      }
      throw new APIError(0, `video generation ${status}: ${msg}`, false);
    }
    default:
      return null; // pending (or any non-terminal status)
  }
}

// videoResultFromGrok extracts the finished video from a Grok poll response.
// Grok uses url delivery: VideoData.url carries a temporary xAI-hosted URL and
// bytes stays empty (the SDK does not download on the caller's behalf).
function videoResultFromGrok(
  vgCfg: VideoGenDef,
  raw: unknown,
): VideoResponse {
  const mime = videoFallbackMime(vgCfg);
  const root = raw as {
    video?: { url?: unknown; duration?: unknown };
  };
  const video = root.video;
  if (!video || typeof video !== "object") {
    return buildVideoResponse([]);
  }
  const url = typeof video.url === "string" ? video.url : "";
  const data: VideoData = { mimeType: mime, url };
  if (typeof video.duration === "number") {
    data.durationSeconds = Math.trunc(video.duration);
  }
  return buildVideoResponse([data]);
}

// videoFallbackMime returns the first model's output MIME, used when the
// provider does not echo a MIME on the result.
function videoFallbackMime(vgCfg: VideoGenDef): string {
  return vgCfg.models.length > 0 ? vgCfg.models[0]!.outputMime : "video/mp4";
}

function buildVideoResponse(videos: VideoData[]): VideoResponse {
  return {
    videos,
    usage: {
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
      reasoning: 0,
      cost: 0,
    },
  };
}

/**
 * normalizeVideoParts enforces the XOR rule on the chain-accumulated parts.
 * Both empty (neither Prompt nor Parts) is a validation error. The chain has
 * no distinct prompt/parts split at this layer; submit(msg) folds msg into a
 * trailing text part, so an empty result means the caller set nothing.
 */
function normalizeVideoParts(parts: Part[]): Part[] {
  if (parts.length === 0) {
    throw new ValidationError("prompt", "set either prompt or parts");
  }
  return parts;
}

function joinPromptText(parts: Part[]): string {
  return parts
    .filter((p): p is { text: string } => "text" in p && !!p.text)
    .map((p) => p.text)
    .join("\n");
}

function findVideoModel(
  cfg: VideoGenDef,
  modelId: string,
): VideoModelDef | undefined {
  return cfg.models.find((m) => m.modelId === modelId);
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<string> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

async function fetchText(
  url: string,
  headers: Record<string, string>,
): Promise<string> {
  const resp = await fetch(url, { headers });
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
