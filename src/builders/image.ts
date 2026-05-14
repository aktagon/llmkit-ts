//
//
//
//
//

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

  //
  //
  //
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
  if (b._quality) options.quality = b._quality;
  if (b._outputFormat) options.outputFormat = b._outputFormat;
  if (b._background) options.background = b._background;
  if (b._count !== undefined) options.count = b._count;
  if (b._mask) options.mask = b._mask;
  if (b._safetyFilter) options.safetyFilter = b._safetyFilter;
  if (b._safetySettings.length > 0) options.safetySettings = b._safetySettings;
  if (b._middleware.length > 0) options.middleware = b._middleware;
  if (b._extraFields && Object.keys(b._extraFields).length > 0) {
    options.extraFields = b._extraFields;
  }

  return await runImageGeneration(provider, request, options);
}
