// Music generation runtime — mirror of go/music.go (ADR-033).
//
// Pre-flight validation (model required; each part exactly one of text or
// lyrics; image parts rejected; lyrics rejected on instrumental-only models)
// runs before any HTTP call. Dispatch branches on mgCfg.wireShape, which fully
// determines the request body, the response audio path, AND the byte encoding
// (base64 for Vertex/Gemini, hex for MiniMax).

import { PROVIDERS, type ProviderConfig } from "./providers/providers.ts";
import {
  type MusicGenDef,
  type MusicModelDef,
  musicGenConfig,
} from "./providers/music_gen.ts";
import { APIError, ValidationError } from "./errors.ts";
import { buildAuthHeaders } from "./request.ts";
import { firePost, firePre } from "./middleware.ts";
import type { Event, MiddlewareFn } from "./providers/middleware.ts";
import type { Provider } from "./types.ts";
import type { Part } from "./image.ts";

export type { AudioData, MusicResponse } from "./structs.ts";
import type { AudioData, MusicResponse } from "./structs.ts";

/**
 * MusicRequest accepts input in one of two mutually-exclusive forms:
 *  - prompt: terse sugar for the prompt-only hot path. Internally
 *    desugars to parts: [text(prompt)] before serialisation.
 *  - parts: canonical sequence of text and lyrics parts. A music request
 *    never carries image parts; the runtime rejects them pre-flight.
 *
 * Pre-flight validation requires exactly one of prompt or parts to be set
 * (XOR). Lyrics on an instrumental-only model are advisory, not rejected
 * (ADR-037 MUS-008): they fold into the prompt for the Predict shape.
 */
export interface MusicRequest {
  model: string;
  prompt?: string;
  parts?: Part[];
}

export interface MusicOptions {
  middleware?: MiddlewareFn[];
  signal?: AbortSignal;
  /**
   * Opt-in: populate MusicResponse.raw with the parsed provider response
   * body (ADR-014). Plumbed by the typed-builder's `.raw()` chain method.
   */
  raw?: boolean;
}

