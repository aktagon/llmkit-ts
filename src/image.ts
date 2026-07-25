//
//
//
//
//
//
//

import { PROVIDERS } from "./providers/providers.ts";
import {
  type ImageGenDef,
  type ImageModelDef,
  imageGenConfig,
} from "./providers/image_gen.ts";
import { APIError, ValidationError } from "./errors.ts";
import { extractIntPath, optIntPath } from "./paths.ts";
import { buildAuthHeaders } from "./request.ts";
import { firePost, firePre } from "./middleware.ts";
import type { Event, MiddlewareFn } from "./providers/middleware.ts";
import type { Provider, SafetySetting, Usage } from "./types.ts";

export type { MediaRef } from "./structs.ts";
import type { MediaRef } from "./structs.ts";











export type Part =
  | { text: string }
  | { image: MediaRef }
  | { lyrics: string }
  | { audio: string }
  | { audioBytes: MediaRef };






export function audio(url: string): Part {
  return { audio: url };
}







export function audioBytes(mime: string, raw: Uint8Array): Part {
  return { audioBytes: { mimeType: mime, bytes: raw } };
}

export type { ImageData } from "./structs.ts";
import type { ImageData } from "./structs.ts";











export interface ImageRequest {
  model: string;
  prompt?: string;
  parts?: Part[];
}

//
//
//
//
import type { ImageResponse } from "./structs.ts";
export type { ImageResponse };

export interface ImageOptions {
  aspectRatio?: string;
  imageSize?: string;
  includeText?: boolean;

  quality?: string;

  outputFormat?: string;

  background?: string;

  count?: number;


  mask?: MediaRef;






  extraFields?: Record<string, unknown>;


  safetyFilter?: string;


  safetySettings?: SafetySetting[];
  middleware?: MiddlewareFn[];
  signal?: AbortSignal;




  raw?: boolean;
}

