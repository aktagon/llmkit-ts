// Speech generation (text-to-speech) runtime — mirror of go/speech.go (ADR-049).
//
// Pre-flight validation (model + text or lines required; voice or speakers;
// provider supports speech; model known; speakers and style the model takes)
// runs before any HTTP call. Voices are free-form: there is no catalogue.
// Five wire shapes: SpeechInworld (base64 audio at audioContent),
// SpeechOpenAI (raw audio body), SpeechGemini (Interactions API, base64
// audio in steps[]), SpeechMiniMax (hex audio at data.audio) and SpeechXAI
// (raw audio body). Sync, single AudioData.

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
import type { Provider, SpeechLine, SpeechSpeaker } from "./types.ts";

export type { AudioData, SpeechResponse } from "./structs.ts";
import type { AudioData, SpeechResponse } from "./structs.ts";
import { sendHTTP } from "./http.ts";

/**
 * SpeechRequest carries a single text utterance to speak (single-turn, no
 * Message/Role wrapper — ADR-049 SPK-003), the model, and a free-form voice
 * id. Speakers and lines make a multi-speaker request, in which text is empty;
 * style is an optional delivery style (BUG-091).
 */
export interface SpeechRequest {
  model: string;
  voice: string;
  text: string;
  style?: string;
  speakers?: SpeechSpeaker[];
  lines?: SpeechLine[];
}

export interface SpeechOptions {
  signal?: AbortSignal;
  /**
   * Pre/post hooks that fire around the speech request. Op is
   * "speech_generation"; the pre phase can veto. Plumbed by the typed
   * builder's `.addMiddleware()` chain method.
   */
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
  validateSpeechInputs(request);

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
  validateSpeechModel(request, sgCfg, model);

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
    // Speech base: explicit override > the config's distinct speech base
    // (MiniMax, HANDOFF-094) > chat base — the music base contract.
    const baseUrl = provider.baseUrl || sgCfg.baseUrl || cfg.baseUrl;
    const authHeaders = buildAuthHeaders(provider, cfg);
    const { url, body } = dispatchSpeechHTTP(cfg, sgCfg, request, baseUrl, provider.apiKey);

    const httpResp = await sendHTTP(url, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    }, provider.timeoutMs);

    // Read the raw bytes: the OpenAI shape returns binary audio (not JSON), so
    // we cannot text-decode + JSON.parse unconditionally.
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

// dispatchSpeechHTTP picks a wire shape per provider config (never by provider
// name). SpeechInworld is a flat-JSON POST whose response carries base64 audio;
// SpeechOpenAI is a flat-JSON POST whose response body is the raw audio bytes;
// SpeechGemini is an Interactions API POST whose audio sits in steps[];
// SpeechMiniMax is a flat-JSON POST whose reply carries hex audio at data.audio;
// SpeechXAI is a flat-JSON POST whose response body is the raw audio bytes.
// Query-param-key providers (Google) carry the key in the URL, as on every
// other Google call.
function dispatchSpeechHTTP(
  cfg: ProviderSpec,
  sgCfg: SpeechGenDef,
  request: SpeechRequest,
  baseUrl: string,
  apiKey: string,
): { url: string; body: Record<string, unknown> } {
  const endpoint = sgCfg.genEndpoint || cfg.endpoint || "";
  let url = endpoint.startsWith("http") ? endpoint : baseUrl + endpoint;
  if (cfg.authScheme === "QueryParamKey" && cfg.authQueryParam) {
    const sep = url.includes("?") ? "&" : "?";
    url = `${url}${sep}${cfg.authQueryParam}=${encodeURIComponent(apiKey)}`;
  }
  let body: Record<string, unknown>;
  switch (sgCfg.wireShape) {
    case "SpeechOpenAI":
      body = buildOpenAISpeechBody(request, sgCfg.requestedOutputFormat);
      break;
    case "SpeechGemini":
      body = buildGeminiSpeechBody(request);
      break;
    case "SpeechMiniMax":
      body = buildMiniMaxSpeechBody(request);
      break;
    case "SpeechXAI":
      body = buildXAISpeechBody(request, sgCfg.requestedOutputFormat);
      break;
    case "SpeechInworld":
      body = buildInworldSpeechBody(request, sgCfg.requestedOutputFormat);
      break;
    default: {
      const _exhaustive: never = sgCfg.wireShape;
      throw new APIError(0, `speech: unsupported wire shape ${String(_exhaustive)}`, false);
    }
  }
  return { url, body };
}

// validateSpeechInputs checks the request on its own, before the provider
// config is read (BUG-091). The messages are the same in every SDK.
function validateSpeechInputs(request: SpeechRequest): void {
  const speakers = request.speakers ?? [];
  const lines = request.lines ?? [];
  if (lines.length === 0 && !request.text) {
    throw new ValidationError("text", "required for speech generation");
  }
  if (lines.length > 0 && request.text) {
    throw new ValidationError("text", "must be empty when lines are set");
  }
  if (speakers.length === 0) {
    if (!request.voice) {
      throw new ValidationError("voice", "required for speech generation");
    }
  } else {
    if (request.voice) {
      throw new ValidationError("voice", "cannot be set together with speakers");
    }
    if (request.style) {
      throw new ValidationError(
        "style",
        "cannot be set together with speakers; style each line instead",
      );
    }
    if (lines.length === 0) {
      throw new ValidationError("lines", "required when speakers are set");
    }
  }
  for (const line of lines) {
    if (!speakers.some((s) => s.name === line.speaker)) {
      throw new ValidationError("lines", `${line.speaker} is not a declared speaker`);
    }
  }
}

