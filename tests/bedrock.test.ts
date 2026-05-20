import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";

interface Captured {
  url: string;
  method: string;
  authorization?: string;
  amzDate?: string;
  body: Record<string, unknown>;
}

function startMockSequence(
  responses: unknown[],
  capture: Captured[],
): { url: string; stop: () => void } {
  let i = 0;
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const body = (await req.json()) as Record<string, unknown>;
      capture.push({
        url: req.url,
        method: req.method,
        authorization: req.headers.get("authorization") ?? undefined,
        amzDate: req.headers.get("x-amz-date") ?? undefined,
        body,
      });
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

const ENV_KEYS = ["AWS_REGION", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
  delete process.env.AWS_SESSION_TOKEN;
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("Bedrock — Converse + SigV4", () => {
  test("prompt builds Converse body shape and signs with SigV4", async () => {
    const captured: Captured[] = [];
    const server = startMockSequence(
      [
        {
          output: {
            message: {
              role: "assistant",
              content: [{ text: "answer" }],
            },
          },
          usage: { inputTokens: 7, outputTokens: 3 },
        },
      ],
      captured,
    );
    try {
      const c = newClient(Providers.bedrock, "AKID-test");
      c.provider.baseUrl = server.url;
      const resp = await c.text.system("x").prompt("y");
      expect(resp.text).toBe("answer");
      expect(resp.usage.input).toBe(7);
      expect(resp.usage.output).toBe(3);
      const cap = captured[0]!;
      // Converse body shape
      expect(cap.body.system).toEqual([{ text: "x" }]);
      const messages = cap.body.messages as Array<Record<string, unknown>>;
      expect(messages).toEqual([{ role: "user", content: [{ text: "y" }] }]);
      // inferenceConfig wrapping
      const inferenceConfig = cap.body.inferenceConfig as Record<
        string,
        unknown
      >;
      expect(inferenceConfig.maxTokens).toBe(4096);
      expect(cap.body.max_tokens).toBeUndefined();
      // Endpoint templating
      expect(cap.url).toContain(
        "/model/anthropic.claude-sonnet-4-20250514-v1:0/converse",
      );
      // SigV4 signed
      expect(cap.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKID-test\/\d{8}\/us-east-1\/bedrock\/aws4_request,/,
      );
      expect(cap.amzDate).toMatch(/^\d{8}T\d{6}Z$/);
    } finally {
      server.stop();
    }
  });

  test("Agent tool loop uses Converse toolUse / toolResult content blocks", async () => {
    const captured: Captured[] = [];
    const server = startMockSequence(
      [
        {
          output: {
            message: {
              role: "assistant",
              content: [
                {
                  toolUse: {
                    toolUseId: "tu-1",
                    name: "weather",
                    input: { city: "Helsinki" },
                  },
                },
              ],
            },
          },
          usage: { inputTokens: 5, outputTokens: 5 },
        },
        {
          output: {
            message: {
              role: "assistant",
              content: [{ text: "It's cold." }],
            },
          },
          usage: { inputTokens: 12, outputTokens: 3 },
        },
      ],
      captured,
    );
    try {
      let received: Record<string, unknown> | undefined;
      const c = newClient(Providers.bedrock, "AKID-agent");
      c.provider.baseUrl = server.url;
      const resp = await c.agent
        .tool({
          name: "weather",
          description: "Get weather",
          schema: { type: "object" },
          run: (input) => {
            received = input;
            return "cold";
          },
        })
        .prompt("weather?");
      expect(resp.text).toBe("It's cold.");
      expect(resp.usage.input).toBe(17);
      expect(resp.usage.output).toBe(8);
      expect(received).toEqual({ city: "Helsinki" });
      // Second call must include toolUse + toolResult content blocks
      const msgs2 = captured[1]?.body.messages as Array<
        Record<string, unknown>
      >;
      expect(msgs2).toHaveLength(3);
      const assistantContent = msgs2[1]?.content as Array<
        Record<string, unknown>
      >;
      expect(assistantContent[0]?.toolUse).toEqual({
        toolUseId: "tu-1",
        name: "weather",
        input: { city: "Helsinki" },
      });
      const userContent = msgs2[2]?.content as Array<Record<string, unknown>>;
      expect(
        (userContent[0]?.toolResult as Record<string, unknown>)?.toolUseId,
      ).toBe("tu-1");
      // toolConfig present in both calls
      const toolConfig = captured[0]?.body.toolConfig as Record<
        string,
        unknown
      >;
      const tools = toolConfig.tools as Array<Record<string, unknown>>;
      expect((tools[0]?.toolSpec as Record<string, unknown>)?.name).toBe(
        "weather",
      );
    } finally {
      server.stop();
    }
  });
});
