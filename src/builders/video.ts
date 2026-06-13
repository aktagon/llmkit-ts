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
import type { ProviderConfig } from "../providers/providers.ts";
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
  /** The submitted model id, carried so wait() can build a model-templated
   * poll URL (Vertex Veo polls POST /{model}:fetchPredictOperation). Submit
   * sets it from the request; "" for providers whose poll endpoint does not
   * template the model. */
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
    // Poll dispatch has three arms, selected here once before the loop:
    //   - sigV4 (Bedrock): signs the poll GET and carries the handle ARN as a
    //     single percent-encoded path segment (its ':' and '/' must not split
    //     into extra segments).
    //   - vertexPoll (Vertex Veo): the ONLY POST-poll shape — fetches the
    //     operation with a POST to {model}:fetchPredictOperation carrying
    //     {operationName}. The model is templated from the handle; the
    //     operation name goes in the body, not the URL.
    //   - default: the verbatim {id} substitution and a GET on the bearer/
    //     query-param auth path (every other provider).
    //
    // The arms are config-disjoint by design: sigV4 keys off authScheme and
    // vertexPoll off wireShape, and no A-Box pairs SigV4 with VideoVertexVeo
    // (Bedrock is SigV4+VideoBedrock; Vertex is bearer+VideoVertexVeo). sigV4 is
    // matched first so a hypothetical both-true misconfig would poll as SigV4.
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
        // Two-hop providers (vgCfg.fileEndpoint set, e.g. minimax): the
        // terminal poll carried a file reference, not a video URL — resolve it
        // with one more GET before returning.
        let finalResult = vgCfg.fileEndpoint
          ? await resolveVideoFile(base, vgCfg, raw, headers)
          : result;
        // Delivery dispatch (VID-005). Download-delivery providers (Veo)
        // returned a temporary fetch URI in VideoData.url; GET it and fill
        // VideoData.bytes (clearing url, per the source-XOR contract). Url-
        // and output-uri-delivery providers leave the url.
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
      // Image-to-video seed frame (BUG-010): accepted only by models whose
      // VideoModelDef sets supportsImageToVideo; text-to-video-only models
      // reject it pre-flight rather than silently dropping it at wire time.
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

  // VID-005: output-uri providers (Bedrock Nova Reel) write the video to the
  // caller's own S3 bucket, so the submit MUST carry a destination URI. Reject
  // pre-flight rather than letting the provider 400. Mirror of go/video.go
  // submitVideo.
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
//   - VideoBedrock (Nova Reel) nests the prompt under modelInput and carries
//     the caller S3 URI under outputDataConfig, and is signed with SigV4 (the
//     bearer/query-param header map does not apply).
//
// The body and any per-shape headers are selected by wire shape (never
// provider name); the poll handle id is always read from the config-declared
// dotted path (vgCfg.submitHandleField).
async function dispatchVideoSubmit(
  vgCfg: VideoGenDef,
  baseUrl: string,
  headers: Record<string, string>,
  provider: Provider,
  cfg: ProviderConfig,
  model: string,
  outputUri: string,
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
  } else if (
    vgCfg.wireShape === "VideoVeo" ||
    vgCfg.wireShape === "VideoVertexVeo"
  ) {
    // Veo (Gemini API) and Vertex Veo share the submit body: the model is in
    // the submit PATH (:predictLongRunning), not the body — so the body has no
    // model field. The prompt nests under instances[]; the optional parameters
    // object ({aspectRatio, resolution} for Gemini; {sampleCount, storageUri}
    // for Vertex) is omitted on the prompt-only hot path.
    body = { instances: [{ prompt: joinPromptText(parts) }] };
  } else if (vgCfg.wireShape === "VideoBedrock") {
    // Nova Reel carries the model in the BODY (modelId, unlike the Converse
    // chat path) and writes the mp4 to the caller's S3 bucket. The optional
    // videoGenerationConfig is omitted on the prompt-only hot path (provider
    // defaults apply).
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
    // Image-to-video (BUG-010): when a seed frame is present (only reachable
    // for grok-imagine-video, the lone supportsImageToVideo model this slice),
    // inline it as a data URL in xAI's image.url field — the same encoding the
    // Grok image-edit path uses. Absent on the text-to-video hot path, so the
    // existing video-grok golden is unchanged.
    const seed = videoSeedImageURL(parts);
    if (seed) body.image = { url: seed };
  }
  // {model} in the submit endpoint is substituted with the per-call model
  // (Veo's :predictLongRunning path); a no-op for providers that carry the
  // model in the body. Query-param auth (Google ?key=) is appended last.
  const submitUrl = appendVideoAuth(
    baseUrl + vgCfg.genEndpoint.replace("{model}", model),
    provider,
    cfg,
  );
  // Bedrock (SigV4) signs the submit POST; the bearer/query-param header map
  // does not apply. Region/secret/session come from the AWS env vars.
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

