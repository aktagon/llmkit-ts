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
  // The OpenAI snake_case option-key test, the per-model max-tokens key
  // table (BUG-001 / ADR-024), the Anthropic thinkingBudget nesting test,
  // and the Google generationConfig wrapping test migrated to the
  // wire-conformance suite (ADR-028 M2): the options-* fixtures in
  // request_wire.test.ts witness those bodies byte-for-byte across SDKs.

  test("Anthropic: topK and stopSequences land at top level with their provider json keys", async () => {
    const body = await captureBody(anthropicResp, async (url) => {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = url;
      await c.text.topK(5).stopSequences("END").prompt("hi");
    });
    expect(body.top_k).toBe(5);
    expect(body.stop_sequences).toEqual(["END"]);
  });

  test("OpenAI: reasoningEffort rejects values outside the allowed set", async () => {
    // The accepted-value body assert migrated to the options-openai-gpt5
    // wire fixture; the validation rejection below is this test's subject.
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
