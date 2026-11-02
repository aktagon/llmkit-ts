// Owns Speech.generate translation (ADR-049). The typed-builder method is
// the only public entry point for speech generation; the internal
// generateSpeech helper in ../speech.ts holds the runtime.

import {
  generateSpeech as runSpeechGeneration,
  previewSpeechRequest,
  type SpeechRequest,
  type SpeechResponse,
} from "../speech.ts";
import type { MiddlewareFn } from "../providers/middleware.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { Provider } from "../types.ts";
import type { Speech } from "./builders.ts";

export async function speechGenerate(
  b: Speech,
  msg: string,
): Promise<SpeechResponse> {
  return await runSpeechGeneration(...speechCall(b, msg), {
    middleware: b._middleware as MiddlewareFn[],
  });
}

// speechPreviewRequest returns the body speechGenerate would POST (ADR-106).
export function speechPreviewRequest(b: Speech, msg: string): string {
  return previewSpeechRequest(...speechCall(b, msg));
}

// speechCall translates the builder state into the runtime's arguments; the
// terminal and the preview share it.
function speechCall(b: Speech, msg: string): [Provider, SpeechRequest] {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
    headers: b.client.provider.headers,
    timeoutMs: b.client.provider.timeoutMs,
  };
  if (b.client.provider.baseUrl) {
    provider.baseUrl = b.client.provider.baseUrl;
  }

  const request: SpeechRequest = {
    model: b._model,
    voice: b._voice,
    text: msg,
    style: b._style,
    speakers: b._speakers,
    lines: b._lines,
  };

  return [provider, request];
}

