// Phase 3 slice 1 — wires Image.generate against the legacy
// free-function runtime. The codegen-emitted Image.generate method
// delegates to `imageGenerate(this, msg)`; this file owns the
// translation logic.

import {
  generateImage as legacyGenerateImage,
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

  return await legacyGenerateImage(provider, request, options);
}
