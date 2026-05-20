/**
 * File upload — Path and Bytes paths.
 *
 * Run: OPENAI_API_KEY=sk-... bun run examples/upload.ts
 *
 * The `.path()` and `.bytes()` terminals are mutually exclusive on the
 * same Upload builder — pick one. `.bytes()` requires `.filename()` so
 * the multipart frame has a meaningful name; `.mimeType()` is optional
 * and defaults to `application/octet-stream`.
 */
import { openai, Client } from "../src/builders/index.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? openai(process.env.OPENAI_API_KEY ?? "sk-test");

  // Path form
  const byPath = await client.upload.path("./data.pdf").run();
  console.log("by_path:", byPath.id);

  // Bytes form
  const payload = new TextEncoder().encode("hello world");
  const byBytes = await client.upload
    .bytes(payload)
    .filename("greeting.txt")
    .mimeType("text/plain")
    .run();
  console.log("by_bytes:", byBytes.id);
}

if (import.meta.main) {
  await main();
}
