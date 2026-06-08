// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";

//
//
export type MusicWireShape = "MusicPredict" | "MusicGenerateContent" | "MusicMinimax";

export interface MusicModelDef {
  modelId: string;
  label: string;
  supportsLyrics: boolean;
  maxDurationSeconds: number;
  outputMime: string;
}

export interface MusicGenDef {
  wireShape: MusicWireShape;
  //
  genEndpoint: string;
  models: MusicModelDef[];
}

const MUSIC_GEN: Partial<Record<ProviderName, MusicGenDef>> = {
  google: {
    wireShape: "MusicGenerateContent",
    genEndpoint: "",
    models: [
      {
        modelId: "lyria-3-clip-preview",
        label: "Lyria 3 Clip",
        supportsLyrics: true,
        maxDurationSeconds: 30,
        outputMime: "audio/mpeg",
      },
      {
        modelId: "lyria-3-pro-preview",
        label: "Lyria 3 Pro",
        supportsLyrics: true,
        maxDurationSeconds: 120,
        outputMime: "audio/mpeg",
      },
    ],
  },
  minimax: {
    wireShape: "MusicMinimax",
    genEndpoint: "https://api.minimax.io/v1/music_generation",
    models: [
      {
        modelId: "music-2.6",
        label: "MiniMax Music 2.6",
        supportsLyrics: true,
        maxDurationSeconds: 0,
        outputMime: "audio/mpeg",
      },
    ],
  },
  vertex: {
    wireShape: "MusicPredict",
    genEndpoint: "",
    models: [
      {
        modelId: "lyria-002",
        label: "Lyria 2",
        supportsLyrics: false,
        maxDurationSeconds: 30,
        outputMime: "audio/wav",
      },
    ],
  },
};

export function musicGenConfig(provider: ProviderName): MusicGenDef | undefined {
  return MUSIC_GEN[provider];
}
