/**
 * Model catalogue + provider lookup.
 *
 * Demonstrates the c.models and c.providers surface (ADR-019). Four parts:
 *
 * 1. Live list — list() fans out to each configured provider's /v1/models
 *    endpoint. The client caches each provider's list in memory for one
 *    hour; fresh() makes the call again and refills it.
 * 2. Providers namespace — configured (have credentials + a /v1/models
 *    endpoint) and supported (every provider the SDK was built with).
 * 3. Scoped — provider(p).get(id) answers from the cached list when it
 *    holds the id; provider(p).list() lists one provider. raw()
 *    additionally populates ModelInfo.raw with the provider-native record.
 * 4. Known models — providers.knownModels(name) lists the models this SDK
 *    version states facts for, with no key and no network.
 *
 * Run: ANTHROPIC_API_KEY=sk-... bun run examples/catalogue.ts
 */
import { anthropic, providers, type Client } from "../src/llmkit.ts";
import { Capabilities } from "../src/types.ts";
import type { Provider } from "../src/types.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? anthropic(process.env.ANTHROPIC_API_KEY ?? "sk-test");

  // 1. Live list, cached for one hour.
  const live = await client.models.list();
  console.log(`live models: ${live.models.length}`);

  const chat = await client.models.withCapability(Capabilities.ChatCompletion).list();
  console.log(`chat-capable non-empty: ${chat.models.length > 0}`);

  const fresh = await client.models.fresh().list();
  console.log(`fresh models: ${fresh.models.length}`);

  // 2. Providers namespace.
  const configured = client.providers.list().map((p) => p.slug);
  console.log(`configured: [${configured.join(", ")}]`);
  console.log(`supported >= 1: ${providers.list().length > 0}`);

  // 3. Scoped to one provider.
  const p: Provider = {
    name: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "sk-test",
  };
  const info = await client.models.provider(p).get("claude-opus-4-7");
  console.log(`claude-opus-4-7 context > 0: ${(info.contextWindow ?? 0) > 0}`);

  const scoped = await client.models.provider(p).list();
  console.log(`scoped list: ${scoped.length}`);

  const rawScoped = await client.models.provider(p).raw().list();
  const first = rawScoped[0];
  const rawPopulated = first !== undefined && first.raw !== undefined;
  console.log(`raw populated: ${rawPopulated}`);

  // 4. Known models: what this SDK version states about each model, with no
  // key and no network.
  // #region known-models
  for (const m of providers.knownModels("google")) {
    if (m.speech) console.log(m.id, m.displayName, m.speech.maxSpeakers, m.speech.rejects);
  }
  // #endregion
}

if (import.meta.main) {
  await main();
}
