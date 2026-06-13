// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";

export type ImageInputMode = "InlineParts" | "MultipartForm" | "JSONInlineRefs" | "JSONPredict";
export type ImageOutputMode = "Base64Inline" | "URLOrBase64";

export interface ImageModelDef {
  modelId: string;
  label: string;
  aspectRatios: string[];
  imageSizes: string[];


  maxInputImages: number;
}

export interface ImageGenDef {
  inputMode: ImageInputMode;
  outputMode: ImageOutputMode;
  maxInputCount: number;
  genEndpoint: string;
  editEndpoint: string;
  models: ImageModelDef[];
}

const IMAGE_GEN: Partial<Record<ProviderName, ImageGenDef>> = {
  google: {
    inputMode: "InlineParts",
    outputMode: "Base64Inline",
    maxInputCount: 14,
    genEndpoint: "",
    editEndpoint: "",
    models: [
      {
        modelId: "gemini-3-pro-image-preview",
        label: "Nano Banana Pro",
        aspectRatios: ["16:9", "1:1", "21:9", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16"],
        imageSizes: ["1K", "2K", "4K"],
        maxInputImages: 11,
      },
      {
        modelId: "gemini-3.1-flash-image-preview",
        label: "Nano Banana 2",
        aspectRatios: ["16:9", "1:1", "1:4", "1:8", "21:9", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16"],
        imageSizes: ["1K", "2K", "4K", "512"],
        maxInputImages: 14,
      },
    ],
  },
  grok: {
    inputMode: "JSONInlineRefs",
    outputMode: "Base64Inline",
    maxInputCount: 16,
    genEndpoint: "/v1/images/generations",
    editEndpoint: "/v1/images/edits",
    models: [
      {
        modelId: "grok-imagine-image-quality",
        label: "Grok Imagine Quality",
        aspectRatios: ["16:9", "19.5:9", "1:1", "1:2", "20:9", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "9:19.5", "9:20", "auto"],
        imageSizes: [],
        maxInputImages: 0,
      },
    ],
  },
  openai: {
    inputMode: "MultipartForm",
    outputMode: "Base64Inline",
    maxInputCount: 16,
    genEndpoint: "/v1/images/generations",
    editEndpoint: "/v1/images/edits",
    models: [
      {
        modelId: "gpt-image-1",
        label: "GPT Image 1",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
      },
      {
        modelId: "gpt-image-1-mini",
        label: "GPT Image 1 Mini",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
      },
      {
        modelId: "gpt-image-1.5",
        label: "GPT Image 1.5",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
      },
      {
        modelId: "gpt-image-2",
        label: "GPT Image 2",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
      },
    ],
  },
  vertex: {
    inputMode: "JSONPredict",
    outputMode: "Base64Inline",
    maxInputCount: 1,
    genEndpoint: "",
    editEndpoint: "",
    models: [
      {
        modelId: "imagen-3.0-fast-generate-001",
        label: "Imagen 3 Fast",
        aspectRatios: ["16:9", "1:1", "3:4", "4:3", "9:16"],
        imageSizes: [],
        maxInputImages: 0,
      },
      {
        modelId: "imagen-3.0-generate-002",
        label: "Imagen 3",
        aspectRatios: ["16:9", "1:1", "3:4", "4:3", "9:16"],
        imageSizes: [],
        maxInputImages: 0,
      },
      {
        modelId: "imagen-4.0-generate-preview-06-06",
        label: "Imagen 4 Preview",
        aspectRatios: ["16:9", "1:1", "3:4", "4:3", "9:16"],
        imageSizes: [],
        maxInputImages: 0,
      },
    ],
  },
};

export function imageGenConfig(provider: ProviderName): ImageGenDef | undefined {
  return IMAGE_GEN[provider];
}
