









import { openai, Client } from "../src/builders/index.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? openai(process.env.OPENAI_API_KEY ?? "sk-test");

  //
  const byPath = await client.upload.path("./data.pdf").run();
  console.log("by_path:", byPath.id);

  //
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
