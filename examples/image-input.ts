/**
 * Inline image input on the text/prompt path (ADR-060).
 *
 * Attach an image (MIME + raw bytes) to a normal text prompt and the SDK
 * sends it as the provider's native image block. Bytes-based, so it works in
 * environments with no filesystem (e.g. a browser extension passing a
 * screenshot's bytes straight through).
 *
 * Run: ANTHROPIC_API_KEY=sk-... bun run examples/image-input.ts path/to/image.png
 */
import { readFileSync } from "node:fs";
import { anthropic, Client } from "../src/builders/index.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? anthropic(process.env.ANTHROPIC_API_KEY ?? "sk-test");

  // Raw bytes + MIME — no filesystem required at the SDK boundary.
  const path = process.argv[2] ?? "screenshot.png";
  const bytes = new Uint8Array(readFileSync(path));

  const resp = await client.text
    .image("image/png", bytes)
    .prompt("Describe this screenshot in one sentence.");

  console.log(resp.text);
}

if (import.meta.main) {
  await main();
}
