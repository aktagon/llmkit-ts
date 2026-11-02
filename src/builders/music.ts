// Owns Music.generate translation (ADR-033). The typed-builder method is
// the only public entry point for music generation; the internal
// generateMusic helper in ../music.ts holds the runtime.

import {
  generateMusic as runMusicGeneration,
  previewMusicRequest,
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
  const [provider, request, options] = musicCall(b, msg);
  return await runMusicGeneration(provider, request, options);
}

// musicPreviewRequest returns the body musicGenerate would POST (ADR-106).
export function musicPreviewRequest(b: Music, msg: string): string {
  const [provider, request] = musicCall(b, msg);
  return previewMusicRequest(provider, request);
}

// musicCall translates the builder state into the runtime's arguments; the
// terminal and the preview share it.
function musicCall(
  b: Music,
  msg: string,
): [Provider, MusicRequest, MusicOptions] {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
    headers: b.client.provider.headers,
    timeoutMs: b.client.provider.timeoutMs,
  };
  if (b.client.provider.baseUrl) {
    provider.baseUrl = b.client.provider.baseUrl;
  }

  // Mirror go/music_builder.go: chain-accumulated parts plus an optional
  // trailing text part from generate(msg). The XOR (prompt vs parts) is
  // enforced by normalizeMusicParts in the runtime — both empty errors.
  const parts: Part[] = msg ? [...b._parts, { text: msg }] : b._parts;

  const request: MusicRequest = { model: b._model, parts };

  const options: MusicOptions = {};
  if (b._middleware.length > 0) options.middleware = b._middleware;
  if (b._raw) options.raw = true;

  return [provider, request, options];
}

