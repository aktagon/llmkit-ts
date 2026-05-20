/**
 * Minimal text-prompt example.
 *
 * Run: ANTHROPIC_API_KEY=sk-... bun run examples/quickstart.ts
 *
 * Note `c.text` is a field, not a method — no parens. Chain methods
 * clone the prototype, so `c.text.system(...)` returns a fresh Text
 * builder each call.
 */
import { anthropic, Client } from "../src/builders/index.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? anthropic(process.env.ANTHROPIC_API_KEY ?? "sk-test");
  const resp = await client.text
    .system("Be concise.")
    .temperature(0.3)
    .maxTokens(50)
    .prompt("Say hi");
  console.log(resp.text);
  console.log(
    `${resp.usage.input} input tokens, ${resp.usage.output} output tokens`,
  );
}

if (import.meta.main) {
  await main();
}
