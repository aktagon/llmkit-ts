







import { anthropic, Client } from "../src/builders/index.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? anthropic(process.env.ANTHROPIC_API_KEY ?? "sk-test");
  const results = await client.text
    .system("Be brief")
    .batch(
      "Translate hello to French",
      "Translate hello to Spanish",
      "Translate hello to German",
    );
  results.forEach((r) => console.log(r.text));
}

if (import.meta.main) {
  await main();
}
