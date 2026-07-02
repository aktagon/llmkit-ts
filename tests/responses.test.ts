// ADR-055 Phase B: the OpenAI Responses chat-protocol response-parse + opt-in
// surface. The request-wire golden (responses-openai.json, asserted in
// request_wire.test.ts) covers the outbound body; these tests cover the reply
// envelope (output[] not choices[]), the endpoint switch, and the loud
// ValidationError on a provider that lacks the protocol. Mirrors Go's
// go/responses_test.go.

import { describe, expect, test } from "bun:test";

import { newClient } from "../src/llmkit.ts";
import { Providers } from "../src/providers/providers.ts";
import { ValidationError } from "../src/errors.ts";

function startPathMock(payload: unknown): {
  url: string;
  stop: () => void;
  path: () => string;
} {
  let gotPath = "";
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      gotPath = new URL(req.url).pathname;
      return new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  return {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
    path: () => gotPath,
  };
}

describe("ADR-055 Responses protocol", () => {
  // (a) A Responses reply (output[] array with an output_text block +
  // input_tokens/output_tokens usage) parses into Response.text + usage — NOT
  // the Chat Completions choices[] path — and the request hits /v1/responses.
  test("parses the output[] envelope and hits /v1/responses", async () => {
    const m = startPathMock({
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Helsinki." }],
        },
      ],
      usage: { input_tokens: 16, output_tokens: 5 },
    });
    try {
      const c = newClient(Providers.openai, "key");
      c.provider.baseUrl = m.url;
      const resp = await c.text
        .protocol("responses")
        .model("gpt-4o-mini")
        .prompt("capital of Finland?");
      expect(resp.text).toBe("Helsinki.");
      expect(resp.usage.input).toBe(16);
      expect(resp.usage.output).toBe(5);
      expect(resp.finishReason).toBe("completed");
      expect(m.path()).toBe("/v1/responses");
    } finally {
      m.stop();
    }
  });

  // (b) WITHOUT protocol("responses") the same client still POSTs to
  // /v1/chat/completions and parses the choices[] envelope — the default is
  // pinned (ADR-055 goal #1).
  test("default (no protocol) hits /v1/chat/completions and parses choices[]", async () => {
    const m = startPathMock({
      choices: [{ message: { content: "Helsinki." } }],
      usage: { prompt_tokens: 16, completion_tokens: 5 },
    });
    try {
      const c = newClient(Providers.openai, "key");
      c.provider.baseUrl = m.url;
      const resp = await c.text.model("gpt-4o-mini").prompt("capital of Finland?");
      expect(resp.text).toBe("Helsinki.");
      expect(m.path()).toBe("/v1/chat/completions");
    } finally {
      m.stop();
    }
  });

  // (c) protocol("responses") on a provider that does not expose it (Anthropic)
  // throws the uniform ValidationError(field:"protocol") before any network call.
  test("unsupported provider throws ValidationError(field:protocol)", async () => {
    const c = newClient(Providers.anthropic, "key");
    let caught: unknown;
    try {
      await c.text
        .protocol("responses")
        .model("claude-sonnet-4-6")
        .prompt("hi");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).field).toBe("protocol");
  });

  // (d) An unknown protocol token throws ValidationError(field:"protocol")
  // rather than silently falling back.
  test("unknown protocol token throws ValidationError(field:protocol)", async () => {
    const c = newClient(Providers.openai, "key");
    let caught: unknown;
    try {
      await c.text.protocol("nonexistent").model("gpt-4o-mini").prompt("hi");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).field).toBe("protocol");
  });
});
