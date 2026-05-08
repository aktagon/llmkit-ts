import { describe, test, expect } from "bun:test";
import {
  Client,
  newClient,
  ai21,
  anthropic,
  azure,
  bedrock,
  cerebras,
  cohere,
  deepseek,
  doubao,
  ernie,
  fireworks,
  google,
  grok,
  groq,
  lmstudio,
  minimax,
  mistral,
  moonshot,
  ollama,
  openai,
  openrouter,
  perplexity,
  qwen,
  sambanova,
  together,
  vllm,
  yi,
  zhipu,
  Text,
  Image,
  Agent,
  Upload,
  BatchHandle,
} from "../src/builders/index.ts";
import type {
  File,
  Message,
  Response as PromptResponse,
  Tool,
  ImageData,
  ImageResponse,
  Part,
  MiddlewareFn,
} from "../src/builders/index.ts";

const noopMiddleware: MiddlewareFn = () => null;

// TestSurface_Chains exercises every chain method on every builder
// and asserts the chained config lands in the right field. Phase 2b
// emits chain bodies that clone-then-mutate; this test verifies the
// mutation actually happens.
describe("Surface — chains", () => {
  test("Text", () => {
    const c = google("k");
    expect(c).toBeInstanceOf(Client);
    expect(c.text).toBeInstanceOf(Text);
    expect(c.image).toBeInstanceOf(Image);
    expect(c.agent).toBeInstanceOf(Agent);
    expect(c.upload).toBeInstanceOf(Upload);

    const text = c.text
      .caching()
      .file("file-id")
      .history({ role: "user", content: "earlier" })
      .image("image/png", new Uint8Array([0xff]))
      .maxTokens(42)
      .middleware(noopMiddleware)
      .model("text-model")
      .schema(`{"type":"object"}`)
      .system("you are a tutor")
      .temperature(0.7)
      .text("hello");

    expect(text._caching).toBe(true);
    expect(text._files).toEqual([
      { id: "file-id", uri: "", name: "", mimeType: "" },
    ]);
    expect(text._history).toEqual([{ role: "user", content: "earlier" }]);
    expect(text._maxTokens).toBe(42);
    expect(text._middleware).toHaveLength(1);
    expect(text._model).toBe("text-model");
    expect(text._schema).toBe(`{"type":"object"}`);
    expect(text._system).toBe("you are a tutor");
    expect(text._temperature).toBe(0.7);
    expect(text._parts).toHaveLength(2);
    expect(text._parts[0]).toEqual({
      image: { mimeType: "image/png", bytes: new Uint8Array([0xff]) },
    });
    expect(text._parts[1]).toEqual({ text: "hello" });
  });

  test("Image", () => {
    const c = google("k");
    const img = c.image
      .aspectRatio("16:9")
      .caching()
      .image("image/png", new Uint8Array([0xff]))
      .imageSize("2K")
      .includeText()
      .middleware(noopMiddleware)
      .model("img-model")
      .text("compose");

    expect(img._aspectRatio).toBe("16:9");
    expect(img._caching).toBe(true);
    expect(img._imageSize).toBe("2K");
    expect(img._includeText).toBe(true);
    expect(img._middleware).toHaveLength(1);
    expect(img._model).toBe("img-model");
    expect(img._parts).toHaveLength(2);
  });

  test("Agent", () => {
    const c = google("k");
    const tool: Tool = {
      name: "calc",
      description: "calculator",
      schema: { type: "object" },
      run: () => "42",
    };
    const ag = c.agent
      .caching()
      .maxTokens(1)
      .middleware(noopMiddleware)
      .model("a")
      .system("sys")
      .temperature(0.5)
      .tool(tool);

    expect(ag._caching).toBe(true);
    expect(ag._maxTokens).toBe(1);
    expect(ag._middleware).toHaveLength(1);
    expect(ag._model).toBe("a");
    expect(ag._system).toBe("sys");
    expect(ag._temperature).toBe(0.5);
    expect(ag._tools).toEqual([tool]);
  });

  test("Upload", () => {
    const c = google("k");
    const up = c.upload
      .bytes(new Uint8Array([104, 105]))
      .filename("f")
      .middleware(noopMiddleware)
      .mimeType("text/plain")
      .path("/tmp/x");

    expect(Array.from(up._bytes)).toEqual([104, 105]);
    expect(up._filename).toBe("f");
    expect(up._middleware).toHaveLength(1);
    expect(up._mimeType).toBe("text/plain");
    expect(up._path).toBe("/tmp/x");
  });
});

