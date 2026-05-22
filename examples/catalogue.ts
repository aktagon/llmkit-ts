















import { anthropic, type Client } from "../src/builders/index.ts";
import { Capabilities } from "../src/types.ts";
import type { Provider } from "../src/types.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? anthropic(process.env.ANTHROPIC_API_KEY ?? "sk-test");

  //
  const all = client.models.list();
  console.log(`compiled-in non-empty: ${all.length > 0}`);

  const info = client.models.get("claude-opus-4-7");
  const ctxPos = info !== undefined && (info.contextWindow ?? 0) > 0;
  console.log(`claude-opus-4-7 context > 0: ${ctxPos}`);

  const chat = client.models.withCapability(Capabilities.ChatCompletion).list();
  console.log(`chat-capable non-empty: ${chat.length > 0}`);

  //
  const configured = client.providers.list().map((p) => p.name);
  console.log(`configured: [${configured.join(", ")}]`);
  console.log(`supported >= 1: ${client.providers.supported().length > 0}`);

  //
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
