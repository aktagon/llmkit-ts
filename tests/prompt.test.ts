import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { APIError } from "../src/errors.ts";
import { Providers } from "../src/providers/providers.ts";

// Minimal mock server
function startMockServer(
  handler: (req: Request) => Response | Promise<Response>,
): {
  url: string;
  stop: () => void;
} {
  const server = Bun.serve({
    port: 0, // random
    fetch: handler,
  });
  return {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
  };
}

describe("prompt — Anthropic", () => {
  test("sends correct headers and parses response", async () => {
    let receivedHeaders: Headers | undefined;
    let receivedBody: Record<string, unknown> | undefined;

    const server = startMockServer(async (req) => {
      receivedHeaders = req.headers;
      receivedBody = (await req.json()) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "pong" }],
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });

    try {
      const c = newClient(Providers.anthropic, "test-key");
      c.provider.baseUrl = server.url;
      const resp = await c.text.system("Reply with pong").prompt("ping");

      expect(resp.text).toBe("pong");
      expect(resp.usage.input).toBe(5);
      expect(resp.usage.output).toBe(1);

      // Anthropic auth: x-api-key header, no Bearer prefix
      expect(receivedHeaders?.get("x-api-key")).toBe("test-key");
      expect(receivedHeaders?.get("anthropic-version")).toBe("2023-06-01");

      // Anthropic system placement: top-level field
      expect(receivedBody?.system).toBe("Reply with pong");
      expect(receivedBody?.messages).toEqual([
        { role: "user", content: "ping" },
      ]);
    } finally {
      server.stop();
    }
  });

  test("throws APIError on 4xx response", async () => {
    const server = startMockServer(
      () =>
        new Response(
          JSON.stringify({
            error: { type: "invalid_request_error", message: "bad input" },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    );

    try {
      let caught: unknown;
      try {
        const c = newClient(Providers.anthropic, "test-key");
        c.provider.baseUrl = server.url;
        await c.text.prompt("ping");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(APIError);
      const err = caught as APIError;
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("bad input");
    } finally {
      server.stop();
    }
  });
});

describe("prompt — OpenAI", () => {
  test("sends Bearer auth and parses choices[0].message.content", async () => {
    let receivedHeaders: Headers | undefined;
    let receivedBody: Record<string, unknown> | undefined;

    const server = startMockServer(async (req) => {
      receivedHeaders = req.headers;
      receivedBody = (await req.json()) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "pong" } }],
          usage: { prompt_tokens: 18, completion_tokens: 1 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });

    try {
      const c = newClient(Providers.openai, "test-key");
      c.provider.baseUrl = server.url;
      const resp = await c.text.system("Reply with pong").prompt("ping");

      expect(resp.text).toBe("pong");
      expect(resp.usage.input).toBe(18);
      expect(resp.usage.output).toBe(1);

      expect(receivedHeaders?.get("authorization")).toBe("Bearer test-key");

      // OpenAI system placement: in messages array
      expect(receivedBody?.messages).toEqual([
        { role: "system", content: "Reply with pong" },
        { role: "user", content: "ping" },
      ]);
    } finally {
      server.stop();
    }
  });
});

describe("prompt — reasoning tokens", () => {
  test("Usage.reasoning populated for OpenAI o1/o3/o4 responses", async () => {
    const server = startMockServer(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "reasoned" } }],
            usage: {
              prompt_tokens: 40,
              completion_tokens: 25,
              completion_tokens_details: { reasoning_tokens: 17 },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    try {
      const c = newClient(Providers.openai, "sk-test");
      c.provider.baseUrl = server.url;
      const response = await c.text.prompt("think");
      expect(response.usage.reasoning).toBe(17);
      expect(response.usage.input).toBe(40);
      expect(response.usage.output).toBe(25);
    } finally {
      server.stop();
    }
  });

  test("Usage.reasoning stays zero for providers that do not report it", async () => {
    const server = startMockServer(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "hi" }],
            usage: { input_tokens: 5, output_tokens: 3 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    try {
      const c = newClient(Providers.anthropic, "sk-test");
      c.provider.baseUrl = server.url;
      const response = await c.text.prompt("hi");
      expect(response.usage.reasoning).toBe(0);
    } finally {
      server.stop();
    }
  });
});

describe("prompt — finishReason / finishMessage", () => {
  test("Anthropic: surfaces stop_reason as finishReason", async () => {
    const server = startMockServer(
      () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "truncated" }],
            usage: { input_tokens: 4, output_tokens: 10 },
            stop_reason: "max_tokens",
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    try {
      const c = newClient(Providers.anthropic, "test-key");
      c.provider.baseUrl = server.url;
      const resp = await c.text.maxTokens(10).prompt("ping");
      expect(resp.finishReason).toBe("max_tokens");
      expect(resp.finishMessage).toBeUndefined();
    } finally {
      server.stop();
    }
  });

  test("OpenAI: surfaces choices[0].finish_reason", async () => {
    const server = startMockServer(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { role: "assistant", content: "ok" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 1 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    try {
      const c = newClient(Providers.openai, "test-key");
      c.provider.baseUrl = server.url;
      const resp = await c.text.prompt("ping");
      expect(resp.finishReason).toBe("stop");
    } finally {
      server.stop();
    }
  });

  test("happy path leaves finishReason undefined when absent", async () => {
    const server = startMockServer(
      () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "hi" }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    try {
      const c = newClient(Providers.anthropic, "test-key");
      c.provider.baseUrl = server.url;
      const resp = await c.text.prompt("ping");
      expect(resp.finishReason).toBeUndefined();
      expect(resp.finishMessage).toBeUndefined();
    } finally {
      server.stop();
    }
  });
});

describe("Text.prompt — safety settings", () => {
  test("Google: safetySettings written as top-level wire field", async () => {
    let receivedBody: any = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "ok" }] } }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
          }),
        );
      },
    });
    try {
      const c = newClient(Providers.google, "key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.text
        .safetySettings([
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        ])
        .prompt("hello");
      expect(receivedBody.safetySettings).toBeDefined();
      expect(receivedBody.safetySettings).toHaveLength(1);
      expect(receivedBody.safetySettings[0].category).toBe(
        "HARM_CATEGORY_HARASSMENT",
      );
      expect(receivedBody.safetySettings[0].threshold).toBe("BLOCK_NONE");
    } finally {
      server.stop(true);
    }
  });

  test("OpenAI: safetySettings silently dropped (no wire field, no error)", async () => {
    let receivedBody: any = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        );
      },
    });
    try {
      const c = newClient(Providers.openai, "key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.text
        .safetySettings([
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        ])
        .prompt("hello");
      expect(resp.text).toBe("ok");
      expect(receivedBody.safetySettings).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });
});
