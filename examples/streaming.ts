








import { anthropic, Client } from "../src/builders/index.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? anthropic(process.env.ANTHROPIC_API_KEY ?? "sk-test");
  // #region stream
  const stream = client.text
    .system("Be brief")
    .stream("Tell me a one-line joke");
  for await (const chunk of stream) {
    process.stdout.write(chunk);
  }
  process.stdout.write("\n");
  const final = stream.response();
  if (final !== null) {
    console.log(
      `input=${final.usage.input} output=${final.usage.output} ` +
        `finishReason=${final.finishReason ?? ""}`,
    );
  }
  // #endregion
}

if (import.meta.main) {
  await main();
}