export async function generateMusic(
  provider: Provider,
  request: MusicRequest,
  options: MusicOptions = {},
): Promise<MusicResponse> {
  const cfg = PROVIDERS[provider.name];
  if (!cfg) {
    throw new ValidationError("provider", `unknown: ${provider.name}`);
  }
  if (!provider.apiKey) {
    throw new ValidationError("apiKey", "required");
  }
  if (!request.model) {
    throw new ValidationError("model", "required for music generation");
  }

  const parts = normalizeMusicParts(request);
  parts.forEach((part, i) => {
    let set = 0;
    if ("text" in part && part.text) set++;
    if ("lyrics" in part && part.lyrics) {
      set++;
    }
    if ("image" in part) {
      throw new ValidationError(
        `parts[${i}]`,
        "music generation does not accept image parts",
      );
    }
    if (set !== 1) {
      throw new ValidationError(
        `parts[${i}]`,
        "must have exactly one of text or lyrics set",
      );
    }
  });

  const mgCfg = musicGenConfig(provider.name);
  if (!mgCfg) {
    throw new ValidationError(
      "provider",
      `${provider.name} does not support music generation`,
    );
  }
  const model = findMusicModel(mgCfg, request.model);
  if (!model) {
    throw new ValidationError(
      "model",
      `${request.model} is not a known music-generation model for ${provider.name}`,
    );
  }
  // ADR-037 (MUS-008): supportsLyrics is advisory metadata, not a gate.
  // Lyrics on an instrumental-only model fold into the prompt (for the
  // single-prompt Predict shape) and the model ignores or honors them.

  const baseEvent: Event = {
    op: "music_generation",
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

    const { url, body } = dispatchMusicHTTP(
      provider,
      cfg,
      mgCfg,
      request.model,
      parts,
      baseUrl,
    );

    const httpResp = await fetch(url, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
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
    const result = parseMusicResponse(
      mgCfg.wireShape,
      model.outputMime,
      raw,
    );
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

// dispatchMusicHTTP picks a wire shape per provider config (never by provider
// name — the wire shape is the single discriminator):
//
//   - MusicPredict (Vertex): instances/parameters envelope to :predict;
//     audio at predictions[].audioContent (base64 WAV).
//   - MusicGenerateContent (Gemini): prompt + lyrics fold into
//     contents[0].parts[].text with responseModalities=["AUDIO"]; audio at
//     candidates[0].content.parts[].inlineData.data (base64).
//   - MusicMinimax: top-level model/prompt/lyrics/audio_setting to the
//     absolute genEndpoint; audio at data.audio (hex).
function dispatchMusicHTTP(
  provider: Provider,
  cfg: ProviderConfig,
  mgCfg: MusicGenDef,
  model: string,
  parts: Part[],
  baseUrl: string,
): { url: string; body: Record<string, unknown> } {
  switch (mgCfg.wireShape) {
    case "MusicPredict": {
      const body = buildVertexMusicBody(parts);
      let endpoint = mgCfg.genEndpoint || cfg.endpoint || "";
      endpoint = endpoint.replaceAll("{model}", model);
      return { url: baseUrl + endpoint, body };
    }
    case "MusicMinimax": {
      const body = buildMinimaxMusicBody(parts, model);
      const url = mgCfg.genEndpoint.startsWith("http")
        ? mgCfg.genEndpoint
        : baseUrl + mgCfg.genEndpoint;
      return { url, body };
    }
    default: {
      // MusicGenerateContent (Gemini).
      const body = buildGeminiMusicBody(parts);
      return { url: buildMusicURL(provider, cfg, mgCfg, model), body };
    }
  }
}

// buildVertexMusicBody assembles the Vertex AI Lyria :predict request body.
// Lyria 2 has no lyrics wire-slot, so any lyrics parts fold into the prompt
// text (ADR-037 MUS-008); the instrumental model ignores vocal content. The
// instances/parameters envelope mirrors Vertex Imagen.
function buildVertexMusicBody(parts: Part[]): Record<string, unknown> {
  let prompt = joinPromptText(parts);
  const lyrics = joinLyricsText(parts);
  if (lyrics) {
    prompt = prompt ? prompt + "\n" + lyrics : lyrics;
  }
  return {
    instances: [{ prompt }],
    parameters: { sampleCount: 1 },
  };
}

// buildGeminiMusicBody assembles the Gemini generateContent body for Lyria 3.
// Text and lyrics parts both serialise as {text} parts in caller order
// (Gemini takes custom lyrics inline in the prompt text). responseModalities
// requests AUDIO output.
function buildGeminiMusicBody(parts: Part[]): Record<string, unknown> {
  const wire: Array<Record<string, unknown>> = [];
  for (const p of parts) {
    if ("lyrics" in p && p.lyrics) {
      wire.push({ text: p.lyrics });
    } else if ("text" in p) {
      wire.push({ text: p.text });
    }
  }
  return {
    contents: [{ parts: wire }],
    generationConfig: { responseModalities: ["AUDIO"] },
  };
}

// buildMinimaxMusicBody assembles the MiniMax /v1/music_generation body.
// Prompt parts join into `prompt`; lyrics parts join into `lyrics`.
// output_format=hex returns hex-encoded audio at data.audio.
function buildMinimaxMusicBody(
  parts: Part[],
  model: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    prompt: joinPromptText(parts),
    output_format: "hex",
    audio_setting: {
      sample_rate: 44100,
      bitrate: 128000,
      format: "mp3",
    },
  };
  const lyrics = joinLyricsText(parts);
  if (lyrics) body.lyrics = lyrics;
  return body;
}

function joinPromptText(parts: Part[]): string {
  return parts
    .filter((p): p is { text: string } => "text" in p && !!p.text)
    .map((p) => p.text)
    .join("\n");
}

function joinLyricsText(parts: Part[]): string {
  return parts
    .filter((p): p is { lyrics: string } => "lyrics" in p && !!p.lyrics)
    .map((p) => p.lyrics)
    .join("\n");
}

// buildMusicURL substitutes the per-call model into the provider's endpoint
// template (Gemini reuses the main generateContent endpoint) and appends the
// query auth key for query-param-key providers (Google).
function buildMusicURL(
  provider: Provider,
  cfg: ProviderConfig,
  mgCfg: MusicGenDef,
  model: string,
): string {
  const baseUrl = provider.baseUrl || cfg.baseUrl;
  let endpoint = mgCfg.genEndpoint || cfg.endpoint || "";
  if (cfg.authScheme === "QueryParamKey" && cfg.authQueryParam) {
    const sep = endpoint.includes("?") ? "&" : "?";
    endpoint = `${endpoint}${sep}${cfg.authQueryParam}=${encodeURIComponent(provider.apiKey)}`;
  }
  endpoint = endpoint.replaceAll("{model}", model);
  endpoint = endpoint.replaceAll("{apiKey}", provider.apiKey);
  return baseUrl + endpoint;
}

/**
 * normalizeMusicParts enforces the XOR rule and produces the canonical Part[].
 * When only prompt is set, it synthesises [text(prompt)]. Both empty or both
 * set is a validation error.
 */
function normalizeMusicParts(request: MusicRequest): Part[] {
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

function findMusicModel(
  cfg: MusicGenDef,
  modelId: string,
): MusicModelDef | undefined {
  return cfg.models.find((m) => m.modelId === modelId);
}

// parseMusicResponse decodes the audio payloads per wire shape. Each shape's
// response diverges enough (predictions[] vs candidates[] vs data.audio,
// base64 vs hex) that a switch is clearer than a generic walker.
function parseMusicResponse(
  wireShape: string,
  fallbackMime: string,
  raw: unknown,
): MusicResponse {
  switch (wireShape) {
    case "MusicPredict":
      return parseVertexMusicResponse(raw, fallbackMime);
    case "MusicMinimax":
      return parseMinimaxMusicResponse(raw, fallbackMime);
    default:
      return parseGeminiMusicResponse(raw, fallbackMime);
  }
}

// parseVertexMusicResponse decodes Vertex Lyria :predict responses.
// Shape: {"predictions": [{"audioContent": "<base64>", "mimeType": "audio/wav"}]}.
function parseVertexMusicResponse(
  raw: unknown,
  fallbackMime: string,
): MusicResponse {
  const preds = (raw as { predictions?: unknown[] }).predictions;
  const audio: AudioData[] = [];
  let finishReason: string | undefined;
  for (const item of Array.isArray(preds) ? preds : []) {
    if (!item || typeof item !== "object") continue;
    const entry = item as {
      audioContent?: unknown;
      bytesBase64Encoded?: unknown;
      mimeType?: unknown;
      raiFilteredReason?: unknown;
    };
    if (
      !finishReason &&
      typeof entry.raiFilteredReason === "string" &&
      entry.raiFilteredReason
    ) {
      finishReason = entry.raiFilteredReason;
    }
    let b64 =
      typeof entry.audioContent === "string" ? entry.audioContent : "";
    if (!b64) {
      b64 =
        typeof entry.bytesBase64Encoded === "string"
          ? entry.bytesBase64Encoded
          : "";
    }
    if (!b64) continue;
    const mime =
      typeof entry.mimeType === "string" && entry.mimeType
        ? entry.mimeType
        : fallbackMime;
    try {
      audio.push({ mimeType: mime, bytes: base64ToBytes(b64) });
    } catch {
      // skip malformed entries
    }
  }
  return buildMusicResponse(audio, "", finishReason, undefined);
}

// parseGeminiMusicResponse walks candidates[0].content.parts, decoding each
// inlineData audio part and concatenating text parts (generated lyrics).
function parseGeminiMusicResponse(
  raw: unknown,
  fallbackMime: string,
): MusicResponse {
  const root = raw as {
    candidates?: Array<{
      content?: { parts?: unknown[] };
      finishReason?: string;
    }>;
  };
  const candidates = root.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return buildMusicResponse([], "", undefined, undefined);
  }
  const first = candidates[0]!;
  const parts = first.content?.parts;
  const audio: AudioData[] = [];
  const textParts: string[] = [];
  for (const part of Array.isArray(parts) ? parts : []) {
    if (!part || typeof part !== "object") continue;
    const pm = part as Record<string, unknown>;
    const inline = pm.inlineData as
      | { mimeType?: string; data?: string }
      | undefined;
    if (inline && typeof inline.data === "string") {
      const mime =
        typeof inline.mimeType === "string" && inline.mimeType
          ? inline.mimeType
          : fallbackMime;
      try {
        audio.push({ mimeType: mime, bytes: base64ToBytes(inline.data) });
      } catch {
        // skip malformed entries
      }
    }
    if (typeof pm.text === "string" && pm.text) {
      textParts.push(pm.text);
    }
  }
  const finishReason =
    typeof first.finishReason === "string" ? first.finishReason : undefined;
  return buildMusicResponse(audio, textParts.join(""), finishReason, undefined);
}

// parseMinimaxMusicResponse decodes MiniMax /v1/music_generation responses.
// Shape: {"data": {"audio": "<hex>"}, "base_resp": {"status_msg": "..."}}.
function parseMinimaxMusicResponse(
  raw: unknown,
  fallbackMime: string,
): MusicResponse {
  const root = raw as {
    data?: { audio?: unknown };
    base_resp?: { status_msg?: unknown };
  };
  const audio: AudioData[] = [];
  const hex = typeof root.data?.audio === "string" ? root.data.audio : "";
  if (hex) {
    try {
      audio.push({ mimeType: fallbackMime, bytes: hexToBytes(hex) });
    } catch {
      // skip malformed entries
    }
  }
  let finishMessage: string | undefined;
  const msg = root.base_resp?.status_msg;
  if (typeof msg === "string" && msg && msg !== "success") {
    finishMessage = msg;
  }
  return buildMusicResponse(audio, "", undefined, finishMessage);
}

function buildMusicResponse(
  audio: AudioData[],
  text: string,
  finishReason: string | undefined,
  finishMessage: string | undefined,
): MusicResponse {
  const out: MusicResponse = {
    audio,
    text,
    usage: {
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
      reasoning: 0,
      cost: 0,
    },
  };
  if (finishReason) out.finishReason = finishReason;
  if (finishMessage) out.finishMessage = finishMessage;
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// hexToBytes decodes a hex-encoded string (MiniMax output_format=hex).
// Throws on odd-length or non-hex input so malformed payloads are skipped.
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("odd-length hex string");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) throw new Error("invalid hex string");
    out[i] = byte;
  }
  return out;
}
