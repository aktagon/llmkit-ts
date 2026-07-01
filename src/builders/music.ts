//
//
//

import {
  generateMusic as runMusicGeneration,
  type MusicOptions,
  type MusicRequest,
  type MusicResponse,
} from "../music.ts";
import type { Part } from "../image.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { Provider } from "../types.ts";
import type { Music } from "./builders.ts";

export async function musicGenerate(
  b: Music,
  msg: string,
): Promise<MusicResponse> {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
    headers: b.client.provider.headers,
  };
  if (b.client.provider.baseUrl) {
    provider.baseUrl = b.client.provider.baseUrl;
  }

  //
  //
  //
  const parts: Part[] = msg ? [...b._parts, { text: msg }] : b._parts;

  const request: MusicRequest = { model: b._model, parts };

  const options: MusicOptions = {};
  if (b._middleware.length > 0) options.middleware = b._middleware;
  if (b._raw) options.raw = true;

  return await runMusicGeneration(provider, request, options);
}
