import { describe, test, expect } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";

function startMockSSE(lines: string[]): { url: string; stop: () => void } {
  const body = lines.join("\n") + "\n";
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(body, {
        headers: { "content-type": "text/event-stream" },
      }),
  });
  return {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
  };
}

// Typed-builder *Text.stream returns AsyncIterable<string> — token
// counts/totals aren't surfaced through the iterator (see Go D1.3b
// equivalent gap with iter.Seq2). These tests only assert chunk
// delivery + termination, which is the iterator's contract.
describe("Text.stream — OpenAI flavor (no event types)", () => {
  test("delivers chunks, stops at [DONE]", async () => {
    const server = startMockSSE([
      `data: {"choices":[{"delta":{"content":"hel"}}]}`,
      `data: {"choices":[{"delta":{"content":"lo"}}]}`,
      `data: {"choices":[{"delta":{"content":"!"}}],"usage":{"prompt_tokens":3,"completion_tokens":3}}`,
      `data: [DONE]`,
    ]);
    try {
      const c = newClient(Providers.openai, "sk");
      c.provider.baseUrl = server.url;
      const chunks: string[] = [];
      for await (const chunk of c.text.stream("hi")) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(["hel", "lo", "!"]);
    } finally {
      server.stop();
    }
  });
});

// BUG-028: OpenAI only emits streamed usage when the request opts in with
// stream_options.include_usage. Assert llmkit sends it for OpenAI (usageOptIn
// true) and NOT for an unverified compat-fleet provider (Grok).
describe("Text.stream — stream_options usage opt-in (BUG-028)", () => {
  function captureBodyServer(): {
    url: string;
    body: () => Record<string, unknown>;
    stop: () => void;
  } {
    let captured: Record<string, unknown> = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        captured = (await req.json()) as Record<string, unknown>;
        return new Response(`data: [DONE]\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    return {
      url: `http://localhost:${server.port}`,
      body: () => captured,
      stop: () => server.stop(true),
    };
  }

  test("OpenAI sends stream_options.include_usage", async () => {
    const server = captureBodyServer();
    try {
      const c = newClient(Providers.openai, "sk");
      c.provider.baseUrl = server.url;
      for await (const _ of c.text.model("m").stream("hi")) {
      }
      expect(server.body().stream_options).toEqual({ include_usage: true });
    } finally {
      server.stop();
    }
  });

  test("Grok (unverified fleet) omits stream_options", async () => {
    const server = captureBodyServer();
    try {
      const c = newClient(Providers.grok, "k");
      c.provider.baseUrl = server.url;
      for await (const _ of c.text.model("m").stream("hi")) {
      }
      expect(server.body().stream_options).toBeUndefined();
    } finally {
      server.stop();
    }
  });
});

describe("Text.stream — Anthropic flavor (event types)", () => {
  test("dispatches only content_block_delta events, terminates on message_stop", async () => {
    const server = startMockSSE([
      `event: message_start`,
      `data: {"type":"message_start","message":{"usage":{"input_tokens":4}}}`,
      `event: content_block_delta`,
      `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"foo"}}`,
      `event: content_block_delta`,
      `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"bar"}}`,
      `event: message_delta`,
      `data: {"type":"message_delta","usage":{"output_tokens":7}}`,
      `event: message_stop`,
      `data: {"type":"message_stop"}`,
    ]);
    try {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = server.url;
      const chunks: string[] = [];
      for await (const chunk of c.text.stream("hi")) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(["foo", "bar"]);
    } finally {
      server.stop();
    }
  });
});
