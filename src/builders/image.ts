// D2.3 (plan-018) — owns Image.generate translation. The legacy
// free-function `generateImage` (formerly exported from llmkit.ts)
// is now reachable only as an internal helper imported from image.ts;
// the typed-builder method is the only public entry point for image
// generation.

import {
  generateImage as runImageGeneration,
  type ImageOptions,
  type ImageRequest,
  type ImageResponse,
} from "../image.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { Provider } from "../types.ts";
import type { Image } from "./builders.ts";

export async function imageGenerate(
  b: Image,
  msg: string,
): Promise<ImageResponse> {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
  };
  if (b.client.provider.baseUrl) {
    provider.baseUrl = b.client.provider.baseUrl;
  }

  // ImageRequest XOR rule: prompt or parts, never both. If the chain
  // accumulated parts, append msg as a final text part and use the
  // parts path. Otherwise use the prompt sugar path.
  const request: ImageRequest = { model: b._model };
  if (b._parts.length > 0) {
    const parts = msg ? [...b._parts, { text: msg }] : b._parts;
    request.parts = parts;
  } else if (msg) {
    request.prompt = msg;
  }

  const options: ImageOptions = {};
  if (b._aspectRatio) options.aspectRatio = b._aspectRatio;
  if (b._imageSize) options.imageSize = b._imageSize;
  if (b._includeText) options.includeText = true;
  if (b._middleware.length > 0) options.middleware = b._middleware;

  return await runImageGeneration(provider, request, options);
}
