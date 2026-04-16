// Public types for the llmkit TS SDK.

import type { ProviderName } from "./providers/providers.ts";

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
  cacheCreation: number;
  cacheRead: number;
}

export interface Response {
  text: string;
  tokens: Usage;
}

export interface PromptOptions {
  signal?: AbortSignal;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  caching?: boolean;
  cacheTTL?: number; // seconds
}
