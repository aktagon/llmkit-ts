// Public types for the llmkit TS SDK.

import type { ProviderName } from "./providers/providers.ts";
import type { MiddlewareFn } from "./providers/middleware.ts";

// Re-exports of codegen-emitted containers (ADR-018, API-PDS-002).
// Canonical declarations live at ./structs.ts; these lines keep every
// internal import { Foo } from "./types.ts" working without touching
// every call site.
export type { BatchHandle, Response } from "./structs.ts";

export interface Provider {
  name: ProviderName;
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface Request {
  system?: string;
  user?: string;
  messages?: Message[];
  schema?: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  reasoning: number;
}

export interface File {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
}

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