// validateSpeechModel checks the request against what the config's body can
// carry and the model's stated speaker and style facts (BUG-091). An unknown
// model fact sends the request; only a stated false or a stated speaker count
// that does not match blocks it (decision 009, HANDOFF-099). Exported for
// tests only; the package barrel does not re-export it.
export function validateSpeechModel(
  request: SpeechRequest,
  cfg: SpeechGenDef,
  model: SpeechModelDef,
): void {
  const speakers = request.speakers ?? [];
  if (speakers.length > 0) {
    if (!cfg.multiSpeaker || model.maxSpeakers === 1) {
      throw new ValidationError(
        "speakers",
        `${model.modelId} does not support multiple speakers`,
      );
    }
    if (model.maxSpeakers !== undefined && speakers.length !== model.maxSpeakers) {
      throw new ValidationError(
        "speakers",
        `exactly ${model.maxSpeakers} speakers are required, got ${speakers.length}`,
      );
    }
  }
  const styled = !!request.style || (request.lines ?? []).some((l) => !!l.style);
  if (styled && (!cfg.carriesSpeechStyle || model.supportsSpeechStyle === false)) {
    throw new ValidationError("style", `${model.modelId} does not support a speech style`);
  }
}

// buildGeminiSpeechBody assembles the Gemini TTS request body on the
// Interactions API (BUG-091): one user_input turn and an audio response.
// Single voice: one text item and speech_config [{voice}]; a style annotates
// the text item. Multi-speaker: one text item per line, each annotated with
// its speaker and optional style, and speech_config {speakers}. store is
// always false: the Interactions API keeps requests by default.
function buildGeminiSpeechBody(
  request: SpeechRequest,
): Record<string, unknown> {
  const speakers = request.speakers ?? [];
  let content: Record<string, unknown>[];
  let speechConfig: unknown;
  if (speakers.length > 0) {
    content = (request.lines ?? []).map((line) => {
      const meta: Record<string, unknown> = { type: "speech_metadata", speaker: line.speaker };
      if (line.style) meta.style = line.style;
      return { type: "text", text: line.text, annotations: [meta] };
    });
    speechConfig = { speakers: speakers.map((s) => ({ speaker: s.name, voice: s.voice })) };
  } else {
    const item: Record<string, unknown> = { type: "text", text: request.text };
    if (request.style) {
      item.annotations = [{ type: "speech_metadata", style: request.style }];
    }
    content = [item];
    speechConfig = [{ voice: request.voice }];
  }
  return {
    model: request.model,
    input: [{ type: "user_input", content }],
    response_format: { type: "audio" },
    generation_config: { speech_config: speechConfig },
    store: false,
  };
}

// buildOpenAISpeechBody assembles the OpenAI /v1/audio/speech request body.
// response_format is the config's requested output format (HANDOFF-098).
// A style is sent as instructions (BUG-091), which gpt-4o-mini-tts accepts.
function buildOpenAISpeechBody(
  request: SpeechRequest,
  outputFormat: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    input: request.text,
    voice: request.voice,
    response_format: outputFormat,
  };
  if (request.style) body.instructions = request.style;
  return body;
}

// buildInworldSpeechBody assembles the Inworld /tts/v1/voice request body.
// audioEncoding is the config's requested output format (HANDOFF-098); the
// sample rate (22050 -> WAV) and BALANCED delivery are fixed (ADR-049 OQ-5).
function buildInworldSpeechBody(
  request: SpeechRequest,
  outputFormat: string,
): Record<string, unknown> {
  return {
    text: request.text,
    voiceId: request.voice,
    modelId: request.model,
    audioConfig: {
      audioEncoding: outputFormat,
      sampleRateHertz: 22050,
    },
    deliveryMode: "BALANCED",
  };
}

// buildMiniMaxSpeechBody assembles the MiniMax /v1/t2a_v2 request body
// (HANDOFF-094): only the fields the reference marks required. stream,
// output_format (hex) and audio_setting (mp3) take their defaults.
function buildMiniMaxSpeechBody(request: SpeechRequest): Record<string, unknown> {
  return {
    model: request.model,
    text: request.text,
    voice_setting: { voice_id: request.voice },
  };
}

// buildXAISpeechBody assembles the xAI /v1/tts request body (HANDOFF-095).
// The endpoint has no model field. language is always "auto" (llmkit has no
// language option), and with_timestamps is never sent: it switches the reply
// from raw audio bytes to JSON.
// output_format.codec is the config's requested output format (HANDOFF-098).
function buildXAISpeechBody(
  request: SpeechRequest,
  outputFormat: string,
): Record<string, unknown> {
  return {
    text: request.text,
    voice_id: request.voice,
    language: "auto",
    output_format: { codec: outputFormat },
  };
}

