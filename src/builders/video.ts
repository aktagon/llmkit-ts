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

    const base = videoBaseUrl(this.provider, cfg, vgCfg);
    const headers = buildAuthHeaders(this.provider, cfg);
    const pollUrl = videoPollURL(vgCfg.pollEndpoint, base, this.id);
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
        // Two-hop providers (vgCfg.fileEndpoint set, e.g. minimax): the
        // terminal poll carried a file reference, not a video URL — resolve it
        // with one more GET before returning.
        const finalResult = vgCfg.fileEndpoint
          ? await resolveVideoFile(base, vgCfg, raw, headers)
          : result;
        if (wantRaw) finalResult.raw = raw;
        return finalResult;
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
    const baseUrl = videoBaseUrl(provider, cfg, vgCfg);
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
// provider-assigned poll handle id.
//
//   - VideoGrok (xAI), VideoZhipu (CogVideoX), and VideoTogether share the
//     simple {model, prompt} submit body. They differ only in which response
//     field carries the poll handle: Grok returns it as request_id, Zhipu and
//     Together as the top-level id.
//   - VideoQwen (DashScope) nests the prompt under an `input` object
//     ({model, input:{prompt}}) and requires the X-DashScope-Async: enable
//     header.
//
// The body and any per-shape headers are selected by wire shape (never
// provider name); the poll handle id is always read from the config-declared
// dotted path (vgCfg.submitHandleField).
async function dispatchVideoSubmit(
  vgCfg: VideoGenDef,
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
  parts: Part[],
): Promise<string> {
  // Submit endpoint resolved from the config-declared base + relative path
  // (Option D); handle id read from the config-declared dotted path (OQ7).
  let body: Record<string, unknown>;
  let postHeaders = headers;
  if (vgCfg.wireShape === "VideoQwen") {
    body = { model, input: { prompt: joinPromptText(parts) } };
    // DashScope's async submit requires this header; set per-request only so
    // it never leaks into the shared auth-header map.
    postHeaders = { ...headers, "X-DashScope-Async": "enable" };
  } else {
    body = { model, prompt: joinPromptText(parts) };
  }
  const respText = await postJson(baseUrl + vgCfg.genEndpoint, body, postHeaders);
  const raw = JSON.parse(respText) as Record<string, unknown>;
  const id = lookupHandleField(raw, vgCfg.submitHandleField);
  if (!id) {
    throw new APIError(
      0,
      `video submit: empty handle field ${vgCfg.submitHandleField}`,
      false,
    );
  }
  return id;
}

// videoBaseUrl resolves the base for the video API (Option D): an explicit
// per-client override wins (tests point it at a mock; users at a proxy), else
// the provider's distinct video base (vgCfg.videoBaseUrl) when the video host
// differs from chat, else the chat base. Endpoints are always relative paths
// joined to this base — never absolute — so the host stays overridable.
function videoBaseUrl(
  provider: Provider,
  cfg: { baseUrl: string },
  vgCfg: VideoGenDef,
): string {
  return provider.baseUrl || vgCfg.videoBaseUrl || cfg.baseUrl;
}

// videoPollURL substitutes {id} in the config poll template (an A-Box fact,
// OQ7) and joins it to the resolved video base.
function videoPollURL(pollEndpoint: string, base: string, id: string): string {
  return base + pollEndpoint.replace("{id}", id);
}

// lookupHandleField descends a dotted path (e.g. "id", "output.task_id")
// through the decoded submit response, returning the string leaf or "".
function lookupHandleField(
  raw: Record<string, unknown>,
  path: string,
): string {
  if (!path) return "";
  let cur: unknown = raw;
  for (const seg of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return "";
    cur = (cur as Record<string, unknown>)[seg];
  }
  return typeof cur === "string" ? cur : "";
}

