// Public package entry point. Plan-018 D2.x absorbs each legacy free
// function (`prompt`, `promptStream`, `generateImage`, `uploadFile`,
// batch trio, `Agent`) into typed-builder terminals; this module's
// surface area shrinks to types + non-builder error/middleware
// re-exports as the absorption progresses.

export type {
  Provider,
  Request,
  Response,
  PromptOptions,
  Message,
  Usage,
  File,
  BatchHandle,
} from "./types.ts";
export { Providers } from "./providers/providers.ts";
export { APIError, ValidationError } from "./errors.ts";
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
export type { Tool, AgentOptions } from "./types.ts";