function findSpeechModel(
  cfg: SpeechGenDef,
  modelId: string,
): SpeechModelDef | undefined {
  return cfg.models.find((m) => m.modelId === modelId);
}

// parseSpeechResponse decodes the synthesized audio per the wire shape's audio
// response encoding (ADR-051 OAA-002). "rawBody" (OpenAI, xAI) takes the response
// body verbatim as the audio bytes; "base64Envelope" (Inworld) parses a JSON
// envelope and base64-decodes the audio field; "hexEnvelope" (MiniMax)
// hex-decodes data.audio and raises on a nonzero base_resp. A 2xx body that does not parse
// to audio is a decoding error (HANDOFF-036 A5) — never a silent empty clip.
function parseSpeechResponse(
  providerName: string,
  audioEncoding: string,
  fallbackMime: string,
  body: Uint8Array,
): SpeechResponse {
  let audio: AudioData;
  if (audioEncoding === "rawBody") {
    audio = { mimeType: fallbackMime, bytes: body };
  } else if (audioEncoding === "base64InteractionSteps") {
    audio = parseInteractionStepsAudio(providerName, fallbackMime, body);
  } else if (audioEncoding === "hexEnvelope") {
    audio = parseHexEnvelopeAudio(providerName, fallbackMime, body);
  } else if (audioEncoding === "base64Envelope") {
    // base64Envelope: {"audioContent": "<base64>", "usage": {...}}.
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
  } else {
    throw new APIError(0, `speech: unsupported audio encoding ${audioEncoding}`, false);
  }
  return {
    audio,
    usage: {},
  };
}

interface InteractionItem {
  type?: unknown;
  data?: unknown;
  mime_type?: unknown;
  content?: unknown;
}

// parseInteractionStepsAudio decodes a Gemini TTS Interactions API reply
// (BUG-091). Google's documented path is
// [.steps[] | select(.type=="model_output") | .content[] | select(.type=="audio")] | last | .data:
// the LAST audio item across the model_output steps wins. Its mime_type is
// used when present, else the model's outputMime. No audio item, or invalid
// base64, is a decoding error (HANDOFF-036 A5).
function parseInteractionStepsAudio(
  providerName: string,
  fallbackMime: string,
  body: Uint8Array,
): AudioData {
  let root: { steps?: unknown };
  try {
    root = JSON.parse(new TextDecoder().decode(body)) as { steps?: unknown };
  } catch (err) {
    throw new APIError(
      200,
      `${providerName} speech response: not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      false,
    );
  }
  let last: InteractionItem | undefined;
  const steps = Array.isArray(root.steps) ? (root.steps as InteractionItem[]) : [];
  for (const step of steps) {
    if (step?.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (const item of step.content as InteractionItem[]) {
      if (item?.type === "audio") last = item;
    }
  }
  if (typeof last?.data !== "string" || !last.data) {
    throw new APIError(
      200,
      `${providerName} speech response: no audio item in steps[model_output].content`,
      false,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(last.data);
  } catch (err) {
    throw new APIError(
      200,
      `${providerName} speech response: invalid base64 in audio data: ${err instanceof Error ? err.message : String(err)}`,
      false,
    );
  }
  const mimeType =
    typeof last.mime_type === "string" && last.mime_type ? last.mime_type : fallbackMime;
  return { mimeType, bytes };
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// parseHexEnvelopeAudio decodes a MiniMax t2a_v2 reply (HANDOFF-094):
// {"data": {"audio": "<hex>"}, "base_resp": {"status_code", "status_msg"}}.
// MiniMax reports failures in base_resp on an HTTP 200, so a nonzero
// status_code is an APIError carrying status_msg. A success with missing
// audio, or invalid hex, is a decoding error (HANDOFF-036 A5).
function parseHexEnvelopeAudio(
  providerName: string,
  fallbackMime: string,
  body: Uint8Array,
): AudioData {
  let root: {
    data?: { audio?: unknown } | null;
    base_resp?: { status_code?: unknown; status_msg?: unknown };
  };
  try {
    root = JSON.parse(new TextDecoder().decode(body)) as typeof root;
  } catch (err) {
    throw new APIError(
      200,
      `${providerName} speech response: not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      false,
    );
  }
  const code = root.base_resp?.status_code;
  if (typeof code === "number" && code !== 0) {
    const msg = typeof root.base_resp?.status_msg === "string" ? root.base_resp.status_msg : "";
    throw new APIError(200, `${providerName}: ${msg} (base_resp.status_code ${code})`, false);
  }
  const hex = root.data?.audio;
  if (typeof hex !== "string" || !hex) {
    throw new APIError(200, `${providerName} speech response: missing or empty data.audio`, false);
  }
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new APIError(200, `${providerName} speech response: invalid hex in data.audio`, false);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return { mimeType: fallbackMime, bytes };
}