// videoBaseUrl resolves the base for the video API (Option D): an explicit
// per-client override wins (tests point it at a mock; users at a proxy), else
// the provider's distinct video base (vgCfg.videoBaseUrl) when the video host
// differs from chat, else the chat base. Endpoints are always relative paths
// joined to this base — never absolute — so the host stays overridable. Mirror
// of go/video.go videoBaseURL.
function videoBaseUrl(
  provider: Provider,
  cfg: ProviderConfig,
  vgCfg: VideoGenDef,
): string {
  if (provider.baseUrl) return provider.baseUrl;
  let base = vgCfg.videoBaseUrl || cfg.baseUrl;
  // SigV4 hosts carry a {region} placeholder (Bedrock:
  // bedrock-runtime.{region}.amazonaws.com) resolved from the region env var;
  // a no-op for every provider without the placeholder.
  if (cfg.regionEnvVar) {
    base = base.replaceAll("{region}", process.env[cfg.regionEnvVar] || "");
  }
  return base;
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
    case "VideoVeo": {
      // Operation-based LRO: poll until done=true (the long-running-operation
      // done flag, not a status string). A done op carrying an error object is
      // a terminal failure; otherwise the response holds the finished video.
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
      // A done op with neither error nor a usable uri must surface as an error,
      // not a silent zero-byte success: download delivery would otherwise GET
      // nothing and return a VideoData with empty bytes and empty url.
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
      // Vertex Veo operation poll (fetchPredictOperation): same done/error LRO
      // shape as Gemini Veo, but the finished video arrives as inline base64 in
      // the poll body (response.videos[0].bytesBase64Encoded), not a fetch URI.
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
      // Mirror the Veo done+no-uri guard: a done op carrying no decodable bytes
      // must surface as an error, not a silent zero-byte success.
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
      // Bedrock async-invoke status (GetAsyncInvoke): Completed terminal-
      // success, Failed terminal-error (failureMessage), InProgress pending.
      // On success the provider wrote the mp4 to the caller's S3 bucket and
      // echoes the URI.
      const root = raw as { status?: unknown; failureMessage?: unknown };
      const status = typeof root.status === "string" ? root.status : "";
      switch (status) {
        case "Completed": {
          // A Completed invocation that echoes no output s3 uri must surface as
          // an error, not a silent empty success (mirrors the Veo done+no-uri
          // guard): the caller would otherwise get a "successful" response
          // whose url is empty and never find the mp4.
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

// videoResultFromVeo extracts the finished video reference from a Veo LRO poll
// response. Veo uses download delivery: the response carries a temporary
// Files-API download URI at
// response.generateVideoResponse.generatedSamples[0].video.uri. This places it
// in VideoData.url; the wait() download step (outputDelivery=DeliveryDownload)
// then fetches the bytes into VideoData.bytes and clears url.
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

// videoResultFromVertexVeo extracts the finished video from a Vertex Veo
// fetchPredictOperation poll response. Unlike Gemini Veo (which returns a fetch
// URI), Vertex Veo returns the bytes inline as base64 at
// response.videos[0].bytesBase64Encoded with the mime at .mimeType. This is
// download delivery with NO fetch hop: the bytes are decoded straight into
// VideoData.bytes here and VideoData.url stays empty, so the wait() download
// step (downloadVideoBytes) finds no url and no-ops — the source-XOR contract
// holds (VID-004: download delivery returns bytes, never a url).
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

// videoResultFromBedrock extracts the finished video reference from a Bedrock
// Nova Reel poll response. Bedrock uses output-uri delivery: the provider wrote
// the mp4 to the caller's own S3 bucket and the finished poll echoes the S3 URI
// at outputDataConfig.s3OutputDataConfig.s3Uri. The SDK surfaces it as
// VideoData.url with bytes empty — the wait() delivery step never downloads it
// (only DeliveryDownload fetches), so the caller fetches from S3 with their own
// tooling (VID-005).
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

// pathEscapeSegment encodes a value as a single URL path segment, mirroring
// Go's url.PathEscape: '/' becomes %2F (keeping it one segment) but ':' stays
// literal — which matches Bedrock's SigV4 canonicalization (the live-verified
// Converse chat path signs a model id carrying ':' literally and AWS accepts
// it). signSigV4 canonicalizes the URL's pathname, and new URL().pathname
// preserves both the literal ':' and the %2F, so the signed path equals the
// wire path.
function pathEscapeSegment(s: string): string {
  return encodeURIComponent(s).replace(/%3A/gi, ":");
}

// appendVideoAuth appends the provider's query-param API key to a video URL
// when the provider authenticates that way (Google ?key=); a no-op for
// bearer-header providers (every other video provider). Picks ? or & based on
// whether the URL already carries a query string (the Files-API download URI
// arrives with ?alt=media).
function appendVideoAuth(
  url: string,
  provider: Provider,
  cfg: ProviderConfig,
): string {
  if (cfg.authScheme !== "QueryParamKey" || !cfg.authQueryParam) {
    return url;
  }
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${cfg.authQueryParam}=${encodeURIComponent(provider.apiKey)}`;
}

// downloadVideoBytes fetches the finished video for download-delivery providers
// (vgCfg.outputDelivery === DeliveryDownload, e.g. Veo). The poll result placed
// the temporary fetch URI in VideoData.url; this GETs each one (carrying the
// provider's query-param auth when applicable) and moves the payload into
// VideoData.bytes, clearing url so the source-XOR contract holds (VID-004):
// download delivery returns bytes, never a url.
async function downloadVideoBytes(
  provider: Provider,
  cfg: ProviderConfig,
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

// videoSeedImageURL builds the image-to-video seed-frame data URL for wire
// shapes that condition on a single reference frame (Grok Imagine, BUG-010).
// The image Part's bytes are inlined as a data URL carried in xAI's image.url
// field, mirroring the Grok image-edit encoding in image.ts. Returns "" when no
// image part is present (the text-to-video hot path). Throws on more than one
// image part: Grok animates a single seed frame, so multi-image conditioning is
// a separate slice — rejecting is honest where silently using the first would
// reintroduce the silent-drop bug.
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

// bytesToBase64 encodes bytes as standard base64, mirroring image.ts (the
// seed-image data URL must match the Grok image-edit encoding).
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

// postJsonText POSTs a pre-serialised JSON body string (the Vertex Veo poll
// carries {operationName} as the request body). Mirrors postJson but takes the
// already-stringified body so the poll body is built once before the loop.
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

// sigV4PostJson signs and sends a JSON POST with AWS SigV4, mirroring the chat
// path in request.ts executeRequest. Region/secret/session come from the AWS
// env vars; the signed canonical path equals the wire path (the body is
// content-hashed into the signature).
async function sigV4PostJson(
  url: string,
  body: Record<string, unknown>,
  provider: Provider,
  cfg: ProviderConfig,
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

// sigV4Get signs and sends an empty-body GET with AWS SigV4 (the Bedrock poll).
async function sigV4Get(
  url: string,
  provider: Provider,
  cfg: ProviderConfig,
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

// base64ToBytes decodes a base64 string to bytes, mirroring the image/music
// inline-media decode path (Vertex Veo returns the video inline as base64).
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