// parseVideoPoll decodes one poll response per wire shape. Returns the
// finished VideoResponse when the job reached terminal-success, null while
// still pending, and throws when the job failed or expired.
//   - VideoGrok: {"status": "done", "video": {"url", "duration"}} or
//     {"status": "failed", "error": {"code", "message"}}.
//   - VideoZhipu: {"task_status": "SUCCESS"|"FAIL"|"PROCESSING",
//     "video_result": [{"url"}]}.
//   - VideoTogether: {"status": "completed"|"failed"|"cancelled"|"queued"|
//     "in_progress", "outputs": {"video_url"}}.
//   - VideoQwen: {"output": {"task_status": "SUCCEEDED"|"FAILED"|"CANCELED"|
//     "PENDING"|"RUNNING"|"UNKNOWN", "video_url"}}.
function parseVideoPoll(
  vgCfg: VideoGenDef,
  raw: unknown,
): VideoResponse | null {
  // Exhaustive over the wire-shape union: a future shape without a poll arm
  // is a compile error here, not a silent Grok fallthrough that would hang
  // the poll loop on a never-terminal status.
  switch (vgCfg.wireShape) {
    case "VideoTogether": {
      const root = raw as { status?: unknown };
      const status = typeof root.status === "string" ? root.status : "";
      switch (status) {
        case "completed":
          return videoResultFromTogether(vgCfg, raw);
        case "failed":
        case "cancelled":
          throw new APIError(0, `video generation ${status}`, false);
        default:
          return null; // queued, in_progress (or any non-terminal status)
      }
    }
    case "VideoQwen": {
      const root = raw as { output?: { task_status?: unknown } };
      const output = root.output;
      const status =
        output && typeof output.task_status === "string"
          ? output.task_status
          : "";
      switch (status) {
        case "SUCCEEDED":
          return videoResultFromQwen(vgCfg, raw);
        case "FAILED":
        case "CANCELED":
          throw new APIError(0, `video generation ${status}`, false);
        default:
          return null; // PENDING, RUNNING, UNKNOWN (or any non-terminal status)
      }
    }
    case "VideoMinimax": {
      // Two-hop: terminal-success yields a file_id, not a URL. Return an empty
      // response to signal done; wait() performs the file-retrieve hop (gated
      // on vgCfg.fileEndpoint) and fills the URL.
      const root = raw as { status?: unknown };
      const status = typeof root.status === "string" ? root.status : "";
      switch (status) {
        case "Success":
          return buildVideoResponse([]);
        case "Fail":
          throw new APIError(0, "video generation failed", false);
        default:
          return null; // Queueing, Preparing, Processing
      }
    }
    case "VideoZhipu": {
      const root = raw as { task_status?: unknown };
      const status =
        typeof root.task_status === "string" ? root.task_status : "";
      switch (status) {
        case "SUCCESS":
          return videoResultFromZhipu(vgCfg, raw);
        case "FAIL":
          throw new APIError(0, "video generation failed", false);
        default:
          return null; // PROCESSING (or any non-terminal status)
      }
    }
    case "VideoGrok": {
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
    default: {
      const _exhaustive: never = vgCfg.wireShape;
      throw new APIError(
        0,
        `video poll: unsupported wire shape ${String(_exhaustive)}`,
        false,
      );
    }
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

// videoResultFromZhipu extracts the finished video from a Zhipu CogVideoX
// poll response. Zhipu uses url delivery: the finished video sits at
// video_result[0].url (no duration field on the result), so VideoData.url
// carries the temporary Zhipu-hosted URL and bytes stays empty.
function videoResultFromZhipu(
  vgCfg: VideoGenDef,
  raw: unknown,
): VideoResponse {
  const mime = videoFallbackMime(vgCfg);
  const root = raw as { video_result?: unknown };
  const results = Array.isArray(root.video_result) ? root.video_result : [];
  if (results.length === 0) {
    return buildVideoResponse([]);
  }
  const first = results[0] as { url?: unknown };
  const url = typeof first.url === "string" ? first.url : "";
  return buildVideoResponse([{ mimeType: mime, url }]);
}

// videoResultFromTogether extracts the finished video from a Together poll
// response. Together uses url delivery: the finished video sits at
// outputs.video_url, so VideoData.url carries the temporary Together-hosted
// URL and bytes stays empty.
function videoResultFromTogether(
  vgCfg: VideoGenDef,
  raw: unknown,
): VideoResponse {
  const mime = videoFallbackMime(vgCfg);
  const root = raw as { outputs?: { video_url?: unknown } };
  const outputs = root.outputs;
  if (!outputs || typeof outputs !== "object") {
    return buildVideoResponse([]);
  }
  const url = typeof outputs.video_url === "string" ? outputs.video_url : "";
  return buildVideoResponse([{ mimeType: mime, url }]);
}

// videoResultFromQwen extracts the finished video from a DashScope (Qwen) poll
// response. Qwen uses url delivery: the finished video sits at
// output.video_url, so VideoData.url carries the temporary DashScope-hosted URL
// and bytes stays empty.
function videoResultFromQwen(
  vgCfg: VideoGenDef,
  raw: unknown,
): VideoResponse {
  const mime = videoFallbackMime(vgCfg);
  const root = raw as { output?: { video_url?: unknown } };
  const output = root.output;
  if (!output || typeof output !== "object") {
    return buildVideoResponse([]);
  }
  const url = typeof output.video_url === "string" ? output.video_url : "";
  return buildVideoResponse([{ mimeType: mime, url }]);
}

// resolveVideoFile performs the two-hop file-retrieve step for providers whose
// terminal poll yields a file reference rather than a finished video URL
// (vgCfg.fileEndpoint set, e.g. minimax): extract the file id from the terminal
// poll body, GET the file endpoint (joined to the resolved video base), and
// extract the finished reference. file-id and result locations are wire-shape-
// keyed (the transform); the endpoint is config.
async function resolveVideoFile(
  base: string,
  vgCfg: VideoGenDef,
  pollRaw: unknown,
  headers: Record<string, string>,
): Promise<VideoResponse> {
  const root = pollRaw as { file_id?: unknown };
  const fileId = videoFileId(root.file_id);
  if (!fileId) {
    throw new APIError(
      0,
      "video file hop: terminal poll carried no file_id",
      false,
    );
  }
  const fileUrl = base + vgCfg.fileEndpoint.replace("{file_id}", fileId);
  const fileText = await fetchText(fileUrl, headers);
  const fileRaw = JSON.parse(fileText) as unknown;
  return videoResultFromMinimaxFile(vgCfg, fileRaw);
}

// videoFileId reads the minimax terminal poll's file_id, which the API may
// encode as a string or a (large) integer.
function videoFileId(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(Math.trunc(v));
  return "";
}

// videoResultFromMinimaxFile extracts the finished video from a minimax
// file-retrieve response. minimax uses url delivery: the download URL sits at
// file.download_url, so VideoData.url carries it and bytes stays empty.
function videoResultFromMinimaxFile(
  vgCfg: VideoGenDef,
  raw: unknown,
): VideoResponse {
  const mime = videoFallbackMime(vgCfg);
  const root = raw as { file?: { download_url?: unknown } };
  const file = root.file;
  if (!file || typeof file !== "object") {
    return buildVideoResponse([]);
  }
  const url = typeof file.download_url === "string" ? file.download_url : "";
  return buildVideoResponse([{ mimeType: mime, url }]);
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