export async function generateImage(
  provider: Provider,
  request: ImageRequest,
  options: ImageOptions = {},
): Promise<ImageResponse> {
  const cfg = PROVIDERS[provider.name];
  if (!cfg) {
    throw new ValidationError("provider", `unknown: ${provider.name}`);
  }
  if (!provider.apiKey) {
    throw new ValidationError("apiKey", "required");
  }
  if (!request.model) {
    throw new ValidationError("model", "required for image generation");
  }

  const parts = normalizeImageParts(request);

  const imgCfg = imageGenConfig(provider.name);
  if (!imgCfg) {
    throw new ValidationError(
      "provider",
      `${provider.name} does not support image generation`,
    );
  }
  const model = findImageModel(imgCfg, request.model);
  if (!model) {
    throw new ValidationError(
      "model",
      `${request.model} is not a known image-generation model for ${provider.name}`,
    );
  }
  //
  //
  //
  //
  if (
    options.aspectRatio &&
    model.aspectRatios.length > 0 &&
    !model.aspectRatios.includes(options.aspectRatio)
  ) {
    throw new ValidationError(
      "aspect_ratio",
      `${options.aspectRatio} not supported by ${request.model}`,
    );
  }
  if (
    options.imageSize &&
    model.imageSizes.length > 0 &&
    !model.imageSizes.includes(options.imageSize)
  ) {
    throw new ValidationError(
      "image_size",
      `${options.imageSize} not supported by ${request.model}`,
    );
  }
  const imageCount = parts.filter((p) => "image" in p).length;
  if (imageCount > imgCfg.maxInputCount) {
    throw new ValidationError(
      "parts",
      `${imageCount} image parts exceeds maximum ${imgCfg.maxInputCount} for ${provider.name}`,
    );
  }

  //
  //
  //
  if (imgCfg.inputMode === "InlineParts") {
    if (options.quality !== undefined)
      throw new ValidationError("quality", `not supported by ${provider.name}`);
    if (options.outputFormat !== undefined)
      throw new ValidationError(
        "output_format",
        `not supported by ${provider.name}`,
      );
    if (options.background !== undefined)
      throw new ValidationError(
        "background",
        `not supported by ${provider.name}`,
      );
    if (options.count !== undefined)
      throw new ValidationError("count", `not supported by ${provider.name}`);
    if (options.mask !== undefined)
      throw new ValidationError("mask", `not supported by ${provider.name}`);
    if (options.safetyFilter !== undefined)
      throw new ValidationError(
        "safety_filter",
        `not supported by ${provider.name}; use SafetySettings for text-gen`,
      );
    //
  } else if (imgCfg.inputMode === "JSONInlineRefs") {
    if (options.quality !== undefined)
      throw new ValidationError("quality", `not supported by ${provider.name}`);
    if (options.outputFormat !== undefined)
      throw new ValidationError(
        "output_format",
        `not supported by ${provider.name}`,
      );
    if (options.background !== undefined)
      throw new ValidationError(
        "background",
        `not supported by ${provider.name}`,
      );
    if (options.mask !== undefined)
      throw new ValidationError("mask", `not supported by ${provider.name}`);
    if (options.safetyFilter !== undefined)
      throw new ValidationError(
        "safety_filter",
        `not supported by ${provider.name}`,
      );
    if (options.safetySettings && options.safetySettings.length > 0)
      throw new ValidationError(
        "safety_settings",
        `not supported by ${provider.name}`,
      );
  } else if (imgCfg.inputMode === "MultipartForm") {
    if (options.mask !== undefined && imageCount === 0) {
      throw new ValidationError(
        "mask",
        "requires at least one image part (edits branch only)",
      );
    }
    if (options.safetyFilter !== undefined)
      throw new ValidationError(
        "safety_filter",
        `not supported by ${provider.name}`,
      );
    if (options.safetySettings && options.safetySettings.length > 0)
      throw new ValidationError(
        "safety_settings",
        `not supported by ${provider.name}`,
      );
  } else if (imgCfg.inputMode === "JSONPredict") {
    if (options.quality !== undefined)
      throw new ValidationError("quality", `not supported by ${provider.name}`);
    if (options.outputFormat !== undefined)
      throw new ValidationError(
        "output_format",
        `not supported by ${provider.name}`,
      );
    if (options.background !== undefined)
      throw new ValidationError(
        "background",
        `not supported by ${provider.name}`,
      );
    //
    if (options.safetySettings && options.safetySettings.length > 0)
      throw new ValidationError(
        "safety_settings",
        `not supported by ${provider.name}; use safetyFilter for Vertex Imagen`,
      );
  } else if (imgCfg.inputMode === "JSONGenerations") {
    //
    //
    //
    //
    //
    if (options.aspectRatio !== undefined)
      throw new ValidationError(
        "aspect_ratio",
        `not supported by ${provider.name}; use imageSize (Recraft sizes by WxH)`,
      );
    if (options.quality !== undefined)
      throw new ValidationError("quality", `not supported by ${provider.name}`);
    if (options.outputFormat !== undefined)
      throw new ValidationError(
        "output_format",
        `not supported by ${provider.name}`,
      );
    if (options.background !== undefined)
      throw new ValidationError(
        "background",
        `not supported by ${provider.name}`,
      );
    if (options.mask !== undefined)
      throw new ValidationError("mask", `not supported by ${provider.name}`);
    if (options.safetyFilter !== undefined)
      throw new ValidationError(
        "safety_filter",
        `not supported by ${provider.name}`,
      );
    if (options.safetySettings && options.safetySettings.length > 0)
      throw new ValidationError(
        "safety_settings",
        `not supported by ${provider.name}`,
      );
  }

  const baseEvent: Event = {
    op: "image_generation",
    phase: "pre",
    provider: provider.name,
    model: request.model,
  };
  const veto = firePre(options.middleware, baseEvent);
  if (veto) throw veto;
  const start = performance.now();

  try {
    const baseUrl = provider.baseUrl || cfg.baseUrl;
    const authHeaders = buildAuthHeaders(provider, cfg);

    let httpResp: Response;
    const hasImages = parts.some((p) => "image" in p);
    if (imgCfg.inputMode === "JSONInlineRefs") {
      const body = hasImages
        ? buildXAIEditBody(parts, request.model, options)
        : buildXAIGenBody(parts, request.model, options);
      const url =
        baseUrl + (hasImages ? imgCfg.editEndpoint : imgCfg.genEndpoint);
      httpResp = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } else if (imgCfg.inputMode === "MultipartForm") {
      if (hasImages) {
        const form = buildOpenAIEditFormData(parts, request.model, options);
        httpResp = await fetch(baseUrl + imgCfg.editEndpoint, {
          method: "POST",
          headers: authHeaders, // FormData sets its own Content-Type
          body: form,
          signal: options.signal,
        });
      } else {
        const body = buildOpenAIGenBody(parts, request.model, options);
        httpResp = await fetch(baseUrl + imgCfg.genEndpoint, {
          method: "POST",
          headers: { ...authHeaders, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: options.signal,
        });
      }
    } else if (imgCfg.inputMode === "JSONGenerations") {
      const body = buildRecraftGenBody(parts, request.model, options);
      httpResp = await fetch(baseUrl + imgCfg.genEndpoint, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } else if (imgCfg.inputMode === "JSONPredict") {
      const body = buildVertexBody(parts, options);
      const endpoint = (cfg.endpoint || "").replaceAll(
        "{model}",
        request.model,
      );
      httpResp = await fetch(baseUrl + endpoint, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } else {
      //
      let endpoint = (cfg.endpoint || "").replaceAll("{model}", request.model);
      if (cfg.authScheme === "QueryParamKey" && cfg.authQueryParam) {
        const sep = endpoint.includes("?") ? "&" : "?";
        endpoint = `${endpoint}${sep}${cfg.authQueryParam}=${encodeURIComponent(provider.apiKey)}`;
      }
      const body = buildImageBody(parts, options);
      httpResp = await fetch(baseUrl + endpoint, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal,
      });
    }

    const respText = await httpResp.text();
    if (!httpResp.ok) {
      throw new APIError(
        httpResp.status,
        respText,
        httpResp.status === 429 || httpResp.status >= 500,
      );
    }

    const raw = JSON.parse(respText) as unknown;
    //
    //
    //
    let result: ImageResponse;
    switch (imgCfg.responseShape) {
      case "DataArrayB64Json":
        //
        //
        result = parseImageResponseDataArray(
          raw,
          imgCfg.usageInputPath,
          imgCfg.usageOutputPath,
        );
        break;
      case "VertexPredictions":
        result = parseVertexImageResponse(raw);
        break;
      default:
        //
        result = parseImageResponse(
          raw,
          imgCfg.usageInputPath,
          imgCfg.usageOutputPath,
        );
    }
    if (options.raw) result.raw = raw;
    firePost(options.middleware, {
      ...baseEvent,
      usage: result.usage,
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

//
//
//
function buildOpenAIGenBody(
  parts: Part[],
  model: string,
  options: ImageOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    prompt: joinTextParts(parts),
  };
  if (options.imageSize) body.size = options.imageSize;
  if (options.quality) body.quality = options.quality;
  if (options.outputFormat) body.output_format = options.outputFormat;
  if (options.background) body.background = options.background;
  if (options.count !== undefined) body.n = options.count;
  if (options.extraFields) {
    for (const [k, v] of Object.entries(options.extraFields)) body[k] = v;
  }
  return body;
}

function buildOpenAIEditFormData(
  parts: Part[],
  model: string,
  options: ImageOptions,
): FormData {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", joinTextParts(parts));
  if (options.imageSize) form.append("size", options.imageSize);
  if (options.quality) form.append("quality", options.quality);
  if (options.outputFormat) form.append("output_format", options.outputFormat);
  if (options.background) form.append("background", options.background);
  if (options.count !== undefined) form.append("n", String(options.count));
  if (options.extraFields) {
    for (const [k, v] of Object.entries(options.extraFields)) {
      form.append(k, typeof v === "string" ? v : JSON.stringify(v));
    }
  }
  let idx = 0;
  for (const part of parts) {
    if ("image" in part) {
      const mime = part.image.mimeType || "image/png";
      const ext =
        mime === "image/jpeg"
          ? ".jpg"
          : mime === "image/webp"
            ? ".webp"
            : ".png";
      //
      const buf = new ArrayBuffer(part.image.bytes.byteLength);
      new Uint8Array(buf).set(part.image.bytes);
      form.append(
        "image[]",
        new Blob([buf], { type: mime }),
        `image-${idx}${ext}`,
      );
      idx++;
    }
  }
  if (options.mask) {
    const mime = options.mask.mimeType || "image/png";
    const ext =
      mime === "image/jpeg" ? ".jpg" : mime === "image/webp" ? ".webp" : ".png";
    const buf = new ArrayBuffer(options.mask.bytes.byteLength);
    new Uint8Array(buf).set(options.mask.bytes);
    form.append("mask", new Blob([buf], { type: mime }), `mask${ext}`);
  }
  return form;
}






function buildXAIGenBody(
  parts: Part[],
  model: string,
  options: ImageOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    prompt: joinTextParts(parts),
    response_format: "b64_json",
  };
  if (options.aspectRatio) body.aspect_ratio = options.aspectRatio;
  if (options.imageSize) body.resolution = options.imageSize;
  if (options.count !== undefined) body.n = options.count;
  if (options.extraFields) {
    for (const [k, v] of Object.entries(options.extraFields)) body[k] = v;
  }
  return body;
}






function buildXAIEditBody(
  parts: Part[],
  model: string,
  options: ImageOptions,
): Record<string, unknown> {
  const body = buildXAIGenBody(parts, model, options);
  const refs: Array<{ url: string }> = [];
  for (const p of parts) {
    if ("image" in p) {
      const mime = p.image.mimeType || "image/png";
      const dataURL = `data:${mime};base64,${bytesToBase64(p.image.bytes)}`;
      refs.push({ url: dataURL });
    }
  }
  if (refs.length === 1) {
    body.image = refs[0];
  } else if (refs.length > 1) {
    body.images = refs;
  }
  return body;
}










function buildVertexBody(
  parts: Part[],
  options: ImageOptions,
): Record<string, unknown> {
  const instance: Record<string, unknown> = {
    prompt: joinTextParts(parts),
  };
  for (const p of parts) {
    if ("image" in p) {
      instance.image = { bytesBase64Encoded: bytesToBase64(p.image.bytes) };
      break; // Vertex Imagen takes a single edit-target image
    }
  }
  if (options.mask) {
    instance.mask = {
      image: { bytesBase64Encoded: bytesToBase64(options.mask.bytes) },
    };
  }

  const parameters: Record<string, unknown> = {
    sampleCount: options.count ?? 1,
  };
  if (options.aspectRatio) parameters.aspectRatio = options.aspectRatio;
  if (options.safetyFilter) parameters.safetySetting = options.safetyFilter;
  if (options.extraFields) {
    for (const [k, v] of Object.entries(options.extraFields)) parameters[k] = v;
  }

  return { instances: [instance], parameters };
}






function parseVertexImageResponse(raw: unknown): ImageResponse {
  const obj = (raw as { predictions?: unknown }).predictions;
  const preds = Array.isArray(obj) ? obj : [];
  const images: ImageData[] = [];
  let finishReason: string | undefined;
  for (const item of preds) {
    if (!item || typeof item !== "object") continue;
    const entry = item as {
      bytesBase64Encoded?: unknown;
      mimeType?: unknown;
      raiFilteredReason?: unknown;
    };
    if (
      typeof entry.raiFilteredReason === "string" &&
      entry.raiFilteredReason &&
      !finishReason
    ) {
      //
      //
      finishReason = entry.raiFilteredReason;
    }
    const b64 =
      typeof entry.bytesBase64Encoded === "string"
        ? entry.bytesBase64Encoded
        : "";
    if (!b64) continue;
    const mime =
      typeof entry.mimeType === "string" && entry.mimeType
        ? entry.mimeType
        : "image/png";
    try {
      images.push({ mimeType: mime, bytes: base64ToBytes(b64) });
    } catch {
      //
    }
  }
  const out: ImageResponse = {
    images,
    text: "",
    usage: {},
  };
  if (finishReason) out.finishReason = finishReason;
  return out;
}










function buildRecraftGenBody(
  parts: Part[],
  model: string,
  options: ImageOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    prompt: joinTextParts(parts),
    response_format: "b64_json",
  };
  if (options.imageSize) body.size = options.imageSize;
  if (options.count !== undefined) body.n = options.count;
  if (options.extraFields) {
    for (const [k, v] of Object.entries(options.extraFields)) body[k] = v;
  }
  return body;
}

function joinTextParts(parts: Part[]): string {
  return parts
    .filter((p): p is { text: string } => "text" in p && !!p.text)
    .map((p) => p.text)
    .join("\n");
}

function findImageModel(
  cfg: ImageGenDef,
  modelId: string,
): ImageModelDef | undefined {
  return cfg.models.find((m) => m.modelId === modelId);
}







function normalizeImageParts(request: ImageRequest): Part[] {
  const hasPrompt = !!request.prompt;
  const hasParts = (request.parts?.length ?? 0) > 0;
  if (hasPrompt && hasParts) {
    throw new ValidationError("parts", "set prompt or parts, not both");
  }
  if (!hasPrompt && !hasParts) {
    throw new ValidationError("prompt", "set either prompt or parts");
  }
  return hasPrompt ? [{ text: request.prompt! }] : (request.parts as Part[]);
}

function buildImageBody(
  parts: Part[],
  options: ImageOptions,
): Record<string, unknown> {
  const wire: Array<Record<string, unknown>> = [];
  for (const p of parts) {
    if ("image" in p) {
      wire.push({
        inlineData: {
          mimeType: p.image.mimeType,
          data: bytesToBase64(p.image.bytes),
        },
      });
    } else if ("text" in p) {
      wire.push({ text: p.text });
    }
  }

  const modalities = options.includeText ? ["TEXT", "IMAGE"] : ["IMAGE"];
  const generationConfig: Record<string, unknown> = {
    responseModalities: modalities,
  };
  const imgConfig: Record<string, unknown> = {};
  if (options.aspectRatio) imgConfig.aspectRatio = options.aspectRatio;
  if (options.imageSize) imgConfig.imageSize = options.imageSize;
  if (Object.keys(imgConfig).length > 0) {
    generationConfig.imageConfig = imgConfig;
  }

  const body: Record<string, unknown> = {
    contents: [{ parts: wire }],
    generationConfig,
  };
  if (options.safetySettings && options.safetySettings.length > 0) {
    body.safetySettings = options.safetySettings.map((s) => ({
      category: s.category,
      threshold: s.threshold,
    }));
  }
  return body;
}

function parseImageResponse(
  raw: unknown,
  inputPath: string,
  outputPath: string,
): ImageResponse {
  const { images, text, finishReason, finishMessage } =
    extractGoogleImageParts(raw);
  const out: ImageResponse = {
    images,
    text,
    usage: {
      input: optIntPath(raw, inputPath),
      output: optIntPath(raw, outputPath),
    },
  };
  if (finishReason) out.finishReason = finishReason;
  if (finishMessage) out.finishMessage = finishMessage;
  return out;
}













function parseImageResponseDataArray(
  raw: unknown,
  inputPath: string,
  outputPath: string,
): ImageResponse {
  const root = raw as {
    data?: Array<{
      b64_json?: string;
      mime_type?: string;
      revised_prompt?: string;
    }>;
  };
  const images: ImageData[] = [];
  const revised: string[] = [];
  for (const entry of root?.data ?? []) {
    if (typeof entry?.b64_json === "string" && entry.b64_json.length > 0) {
      let mime =
        typeof entry.mime_type === "string" && entry.mime_type
          ? entry.mime_type
          : "image/png";
      const bytes = base64ToBytes(entry.b64_json);
      //
      //
      //
      //
      //
      if (mime === "image/png" && looksLikeSVG(bytes)) {
        mime = "image/svg+xml";
      }
      images.push({ mimeType: mime, bytes });
    }
    if (typeof entry?.revised_prompt === "string" && entry.revised_prompt) {
      revised.push(entry.revised_prompt);
    }
  }
  return {
    images,
    text: revised.join("\n"),
    usage: {
      input: optIntPath(raw, inputPath),
      output: optIntPath(raw, outputPath),
    },
  };
}

function extractGoogleImageParts(raw: unknown): {
  images: ImageData[];
  text: string;
  finishReason?: string;
  finishMessage?: string;
} {
  const images: ImageData[] = [];
  const textParts: string[] = [];
  const root = raw as {
    candidates?: Array<{
      content?: { parts?: unknown[] };
      finishReason?: string;
      finishMessage?: string;
    }>;
  };
  const candidates = root?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { images, text: "" };
  }
  const cand = candidates[0];
  const finishReason =
    typeof cand?.finishReason === "string" ? cand.finishReason : undefined;
  const finishMessage =
    typeof cand?.finishMessage === "string" ? cand.finishMessage : undefined;
  const parts = cand?.content?.parts;
  if (!Array.isArray(parts)) {
    return { images, text: "", finishReason, finishMessage };
  }

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    const inline = p.inlineData as
      | { mimeType?: string; data?: string }
      | undefined;
    if (inline && typeof inline.data === "string") {
      images.push({
        mimeType: inline.mimeType ?? "",
        bytes: base64ToBytes(inline.data),
      });
    }
    if (typeof p.text === "string" && p.text !== "") {
      textParts.push(p.text);
    }
  }
  return { images, text: textParts.join(""), finishReason, finishMessage };
}







function looksLikeSVG(data: Uint8Array): boolean {
  let s = "";
  for (let i = 0; i < Math.min(data.length, 64); i++) {
    s += String.fromCharCode(data[i]!);
  }
  s = s.replace(/^[\s﻿]+/, "");
  return s.startsWith("<?xml") || s.startsWith("<svg");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)),
    );
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
