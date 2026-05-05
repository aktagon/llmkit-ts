import { describe, test, expect } from "bun:test";
import { prompt } from "../src/llmkit.ts";
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
      await prompt(
        { name: Providers.openai, apiKey: "sk", baseUrl: url },
        { user: "hi" },
        {
          frequencyPenalty: 0.5,
          presencePenalty: -0.25,
          seed: 42,
          stopSequences: ["END"],
        },
      );
    });
    expect(body.frequency_penalty).toBe(0.5);
    expect(body.presence_penalty).toBe(-0.25);
    expect(body.seed).toBe(42);
    expect(body.stop).toEqual(["END"]);
  });

  test("Anthropic: topK and stopSequences land at top level with their provider json keys", async () => {
    const body = await captureBody(anthropicResp, async (url) => {
      await prompt(
        { name: Providers.anthropic, apiKey: "k", baseUrl: url },
        { user: "hi" },
        { topK: 5, stopSequences: ["END"] },
      );
    });
    expect(body.top_k).toBe(5);
    expect(body.stop_sequences).toEqual(["END"]);
  });

  test("Anthropic: thinkingBudget nests under thinking.* and merges extraFieldsJson", async () => {
    const body = await captureBody(anthropicResp, async (url) => {
      await prompt(
        { name: Providers.anthropic, apiKey: "k", baseUrl: url },
        { user: "hi" },
        { thinkingBudget: 1024 },
      );
    });
    expect(body.thinking).toEqual({ budget_tokens: 1024, type: "enabled" });
  });

  test("OpenAI: reasoningEffort accepts allowed values; rejects others", async () => {
    const body = await captureBody(openaiResp, async (url) => {
      await prompt(
        { name: Providers.openai, apiKey: "sk", baseUrl: url },
        { user: "hi" },
        { reasoningEffort: "low" },
      );
    });
    expect(body.reasoning_effort).toBe("low");

    let caught: unknown;
    try {
      await prompt(
        { name: Providers.openai, apiKey: "sk", baseUrl: "http://localhost:1" },
        { user: "hi" },
        { reasoningEffort: "yolo" },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
  });

  test("Anthropic: frequencyPenalty rejected as unsupported", async () => {
    let caught: unknown;
    try {
      await prompt(
        {
          name: Providers.anthropic,
          apiKey: "k",
          baseUrl: "http://localhost:1",
        },
        { user: "hi" },
        { frequencyPenalty: 0.1 },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).field).toBe("frequencyPenalty");
  });

  test("Google: options nest under generationConfig (wrapsOptionsIn)", async () => {
    const body = await captureBody(googleResp, async (url) => {
      await prompt(
        { name: Providers.google, apiKey: "k", baseUrl: url },
        { user: "hi" },
        { temperature: 0.7, topK: 10, maxTokens: 256 },
      );
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
