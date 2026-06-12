// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";

//
//
export type VideoWireShape = "VideoGrok" | "VideoZhipu" | "VideoTogether" | "VideoQwen" | "VideoMinimax" | "VideoVeo" | "VideoBedrock";

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
  fileEndpoint: string;
  //
  submitHandleField: string;
  requiresOutputUri: boolean;
  models: VideoModelDef[];
}

const VIDEO_GEN: Partial<Record<ProviderName, VideoGenDef>> = {
  bedrock: {
    wireShape: "VideoBedrock",
    outputDelivery: "DeliveryOutputURI",
    videoBaseUrl: "",
    genEndpoint: "/async-invoke",
    pollEndpoint: "/async-invoke/{id}",
    fileEndpoint: "",
    submitHandleField: "invocationArn",
    requiresOutputUri: true,
    models: [
      {
        modelId: "amazon.nova-reel-v1:0",
        label: "Nova Reel",
        supportsImageToVideo: true,
        maxDurationSeconds: 6,
        outputMime: "video/mp4",
        resolutions: ["720p"],
      },
    ],
  },
  google: {
    wireShape: "VideoVeo",
    outputDelivery: "DeliveryDownload",
    videoBaseUrl: "",
    genEndpoint: "/v1beta/models/{model}:predictLongRunning",
    pollEndpoint: "/v1beta/{id}",
    fileEndpoint: "",
    submitHandleField: "name",
    requiresOutputUri: false,
    models: [
      {
        modelId: "veo-3.1-generate-preview",
        label: "Veo 3.1",
        supportsImageToVideo: true,
        maxDurationSeconds: 8,
        outputMime: "video/mp4",
        resolutions: ["1080p", "720p"],
      },
    ],
  },
  grok: {
    wireShape: "VideoGrok",
    outputDelivery: "DeliveryURL",
    videoBaseUrl: "",
    genEndpoint: "/v1/videos/generations",
    pollEndpoint: "/v1/videos/{id}",
    fileEndpoint: "",
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
  minimax: {
    wireShape: "VideoMinimax",
    outputDelivery: "DeliveryURL",
    videoBaseUrl: "https://api.minimax.io",
    genEndpoint: "/v1/video_generation",
    pollEndpoint: "/v1/query/video_generation?task_id={id}",
    fileEndpoint: "/v1/files/retrieve?file_id={file_id}",
    submitHandleField: "task_id",
    requiresOutputUri: false,
    models: [
      {
        modelId: "MiniMax-Hailuo-2.3",
        label: "MiniMax Hailuo 2.3",
        supportsImageToVideo: true,
        maxDurationSeconds: 6,
        outputMime: "video/mp4",
        resolutions: ["1080p", "768p"],
      },
    ],
  },
  qwen: {
    wireShape: "VideoQwen",
    outputDelivery: "DeliveryURL",
    videoBaseUrl: "https://dashscope-intl.aliyuncs.com",
    genEndpoint: "/api/v1/services/aigc/video-generation/video-synthesis",
    pollEndpoint: "/api/v1/tasks/{id}",
    fileEndpoint: "",
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
    fileEndpoint: "",
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
    fileEndpoint: "",
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
