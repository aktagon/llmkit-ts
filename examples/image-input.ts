









import { readFileSync } from "node:fs";
import { anthropic, Client } from "../src/builders/index.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? anthropic(process.env.ANTHROPIC_API_KEY ?? "sk-test");

  //
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
