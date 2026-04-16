import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prompt } from "../src/llmkit.ts";
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
      const resp = await prompt(
        {
          name: Providers.anthropic,
          apiKey: "test-key",
          baseUrl: server.url,
        },
        { system: "Reply with pong", user: "ping" },
      );

      expect(resp.text).toBe("pong");
      expect(resp.tokens.input).toBe(5);
      expect(resp.tokens.output).toBe(1);

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
        await prompt(
          {
            name: Providers.anthropic,
            apiKey: "test-key",
            baseUrl: server.url,
          },
          { user: "ping" },
        );
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
      const resp = await prompt(
        {
          name: Providers.openai,
          apiKey: "test-key",
          baseUrl: server.url,
        },
        { system: "Reply with pong", user: "ping" },
      );

      expect(resp.text).toBe("pong");
      expect(resp.tokens.input).toBe(18);
      expect(resp.tokens.output).toBe(1);

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
