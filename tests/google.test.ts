import { describe, test, expect } from "bun:test";
import { Agent } from "../src/agent.ts";
import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";

interface Captured {
  url: string;
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
      capture.push({ url: req.url, body });
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

describe("Google — SystemPlacement.SiblingObject", () => {
  test("prompt builds system_instruction + contents and templates {model} in URL", async () => {
    const captured: Captured[] = [];
    const server = startMockSequence(
      [
        {
          candidates: [{ content: { parts: [{ text: "hi from gemini" }] } }],
          usageMetadata: {
            promptTokenCount: 8,
            candidatesTokenCount: 4,
          },
        },
      ],
      captured,
    );
    try {
      const c = newClient(Providers.google, "g-key");
      c.provider.baseUrl = server.url;
      const resp = await c.text.system("Be terse.").prompt("hi");
      expect(resp.text).toBe("hi from gemini");
      expect(resp.tokens.input).toBe(8);
      expect(resp.tokens.output).toBe(4);
      const cap = captured[0]!;
      expect(cap.url).toContain(":generateContent");
      expect(cap.url).toContain("gemini-2.5-flash");
      expect(cap.url).toContain("key=g-key");
      expect(cap.body.system_instruction).toEqual({
        parts: [{ text: "Be terse." }],
      });
      const contents = cap.body.contents as Array<Record<string, unknown>>;
      expect(contents).toHaveLength(1);
      expect(contents[0]?.role).toBe("user");
      expect(contents[0]?.parts).toEqual([{ text: "hi" }]);
      expect(cap.body.messages).toBeUndefined();
    } finally {
      server.stop();
    }
  });

  test("Agent tool loop uses functionCall / functionResponse parts", async () => {
    const captured: Captured[] = [];
    const server = startMockSequence(
      [
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: "lookup",
                      args: { id: 42 },
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 3,
            candidatesTokenCount: 5,
          },
        },
        {
          candidates: [{ content: { parts: [{ text: "result is foo" }] } }],
          usageMetadata: {
            promptTokenCount: 9,
            candidatesTokenCount: 3,
          },
        },
      ],
      captured,
    );
    try {
      const agent = new Agent({
        name: Providers.google,
        apiKey: "g-key",
        baseUrl: server.url,
      });
      let received: Record<string, unknown> | undefined;
      agent.addTool({
        name: "lookup",
        description: "lookup id",
        schema: { type: "object" },
        run: (input) => {
          received = input;
          return "foo";
        },
      });
      const resp = await agent.chat("look up 42");
      expect(resp.text).toBe("result is foo");
      expect(received).toEqual({ id: 42 });
      expect(resp.tokens.input).toBe(12);
      expect(resp.tokens.output).toBe(8);
      // Second call must include functionCall + functionResponse parts.
      const contents2 = captured[1]?.body.contents as Array<
        Record<string, unknown>
      >;
      expect(contents2).toHaveLength(3);
      const assistantParts = contents2[1]?.parts as Array<
        Record<string, unknown>
      >;
      expect(assistantParts[0]?.functionCall).toEqual({
        name: "lookup",
        args: { id: 42 },
      });
      const toolParts = contents2[2]?.parts as Array<Record<string, unknown>>;
      expect(toolParts[0]?.functionResponse).toEqual({
        name: "lookup",
        response: { result: "foo" },
      });
      // Tool defs use functionDeclarations
      const tools = captured[0]?.body.tools as Array<Record<string, unknown>>;
      expect(tools[0]?.functionDeclarations).toBeDefined();
    } finally {
      server.stop();
    }
  });
});

describe("Google — ResourceCaching", () => {
  test("caching=true preflights /v1beta/cachedContents and references id", async () => {
    const captured: Captured[] = [];
    const server = startMockSequence(
      [
        // preflight cache create response
        { name: "cachedContents/abc-123" },
        // main generateContent response
        {
          candidates: [{ content: { parts: [{ text: "cached answer" }] } }],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 2,
            cachedContentTokenCount: 1024,
          },
        },
      ],
      captured,
    );
    try {
      const c = newClient(Providers.google, "g-key");
      c.provider.baseUrl = server.url;
      const resp = await c.text
        .system("Long cached system prompt.")
        .caching()
        .prompt("Q");
      expect(resp.text).toBe("cached answer");
      expect(resp.tokens.cacheRead).toBe(1024);
      // 1st call: cache create
      const c0 = captured[0]!;
      expect(c0.url).toContain("/v1beta/cachedContents");
      expect(c0.url).toContain("key=g-key");
      expect(c0.body.model).toBe("models/gemini-2.5-flash");
      expect(c0.body.ttl).toBe("3600s");
      expect(c0.body.systemInstruction).toEqual({
        parts: [{ text: "Long cached system prompt." }],
      });
      // 2nd call: main generate, must reference cachedContent and have NO system_instruction
      const c1 = captured[1]!;
      expect(c1.body.cachedContent).toBe("cachedContents/abc-123");
      expect(c1.body.system_instruction).toBeUndefined();
      const contents = c1.body.contents as Array<Record<string, unknown>>;
      expect(contents[0]?.parts).toEqual([{ text: "Q" }]);
    } finally {
      server.stop();
    }
  });
});
