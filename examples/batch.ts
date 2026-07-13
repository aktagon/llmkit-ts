/**
 * Batch prompting — many prompts in one submission.
 *
 * Run: ANTHROPIC_API_KEY=sk-... bun run examples/batch.ts
 *
 * `c.text.<config>.batch(...prompts)` queues the batch and returns a handle;
 * `handle.wait()` blocks until completion, returning the parsed Responses
 * in prompt order.
 */
import { anthropic, Client } from "../src/builders/index.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? anthropic(process.env.ANTHROPIC_API_KEY ?? "sk-test");
  // #region batch
  const handle = await client.text
    .system("Be brief")
    .batch(
      "Translate hello to French",
      "Translate hello to Spanish",
      "Translate hello to German",
    );
  const results = await handle.wait();
  results.forEach((r) => console.log(r.text));
  // #endregion
}

if (import.meta.main) {
  await main();
}
