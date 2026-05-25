import { describe, test, expect } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";

function startMockJSON(
  payload: unknown,
  capture?: (req: Request, body: Record<string, unknown>) => void,
): { url: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const body = (await req.json()) as Record<string, unknown>;
      capture?.(req, body);
      return new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  return {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
  };
}

describe("caching — Anthropic ExplicitCaching", () => {
  test("caching: true wraps system prompt with cache_control; cache tokens parsed", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const server = startMockJSON(
      {
        content: [{ type: "text", text: "ok" }],
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 50,
        },
      },
      (_req, body) => {
        capturedBody = body;
      },
    );
    try {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = server.url;
      const resp = await c.text
        .system("long system prompt")
        .caching()
        .prompt("hi");
      expect(capturedBody?.system).toEqual([
        {
          type: "text",
          text: "long system prompt",
          cache_control: { type: "ephemeral" },
        },
      ]);
      expect(resp.usage.cacheWrite).toBe(100);
      expect(resp.usage.cacheRead).toBe(50);
    } finally {
      server.stop();
    }
  });

  test("caching: false leaves system prompt as a string but still parses cache tokens from response", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const server = startMockJSON(
      {
        content: [{ type: "text", text: "ok" }],
        usage: {
          input_tokens: 5,
          output_tokens: 1,
          cache_read_input_tokens: 7,
        },
      },
      (_req, body) => {
        capturedBody = body;
      },
    );
    try {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = server.url;
      const resp = await c.text.system("sys").prompt("hi");
      expect(capturedBody?.system).toBe("sys");
      expect(resp.usage.cacheRead).toBe(7);
      expect(resp.usage.cacheWrite).toBe(0);
    } finally {
      server.stop();
    }
  });

  test("Agent.caching() wraps the agent request system with cache_control (BUG-004)", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const server = startMockJSON(
      {
        content: [{ type: "text", text: "done" }],
        usage: { input_tokens: 2000, output_tokens: 5 },
      },
      (_req, body) => {
        capturedBody = body;
      },
    );
    try {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = server.url;
      await c.agent
        .system("a long stable system prefix")
        .caching()
        .prompt("hi");
      // Caching applied on the agent path by construction (ADR-026), exactly
      // like Text — not a string.
      expect(capturedBody?.system).toEqual([
        {
          type: "text",
          text: "a long stable system prefix",
          cache_control: { type: "ephemeral" },
        },
      ]);
    } finally {
      server.stop();
    }
  });
});

describe("caching — OpenAI AutomaticCaching", () => {
  test("caching: true does not mutate body; cached_tokens parsed from response", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const server = startMockJSON(
      {
        choices: [{ message: { content: "ok" } }],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 3,
          prompt_tokens_details: { cached_tokens: 12 },
        },
      },
      (_req, body) => {
        capturedBody = body;
      },
    );
    try {
      const c = newClient(Providers.openai, "sk");
      c.provider.baseUrl = server.url;
      const resp = await c.text.system("sys").caching().prompt("hi");
      // OpenAI is automatic — no cache_control wrapping anywhere.
      const messages = capturedBody?.messages as Array<Record<string, unknown>>;
      expect(messages[0]?.content).toBe("sys");
      expect(resp.usage.cacheRead).toBe(12);
      expect(resp.usage.cacheWrite).toBe(0);
    } finally {
      server.stop();
    }
  });
});
