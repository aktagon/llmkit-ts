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
import type { ProviderSpec } from "../providers/providers.ts";
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
import type { MediaRef } from "../structs.ts";
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




  model: string;

  constructor(
    id: string,
    provider: Provider,
    raw: boolean = false,
    model: string = "",
  ) {
    this.id = id;
    this.provider = provider;
    this.raw = raw;
    this.model = model;
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
    const sigV4 = cfg.authScheme === "SigV4";
    const vertexPoll = vgCfg.wireShape === "VideoVertexVeo";
    let pollUrl: string;
    let vertexPollBody = "";
    if (sigV4) {
      pollUrl =
        base + vgCfg.pollEndpoint.replace("{id}", pathEscapeSegment(this.id));
    } else if (vertexPoll) {
      pollUrl = appendVideoAuth(
        base + vgCfg.pollEndpoint.replace("{model}", this.model),
        this.provider,
        cfg,
      );
      vertexPollBody = JSON.stringify({ operationName: this.id });
    } else {
      pollUrl = appendVideoAuth(
        videoPollURL(vgCfg.pollEndpoint, base, this.id),
        this.provider,
        cfg,
      );
    }
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
      const respText = sigV4
        ? await sigV4Get(pollUrl, this.provider, cfg)
        : vertexPoll
          ? await postJsonText(pollUrl, vertexPollBody, headers)
          : await fetchText(pollUrl, headers);
      const raw = JSON.parse(respText) as unknown;
      const result = parseVideoPoll(vgCfg, raw);
      if (result) {
        //
        //
        //
        let finalResult = vgCfg.fileEndpoint
          ? await resolveVideoFile(base, vgCfg, raw, headers)
          : result;
        //
        //
        //
        //
        if (vgCfg.outputDelivery === "DeliveryDownload") {
          finalResult = await downloadVideoBytes(
            this.provider,
            cfg,
            finalResult,
          );
        }
        if (wantRaw) finalResult.raw = raw;
        return finalResult;
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

  parts.forEach((part, i) => {
    if ("lyrics" in part) {
      throw new ValidationError(
        `parts[${i}]`,
        "video generation does not accept lyrics parts",
      );
    }
    if ("image" in part) {
      //
      //
      //
      if (!model.supportsImageToVideo) {
        throw new ValidationError(
          `parts[${i}]`,
          `${b._model} is a text-to-video-only model and does not accept image parts`,
        );
      }
      return;
    }
    if (!("text" in part) || !part.text) {
      throw new ValidationError(`parts[${i}]`, "must have text set");
    }
  });

  //
  //
  //
  //
  if (vgCfg.requiresOutputUri && !b._outputURI) {
    throw new ValidationError(
      "output_uri",
      `${provider.name} requires a caller output S3 URI; set outputURI on the request`,
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
      provider,
      cfg,
      b._model,
      b._outputURI,
      parts,
    );
    firePost(b._middleware as MiddlewareFn[], {
      ...baseEvent,
      duration: performance.now() - start,
    });
    return new VideoHandle(requestId, provider, !!b._raw, b._model);
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
//
//
//
async function dispatchVideoSubmit(
  vgCfg: VideoGenDef,
  baseUrl: string,
  headers: Record<string, string>,
  provider: Provider,
  cfg: ProviderSpec,
  model: string,
  outputUri: string,
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
  } else if (
    vgCfg.wireShape === "VideoVeo" ||
    vgCfg.wireShape === "VideoVertexVeo"
  ) {
    //
    //
    //
    //
    //
    body = { instances: [{ prompt: joinPromptText(parts) }] };
  } else if (vgCfg.wireShape === "VideoBedrock") {
    //
    //
    //
    //
    body = {
      modelId: model,
      modelInput: {
        taskType: "TEXT_VIDEO",
        textToVideoParams: { text: joinPromptText(parts) },
      },
      outputDataConfig: {
        s3OutputDataConfig: { s3Uri: outputUri },
      },
    };
  } else {
    body = { model, prompt: joinPromptText(parts) };
    //
    //
    //
    //
    //
    const seed = videoSeedImageURL(parts);
    if (seed) body.image = { url: seed };
  }
  //
  //
  //
  const submitUrl = appendVideoAuth(
    baseUrl + vgCfg.genEndpoint.replace("{model}", model),
    provider,
    cfg,
  );
  //
  //
  const respText =
    cfg.authScheme === "SigV4"
      ? await sigV4PostJson(submitUrl, body, provider, cfg)
      : await postJson(submitUrl, body, postHeaders);
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
//
function videoBaseUrl(
  provider: Provider,
  cfg: ProviderSpec,
  vgCfg: VideoGenDef,
): string {
  if (provider.baseUrl) return provider.baseUrl;
  let base = vgCfg.videoBaseUrl || cfg.baseUrl;
  //
  //
  //
  if (cfg.regionEnvVar) {
    base = base.replaceAll("{region}", process.env[cfg.regionEnvVar] || "");
  }
  return base;
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
    case "VideoMinimax": {
      //
      //
      //
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
    case "VideoVidu": {
      //
      //
      //
      const root = raw as {
        state?: unknown;
        err_code?: unknown;
        message?: unknown;
      };
      const state = typeof root.state === "string" ? root.state : "";
      switch (state) {
        case "success":
          return videoResultFromVidu(vgCfg, raw);
        case "failed": {
          let msg = "operation failed";
          if (typeof root.err_code === "string" && root.err_code) {
            msg = root.err_code;
          } else if (typeof root.message === "string" && root.message) {
            msg = root.message;
          }
          throw new APIError(0, `video generation failed: ${msg}`, false);
        }
        default:
          return null; // created, queueing, processing (or any non-terminal state)
      }
    }
    case "VideoVeo": {
      //
      //
      //
      const root = raw as {
        done?: unknown;
        error?: { message?: unknown };
      };
      if (root.done !== true) {
        return null;
      }
      if (root.error && typeof root.error === "object") {
        const msg =
          typeof root.error.message === "string" && root.error.message
            ? root.error.message
            : "operation failed";
        throw new APIError(0, `video generation failed: ${msg}`, false);
      }
      //
      //
      //
      const result = videoResultFromVeo(vgCfg, raw);
      if (result.videos.length === 0 || !result.videos[0]!.url) {
        throw new APIError(
          0,
          "video generation: operation done but carried no video uri",
          false,
        );
      }
      return result;
    }
    case "VideoVertexVeo": {
      //
      //
      //
      const root = raw as {
        done?: unknown;
        error?: { message?: unknown };
      };
      if (root.done !== true) {
        return null;
      }
      if (root.error && typeof root.error === "object") {
        const msg =
          typeof root.error.message === "string" && root.error.message
            ? root.error.message
            : "operation failed";
        throw new APIError(0, `video generation failed: ${msg}`, false);
      }
      //
      //
      const result = videoResultFromVertexVeo(vgCfg, raw);
      if (result.videos.length === 0 || !result.videos[0]!.bytes?.length) {
        throw new APIError(
          0,
          "video generation: operation done but carried no video bytes",
          false,
        );
      }
      return result;
    }
    case "VideoBedrock": {
      //
      //
      //
      //
      const root = raw as { status?: unknown; failureMessage?: unknown };
      const status = typeof root.status === "string" ? root.status : "";
      switch (status) {
        case "Completed": {
          //
          //
          //
          //
          const result = videoResultFromBedrock(vgCfg, raw);
          if (result.videos.length === 0 || !result.videos[0]!.url) {
            throw new APIError(
              0,
              "video generation: completed but carried no output s3 uri",
              false,
            );
          }
          return result;
        }
        case "Failed": {
          const msg =
            typeof root.failureMessage === "string" && root.failureMessage
              ? root.failureMessage
              : "operation failed";
          throw new APIError(0, `video generation failed: ${msg}`, false);
        }
        default:
          return null; // InProgress (or any non-terminal status)
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
function videoResultFromVidu(
  vgCfg: VideoGenDef,
  raw: unknown,
): VideoResponse {
  const mime = videoFallbackMime(vgCfg);
  const root = raw as { creations?: unknown };
  const creations = Array.isArray(root.creations) ? root.creations : [];
  if (creations.length === 0) {
    return buildVideoResponse([]);
  }
  const first = creations[0] as { url?: unknown };
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
//
//
//
//
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

//
//
function videoFileId(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(Math.trunc(v));
  return "";
}

//
//
//
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

//
//
//
//
//
//
function videoResultFromVeo(
  vgCfg: VideoGenDef,
  raw: unknown,
): VideoResponse {
  const mime = videoFallbackMime(vgCfg);
  const root = raw as {
    response?: {
      generateVideoResponse?: { generatedSamples?: unknown };
    };
  };
  const gvr = root.response?.generateVideoResponse;
  const samples = Array.isArray(gvr?.generatedSamples)
    ? gvr.generatedSamples
    : [];
  if (samples.length === 0) {
    return buildVideoResponse([]);
  }
  const first = samples[0] as { video?: { uri?: unknown } };
  const uri =
    first.video && typeof first.video.uri === "string" ? first.video.uri : "";
  return buildVideoResponse([{ mimeType: mime, url: uri }]);
}

//
//
//
//
//
//
//
//
function videoResultFromVertexVeo(
  vgCfg: VideoGenDef,
  raw: unknown,
): VideoResponse {
  let mime = videoFallbackMime(vgCfg);
  const root = raw as { response?: { videos?: unknown } };
  const videos = Array.isArray(root.response?.videos)
    ? root.response.videos
    : [];
  if (videos.length === 0) {
    return buildVideoResponse([]);
  }
  const first = videos[0] as {
    mimeType?: unknown;
    bytesBase64Encoded?: unknown;
  };
  if (typeof first.mimeType === "string" && first.mimeType) {
    mime = first.mimeType;
  }
  const b64 =
    typeof first.bytesBase64Encoded === "string"
      ? first.bytesBase64Encoded
      : "";
  if (!b64) {
    return buildVideoResponse([]);
  }
  return buildVideoResponse([{ mimeType: mime, bytes: base64ToBytes(b64) }]);
}

//
//
//
//
//
//
//
function videoResultFromBedrock(
  vgCfg: VideoGenDef,
  raw: unknown,
): VideoResponse {
  const mime = videoFallbackMime(vgCfg);
  const root = raw as {
    outputDataConfig?: { s3OutputDataConfig?: { s3Uri?: unknown } };
  };
  const s3 = root.outputDataConfig?.s3OutputDataConfig;
  const url = s3 && typeof s3.s3Uri === "string" ? s3.s3Uri : "";
  return buildVideoResponse([{ mimeType: mime, url }]);
}

//
//
//
//
//
//
//
function pathEscapeSegment(s: string): string {
  return encodeURIComponent(s).replace(/%3A/gi, ":");
}

//
//
//
//
//
function appendVideoAuth(
  url: string,
  provider: Provider,
  cfg: ProviderSpec,
): string {
  if (cfg.authScheme !== "QueryParamKey" || !cfg.authQueryParam) {
    return url;
  }
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${cfg.authQueryParam}=${encodeURIComponent(provider.apiKey)}`;
}

//
//
//
//
//
//
async function downloadVideoBytes(
  provider: Provider,
  cfg: ProviderSpec,
  resp: VideoResponse,
): Promise<VideoResponse> {
  const headers = buildAuthHeaders(provider, cfg);
  for (const video of resp.videos) {
    if (!video.url) continue;
    const fetchUrl = appendVideoAuth(video.url, provider, cfg);
    video.bytes = await fetchBytes(fetchUrl, headers);
    video.url = "";
  }
  return resp;
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

//
//
//
//
//
//
//
//
function videoSeedImageURL(parts: Part[]): string {
  const images = parts.filter(
    (p): p is { image: MediaRef } => "image" in p,
  );
  if (images.length === 0) return "";
  if (images.length > 1) {
    throw new ValidationError(
      "parts",
      "image-to-video conditions on a single seed frame; pass one image part",
    );
  }
  const img = images[0]!.image;
  const mime = img.mimeType || "image/png";
  return `data:${mime};base64,${bytesToBase64(img.bytes)}`;
}

//
//
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)),
    );
  }
  return btoa(binary);
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

//
//
//
async function postJsonText(
  url: string,
  jsonBody: string,
  headers: Record<string, string>,
): Promise<string> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: jsonBody,
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

async function fetchBytes(
  url: string,
  headers: Record<string, string>,
): Promise<Uint8Array> {
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new APIError(
      resp.status,
      text,
      resp.status === 429 || resp.status >= 500,
    );
  }
  return new Uint8Array(await resp.arrayBuffer());
}

//
//
//
//
async function sigV4PostJson(
  url: string,
  body: Record<string, unknown>,
  provider: Provider,
  cfg: ProviderSpec,
): Promise<string> {
  const { signSigV4 } = await import("../sigv4.ts");
  const jsonBody = JSON.stringify(body);
  const region = process.env[cfg.regionEnvVar] || "";
  const secret = process.env[cfg.secretKeyEnvVar] || "";
  const session = process.env[cfg.sessionTokenEnvVar] || "";
  const headers = await signSigV4(
    url,
    new TextEncoder().encode(jsonBody),
    provider.apiKey,
    secret,
    session,
    region,
    cfg.serviceName,
  );
  headers["Content-Type"] = "application/json";
  const resp = await fetch(url, { method: "POST", headers, body: jsonBody });
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

//
async function sigV4Get(
  url: string,
  provider: Provider,
  cfg: ProviderSpec,
): Promise<string> {
  const { signSigV4 } = await import("../sigv4.ts");
  const region = process.env[cfg.regionEnvVar] || "";
  const secret = process.env[cfg.secretKeyEnvVar] || "";
  const session = process.env[cfg.sessionTokenEnvVar] || "";
  const headers = await signSigV4(
    url,
    new Uint8Array(),
    provider.apiKey,
    secret,
    session,
    region,
    cfg.serviceName,
    "GET",
  );
  const resp = await fetch(url, { method: "GET", headers });
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

//
//
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
