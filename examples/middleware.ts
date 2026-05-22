









import { anthropic, type Client } from "../src/builders/index.ts";
import type { Event, MiddlewareFn } from "../src/builders/index.ts";

interface Price {
  input: number;
  output: number;
}

class SpendCap {
  private spent = 0;

  constructor(
    private readonly budget: number,
    private readonly prices: Record<string, Price>,
  ) {}

  middleware: MiddlewareFn = (_ctx, e: Event) => {
    if (e.op !== "llm_request") return null;
    if (e.phase === "pre") {
      if (this.spent >= this.budget) {
        return new Error(
          `daily budget $${this.budget.toFixed(2)} exceeded ` +
            `(spent $${this.spent.toFixed(4)})`,
        );
      }
      return null;
    }
    const p = this.prices[e.model];
    if (!p || !e.usage) return null;
    this.spent += (e.usage.input * p.input + e.usage.output * p.output) / 1e6;
    return null;
  };

  get total(): number {
    return this.spent;
  }
}

const tokenLogger: MiddlewareFn = (_ctx, e) => {
  if (e.op === "llm_request" && e.phase === "post" && e.usage) {
    console.log(
      `[${e.provider}/${e.model}] in=${e.usage.input} out=${e.usage.output} ` +
        `cache_read=${e.usage.cacheRead} took=${e.duration ?? 0}ms`,
    );
  }
  return null;
};

export async function main(c?: Client): Promise<void> {
  const cap = new SpendCap(5.0, {
    "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0 },
  });
  const client = c ?? anthropic(process.env.ANTHROPIC_API_KEY ?? "sk-test");
  const resp = await client.text
    .addMiddleware(cap.middleware, tokenLogger)
    .prompt("What is 2+2? Reply in one word.");
  console.log("Answer:", resp.text);
  console.log(`Spent so far: $${cap.total.toFixed(4)} / $${(5.0).toFixed(2)}`);
}

if (import.meta.main) {
  await main();
}
