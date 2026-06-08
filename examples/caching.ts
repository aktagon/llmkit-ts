/**
 * Prompt caching — reuse a large system prompt across calls.
 *
 * Run: ANTHROPIC_API_KEY=sk-... bun run examples/caching.ts
 *
 * Anthropic explicit caching needs a sizeable cached segment, so the
 * system prompt below is intentionally long.
 */
import { anthropic, Client } from "../src/builders/index.ts";

const longSysPrompt = [
  "You are a meticulous technical editor for a documentation team.",
  "Always preserve the author's voice while tightening prose.",
  "Prefer active voice, short sentences, and concrete nouns.",
  "Never introduce new claims; only clarify what is already stated.",
  "When a sentence is ambiguous, flag it rather than guessing.",
  "Keep code identifiers, file paths, and command names verbatim.",
  "Use straight ASCII quotes and no emojis.",
].join("\n");

export async function main(c?: Client): Promise<void> {
  const client = c ?? anthropic(process.env.ANTHROPIC_API_KEY ?? "sk-test");
  const resp = await client.text
    .system(longSysPrompt)
    .caching()
    .prompt("Tighten: 'In order to begin, you will first need to start.'");
  console.log("cacheRead:", resp.usage.cacheRead);
  console.log("cacheWrite:", resp.usage.cacheWrite);
}

if (import.meta.main) {
  await main();
}
