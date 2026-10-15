// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";

/** The inputs a request variant carries (ADR-096). */
export type CarriedInput = "TextOnly" | "WithReferenceImages" | "WithSeedFrame";
/**
 * Image request shapes: each names one request body (ADR-096).
 * JSONPredict: Deprecated: no provider accepts this since 2026-10-15 (Vertex Imagen shut down, BUG-101); removed at the next major.
 */
export type ImageRequestShape = "InlineParts" | "JSONGenerationsOpenAI" | "MultipartForm" | "JSONInlineRefs" | "JSONPredict" | "JSONGenerations";

/** One wire request of an image or video config, keyed by the inputs it
 * carries (ADR-096). shape is "" on a video variant; endpoint "" means
 * the provider's main endpoint template. */
export interface RequestVariant {
  carries: CarriedInput;
  shape: ImageRequestShape | "";
  endpoint: string;
}

export type ImageOutputMode = "Base64Inline" | "URLOrBase64";
/** VertexPredictions: Deprecated: no provider returns this shape since
 * 2026-10-15 (Vertex Imagen shut down, BUG-101); removed at the next major. */
export type ImageResponseShape = "GoogleParts" | "DataArrayB64Json" | "VertexPredictions";

export interface ImageModelDef {
  modelId: string;
  label: string;
  aspectRatios: string[];
  imageSizes: string[];
  /** Images llmkit serializes when the wire shape fixes the count
   * (e.g. Grok's single-seed slot); 0 = no llmkit limit, the provider
   * decides volume (BUG-011). */
  maxInputImages: number;
  /** Whether llmkit sends Image Parts for this model; false means the
   * runtime rejects them (BUG-096). */
  supportsImageInput: boolean;
}

export interface ImageGenDef {
  outputMode: ImageOutputMode;
  /** Response wire family selecting the response parser (BUG-024). */
  responseShape: ImageResponseShape;
  /** Dotted-from-root usage-token paths; empty when unreported. */
  usageInputPath: string;
  usageOutputPath: string;
  usageReasoningPath: string;
  /** One request per carried input, TextOnly first (ADR-096). */
  variants: RequestVariant[];
  models: ImageModelDef[];
}

const IMAGE_GEN: Partial<Record<ProviderName, ImageGenDef>> = {
  google: {
    outputMode: "Base64Inline",
    responseShape: "GoogleParts",
    usageInputPath: "usageMetadata.promptTokenCount",
    usageOutputPath: "usageMetadata.candidatesTokenCount",
    usageReasoningPath: "usageMetadata.thoughtsTokenCount",
    variants: [
      { carries: "TextOnly", shape: "InlineParts", endpoint: "" },
      { carries: "WithReferenceImages", shape: "InlineParts", endpoint: "" },
    ],
    models: [
      {
        modelId: "gemini-3-pro-image-preview",
        label: "Nano Banana Pro",
        aspectRatios: ["16:9", "1:1", "21:9", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16"],
        imageSizes: ["1K", "2K", "4K"],
        maxInputImages: 0,
        supportsImageInput: true,
      },
      {
        modelId: "gemini-3.1-flash-image-preview",
        label: "Nano Banana 2",
        aspectRatios: ["16:9", "1:1", "1:4", "1:8", "21:9", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16"],
        imageSizes: ["1K", "2K", "4K", "512"],
        maxInputImages: 0,
        supportsImageInput: true,
      },
    ],
  },
  grok: {
    outputMode: "Base64Inline",
    responseShape: "DataArrayB64Json",
    usageInputPath: "",
    usageOutputPath: "",
    usageReasoningPath: "",
    variants: [
      { carries: "TextOnly", shape: "JSONInlineRefs", endpoint: "/v1/images/generations" },
      { carries: "WithReferenceImages", shape: "JSONInlineRefs", endpoint: "/v1/images/edits" },
    ],
    models: [
      {
        modelId: "grok-imagine-image-quality",
        label: "Grok Imagine Quality",
        aspectRatios: ["16:9", "19.5:9", "1:1", "1:2", "20:9", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "9:19.5", "9:20", "auto"],
        imageSizes: [],
        maxInputImages: 0,
        supportsImageInput: true,
      },
    ],
  },
  openai: {
    outputMode: "Base64Inline",
    responseShape: "DataArrayB64Json",
    usageInputPath: "usage.input_tokens",
    usageOutputPath: "usage.output_tokens",
    usageReasoningPath: "",
    variants: [
      { carries: "TextOnly", shape: "JSONGenerationsOpenAI", endpoint: "/v1/images/generations" },
      { carries: "WithReferenceImages", shape: "MultipartForm", endpoint: "/v1/images/edits" },
    ],
    models: [
      {
        modelId: "gpt-image-1",
        label: "GPT Image 1",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
        supportsImageInput: true,
      },
      {
        modelId: "gpt-image-1-mini",
        label: "GPT Image 1 Mini",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
        supportsImageInput: true,
      },
      {
        modelId: "gpt-image-1.5",
        label: "GPT Image 1.5",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
        supportsImageInput: true,
      },
      {
        modelId: "gpt-image-2",
        label: "GPT Image 2",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
        supportsImageInput: true,
      },
    ],
  },
  openrouter: {
    outputMode: "Base64Inline",
    responseShape: "DataArrayB64Json",
    usageInputPath: "usage.prompt_tokens",
    usageOutputPath: "usage.completion_tokens",
    usageReasoningPath: "",
    variants: [
      { carries: "TextOnly", shape: "JSONGenerations", endpoint: "/v1/images" },
    ],
    models: [
      {
        modelId: "google/gemini-2.5-flash-image",
        label: "Nano Banana (Gemini 2.5 Flash Image)",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
        supportsImageInput: false,
      },
      {
        modelId: "google/gemini-3-pro-image",
        label: "Nano Banana Pro (Gemini 3 Pro Image)",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
        supportsImageInput: false,
      },
      {
        modelId: "google/gemini-3.1-flash-image",
        label: "Nano Banana 2 (Gemini 3.1 Flash Image)",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
        supportsImageInput: false,
      },
      {
        modelId: "google/gemini-3.1-flash-lite-image",
        label: "Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
        supportsImageInput: false,
      },
      {
        modelId: "openai/gpt-5-image",
        label: "GPT-5 Image",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
        supportsImageInput: false,
      },
      {
        modelId: "openai/gpt-5-image-mini",
        label: "GPT-5 Image Mini",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
        supportsImageInput: false,
      },
      {
        modelId: "openai/gpt-5.4-image-2",
        label: "GPT-5.4 Image 2",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
        supportsImageInput: false,
      },
    ],
  },
  recraft: {
    outputMode: "Base64Inline",
    responseShape: "DataArrayB64Json",
    usageInputPath: "",
    usageOutputPath: "",
    usageReasoningPath: "",
    variants: [
      { carries: "TextOnly", shape: "JSONGenerations", endpoint: "/v1/images/generations" },
    ],
    models: [
      {
        modelId: "recraftv3",
        label: "Recraft V3",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
        supportsImageInput: false,
      },
      {
        modelId: "recraftv3_vector",
        label: "Recraft V3 (vector / SVG)",
        aspectRatios: [],
        imageSizes: [],
        maxInputImages: 0,
        supportsImageInput: false,
      },
    ],
  },
};

export function imageGenConfig(provider: ProviderName): ImageGenDef | undefined {
  return IMAGE_GEN[provider];
}