// TestSurface_Immutable confirms chain methods return a NEW instance —
// the prototype on Client never mutates.
describe("Surface — immutable", () => {
  test("chain method returns new instance", () => {
    const c = google("k");
    const original = c.text;
    const configured = original.system("hello");
    expect(original).not.toBe(configured);
    expect(original._system).toBe("");
    expect(configured._system).toBe("hello");
  });
});

// TestSurface_Constructors exercises every per-provider factory and
// the generic newClient escape hatch.
describe("Surface — constructors", () => {
  test("every provider factory + newClient", () => {
    const clients: Client[] = [
      newClient("custom", "k"),
      ai21("k"),
      anthropic("k"),
      azure("k"),
      bedrock("k"),
      cerebras("k"),
      cohere("k"),
      deepseek("k"),
      doubao("k"),
      ernie("k"),
      fireworks("k"),
      google("k"),
      grok("k"),
      groq("k"),
      lmstudio("k"),
      minimax("k"),
      mistral("k"),
      moonshot("k"),
      ollama("k"),
      openai("k"),
      openrouter("k"),
      perplexity("k"),
      qwen("k"),
      sambanova("k"),
      together("k"),
      vllm("k"),
      yi("k"),
      zhipu("k"),
    ];
    for (const c of clients) {
      expect(c).toBeInstanceOf(Client);
      expect(c.provider.apiKey).toBe("k");
    }
    expect(clients).toHaveLength(28);
  });
});

// TestTerminals_Throw confirms every still-stubbed phase-2b terminal
// throws the "not yet implemented" sentinel. Phase 3 slice 1 wired
// Text.prompt + Image.generate; their stub-sentinel tests have been
// replaced with mock-server verifications below. Remaining slices
// will continue retiring entries from this list.
describe("Terminals — throw stubs", () => {});

// TestSurface_TypeAliases verifies the public-facing aliased types are
// usable from outside the main llmkit package via builders.
describe("Surface — type aliases", () => {
  test("re-exported types are constructible", () => {
    const _msg: Message = { role: "user", content: "hi" };
    const _tool: Tool = {
      name: "t",
      description: "d",
      schema: {},
      run: () => "",
    };
    const _mw: MiddlewareFn = noopMiddleware;
    const _resp: PromptResponse = {
      text: "ok",
      tokens: {
        input: 0,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
        reasoning: 0,
      },
    };
    const _img: ImageResponse = {
      images: [],
      text: "",
      tokens: {
        input: 0,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
        reasoning: 0,
      },
    };
    const _imgData: ImageData = {
      mimeType: "image/png",
      bytes: new Uint8Array(0),
    };
    const _file: File = { id: "id", uri: "", name: "", mimeType: "" };
    const _part: Part = { text: "hello" };
    const _bh: BatchHandle = new BatchHandle("id", {
      name: "openai",
      apiKey: "k",
    });
    expect(_msg.role).toBe("user");
    expect(_tool.name).toBe("t");
    expect(_mw).toBe(noopMiddleware);
    expect(_resp.text).toBe("ok");
    expect(_img.images).toEqual([]);
    expect(_imgData.mimeType).toBe("image/png");
    expect(_file.id).toBe("id");
    expect(_part).toEqual({ text: "hello" });
    expect(_bh.id).toBe("id");
  });
});

// === Phase 3 slice 1 — wiring verification ===

function startMockServer(
  handler: (req: Request) => Response | Promise<Response>,
): { url: string; stop: () => void } {
  const server = Bun.serve({ port: 0, fetch: handler });
  return {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
  };
}

