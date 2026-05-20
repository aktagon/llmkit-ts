import { describe, test, expect } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";

interface CapturedRequest {
  body: Record<string, unknown>;
}

function startMockSequence(
  responses: unknown[],
  capture: CapturedRequest[],
): { url: string; stop: () => void } {
  let i = 0;
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const body = (await req.json()) as Record<string, unknown>;
      capture.push({ body });
      const payload = responses[Math.min(i, responses.length - 1)];
      i++;
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

describe("Agent — Anthropic", () => {
  test("single chat with no tools returns text", async () => {
    const captured: CapturedRequest[] = [];
    const server = startMockSequence(
      [
        {
          content: [{ type: "text", text: "hello back" }],
          usage: { input_tokens: 4, output_tokens: 2 },
        },
      ],
      captured,
    );
    try {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = server.url;
      const resp = await c.agent
        .system("you are a friendly assistant")
        .prompt("hi");
      expect(resp.text).toBe("hello back");
      expect(resp.usage.input).toBe(4);
      expect(resp.usage.output).toBe(2);
      expect(captured).toHaveLength(1);
      expect(captured[0]?.body.system).toBe("you are a friendly assistant");
      const msgs = captured[0]?.body.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.content).toBe("hi");
    } finally {
      server.stop();
    }
  });

  test("tool_use → text loop executes tool and accumulates usage", async () => {
    const captured: CapturedRequest[] = [];
    const server = startMockSequence(
      [
        {
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "weather",
              input: { city: "Helsinki" },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 6 },
        },
        {
          content: [{ type: "text", text: "It's -3C." }],
          usage: { input_tokens: 20, output_tokens: 5 },
        },
      ],
      captured,
    );
    try {
      let toolArgs: Record<string, unknown> | undefined;
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = server.url;
      const resp = await c.agent
        .tool({
          name: "weather",
          description: "Get the weather",
          schema: { type: "object", properties: { city: { type: "string" } } },
          run: (input) => {
            toolArgs = input;
            return "-3C, clear";
          },
        })
        .prompt("weather in Helsinki?");
      expect(resp.text).toBe("It's -3C.");
      expect(resp.usage.input).toBe(30);
      expect(resp.usage.output).toBe(11);
      expect(toolArgs).toEqual({ city: "Helsinki" });
      // Second request must include the prior tool_use and tool_result.
      const msgs2 = captured[1]?.body.messages as Array<
        Record<string, unknown>
      >;
      expect(msgs2).toHaveLength(3);
      expect(msgs2[1]?.role).toBe("assistant");
      const assistantContent = msgs2[1]?.content as Array<
        Record<string, unknown>
      >;
      expect(assistantContent[0]?.type).toBe("tool_use");
      expect(msgs2[2]?.role).toBe("user");
      const userContent = msgs2[2]?.content as Array<Record<string, unknown>>;
      expect(userContent[0]?.type).toBe("tool_result");
      expect(userContent[0]?.content).toBe("-3C, clear");
    } finally {
      server.stop();
    }
  });
});

describe("Agent — OpenAI", () => {
  test("tool_calls → text loop executes tool", async () => {
    const captured: CapturedRequest[] = [];
    const server = startMockSequence(
      [
        {
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "echo",
                      arguments: '{"text":"yo"}',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 4 },
        },
        {
          choices: [{ message: { role: "assistant", content: "yo!" } }],
          usage: { prompt_tokens: 15, completion_tokens: 2 },
        },
      ],
      captured,
    );
    try {
      const c = newClient(Providers.openai, "sk");
      c.provider.baseUrl = server.url;
      const resp = await c.agent
        .tool({
          name: "echo",
          description: "Echo input",
          schema: { type: "object", properties: { text: { type: "string" } } },
          run: async (input) => String(input.text),
        })
        .prompt("echo yo");
      expect(resp.text).toBe("yo!");
      expect(resp.usage.input).toBe(23);
      expect(resp.usage.output).toBe(6);
      const msgs2 = captured[1]?.body.messages as Array<
        Record<string, unknown>
      >;
      // [user, assistant(tool_calls), tool]
      expect(msgs2).toHaveLength(3);
      expect(msgs2[1]?.role).toBe("assistant");
      expect(msgs2[2]?.role).toBe("tool");
      expect(msgs2[2]?.tool_call_id).toBe("call_1");
      expect(msgs2[2]?.content).toBe("yo");
    } finally {
      server.stop();
    }
  });
});

// "max iterations exceeded" test removed (D2.6): typed-builder Agent
// doesn't yet expose a `maxToolIterations` chain method. The legacy
// option still applies via the wrapped LegacyAgent's defaults; making
// the cap configurable via the chain API is a small follow-up that
// requires adding `MaxToolIterations` to the codegen tables (mirroring
// MaxTokens).

// "Agent.reset clears history and tools" test removed (D2.6): typed-builder
// Reset clears only the live LegacyAgent state; chain config (system,
// tools, ...) is intentionally preserved so the next .prompt() re-initialises
// with the same configuration. Coverage for that semantics lives in
// TestAgent_StateForking inside builders.test.ts.
