// Public types for the llmkit TS SDK.

import type { ProviderName } from "./providers/providers.ts";
import type { MiddlewareFn } from "./providers/middleware.ts";
import type { File, Message } from "./structs.ts";

//
// Canonical declarations live at ./structs.ts; these lines keep every
// internal import { Foo } from "./types.ts" working without touching
// every call site.
export type {
  BatchHandle,
  File,
  Message,
  Response,
  ToolCall,
  ToolResult,
} from "./structs.ts";

export interface Provider {
  name: ProviderName;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /**
   * Custom HTTP headers added via Client.addHeader (ADR-052). Merged into
   * every request before the provider auth header and the static required
   * header, so a gateway header (e.g. cf-aig-authorization) rides alongside
   * the provider key without clobbering it.
   */
  headers?: Record<string, string>;
}

/**
 * Capability names one of the SDK's modelled capabilities. The set mirrors
 *
 *
 * provider wire data.
 */
export type Capability =
  | "chat_completion"
  | "image_generation"
  | "tool_calling"
  | "file_upload"
  | "batching"
  | "caching"
  | "reasoning"
  | "catalogue";

export const Capabilities = {
  ChatCompletion: "chat_completion",
  ImageGeneration: "image_generation",
  ToolCalling: "tool_calling",
  FileUpload: "file_upload",
  Batching: "batching",
  Caching: "caching",
  Reasoning: "reasoning",
  Catalogue: "catalogue",
} as const satisfies Record<string, Capability>;

export interface Request {
  system?: string;
  user?: string;
  messages?: Message[];
  files?: File[];
  images?: InputImage[];
  schema?: string;
}

/**
 * InputImage references an image attached to a text-generation request
 * (vision input, ADR-060). `url` is a base64 `data:` URI or a plain URL;
 * `detail` is the OpenAI `image_url.detail` hint ("auto" when empty).
 * Distinct from Part's `image(...)` constructor used for image generation.
 */
export interface InputImage {
  url: string;
  mimeType: string;
  detail: string;
}

// Usage is GENERATED from the TokenDimension instances (plus the ADR-027
// cost field) into ./providers/middleware.ts, and re-exported here so the
// hand-written surface keeps one name for it. It used to be redeclared in this
// file, which meant two definitions of one type in one package: the generated
// one gained optional dimensions (ADR-081) while this copy still promised six
// non-optional numbers, and nothing but the typechecker was going to notice.
export type { Usage } from "./providers/middleware.ts";

/** Per-category content safety filter for Gemini providers. */
export interface SafetySetting {
  category: string;
  threshold: string;
}

// Harm category constants
export const HARM_CATEGORY_HARASSMENT = "HARM_CATEGORY_HARASSMENT";
export const HARM_CATEGORY_HATE_SPEECH = "HARM_CATEGORY_HATE_SPEECH";
export const HARM_CATEGORY_SEXUALLY_EXPLICIT =
  "HARM_CATEGORY_SEXUALLY_EXPLICIT";
export const HARM_CATEGORY_DANGEROUS_CONTENT =
  "HARM_CATEGORY_DANGEROUS_CONTENT";
export const HARM_CATEGORY_CIVIC_INTEGRITY = "HARM_CATEGORY_CIVIC_INTEGRITY";

// Harm block threshold constants
export const HARM_BLOCK_THRESHOLD_NONE = "BLOCK_NONE";
export const HARM_BLOCK_THRESHOLD_LOW_AND_ABOVE = "BLOCK_LOW_AND_ABOVE";
export const HARM_BLOCK_THRESHOLD_MEDIUM_AND_ABOVE = "BLOCK_MEDIUM_AND_ABOVE";
export const HARM_BLOCK_THRESHOLD_HIGH_ONLY = "BLOCK_ONLY_HIGH";

// Vertex Imagen safety filter constants
export const IMAGE_SAFETY_FILTER_BLOCK_FEW = "block_few";
export const IMAGE_SAFETY_FILTER_BLOCK_SOME = "block_some";
export const IMAGE_SAFETY_FILTER_BLOCK_MOST = "block_most";
export const IMAGE_SAFETY_FILTER_BLOCK_ONLY_HIGH = "block_only_high";

export interface PromptOptions {
  signal?: AbortSignal;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  stopSequences?: string[];
  seed?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  thinkingBudget?: number;
  reasoningEffort?: string;
  caching?: boolean;
  cacheTTL?: number; // seconds
  middleware?: MiddlewareFn[];
  safetySettings?: SafetySetting[];
  /**
   * Opt-in: populate Response.raw with the parsed provider response body
   * (ADR-014). Plumbed by the typed-builder's `.raw()` chain method.
   */
  raw?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => string | Promise<string>;
}

export interface AgentOptions extends PromptOptions {
  maxToolIterations?: number;
}
