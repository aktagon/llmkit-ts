// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";

//
//
export type VideoWireShape = "VideoGrok";

//
export type VideoOutputDelivery = "DeliveryDownload" | "DeliveryURL" | "DeliveryOutputURI";

export interface VideoModelDef {
  modelId: string;
  label: string;
  supportsImageToVideo: boolean;
  maxDurationSeconds: number;
  outputMime: string;
  resolutions: string[];
}

export interface VideoGenDef {
  wireShape: VideoWireShape;
  outputDelivery: VideoOutputDelivery;
  //
  genEndpoint: string;
  requiresOutputUri: boolean;
  models: VideoModelDef[];
}

const VIDEO_GEN: Partial<Record<ProviderName, VideoGenDef>> = {
  grok: {
    wireShape: "VideoGrok",
    outputDelivery: "DeliveryURL",
    genEndpoint: "/v1/videos/generations",
    requiresOutputUri: false,
    models: [
      {
        modelId: "grok-imagine-video",
        label: "Grok Imagine Video",
        supportsImageToVideo: true,
        maxDurationSeconds: 15,
        outputMime: "video/mp4",
        resolutions: ["480p", "720p"],
      },
    ],
  },
};

export function videoGenConfig(provider: ProviderName): VideoGenDef | undefined {
  return VIDEO_GEN[provider];
}
