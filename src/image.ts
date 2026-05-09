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
import { extractIntPath } from "./paths.ts";
import { buildAuthHeaders } from "./request.ts";
import { firePost, firePre } from "./middleware.ts";
import type { Event, MiddlewareFn } from "./providers/middleware.ts";
import type { Provider, Usage } from "./types.ts";

export interface MediaRef {
  mimeType: string;
  bytes: Uint8Array;
}







export type Part = { text: string } | { image: MediaRef };

export interface ImageData {
  mimeType: string;
  bytes: Uint8Array;
}











export interface ImageRequest {
  model: string;
  prompt?: string;
  parts?: Part[];
}

export interface ImageResponse {
  images: ImageData[];
  text: string;
  tokens: Usage;
}

export interface ImageOptions {
  aspectRatio?: string;
  imageSize?: string;
  includeText?: boolean;
  middleware?: MiddlewareFn[];
  signal?: AbortSignal;
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
  if (
    options.aspectRatio &&
    !model.aspectRatios.includes(options.aspectRatio)
  ) {
    throw new ValidationError(
      "aspect_ratio",
      `${options.aspectRatio} not supported by ${request.model}`,
    );
  }
  if (options.imageSize && !model.imageSizes.includes(options.imageSize)) {
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
    const body = buildImageBody(parts, options);
    const baseUrl = provider.baseUrl || cfg.baseUrl;
    let endpoint = (cfg.endpoint || "").replaceAll("{model}", request.model);
    if (cfg.authScheme === "QueryParamKey" && cfg.authQueryParam) {
      const sep = endpoint.includes("?") ? "&" : "?";
      endpoint = `${endpoint}${sep}${cfg.authQueryParam}=${encodeURIComponent(provider.apiKey)}`;
    }
    const url = baseUrl + endpoint;

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...buildAuthHeaders(provider, cfg),
    };

    const httpResp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
    const respText = await httpResp.text();
    if (!httpResp.ok) {
      throw new APIError(
        httpResp.status,
        respText,
        httpResp.status === 429 || httpResp.status >= 500,
      );
    }

    const raw = JSON.parse(respText) as unknown;
    const result = parseImageResponse(
      raw,
      cfg.usageInputPath,
      cfg.usageOutputPath,
    );
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
    } else {
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

  return {
    contents: [{ parts: wire }],
    generationConfig,
  };
}

function parseImageResponse(
  raw: unknown,
  inputPath: string,
  outputPath: string,
): ImageResponse {
  const { images, text } = extractGoogleImageParts(raw);
  return {
    images,
    text,
    tokens: {
      input: extractIntPath(raw, inputPath),
      output: extractIntPath(raw, outputPath),
      cacheWrite: 0,
      cacheRead: 0,
      reasoning: 0,
    },
  };
}

function extractGoogleImageParts(raw: unknown): {
  images: ImageData[];
  text: string;
} {
  const images: ImageData[] = [];
  const textParts: string[] = [];
  const root = raw as {
    candidates?: Array<{ content?: { parts?: unknown[] } }>;
  };
  const candidates = root?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { images, text: "" };
  }
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) return { images, text: "" };

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
  return { images, text: textParts.join("") };
}

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

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
