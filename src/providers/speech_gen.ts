// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";

// Speech wire-shape discriminators. Each fully determines the request
// body and the response audio path.
export type SpeechWireShape = "SpeechInworld" | "SpeechOpenAI" | "SpeechGemini" | "SpeechMiniMax";

export interface SpeechModelDef {
  modelId: string;
  label: string;
  outputMime: string;
  /** ADR-037 advisory fact (queryable, never gated); 0 when unverified. */
  sampleRateHz: number;
  /** Speakers a multi-speaker request declares; 0 = one voice only (BUG-091). */
  maxSpeakers: number;
  /** Whether a style (style, addStyledLine) is sent to this model (BUG-091). */
  supportsSpeechStyle: boolean;
}

export interface SpeechGenDef {
  wireShape: SpeechWireShape;
  // audioEncoding selects the response decoder: "base64Envelope" | "rawBody" | "base64InteractionSteps" | "hexEnvelope" (ADR-051).
  audioEncoding: string;
  // genEndpoint is an override; empty = use provider main endpoint.
  genEndpoint: string;
  models: SpeechModelDef[];
  // baseUrl is the speech API base when it differs from the chat base; "" = use chat base.
  baseUrl: string;
}

const SPEECH_GEN: Partial<Record<ProviderName, SpeechGenDef>> = {
  google: {
    wireShape: "SpeechGemini",
    audioEncoding: "base64InteractionSteps",
    genEndpoint: "/v1beta/interactions",
    models: [
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
  },
  inworld: {
    wireShape: "SpeechInworld",
    audioEncoding: "base64Envelope",
    genEndpoint: "/tts/v1/voice",
    models: [
      {
        modelId: "inworld-tts-1.5-max",
        label: "Inworld TTS 1.5 Max",
        outputMime: "audio/wav",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "inworld-tts-1.5-mini",
        label: "Inworld TTS 1.5 Mini",
        outputMime: "audio/wav",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "inworld-tts-2",
        label: "Inworld TTS 2",
        outputMime: "audio/wav",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
    ],
    baseUrl: "",
  },
  minimax: {
    wireShape: "SpeechMiniMax",
    audioEncoding: "hexEnvelope",
    genEndpoint: "/v1/t2a_v2",
    models: [
      {
        modelId: "speech-2.6-hd",
        label: "MiniMax Speech 2.6 HD",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "speech-2.6-turbo",
        label: "MiniMax Speech 2.6 Turbo",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "speech-2.8-hd",
        label: "MiniMax Speech 2.8 HD",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "speech-2.8-turbo",
        label: "MiniMax Speech 2.8 Turbo",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
    ],
    baseUrl: "https://api.minimax.io",
  },
  openai: {
    wireShape: "SpeechOpenAI",
    audioEncoding: "rawBody",
    genEndpoint: "/v1/audio/speech",
    models: [
      {
        modelId: "gpt-4o-mini-tts",
        label: "GPT-4o mini TTS",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: true,
      },
      {
        modelId: "tts-1",
        label: "TTS 1",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "tts-1-hd",
        label: "TTS 1 HD",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
    ],
    baseUrl: "",
  },
  openrouter: {
    wireShape: "SpeechOpenAI",
    audioEncoding: "rawBody",
    genEndpoint: "/v1/audio/speech",
    models: [
      {
        modelId: "elevenlabs/eleven-v3",
        label: "Eleven v3",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "elevenlabs/eleven-v4",
        label: "Eleven v4",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "elevenlabs/eleven-v4-turbo",
        label: "Eleven v4 Turbo",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "fish-audio/drama-3",
        label: "Fish Audio Drama 3",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "fish-audio/s2.1-pro",
        label: "Fish Audio S2.1 Pro",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "google/gemini-3.1-flash-tts-preview",
        label: "Gemini 3.1 Flash TTS Preview",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "google/gemini-3.8-flash-lite-tts",
        label: "Gemini 3.8 Flash Lite TTS",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "google/gemini-3.8-flash-tts",
        label: "Gemini 3.8 Flash TTS",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "hexgrad/kokoro-82m",
        label: "Kokoro 82M",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
      {
        modelId: "x-ai/grok-voice-tts-1.0",
        label: "Grok Voice TTS 1.0",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
        maxSpeakers: 0,
        supportsSpeechStyle: false,
      },
    ],
    baseUrl: "",
  },
};

export function speechGenConfig(provider: ProviderName): SpeechGenDef | undefined {
  return SPEECH_GEN[provider];
}
