// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";

// Speech wire-shape discriminators. Each fully determines the request
// body and the response audio path.
export type SpeechWireShape = "SpeechInworld" | "SpeechOpenAI" | "SpeechGemini" | "SpeechMiniMax" | "SpeechXAI";

export interface SpeechModelDef {
  modelId: string;
  label: string;
  outputMime: string;
  /** ADR-037 advisory fact (queryable, never gated); 0 when unverified. */
  sampleRateHz: number;
  /** Speakers the model takes (1 or 2); undefined = unknown, which sends (decision 009). */
  maxSpeakers?: number;
  /** Whether the provider accepts a style (style, addStyledLine); undefined = unknown, only false blocks (decision 009). */
  supportsSpeechStyle?: boolean;
}

export interface SpeechGenDef {
  wireShape: SpeechWireShape;
  // audioEncoding selects the response decoder: "base64Envelope" | "rawBody" | "base64InteractionSteps" | "hexEnvelope" (ADR-051).
  audioEncoding: string;
  // requestedOutputFormat is the format token the body sends (mp3, LINEAR16); "" = the body sends no format (HANDOFF-098).
  requestedOutputFormat: string;
  // genEndpoint is an override; empty = use provider main endpoint.
  genEndpoint: string;
  models: SpeechModelDef[];
  // baseUrl is the speech API base when it differs from the chat base; "" = use chat base.
  baseUrl: string;
  /** llmkit's body for this config can carry a style; false rejects every style (HANDOFF-099). */
  carriesSpeechStyle: boolean;
  /** The config has a multi-speaker body; false rejects every speaker request (HANDOFF-099). */
  multiSpeaker: boolean;
}

