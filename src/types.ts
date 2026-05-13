// Public types for the llmkit TS SDK.

import type { ProviderName } from "./providers/providers.ts";
import type { MiddlewareFn } from "./providers/middleware.ts";

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

export interface Response {
  text: string;
  tokens: Usage;
  /**
   * Provider stop signal, passed through verbatim. Examples:
   *   Google:    "STOP", "MAX_TOKENS", "SAFETY", "RECITATION"
   *   OpenAI:    "stop", "length", "content_filter", "tool_calls"
   *   Anthropic: "end_turn", "max_tokens", "stop_sequence", "tool_use"
   *   xAI:       "stop", "length", "content_filter"
   * Undefined when the provider response carries no signal or the parser
   * does not yet read this provider's location.
   */
  finishReason?: string;
  /**
   * Provider-supplied human-readable explanation of the stop signal.
   * Populated by Google when present; OpenAI / Anthropic / xAI do not
   * carry an equivalent free-text field, so this stays undefined for them.
   */
  finishMessage?: string;
}

export interface File {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
}

export interface BatchHandle {
  id: string;
  provider: Provider;
}

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
