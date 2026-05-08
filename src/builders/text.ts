// Phase 3 slice 1 — wires Text.prompt against the legacy free-function
// runtime. The codegen-emitted Text.prompt method delegates to
// `textPrompt(this, msg)` (see TS_BUILDER_SKIP_TERMINALS in
// codegen/generate.py). This file owns the request translation; the
// generated class body is just a thin forwarder so coverage tooling
// sees the method body executed.

import { prompt as legacyPrompt } from "../llmkit.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { PromptOptions, Provider, Request, Response } from "../types.ts";
import type { Text } from "./builders.ts";

/**
 * Translates a chained Text builder + final prompt text into the
 * legacy `prompt` API's three arguments: provider, request, options.
 *
 * Limitations in slice 1:
 *  - `_files` is ignored (legacy TS Request has no `files` field; mirror
 *    of how Go's slice 1 handled the same gap before Request was extended).
 *  - Image parts in `_parts` are ignored (legacy TS Request has no `images`
 *    field). Text parts in `_parts` are concatenated, then `finalText` is
 *    appended as the last text segment if non-empty. This matches Go
 *    slice 1's `splitTextAndImages` behaviour minus the image side.
 *
 * Both gaps are tracked under ADR-008 OQ-2 (text generation onto Part-based
 * vocabulary across SDKs).
 */
export function buildRequest(
  b: Text,
  finalText: string,
): { provider: Provider; request: Request; options: PromptOptions } {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
  };
  if (b._model) provider.model = b._model;
  if (b.client.provider.baseUrl) provider.baseUrl = b.client.provider.baseUrl;

  // Concatenate accumulated text parts, then append finalText.
  const textSegments: string[] = [];
  for (const p of b._parts) {
    if ("text" in p) textSegments.push(p.text);
  }
  if (finalText) textSegments.push(finalText);
  const user = textSegments.join("");

  // Legacy TS Request treats `messages` and `user` as mutually exclusive
  // (request.ts:205 uses if/else if). The typed-builder shields callers
  // from that quirk: when history is present, append the final user turn
  // to the message list; otherwise use the simpler `user` field.
  const request: Request = {};
  if (b._system) request.system = b._system;
  if (b._history.length > 0) {
    const messages = [...b._history];
    if (user) messages.push({ role: "user", content: user });
    request.messages = messages;
  } else if (user) {
    request.user = user;
  }
  if (b._schema) request.schema = b._schema;

  const options: PromptOptions = {};
  if (b._maxTokens !== undefined) options.maxTokens = b._maxTokens;
  if (b._temperature !== undefined) options.temperature = b._temperature;
  if (b._caching) options.caching = true;
  if (b._middleware.length > 0) options.middleware = b._middleware;

  return { provider, request, options };
}

export async function textPrompt(b: Text, msg: string): Promise<Response> {
  const { provider, request, options } = buildRequest(b, msg);
  return await legacyPrompt(provider, request, options);
}
