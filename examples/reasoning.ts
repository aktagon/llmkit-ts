/**
 * Reasoning effort — let the model think harder before answering.
 *
 * Run: OPENAI_API_KEY=sk-... bun run examples/reasoning.ts
 *
 * Reasoning tokens are reported by o-series / thinking models
 * (OpenAI o-series, Gemini 2.5+); they stay zero otherwise.
 */
import { openai, Client } from "../src/builders/index.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? openai(process.env.OPENAI_API_KEY ?? "sk-test");
  const resp = await client.text
    .reasoningEffort("high")
    .prompt("How many positive integers below 100 are divisible by both 3 and 5?");
  console.log("reasoning tokens:", resp.usage.reasoning);
}

if (import.meta.main) {
  await main();
}
