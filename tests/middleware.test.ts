import { describe, test, expect } from "bun:test";
import { MiddlewareVetoError } from "../src/llmkit.ts";
import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";
import type { Event, MiddlewareFn } from "../src/providers/middleware.ts";

function startMockJSON(responses: unknown[]): {
  url: string;
  calls: number;
  stop: () => void;
} {
  let i = 0;
  const state = { calls: 0 };
  const server = Bun.serve({
    port: 0,
    fetch: async (_req) => {
      state.calls++;
      const payload = responses[Math.min(i, responses.length - 1)];
      i++;
      return new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  return {
    url: `http://localhost:${server.port}`,
    get calls() {
      return state.calls;
    },
    stop: () => server.stop(true),
  };
}

describe("middleware — observation", () => {
  test("prompt fires pre + post with op=llm_request and usage", async () => {
    const events: Event[] = [];
    const observer: MiddlewareFn = (_ctx, e) => {
      events.push({ ...e });
      return null;
    };
    const server = startMockJSON([
      {
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 4, output_tokens: 2 },
      },
    ]);
    try {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = server.url;
      await c.text.addMiddleware(observer).prompt("hi");
      expect(events).toHaveLength(2);
      expect(events[0]?.op).toBe("llm_request");
      expect(events[0]?.phase).toBe("pre");
      expect(events[0]?.provider).toBe("anthropic");
      expect(events[0]?.model).toBe("claude-sonnet-4-6");
      expect(events[0]?.duration).toBeUndefined();

      expect(events[1]?.phase).toBe("post");
      expect(events[1]?.usage).toEqual({
        input: 4,
        output: 2,
        cacheWrite: 0,
        cacheRead: 0,
        reasoning: 0,
        cost: 0,
      });
      expect(events[1]?.err).toBeUndefined();
      expect(typeof events[1]?.duration).toBe("number");
      expect((events[1]?.duration ?? 0) >= 0).toBe(true);
    } finally {
      server.stop();
    }
  });
});

describe("middleware — veto", () => {
  test("pre veto throws MiddlewareVetoError and skips HTTP call", async () => {
    const veto: MiddlewareFn = (_ctx, _e) => new Error("blocked by policy");
    const server = startMockJSON([{ should: "never be called" }]);
    try {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = server.url;
      await expect(c.text.addMiddleware(veto).prompt("hi")).rejects.toThrow(
        MiddlewareVetoError,
      );
      expect(server.calls).toBe(0);
    } finally {
      server.stop();
    }
  });

  test("first non-null veto wins; later middleware not invoked", async () => {
    const order: string[] = [];
    const m1: MiddlewareFn = (_c, _e) => {
      order.push("m1");
      return null;
    };
    const m2: MiddlewareFn = (_c, _e) => {
      order.push("m2");
      return new Error("stop");
    };
    const m3: MiddlewareFn = (_c, _e) => {
      order.push("m3");
      return null;
    };
    const server = startMockJSON([{ x: 1 }]);
    try {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = server.url;
      await expect(
        c.text.addMiddleware(m1, m2, m3).prompt("hi"),
      ).rejects.toThrow(MiddlewareVetoError);
      expect(order).toEqual(["m1", "m2"]);
      expect(server.calls).toBe(0);
    } finally {
      server.stop();
    }
  });
});

describe("middleware — upload, batch_submit, cache_create", () => {
  test("uploadFile fires op=upload pre + post", async () => {
    const events: Event[] = [];
    const observer: MiddlewareFn = (_c, e) => {
      events.push({ ...e });
      return null;
    };
    const server = startMockJSON([
      { id: "file_abc", filename: "x.jsonl", bytes: 5 },
    ]);
    try {
      const c = newClient(Providers.openai, "sk");
      c.provider.baseUrl = server.url;
      await c.upload
        .bytes(new TextEncoder().encode("hello"))
        .filename("x.jsonl")
        .addMiddleware(observer)
        .run();
      const ops = events.map((e) => `${e.op}:${e.phase}`);
      expect(ops).toEqual(["upload:pre", "upload:post"]);
      expect(events[1]?.err).toBeUndefined();
      expect(typeof events[1]?.duration).toBe("number");
    } finally {
      server.stop();
    }
  });

  test("batch fires op=batch_submit pre + post", async () => {
    const events: Event[] = [];
    const observer: MiddlewareFn = (_c, e) => {
      events.push({ ...e });
      return null;
    };
    const server = startMockJSON([{ id: "msgbatch_1" }]);
    try {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = server.url;
      await c.text.addMiddleware(observer).batch("hi");
      const ops = events.map((e) => `${e.op}:${e.phase}`);
      expect(ops).toEqual(["batch_submit:pre", "batch_submit:post"]);
    } finally {
      server.stop();
    }
  });

  test("ResourceCaching pre-flight fires op=cache_create pre + post", async () => {
    const events: Event[] = [];
    const observer: MiddlewareFn = (_c, e) => {
      events.push({ ...e });
      return null;
    };
    const server = startMockJSON([
      { name: "cachedContents/abc-1" },
      {
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      },
    ]);
    try {
      const c = newClient(Providers.google, "g");
      c.provider.baseUrl = server.url;
      await c.text
        .system("long sys")
        .caching()
        .addMiddleware(observer)
        .prompt("q");
      const ops = events.map((e) => `${e.op}:${e.phase}`);
      // llm_request:pre fires first, then cache_create:pre/post inside it,
      // then llm_request:post after the main call.
      expect(ops).toEqual([
        "llm_request:pre",
        "cache_create:pre",
        "cache_create:post",
        "llm_request:post",
      ]);
    } finally {
      server.stop();
    }
  });
});

describe("middleware — Agent tool_call events", () => {
  test("tool_call fires pre + post with tool name, args, result", async () => {
    const events: Event[] = [];
    const observer: MiddlewareFn = (_ctx, e) => {
      events.push({ ...e });
      return null;
    };
    const responses = [
      {
        content: [
          {
            type: "tool_use",
            id: "tu1",
            name: "echo",
            input: { x: 1 },
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      {
        content: [{ type: "text", text: "done" }],
        usage: { input_tokens: 2, output_tokens: 1 },
      },
    ];
    const server = startMockJSON(responses);
    try {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = server.url;
      await c.agent
        .addMiddleware(observer)
        .addTool({
          name: "echo",
          description: "echo",
          schema: { type: "object" },
          run: (input) => `got ${JSON.stringify(input)}`,
        })
        .prompt("call echo");

      const ops = events.map((e) => `${e.op}:${e.phase}`);
      // Two LLM calls + one tool call, each with pre+post.
      expect(ops).toEqual([
        "llm_request:pre",
        "llm_request:post",
        "tool_call:pre",
        "tool_call:post",
        "llm_request:pre",
        "llm_request:post",
      ]);
      const toolPre = events[2]!;
      expect(toolPre.tool).toBe("echo");
      expect(toolPre.args).toEqual({ x: 1 });
      const toolPost = events[3]!;
      expect(toolPost.result).toBe('got {"x":1}');
      expect(toolPost.err).toBeUndefined();
    } finally {
      server.stop();
    }
  });
});
