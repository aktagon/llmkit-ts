// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";

//
//
export type SpeechWireShape = "SpeechInworld";

export interface SpeechModelDef {
  modelId: string;
  label: string;
  outputMime: string;

  sampleRateHz: number;
}

export interface SpeechGenDef {
  wireShape: SpeechWireShape;
  //
  genEndpoint: string;
  //
  voices: string[];
  models: SpeechModelDef[];
}

const SPEECH_GEN: Partial<Record<ProviderName, SpeechGenDef>> = {
  inworld: {
    wireShape: "SpeechInworld",
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
};

export function speechGenConfig(provider: ProviderName): SpeechGenDef | undefined {
  return SPEECH_GEN[provider];
}