const anthropicResp = JSON.stringify({
  content: [{ type: "text", text: "ok" }],
  usage: { input_tokens: 1, output_tokens: 1 },
});

const googleImageResp = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: "AAAA",
            },
          },
        ],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 },
});

describe("Phase 3 slice 1 — Text.prompt wired", () => {
  test("chain config produces a request body identical to legacy prompt", async () => {
    let captured: Record<string, unknown> | undefined;
    const server = startMockServer(async (req) => {
      captured = (await req.json()) as Record<string, unknown>;
      return new Response(anthropicResp, {
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const c = anthropic("k");
      c.provider.baseUrl = server.url;
      const resp = await c.text
        .system("be terse")
        .maxTokens(50)
        .temperature(0.7)
        .prompt("hello");
      expect(resp.text).toBe("ok");
    } finally {
      server.stop();
    }
    if (!captured) throw new Error("server never received a request body");
    expect(captured.system).toBe("be terse");
    expect(captured.max_tokens).toBe(50);
    expect(captured.temperature).toBe(0.7);
    // Anthropic body shape: messages: [{ role: "user", content: "hello" }]
    const messages = captured.messages as Array<{
      role: string;
      content: string;
    }>;
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("hello");
  });

  test("history accumulator lands as messages on the wire", async () => {
    let captured: Record<string, unknown> | undefined;
    const server = startMockServer(async (req) => {
      captured = (await req.json()) as Record<string, unknown>;
      return new Response(anthropicResp, {
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const c = anthropic("k");
      c.provider.baseUrl = server.url;
      await c.text
        .history(
          { role: "user", content: "earlier" },
          { role: "assistant", content: "ack" },
        )
        .prompt("now");
    } finally {
      server.stop();
    }
    if (!captured) throw new Error("server never received a request body");
    const messages = captured.messages as Array<{
      role: string;
      content: string;
    }>;
    expect(messages).toHaveLength(3);
    expect(messages[0]?.content).toBe("earlier");
    expect(messages[1]?.content).toBe("ack");
    expect(messages[2]?.content).toBe("now");
  });

  test("text-Part accumulator concatenates with finalText", async () => {
    let captured: Record<string, unknown> | undefined;
    const server = startMockServer(async (req) => {
      captured = (await req.json()) as Record<string, unknown>;
      return new Response(anthropicResp, {
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const c = anthropic("k");
      c.provider.baseUrl = server.url;
      await c.text.text("hello ").prompt("world");
    } finally {
      server.stop();
    }
    if (!captured) throw new Error("server never received a request body");
    const messages = captured.messages as Array<{
      role: string;
      content: string;
    }>;
    expect(messages[0]?.content).toBe("hello world");
  });
});

describe("Phase 3 slice 1 — Image.generate wired", () => {
  test("prompt sugar path serialises as a single text Part", async () => {
    let captured: Record<string, unknown> | undefined;
    const server = startMockServer(async (req) => {
      captured = (await req.json()) as Record<string, unknown>;
      return new Response(googleImageResp, {
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const c = google("k");
      c.provider.baseUrl = server.url;
      const resp = await c.image
        .model("gemini-3.1-flash-image-preview")
        .aspectRatio("1:1")
        .imageSize("1K")
        .generate("a banana");
      expect(resp.images).toHaveLength(1);
      expect(resp.images[0]?.mimeType).toBe("image/png");
    } finally {
      server.stop();
    }
    if (!captured) throw new Error("server never received a request body");
    const contents = captured.contents as Array<{
      parts: Array<Record<string, unknown>>;
    }>;
    expect(contents[0]?.parts).toEqual([{ text: "a banana" }]);
  });

  test("chain-accumulated parts are sent verbatim, finalText appended", async () => {
    let captured: Record<string, unknown> | undefined;
    const server = startMockServer(async (req) => {
      captured = (await req.json()) as Record<string, unknown>;
      return new Response(googleImageResp, {
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const c = google("k");
      c.provider.baseUrl = server.url;
      await c.image
        .model("gemini-3.1-flash-image-preview")
        .image("image/png", new Uint8Array([0xff, 0xfe]))
        .text("compose:")
        .generate("trailing");
    } finally {
      server.stop();
    }
    if (!captured) throw new Error("server never received a request body");
    const contents = captured.contents as Array<{
      parts: Array<Record<string, unknown>>;
    }>;
    const parts = contents[0]?.parts ?? [];
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatchObject({
      inlineData: { mimeType: "image/png" },
    });
    expect(parts[1]).toEqual({ text: "compose:" });
    expect(parts[2]).toEqual({ text: "trailing" });
  });
});

// === Phase 3 slice 2a — wiring verification ===

describe("Phase 3 slice 2a — Text.batch + Text.submitBatch wired", () => {
  test("submitBatch posts inline batch payload, returns BatchHandle class", async () => {
    let captured: Record<string, unknown> | undefined;
    let capturedUrl = "";
    const server = startMockServer(async (req) => {
      capturedUrl = new URL(req.url).pathname;
      captured = (await req.json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "msgbatch_123" }), {
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const c = anthropic("k");
      c.provider.baseUrl = server.url;
      const handle = await c.text.system("be terse").submitBatch("p1", "p2");
      expect(handle).toBeInstanceOf(BatchHandle);
      expect(handle.id).toBe("msgbatch_123");
      expect(handle.provider.name).toBe("anthropic");
    } finally {
      server.stop();
    }
    expect(capturedUrl).toBe("/v1/messages/batches");
    if (!captured) throw new Error("server never received a request body");
    // Anthropic batch shape: {requests: [{custom_id, params: {...body...}}]}
    const requests = captured.requests as Array<{
      custom_id: string;
      params: Record<string, unknown>;
    }>;
    expect(requests).toHaveLength(2);
    expect(requests[0]?.custom_id).toBe("req-0");
    expect(requests[1]?.custom_id).toBe("req-1");
    expect(requests[0]?.params.system).toBe("be terse");
    // Note: legacy TS batch doesn't propagate per-request options
    // (`maxTokens`, `temperature`); see batch.ts:190 which passes
    // an empty options object to buildRequest. Tracked as plan-016
    // OQ-2 follow-up — fix in a later slice or phase 4.
  });

  test("BatchHandle.wait polls then fetches results", async () => {
    let pollCalls = 0;
    const resultLine = JSON.stringify({
      custom_id: "req-0",
      result: {
        message: {
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    });
    const server = startMockServer(async (req) => {
      const path = new URL(req.url).pathname;
      if (path.endsWith("/results")) {
        return new Response(resultLine + "\n", {
          headers: { "content-type": "application/x-jsonl" },
        });
      }
      pollCalls += 1;
      return new Response(
        JSON.stringify({ id: "msgbatch_123", processing_status: "ended" }),
        { headers: { "content-type": "application/json" } },
      );
    });
    try {
      const handle = new BatchHandle("msgbatch_123", {
        name: "anthropic",
        apiKey: "k",
        baseUrl: server.url,
      });
      const responses = await handle.wait({ pollIntervalMs: 1 });
      expect(responses).toHaveLength(1);
      expect(responses[0]?.text).toBe("ok");
    } finally {
      server.stop();
    }
    expect(pollCalls).toBeGreaterThanOrEqual(1);
  });

  test("Text.batch sends payload and parses results in one call", async () => {
    const resultLine = JSON.stringify({
      custom_id: "req-0",
      result: {
        message: {
          content: [{ type: "text", text: "answer" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    });
    const server = startMockServer(async (req) => {
      const path = new URL(req.url).pathname;
      if (path.endsWith("/results")) {
        return new Response(resultLine + "\n", {
          headers: { "content-type": "application/x-jsonl" },
        });
      }
      if (req.method === "POST") {
        return new Response(JSON.stringify({ id: "msgbatch_xyz" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ id: "msgbatch_xyz", processing_status: "ended" }),
        { headers: { "content-type": "application/json" } },
      );
    });
    try {
      const c = anthropic("k");
      c.provider.baseUrl = server.url;
      const responses = await c.text.maxTokens(10).batch("only-one");
      expect(responses).toHaveLength(1);
      expect(responses[0]?.text).toBe("answer");
    } finally {
      server.stop();
    }
  });
});

describe("Phase 3 slice 2a — Upload.run wired", () => {
  test("bytes path uploads multipart form", async () => {
    let capturedPath = "";
    let capturedMethod = "";
    const server = startMockServer(async (req) => {
      capturedPath = new URL(req.url).pathname;
      capturedMethod = req.method;
      return new Response(
        JSON.stringify({
          id: "file-abc",
          filename: "data.bin",
          mime_type: "application/octet-stream",
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    try {
      const c = openai("k");
      c.provider.baseUrl = server.url;
      const file = await c.upload
        .bytes(new Uint8Array([1, 2, 3]))
        .filename("data.bin")
        .run();
      expect(file.id).toBe("file-abc");
      expect(file.name).toBe("data.bin");
    } finally {
      server.stop();
    }
    expect(capturedMethod).toBe("POST");
    expect(capturedPath).toBe("/v1/files");
  });

  test("validation: empty bytes and empty path rejects", async () => {
    await expect(openai("k").upload.run()).rejects.toThrow(
      /exactly one of bytes\(\) or path\(\) must be set/,
    );
  });

  test("validation: both bytes and path rejects", async () => {
    await expect(
      openai("k")
        .upload.bytes(new Uint8Array([1]))
        .path("/x")
        .run(),
    ).rejects.toThrow(/mutually exclusive/);
  });

  test("validation: path-only is deferred to TS slice follow-up", async () => {
    await expect(openai("k").upload.path("/x").run()).rejects.toThrow(
      /not yet wired/,
    );
  });
});

// === Phase 3 slice 2b — Text.stream wired ===

describe("Phase 3 slice 2b — Text.stream wired", () => {
  test("OpenAI SSE chunks arrive in order through the AsyncIterable", async () => {
    const events = [
      `data: {"choices":[{"delta":{"content":"Hel"}}]}`,
      `data: {"choices":[{"delta":{"content":"lo "}}]}`,
      `data: {"choices":[{"delta":{"content":"world"}}]}`,
      `data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":1,"completion_tokens":3}}`,
      `data: [DONE]`,
    ];
    const server = startMockServer(() => {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          for (const e of events) {
            controller.enqueue(enc.encode(e + "\n\n"));
          }
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    });
    try {
      const c = openai("k");
      c.provider.baseUrl = server.url;
      const got: string[] = [];
      for await (const chunk of c.text.stream("hi")) {
        got.push(chunk);
      }
      expect(got).toEqual(["Hel", "lo ", "world"]);
    } finally {
      server.stop();
    }
  });

  test("consumer break aborts the producer cleanly", async () => {
    // Mock server emits chunks slowly so we can break mid-stream.
    const server = startMockServer(() => {
      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(
            enc.encode(`data: {"choices":[{"delta":{"content":"a"}}]}\n\n`),
          );
          await new Promise((r) => setTimeout(r, 10));
          controller.enqueue(
            enc.encode(`data: {"choices":[{"delta":{"content":"b"}}]}\n\n`),
          );
          await new Promise((r) => setTimeout(r, 50));
          // Producer would continue, but consumer should abort first.
          try {
            controller.enqueue(
              enc.encode(`data: {"choices":[{"delta":{"content":"c"}}]}\n\n`),
            );
            controller.close();
          } catch {
            // Stream cancelled by client — expected.
          }
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    });
    try {
      const c = openai("k");
      c.provider.baseUrl = server.url;
      const got: string[] = [];
      for await (const chunk of c.text.stream("hi")) {
        got.push(chunk);
        if (got.length >= 1) break; // bail after first chunk
      }
      expect(got.length).toBeGreaterThanOrEqual(1);
      expect(got[0]).toBe("a");
    } finally {
      server.stop();
    }
  });
});

// === Phase 3 slice 2c — Agent.prompt + Agent.reset wired ===

import { Agent as LegacyAgent } from "../src/agent.ts";
import { AgentState } from "../src/builders/agent.ts";

describe("Phase 3 slice 2c — Agent.prompt + Agent.reset wired", () => {
  test("Agent.prompt initializes state on first call, reuses on second", async () => {
    let calls = 0;
    const server = startMockServer(async () => {
      calls += 1;
      return new Response(anthropicResp, {
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const c = anthropic("k");
      c.provider.baseUrl = server.url;
      const bot = c.agent.system("you are terse");
      expect(bot._state).toBeUndefined();
      const r1 = await bot.prompt("hi");
      expect(r1.text).toBe("ok");
      expect(bot._state).toBeDefined();
      const stateAfterFirst = bot._state;
      const r2 = await bot.prompt("again");
      expect(r2.text).toBe("ok");
      // Same state instance — history retained between Prompts on
      // the same builder.
      expect(bot._state).toBe(stateAfterFirst);
      expect(calls).toBe(2);
    } finally {
      server.stop();
    }
  });

  test("Agent.reset clears state; next prompt re-initializes", async () => {
    const server = startMockServer(async () => {
      return new Response(anthropicResp, {
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const c = anthropic("k");
      c.provider.baseUrl = server.url;
      const bot = c.agent.system("s");
      await bot.prompt("hi");
      expect(bot._state).toBeDefined();
      bot.reset();
      expect(bot._state).toBeUndefined();
      await bot.prompt("again");
      expect(bot._state).toBeDefined();
    } finally {
      server.stop();
    }
  });

  test("state forking — chain method on initialized Agent produces fresh-state clone", () => {
    // Load-bearing contract test for the codegen post-mutation hook
    // (TS_BUILDER_POST_MUTATION["Agent"] = "out._state = undefined").
    // Without it, a forked clone would silently share its parent's
    // accumulated history through the same AgentState reference.
    const c = anthropic("k");
    const bot = c.agent.system("orig");
    bot._state = new AgentState(
      new LegacyAgent({ name: "anthropic", apiKey: "k" }),
    );

    const forked = bot.system("new");
    expect(bot._state).toBeDefined(); // parent state preserved
    expect(forked._state).toBeUndefined(); // fork starts fresh
  });
});

// === A2 — bounded stream queue regression ===
//
// Server streams 200 SSE chunks as fast as it can write them. Consumer
// drains slowly (1ms sleep per chunk). With the bounded queue the
// producer-side `await emit(...)` parks the SSE reader after the cap
// (64) is reached, freeing it as the consumer drains. With the
// previous unbounded queue the producer raced ahead and the queue
// grew to ~200. We can't observe peak queue size from outside the
// closure, but we CAN verify the contract: every chunk arrives in
// order, none are lost, and the pipeline completes — which proves
// the bridge handles backpressure-induced producer pauses correctly.
describe("A2 — bounded stream queue", () => {
  test("delivers all 200 chunks in order under fast producer / slow consumer", async () => {
    const total = 200;

    // Bun.serve handler that streams 200 SSE data lines as fast as
    // it can flush them, then [DONE].
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        const stream = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            for (let i = 0; i < total; i++) {
              controller.enqueue(
                enc.encode(
                  `data: {"choices":[{"delta":{"content":"${i} "}}]}\n\n`,
                ),
              );
            }
            controller.enqueue(
              enc.encode(
                `data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n`,
              ),
            );
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    const url = `http://localhost:${server.port}`;

    try {
      const c = openai("k");
      c.provider.baseUrl = url;
      const got: string[] = [];
      for await (const chunk of c.text.stream("hi")) {
        got.push(chunk);
        await new Promise((r) => setTimeout(r, 1));
      }
      expect(got.length).toBe(total);
      for (let i = 0; i < total; i++) {
        expect(got[i]).toBe(`${i} `);
      }
    } finally {
      server.stop(true);
    }
  });
});
