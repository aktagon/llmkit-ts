//

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
