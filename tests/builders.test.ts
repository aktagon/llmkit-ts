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
} from "../src/builders/builders.ts";
import type {
  File,
  Message,
  Response,
  BatchHandle,
  Tool,
  ImageData,
  ImageResponse,
  Part,
  MiddlewareFn,
} from "../src/builders/builders.ts";

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

// TestTerminals_Throw confirms every phase-2b terminal throws the
// "not yet implemented" sentinel — phase 3 will replace each with a
// real wired implementation.
describe("Terminals — throw stubs", () => {
  test("Text.prompt rejects", async () => {
    await expect(google("k").text.prompt("hi")).rejects.toThrow(
      /Text.prompt not yet implemented/,
    );
  });

  test("Text.stream throws on first iteration", async () => {
    const iter = google("k").text.stream("hi");
    let caught: unknown;
    try {
      for await (const _ of iter) {
        // unreachable
      }
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/Text.stream not yet implemented/);
  });

  test("Text.batch rejects", async () => {
    await expect(google("k").text.batch("p1", "p2")).rejects.toThrow(
      /Text.batch not yet implemented/,
    );
  });

  test("Text.submitBatch rejects", async () => {
    await expect(google("k").text.submitBatch("p1")).rejects.toThrow(
      /Text.submitBatch not yet implemented/,
    );
  });

  test("Image.generate rejects", async () => {
    await expect(google("k").image.generate("a banana")).rejects.toThrow(
      /Image.generate not yet implemented/,
    );
  });

  test("Agent.prompt rejects", async () => {
    await expect(google("k").agent.prompt("hi")).rejects.toThrow(
      /Agent.prompt not yet implemented/,
    );
  });

  test("Agent.reset throws", () => {
    expect(() => google("k").agent.reset()).toThrow(
      /Agent.reset not yet implemented/,
    );
  });

  test("Upload.run rejects", async () => {
    await expect(google("k").upload.run()).rejects.toThrow(
      /Upload.run not yet implemented/,
    );
  });
});

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
    const _resp: Response = {
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
    const _bh: BatchHandle = {
      id: "id",
      provider: { name: "openai", apiKey: "k" },
    };
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
