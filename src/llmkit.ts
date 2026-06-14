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
  Music,
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
  ToolCall,
  ToolResult,
} from "./types.ts";
// Capability vocabulary (ADR-019 catalogue filter + ADR-030
// Client.supports query).
export { Capabilities } from "./types.ts";
export type { Capability } from "./types.ts";
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
export type {
  MusicRequest,
  MusicResponse,
  AudioData,
  MusicOptions,
} from "./music.ts";
// Per-model capability introspection (BUG-011): query the supported models and
// their advisory caps (maxInputImages, supportsImageToVideo, ...) so a consumer
// can gate input — e.g. how many seed/reference images a model accepts —
// before issuing a call. These live in the generated providers module, which
// is not its own package entry point, so they MUST be re-exported here.
export { imageGenConfig } from "./providers/image_gen.ts";
export type {
  ImageGenDef,
  ImageModelDef,
  ImageInputMode,
  ImageOutputMode,
} from "./providers/image_gen.ts";
export { videoGenConfig } from "./providers/video_gen.ts";
export type {
  VideoGenDef,
  VideoModelDef,
  VideoWireShape,
  VideoOutputDelivery,
} from "./providers/video_gen.ts";
export { musicGenConfig } from "./providers/music_gen.ts";
export type { MusicGenDef, MusicModelDef } from "./providers/music_gen.ts";
// Provider metadata (ADR-038): the narrow public per-provider catalogue
// (name/envVar/defaultModel/baseUrl) — a projection of provider facts, NOT the
// internal wire/transform spec. Exposed as the static `providers` namespace
// (providers.info(name) / providers.list()), keyless (no client needed — the
// headline use case is "which env var holds the key?", asked before a client
// exists). This replaces the rejected re-export of the full internal registry
// (BUG-012): renaming an internal wire path can never break a consumer.
export * as providers from "./providers/provider_info.ts";
export type { ProviderInfo } from "./providers/provider_info.ts";
export { MiddlewareVetoError } from "./middleware.ts";
export type { Event, MiddlewareFn } from "./providers/middleware.ts";
export {
  saveHistory,
  loadHistory,
  UnsupportedWireVersionError,
  MissingWireVersionError,
  UnknownWireKeyError,
  MalformedWireDocumentError,
} from "./wire.ts";
export { WIRE_SCHEMA_VERSION } from "./wire_version.ts";