const SPEECH_GEN: Partial<Record<ProviderName, SpeechGenDef>> = {
  google: {
    wireShape: "SpeechGemini",
    audioEncoding: "base64InteractionSteps",
    requestedOutputFormat: "",
    genEndpoint: "/v1beta/interactions",
    models: [
      {
        modelId: "gemini-3.1-flash-tts-preview",
        label: "Gemini 3.1 Flash TTS Preview",
        outputMime: "audio/l16",
        sampleRateHz: 0,
        maxSpeakers: 1,
        supportsSpeechStyle: false,
      },
      {
        modelId: "gemini-3.8-flash-lite-tts",
        label: "Gemini 3.8 Flash-Lite TTS",
        outputMime: "audio/wav",
        sampleRateHz: 24000,
        maxSpeakers: 2,
        supportsSpeechStyle: true,
      },
      {
        modelId: "gemini-3.8-flash-tts",
        label: "Gemini 3.8 Flash TTS",
        outputMime: "audio/wav",
        sampleRateHz: 24000,
        maxSpeakers: 2,
        supportsSpeechStyle: true,
      },
    ],
    baseUrl: "",
    carriesSpeechStyle: true,
    multiSpeaker: true,
  },
  grok: {
    wireShape: "SpeechXAI",
    audioEncoding: "rawBody",
    requestedOutputFormat: "mp3",
    genEndpoint: "/v1/tts",
    models: [
      {
        modelId: "grok-tts",
        label: "Grok TTS",
        outputMime: "audio/mpeg",
        sampleRateHz: 24000,
        supportsSpeechStyle: true,
      },
    ],
    baseUrl: "",
    carriesSpeechStyle: false,
    multiSpeaker: false,
  },
  inworld: {
    wireShape: "SpeechInworld",
    audioEncoding: "base64Envelope",
    requestedOutputFormat: "LINEAR16",
    genEndpoint: "/tts/v1/voice",
    models: [
      {
        modelId: "inworld-tts-1.5-max",
        label: "Inworld TTS 1.5 Max",
        outputMime: "audio/wav",
        sampleRateHz: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "inworld-tts-1.5-mini",
        label: "Inworld TTS 1.5 Mini",
        outputMime: "audio/wav",
        sampleRateHz: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "inworld-tts-2",
        label: "Inworld TTS 2",
        outputMime: "audio/wav",
        sampleRateHz: 0,
        supportsSpeechStyle: true,
      },
    ],
    baseUrl: "",
    carriesSpeechStyle: false,
    multiSpeaker: false,
  },
  minimax: {
    wireShape: "SpeechMiniMax",
    audioEncoding: "hexEnvelope",
    requestedOutputFormat: "",
    genEndpoint: "/v1/t2a_v2",
    models: [
      {
        modelId: "speech-2.6-hd",
        label: "MiniMax Speech 2.6 HD",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        supportsSpeechStyle: true,
      },
      {
        modelId: "speech-2.6-turbo",
        label: "MiniMax Speech 2.6 Turbo",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        supportsSpeechStyle: true,
      },
      {
        modelId: "speech-2.8-hd",
        label: "MiniMax Speech 2.8 HD",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        supportsSpeechStyle: true,
      },
      {
        modelId: "speech-2.8-turbo",
        label: "MiniMax Speech 2.8 Turbo",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        supportsSpeechStyle: true,
      },
    ],
    baseUrl: "https://api.minimax.io",
    carriesSpeechStyle: false,
    multiSpeaker: false,
  },
  openai: {
    wireShape: "SpeechOpenAI",
    audioEncoding: "rawBody",
    requestedOutputFormat: "mp3",
    genEndpoint: "/v1/audio/speech",
    models: [
      {
        modelId: "gpt-4o-mini-tts",
        label: "GPT-4o mini TTS",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        supportsSpeechStyle: true,
      },
      {
        modelId: "tts-1",
        label: "TTS 1",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "tts-1-hd",
        label: "TTS 1 HD",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        supportsSpeechStyle: false,
      },
    ],
    baseUrl: "",
    carriesSpeechStyle: true,
    multiSpeaker: false,
  },
  openrouter: {
    wireShape: "SpeechOpenAI",
    audioEncoding: "rawBody",
    requestedOutputFormat: "mp3",
    genEndpoint: "/v1/audio/speech",
    models: [
      {
        modelId: "elevenlabs/eleven-v3",
        label: "Eleven v3",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 1,
        supportsSpeechStyle: false,
      },
      {
        modelId: "elevenlabs/eleven-v4",
        label: "Eleven v4",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 1,
        supportsSpeechStyle: false,
      },
      {
        modelId: "elevenlabs/eleven-v4-turbo",
        label: "Eleven v4 Turbo",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 1,
        supportsSpeechStyle: false,
      },
      {
        modelId: "fish-audio/drama-3",
        label: "Fish Audio Drama 3",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        supportsSpeechStyle: true,
      },
      {
        modelId: "fish-audio/s2.1-pro",
        label: "Fish Audio S2.1 Pro",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        supportsSpeechStyle: true,
      },
      {
        modelId: "google/gemini-3.1-flash-tts-preview",
        label: "Gemini 3.1 Flash TTS Preview",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        supportsSpeechStyle: true,
      },
      {
        modelId: "google/gemini-3.8-flash-lite-tts",
        label: "Gemini 3.8 Flash Lite TTS",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        supportsSpeechStyle: true,
      },
      {
        modelId: "google/gemini-3.8-flash-tts",
        label: "Gemini 3.8 Flash TTS",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        supportsSpeechStyle: true,
      },
      {
        modelId: "hexgrad/kokoro-82m",
        label: "Kokoro 82M",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 1,
        supportsSpeechStyle: false,
      },
      {
        modelId: "x-ai/grok-voice-tts-1.0",
        label: "Grok Voice TTS 1.0",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 1,
        supportsSpeechStyle: false,
      },
    ],
    baseUrl: "",
    carriesSpeechStyle: false,
    multiSpeaker: false,
  },
};

export function speechGenConfig(provider: ProviderName): SpeechGenDef | undefined {
  return SPEECH_GEN[provider];
}
