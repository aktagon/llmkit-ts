import { describe, test, expect } from "bun:test";
import { promptStream } from "../src/llmkit.ts";
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

describe("promptStream — OpenAI flavor (no event types)", () => {
  test("delivers chunks, stops at [DONE], returns accumulated text", async () => {
    const server = startMockSSE([
      `data: {"choices":[{"delta":{"content":"hel"}}]}`,
      `data: {"choices":[{"delta":{"content":"lo"}}]}`,
      `data: {"choices":[{"delta":{"content":"!"}}],"usage":{"prompt_tokens":3,"completion_tokens":3}}`,
      `data: [DONE]`,
    ]);
    try {
      const chunks: string[] = [];
      const resp = await promptStream(
        { name: Providers.openai, apiKey: "sk", baseUrl: server.url },
        { user: "hi" },
        (c) => chunks.push(c),
      );
      expect(chunks).toEqual(["hel", "lo", "!"]);
      expect(resp.text).toBe("hello!");
      expect(resp.tokens.input).toBe(3);
      expect(resp.tokens.output).toBe(3);
    } finally {
      server.stop();
    }
  });
});

describe("promptStream — Anthropic flavor (event types)", () => {
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
      const chunks: string[] = [];
      const resp = await promptStream(
        { name: Providers.anthropic, apiKey: "k", baseUrl: server.url },
        { user: "hi" },
        (c) => chunks.push(c),
      );
      expect(chunks).toEqual(["foo", "bar"]);
      expect(resp.text).toBe("foobar");
      expect(resp.tokens.output).toBe(7);
    } finally {
      server.stop();
    }
  });
});
