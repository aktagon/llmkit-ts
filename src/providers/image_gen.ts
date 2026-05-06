// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";

export type ImageInputMode = "InlineParts" | "MultipartForm";
export type ImageOutputMode = "Base64Inline" | "URLOrBase64";

export interface ImageModelDef {
  modelId: string;
  label: string;
  aspectRatios: string[];
  imageSizes: string[];
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
      },
      {
        modelId: "gemini-3.1-flash-image-preview",
        label: "Nano Banana 2",
        aspectRatios: ["16:9", "1:1", "1:4", "1:8", "21:9", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16"],
        imageSizes: ["1K", "2K", "4K", "512"],
      },
    ],
  },
};

export function imageGenConfig(provider: ProviderName): ImageGenDef | undefined {
  return IMAGE_GEN[provider];
}
