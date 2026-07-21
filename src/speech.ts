//
//
//
//
//
//

import { PROVIDERS, type ProviderSpec } from "./providers/providers.ts";
import {
  type SpeechGenDef,
  type SpeechModelDef,
  speechGenConfig,
} from "./providers/speech_gen.ts";
import { APIError, ValidationError } from "./errors.ts";
import { buildAuthHeaders } from "./request.ts";
import { firePost, firePre } from "./middleware.ts";
import type { Event, MiddlewareFn } from "./providers/middleware.ts";
import type { Provider } from "./types.ts";

export type { AudioData, SpeechResponse } from "./structs.ts";
import type { AudioData, SpeechResponse } from "./structs.ts";






export interface SpeechRequest {
  model: string;
  voice: string;
  text: string;
}

export interface SpeechOptions {
  signal?: AbortSignal;





  middleware?: MiddlewareFn[];
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

  const baseEvent: Event = {
    op: "speech_generation",
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
    const { url, body } = dispatchSpeechHTTP(cfg, sgCfg, request, baseUrl);

    const httpResp = await fetch(url, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    //
    //
    const respBytes = new Uint8Array(await httpResp.arrayBuffer());
    if (!httpResp.ok) {
      throw new APIError(
        httpResp.status,
        new TextDecoder().decode(respBytes),
        httpResp.status === 429 || httpResp.status >= 500,
      );
    }

    const result = parseSpeechResponse(
      provider.name,
      sgCfg.audioEncoding,
      model.outputMime,
      respBytes,
    );
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
function dispatchSpeechHTTP(
  cfg: ProviderSpec,
  sgCfg: SpeechGenDef,
  request: SpeechRequest,
  baseUrl: string,
): { url: string; body: Record<string, unknown> } {
  const endpoint = sgCfg.genEndpoint || cfg.endpoint || "";
  const url = endpoint.startsWith("http") ? endpoint : baseUrl + endpoint;
  const body =
    sgCfg.wireShape === "SpeechOpenAI"
      ? buildOpenAISpeechBody(request)
      : buildInworldSpeechBody(request);
  return { url, body };
}

//
//
function buildOpenAISpeechBody(
  request: SpeechRequest,
): Record<string, unknown> {
  return {
    model: request.model,
    input: request.text,
    voice: request.voice,
    response_format: "mp3",
  };
}

//
//
//
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

//
//
//
//
//
function parseSpeechResponse(
  providerName: string,
  audioEncoding: string,
  fallbackMime: string,
  body: Uint8Array,
): SpeechResponse {
  let audio: AudioData;
  if (audioEncoding === "rawBody") {
    audio = { mimeType: fallbackMime, bytes: body };
  } else {
    //
    let root: { audioContent?: unknown };
    try {
      root = JSON.parse(new TextDecoder().decode(body)) as {
        audioContent?: unknown;
      };
    } catch (err) {
      throw new APIError(
        200,
        `${providerName} speech response: not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        false,
      );
    }
    if (typeof root.audioContent !== "string" || !root.audioContent) {
      throw new APIError(
        200,
        `${providerName} speech response: missing or empty audioContent`,
        false,
      );
    }
    try {
      audio = {
        mimeType: fallbackMime,
        bytes: base64ToBytes(root.audioContent),
      };
    } catch (err) {
      throw new APIError(
        200,
        `${providerName} speech response: invalid base64 in audioContent: ${err instanceof Error ? err.message : String(err)}`,
        false,
      );
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
