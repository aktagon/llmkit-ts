// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";

//
//
export type SpeechWireShape = "SpeechInworld" | "SpeechOpenAI";

export interface SpeechModelDef {
  modelId: string;
  label: string;
  outputMime: string;

  sampleRateHz: number;
}

export interface SpeechGenDef {
  wireShape: SpeechWireShape;
  //
  audioEncoding: string;
  //
  genEndpoint: string;
  //
  voices: string[];
  models: SpeechModelDef[];
}

const SPEECH_GEN: Partial<Record<ProviderName, SpeechGenDef>> = {
  inworld: {
    wireShape: "SpeechInworld",
    audioEncoding: "base64Envelope",
    genEndpoint: "/tts/v1/voice",
    voices: ["Alex", "Ashley", "Dennis"],
    models: [
      {
        modelId: "inworld-tts-1.5-max",
        label: "Inworld TTS 1.5 Max",
        outputMime: "audio/wav",
        sampleRateHz: 0,
      },
      {
        modelId: "inworld-tts-1.5-mini",
        label: "Inworld TTS 1.5 Mini",
        outputMime: "audio/wav",
        sampleRateHz: 0,
      },
      {
        modelId: "inworld-tts-2",
        label: "Inworld TTS 2",
        outputMime: "audio/wav",
        sampleRateHz: 0,
      },
    ],
  },
  openai: {
    wireShape: "SpeechOpenAI",
    audioEncoding: "rawBody",
    genEndpoint: "/v1/audio/speech",
    voices: ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"],
    models: [
      {
        modelId: "gpt-4o-mini-tts",
        label: "GPT-4o mini TTS",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
      },
      {
        modelId: "tts-1",
        label: "TTS 1",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
      },
      {
        modelId: "tts-1-hd",
        label: "TTS 1 HD",
        outputMime: "audio/mpeg",
        sampleRateHz: 0,
      },
    ],
  },
};

export function speechGenConfig(provider: ProviderName): SpeechGenDef | undefined {
  return SPEECH_GEN[provider];
}
