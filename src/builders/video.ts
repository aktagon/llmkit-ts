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

//
//
//
//
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export interface VideoWaitOptions {
  pollIntervalMs?: number;
  pollTimeoutMs?: number;





  raw?: boolean;
}

export class VideoHandle {
  id: string;
  provider: Provider;


  raw: boolean;

  constructor(id: string, provider: Provider, raw: boolean = false) {
    this.id = id;
    this.provider = provider;
    this.raw = raw;
  }







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
        if (wantRaw) result.raw = raw;
        return result;
      }
      await sleep(interval);
    }
  }
}







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

  //
  //
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
//
//
//
async function dispatchVideoSubmit(
  vgCfg: VideoGenDef,
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
  parts: Part[],
): Promise<string> {
  //
  //
  let body: Record<string, unknown>;
  let postHeaders = headers;
  if (vgCfg.wireShape === "VideoQwen") {
    body = { model, input: { prompt: joinPromptText(parts) } };
    //
    //
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

//
//
//
//
//
function videoBaseUrl(
  provider: Provider,
  cfg: { baseUrl: string },
  vgCfg: VideoGenDef,
): string {
  return provider.baseUrl || vgCfg.videoBaseUrl || cfg.baseUrl;
}

//
//
function videoPollURL(pollEndpoint: string, base: string, id: string): string {
  return base + pollEndpoint.replace("{id}", id);
}

//
//
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
function parseVideoPoll(
  vgCfg: VideoGenDef,
  raw: unknown,
): VideoResponse | null {
  //
  //
  //
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

//
//
//
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

//
//
//
//
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

//
//
//
//
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

//
//
//
//
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

//
//
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
