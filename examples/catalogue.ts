/**
 * Model catalogue + provider lookup.
 *
 * Demonstrates the c.models and c.providers surface (ADR-019). Three modes:
 *
 * 1. Compiled-in catalogue — synchronous, no HTTP. List, filter by
 *    capability, get by id. Backed by ontology data baked into the SDK.
 * 2. Providers namespace — configured (have credentials + a /v1/models
 *    endpoint) and supported (every provider the SDK was built with).
 * 3. Live + scoped HTTP — opt into provider /v1/models endpoints for
 *    the freshest catalogue. live() fans out across configured providers;
 *    provider(p).list() hits one. raw() additionally populates
 *    ModelInfo.raw with the provider-native record.
 *
 * Run: ANTHROPIC_API_KEY=sk-... bun run examples/catalogue.ts
 */
import { anthropic, type Client } from "../src/builders/index.ts";
import { Capabilities } from "../src/types.ts";
import type { Provider } from "../src/types.ts";
import * as providers from "../src/providers/provider_info.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? anthropic(process.env.ANTHROPIC_API_KEY ?? "sk-test");

  // 1. Compiled-in catalogue.
  const all = client.models.list();
  console.log(`compiled-in non-empty: ${all.length > 0}`);

  const info = client.models.get("claude-opus-4-7");
  const ctxPos = info !== undefined && (info.contextWindow ?? 0) > 0;
  console.log(`claude-opus-4-7 context > 0: ${ctxPos}`);

  const chat = client.models.withCapability(Capabilities.ChatCompletion).list();
  console.log(`chat-capable non-empty: ${chat.length > 0}`);

  // 2. Providers namespace.
  const configured = client.providers.list().map((p) => p.slug);
  console.log(`configured: [${configured.join(", ")}]`);
  console.log(`supported >= 1: ${providers.list().length > 0}`);

  // 3. Live + scoped HTTP.
  const p: Provider = {
    name: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "sk-test",
  };
  const live = await client.models.live();
  console.log(`live models: ${live.models.length}`);

  const scoped = await client.models.provider(p).list();
  console.log(`scoped list: ${scoped.length}`);

  const rawScoped = await client.models.provider(p).raw().list();
  const first = rawScoped[0];
  const rawPopulated = first !== undefined && first.raw !== undefined;
  console.log(`raw populated: ${rawPopulated}`);
}

if (import.meta.main) {
  await main();
}
