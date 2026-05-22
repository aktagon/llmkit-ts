/**
 * Agent tool loop.
 *
 * Run: ANTHROPIC_API_KEY=sk-... bun run examples/agent.ts
 *
 * Note `c.agent` is a stateful field — repeated `bot.prompt(...)` calls
 * on the same builder accumulate conversation history. Chain methods
 * (`.system(...)`, `.addTool(...)`) clone and reset state, so a forked
 * builder gets a fresh conversation. `bot.reset()` clears history
 * without dropping chained config.
 */
import { anthropic, Client } from "../src/builders/index.ts";
import type { Tool } from "../src/builders/index.ts";

const add: Tool = {
  name: "add",
  description: "Add two numbers",
  schema: {
    type: "object",
    properties: {
      a: { type: "number" },
      b: { type: "number" },
    },
  },
  run: ({ a, b }) => String(Number(a) + Number(b)),
};

export async function main(c?: Client): Promise<void> {
  const client = c ?? anthropic(process.env.ANTHROPIC_API_KEY ?? "sk-test");
  const bot = client.agent
    .system("You are a calculator. Use the add tool.")
    .addTool(add)
    .maxToolIterations(5);
  const resp = await bot.prompt("What is 2 + 3?");
  console.log(resp.text);
}

if (import.meta.main) {
  await main();
}
