// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";

// Speech wire-shape discriminators. Each fully determines the request
// body and the response audio path.
export type SpeechWireShape = "SpeechInworld" | "SpeechOpenAI" | "SpeechGemini";

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
  // audioEncoding selects the response decoder: "base64Envelope" | "rawBody" | "base64InteractionSteps" (ADR-051).
  audioEncoding: string;
  // genEndpoint is an override; empty = use provider main endpoint.
  genEndpoint: string;
  models: SpeechModelDef[];
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
  },
};

export function speechGenConfig(provider: ProviderName): SpeechGenDef | undefined {
  return SPEECH_GEN[provider];
}
