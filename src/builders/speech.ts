// Owns Speech.generate translation (ADR-049). The typed-builder method is
// the only public entry point for speech generation; the internal
// generateSpeech helper in ../speech.ts holds the runtime.

import {
  generateSpeech as runSpeechGeneration,
  type SpeechRequest,
  type SpeechResponse,
} from "../speech.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { Provider } from "../types.ts";
import type { Speech } from "./builders.ts";

export async function speechGenerate(
  b: Speech,
  msg: string,
): Promise<SpeechResponse> {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
    headers: b.client.provider.headers,
  };
  if (b.client.provider.baseUrl) {
    provider.baseUrl = b.client.provider.baseUrl;
  }

  const request: SpeechRequest = {
    model: b._model,
    voice: b._voice,
    text: msg,
  };

  return await runSpeechGeneration(provider, request);
}
