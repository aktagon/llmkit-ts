// Public package entry point. The typed builder is the v1.0.0 API
// surface; this module re-exports the per-provider factories,
// `newClient`, and the four builder classes so `import { anthropic }
// from "@aktagon/llmkit-ts"` works alongside the explicit subpackage
// import `import { anthropic } from "@aktagon/llmkit-ts/builders"`.

export {
  newClient,
  Client,
  Text,
  Image,
  Agent,
  Upload,
  ai21,
  anthropic,
  azure,
  bedrock,
  cerebras,
  cohere,
  deepseek,
  doubao,
  ernie,
  fireworks,
  google,
  grok,
  groq,
  lmstudio,
  minimax,
  mistral,
  moonshot,
  ollama,
  openai,
  openrouter,
  perplexity,
  qwen,
  sambanova,
  together,
  vllm,
  yi,
  zhipu,
} from "./builders/index.ts";

export type {
  Provider,
  Request,
  Response,
  PromptOptions,
  Message,
  Usage,
  File,
  BatchHandle,
  AgentOptions,
} from "./types.ts";
export { Providers } from "./providers/providers.ts";
export { APIError, ValidationError } from "./errors.ts";
export type { Tool } from "./types.ts";
export type {
  ImageRequest,
  ImageResponse,
  ImageData,
  MediaRef,
  Part,
  ImageOptions,
} from "./image.ts";
export { MiddlewareVetoError } from "./middleware.ts";
export type { Event, MiddlewareFn } from "./providers/middleware.ts";
