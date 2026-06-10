// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";

//
//
export type VideoWireShape = "VideoGrok" | "VideoZhipu" | "VideoTogether" | "VideoQwen";

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
  videoBaseUrl: string;
  //
  genEndpoint: string;
  //
  pollEndpoint: string;
  //
  submitHandleField: string;
  requiresOutputUri: boolean;
  models: VideoModelDef[];
}

const VIDEO_GEN: Partial<Record<ProviderName, VideoGenDef>> = {
  grok: {
    wireShape: "VideoGrok",
    outputDelivery: "DeliveryURL",
    videoBaseUrl: "",
    genEndpoint: "/v1/videos/generations",
    pollEndpoint: "/v1/videos/{id}",
    submitHandleField: "request_id",
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
  qwen: {
    wireShape: "VideoQwen",
    outputDelivery: "DeliveryURL",
    videoBaseUrl: "https://dashscope-intl.aliyuncs.com",
    genEndpoint: "/api/v1/services/aigc/video-generation/video-synthesis",
    pollEndpoint: "/api/v1/tasks/{id}",
    submitHandleField: "output.task_id",
    requiresOutputUri: false,
    models: [
      {
        modelId: "wan2.2-t2v-plus",
        label: "Wan 2.2 T2V Plus",
        supportsImageToVideo: true,
        maxDurationSeconds: 5,
        outputMime: "video/mp4",
        resolutions: ["720p"],
      },
    ],
  },
  together: {
    wireShape: "VideoTogether",
    outputDelivery: "DeliveryURL",
    videoBaseUrl: "",
    genEndpoint: "/v2/videos",
    pollEndpoint: "/v2/videos/{id}",
    submitHandleField: "id",
    requiresOutputUri: false,
    models: [
      {
        modelId: "minimax/video-01-director",
        label: "MiniMax Video 01 Director (Together)",
        supportsImageToVideo: true,
        maxDurationSeconds: 6,
        outputMime: "video/mp4",
        resolutions: ["720p"],
      },
    ],
  },
  zhipu: {
    wireShape: "VideoZhipu",
    outputDelivery: "DeliveryURL",
    videoBaseUrl: "",
    genEndpoint: "/v4/videos/generations",
    pollEndpoint: "/v4/async-result/{id}",
    submitHandleField: "id",
    requiresOutputUri: false,
    models: [
      {
        modelId: "cogvideox-3",
        label: "CogVideoX-3",
        supportsImageToVideo: true,
        maxDurationSeconds: 10,
        outputMime: "video/mp4",
        resolutions: ["1080p", "4k", "720p"],
      },
    ],
  },
};

export function videoGenConfig(provider: ProviderName): VideoGenDef | undefined {
  return VIDEO_GEN[provider];
}
