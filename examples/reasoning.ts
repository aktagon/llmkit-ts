







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
