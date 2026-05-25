import { describe, test, expect } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { ValidationError } from "../src/errors.ts";
import { Providers } from "../src/providers/providers.ts";

function startMockServer(
  handler: (req: Request) => Response | Promise<Response>,
): { url: string; stop: () => void } {
  const server = Bun.serve({ port: 0, fetch: handler });
  return {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
  };
}

const anthropicResp = JSON.stringify({
  content: [{ type: "text", text: "ok" }],
  usage: { input_tokens: 1, output_tokens: 1 },
});

const openaiResp = JSON.stringify({
  choices: [{ message: { content: "ok" } }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
});

const googleResp = JSON.stringify({
  candidates: [{ content: { parts: [{ text: "ok" }] } }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
});

async function captureBody(
  body: string,
  call: (url: string) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  let received: Record<string, unknown> | undefined;
  const server = startMockServer(async (req) => {
    received = (await req.json()) as Record<string, unknown>;
    return new Response(body, {
      headers: { "content-type": "application/json" },
    });
  });
  try {
    await call(server.url);
  } finally {
    server.stop();
  }
  if (!received) throw new Error("server never received a request body");
  return received;
}

describe("prompt — option setters", () => {
  test("OpenAI: frequencyPenalty, presencePenalty, seed, stopSequences land with snake_case keys", async () => {
    const body = await captureBody(openaiResp, async (url) => {
      const c = newClient(Providers.openai, "sk");
      c.provider.baseUrl = url;
      await c.text
        .frequencyPenalty(0.5)
        .presencePenalty(-0.25)
        .seed(42)
        .stopSequences("END")
        .prompt("hi");
    });
    expect(body.frequency_penalty).toBe(0.5);
    expect(body.presence_penalty).toBe(-0.25);
    expect(body.seed).toBe(42);
    expect(body.stop).toEqual(["END"]);
  });

  test.each([
    ["gpt-5", "max_completion_tokens", "max_tokens"],
    ["gpt-5-mini", "max_completion_tokens", "max_tokens"], // glob gpt-5*
    ["o3", "max_completion_tokens", "max_tokens"],
    ["o4-mini", "max_completion_tokens", "max_tokens"], // glob o*
    ["gpt-4o", "max_tokens", "max_completion_tokens"], // unaffected
  ])(
    "OpenAI per-model max tokens key: %s -> %s (BUG-001 / ADR-024)",
    async (model, wantKey, wrongKey) => {
      const body = await captureBody(openaiResp, async (url) => {
        const c = newClient(Providers.openai, "sk");
        c.provider.baseUrl = url;
        await c.text.model(model).maxTokens(128).prompt("hi");
      });
      expect(body[wantKey]).toBe(128);
      expect(body[wrongKey]).toBeUndefined();
    },
  );

  test("Anthropic: topK and stopSequences land at top level with their provider json keys", async () => {
    const body = await captureBody(anthropicResp, async (url) => {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = url;
      await c.text.topK(5).stopSequences("END").prompt("hi");
    });
    expect(body.top_k).toBe(5);
    expect(body.stop_sequences).toEqual(["END"]);
  });

  test("Anthropic: thinkingBudget nests under thinking.* and merges extraFieldsJson", async () => {
    const body = await captureBody(anthropicResp, async (url) => {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = url;
      await c.text.thinkingBudget(1024).prompt("hi");
    });
    expect(body.thinking).toEqual({ budget_tokens: 1024, type: "enabled" });
  });

  test("OpenAI: reasoningEffort accepts allowed values; rejects others", async () => {
    const body = await captureBody(openaiResp, async (url) => {
      const c = newClient(Providers.openai, "sk");
      c.provider.baseUrl = url;
      await c.text.reasoningEffort("low").prompt("hi");
    });
    expect(body.reasoning_effort).toBe("low");

    let caught: unknown;
    try {
      const c = newClient(Providers.openai, "sk");
      c.provider.baseUrl = "http://localhost:1";
      await c.text.reasoningEffort("yolo").prompt("hi");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
  });

  test("Anthropic: frequencyPenalty rejected as unsupported", async () => {
    let caught: unknown;
    try {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = "http://localhost:1";
      await c.text.frequencyPenalty(0.1).prompt("hi");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).field).toBe("frequencyPenalty");
  });

  test("Google: options nest under generationConfig (wrapsOptionsIn)", async () => {
    const body = await captureBody(googleResp, async (url) => {
      const c = newClient(Providers.google, "k");
      c.provider.baseUrl = url;
      await c.text.temperature(0.7).topK(10).maxTokens(256).prompt("hi");
    });
    const gc = body.generationConfig as Record<string, unknown>;
    expect(gc).toBeDefined();
    expect(gc.temperature).toBe(0.7);
    expect(gc.top_k).toBe(10);
    expect(gc.max_output_tokens).toBe(256);
    expect(body.max_output_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });
});

describe("usage cost (ADR-027 / BUG-005)", () => {
  async function promptResp(
    provider: keyof typeof Providers,
    responseBody: string,
  ): Promise<{ usage: { cost: number } }> {
    const server = startMockServer(
      () =>
        new Response(responseBody, {
          headers: { "content-type": "application/json" },
        }),
    );
    try {
      const c = newClient(Providers[provider], "k");
      c.provider.baseUrl = server.url;
      return await c.text.prompt("hi");
    } finally {
      server.stop();
    }
  }

  test("OpenRouter surfaces usage.cost on Usage.cost", async () => {
    const resp = await promptResp(
      "openrouter",
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.00042 },
      }),
    );
    expect(resp.usage.cost).toBe(0.00042);
  });

  test("Grok scales cost_in_usd_ticks to USD (1e-10)", async () => {
    const resp = await promptResp(
      "grok",
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
        usage: {
          prompt_tokens: 136,
          completion_tokens: 100,
          cost_in_usd_ticks: 2856000,
        },
      }),
    );
    expect(resp.usage.cost).toBe(0.0002856);
  });

  test("no-cost provider (OpenAI) stays 0", async () => {
    const resp = await promptResp(
      "openai",
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.99 },
      }),
    );
    expect(resp.usage.cost).toBe(0);
  });
});
