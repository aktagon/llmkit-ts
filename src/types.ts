// Public types for the llmkit TS SDK.

import type { ProviderName } from "./providers/providers.ts";

//
// Canonical declarations live at ./structs.ts; these lines keep every
// internal import { Foo } from "./types.ts" working without touching
// every call site.
export type {
  BatchHandle,
  File,
  Message,
  ProviderTurn,
  Request,
  Response,
  SafetySetting,
  ToolCall,
  ToolDefinition,
  ToolResult,
  WireRequest,
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
  /** Wait for the next response bytes, in ms (Client.timeout, BUG-062). 0 disables. */
  timeoutMs?: number;
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

// Usage is GENERATED from the TokenDimension instances (plus the ADR-027
// cost field) into ./providers/middleware.ts, and re-exported here so the
// hand-written surface keeps one name for it. It used to be redeclared in this
// file, which meant two definitions of one type in one package: the generated
// one gained optional dimensions (ADR-081) while this copy still promised six
// non-optional numbers, and nothing but the typechecker was going to notice.
export type { Usage } from "./providers/middleware.ts";

/** One named speaker of a multi-speaker speech request and its voice (BUG-091). */
export interface SpeechSpeaker {
  name: string;
  voice: string;
}

/** One line of a multi-speaker speech request; style "" means none (BUG-091). */
export interface SpeechLine {
  speaker: string;
  style: string;
  text: string;
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

export interface Tool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => string | Promise<string>;
}
