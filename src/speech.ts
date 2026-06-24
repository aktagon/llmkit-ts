// Speech generation (text-to-speech) runtime — mirror of go/speech.go (ADR-049).
//
// Pre-flight validation (model + text + voice required; provider supports
// speech; model in catalogue; voice in catalogue) runs before any HTTP call.
// One wire shape (SpeechInworld): a flat-JSON POST whose response carries
// base64 audio at audioContent. Sync, single AudioData, no middleware.

import { PROVIDERS, type ProviderSpec } from "./providers/providers.ts";
import {
  type SpeechGenDef,
  type SpeechModelDef,
  speechGenConfig,
} from "./providers/speech_gen.ts";
import { APIError, ValidationError } from "./errors.ts";
import { buildAuthHeaders } from "./request.ts";
import type { Provider } from "./types.ts";

export type { AudioData, SpeechResponse } from "./structs.ts";
import type { AudioData, SpeechResponse } from "./structs.ts";

/**
 * SpeechRequest carries a single text utterance to speak (single-turn, no
 * Message/Role wrapper — ADR-049 SPK-003), the model, and the voice id
 * (validated pre-flight against the provider's catalogue — SPK-004).
 */
export interface SpeechRequest {
  model: string;
  voice: string;
  text: string;
}

export interface SpeechOptions {
  signal?: AbortSignal;
}

export async function generateSpeech(
  provider: Provider,
  request: SpeechRequest,
  options: SpeechOptions = {},
): Promise<SpeechResponse> {
  const cfg = PROVIDERS[provider.name];
  if (!cfg) {
    throw new ValidationError("provider", `unknown: ${provider.name}`);
  }
  if (!provider.apiKey) {
    throw new ValidationError("apiKey", "required");
  }
  if (!request.model) {
    throw new ValidationError("model", "required for speech generation");
  }
  if (!request.text) {
    throw new ValidationError("text", "required for speech generation");
  }
  if (!request.voice) {
    throw new ValidationError("voice", "required for speech generation");
  }

  const sgCfg = speechGenConfig(provider.name);
  if (!sgCfg) {
    throw new ValidationError(
      "provider",
      `${provider.name} does not support speech generation`,
    );
  }
  const model = findSpeechModel(sgCfg, request.model);
  if (!model) {
    throw new ValidationError(
      "model",
      `${request.model} is not a known speech-generation model for ${provider.name}`,
    );
  }
  if (!sgCfg.voices.includes(request.voice)) {
    throw new ValidationError(
      "voice",
      `${request.voice} is not a known voice for ${provider.name}`,
    );
  }

  const baseUrl = provider.baseUrl || cfg.baseUrl;
  const authHeaders = buildAuthHeaders(provider, cfg);
  const { url, body } = dispatchSpeechHTTP(cfg, sgCfg, request, baseUrl);

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
  return parseSpeechResponse(sgCfg.wireShape, model.outputMime, raw);
}

// dispatchSpeechHTTP picks a wire shape per provider config (never by provider
// name). Only SpeechInworld exists today: a flat-JSON POST.
function dispatchSpeechHTTP(
  cfg: ProviderSpec,
  sgCfg: SpeechGenDef,
  request: SpeechRequest,
  baseUrl: string,
): { url: string; body: Record<string, unknown> } {
  const endpoint = sgCfg.genEndpoint || cfg.endpoint || "";
  const url = endpoint.startsWith("http") ? endpoint : baseUrl + endpoint;
  return { url, body: buildInworldSpeechBody(request) };
}

// buildInworldSpeechBody assembles the Inworld /tts/v1/voice request body.
// Slice 1 sends a fixed audioConfig (LINEAR16/22050 -> WAV) and BALANCED
// delivery; format/sample-rate selection is a later slice (ADR-049 OQ-5).
function buildInworldSpeechBody(
  request: SpeechRequest,
): Record<string, unknown> {
  return {
    text: request.text,
    voiceId: request.voice,
    modelId: request.model,
    audioConfig: {
      audioEncoding: "LINEAR16",
      sampleRateHertz: 22050,
    },
    deliveryMode: "BALANCED",
  };
}

function findSpeechModel(
  cfg: SpeechGenDef,
  modelId: string,
): SpeechModelDef | undefined {
  return cfg.models.find((m) => m.modelId === modelId);
}

// parseSpeechResponse decodes the synthesized audio per wire shape.
function parseSpeechResponse(
  _wireShape: string,
  fallbackMime: string,
  raw: unknown,
): SpeechResponse {
  // SpeechInworld: {"audioContent": "<base64>", "usage": {...}}.
  const root = raw as { audioContent?: unknown };
  let audio: AudioData = { mimeType: fallbackMime, bytes: new Uint8Array(0) };
  if (typeof root.audioContent === "string" && root.audioContent) {
    try {
      audio = {
        mimeType: fallbackMime,
        bytes: base64ToBytes(root.audioContent),
      };
    } catch {
      // leave empty on malformed payload
    }
  }
  return {
    audio,
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

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
