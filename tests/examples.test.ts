// Smoke runner for ts/examples/*.ts.
//
// Each example exports `main(client?: Client)`. The test constructs a
// real Client from the appropriate provider factory, pins
// `provider.baseUrl` to a mock HTTP server serving a canned response,
// and runs `main(client)`.
//
// This catches the README/example bug class that typecheck-only checks
// miss:
//   * builder access form — `c.text()` vs `c.text` (TypeError at runtime)
//   * Response field naming — `resp.usage` vs `resp.usage` (undefined)
//   * builder surface — calling `Agent.history(...)` (TypeError)
//   * ImageData field — `images[0].data` vs `images[0].bytes`
//
// Mock servers reuse the `Bun.serve` pattern from tests/builders.test.ts.

import { describe, test } from "bun:test";
import { anthropic, google, openai, vertex } from "../src/builders/index.ts";
import { main as quickstartMain } from "../examples/quickstart.ts";
import { main as agentMain } from "../examples/agent.ts";
import { main as streamingMain } from "../examples/streaming.ts";
import { main as imageMain } from "../examples/image.ts";
import { main as uploadMain } from "../examples/upload.ts";
import { main as middlewareMain } from "../examples/middleware.ts";
import { main as catalogueMain } from "../examples/catalogue.ts";
import { main as musicMain } from "../examples/music.ts";
import { main as batchMain } from "../examples/batch.ts";
import { main as cachingMain } from "../examples/caching.ts";
import { main as reasoningMain } from "../examples/reasoning.ts";

// ---------- mock servers ----------------------------------------------------

function startJsonServer(body: unknown): { url: string; stop: () => void } {
  const payload = JSON.stringify(body);
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      // Drain the body so the client's write side completes.
      await req.text();
      return new Response(payload, {
        headers: { "content-type": "application/json" },
      });
    },
  });
  return {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
  };
}

function startSseServer(events: string[]): { url: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch() {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          for (const e of events) controller.enqueue(enc.encode(e + "\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  return {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
  };
}

// ---------- canned response bodies -----------------------------------------

const anthropicOk = {
  content: [{ type: "text", text: "ok" }],
  usage: { input_tokens: 1, output_tokens: 1 },
  stop_reason: "end_turn",
};

const openaiFileOk = { id: "file-zzz", object: "file", filename: "x" };

function googleImageResponse() {
  // base64 of a tiny PNG header stub
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const encoded = btoa(bin);
  return {
    candidates: [
      {
        content: {
          parts: [{ inlineData: { mimeType: "image/png", data: encoded } }],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10 },
  };
}

const anthropicModels = {
  data: [
    {
      type: "model",
      id: "claude-opus-4-7",
      display_name: "Claude Opus 4.7",
      created_at: "2026-04-14T00:00:00Z",
      max_input_tokens: 1000000,
      max_tokens: 128000,
    },
  ],
  has_more: false,
  last_id: "claude-opus-4-7",
};

const anthropicCachingOk = {
  content: [{ type: "text", text: "ok" }],
  usage: {
    input_tokens: 10,
    output_tokens: 2,
    cache_creation_input_tokens: 100,
    cache_read_input_tokens: 50,
  },
  stop_reason: "end_turn",
};

const openaiReasoningOk = {
  choices: [{ message: { content: "30, 60, 90 — three of them" } }],
  usage: {
    prompt_tokens: 40,
    completion_tokens: 25,
    completion_tokens_details: { reasoning_tokens: 17 },
  },
};

function vertexMusicResponse() {
  // base64 of a tiny WAV header stub
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03]);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const encoded = btoa(bin);
  return {
    predictions: [{ audioContent: encoded, mimeType: "audio/wav" }],
  };
}

// Anthropic batch is a three-hop flow (submit -> poll -> results), so it
// needs a path-routing server rather than a single canned body.
function startAnthropicBatchServer(): { url: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      await req.text();
      if (
        req.method === "POST" &&
        url.pathname === "/v1/messages/batches"
      ) {
        return new Response(
          JSON.stringify({ id: "batch_xyz", processing_status: "ended" }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === "/v1/messages/batches/batch_xyz") {
        return new Response(
          JSON.stringify({ id: "batch_xyz", processing_status: "ended" }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === "/v1/messages/batches/batch_xyz/results") {
        const lines = [
          { custom_id: "req-0", text: "bonjour" },
          { custom_id: "req-1", text: "hola" },
          { custom_id: "req-2", text: "hallo" },
        ]
          .map((r) =>
            JSON.stringify({
              custom_id: r.custom_id,
              result: {
                message: {
                  content: [{ type: "text", text: r.text }],
                  usage: { input_tokens: 1, output_tokens: 1 },
                },
              },
            }),
          )
          .join("\n");
        return new Response(lines, {
          headers: { "content-type": "application/x-ndjson" },
        });
      }
      return new Response("unexpected", { status: 500 });
    },
  });
  return {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
  };
}

const anthropicSse = [
  "event: content_block_delta",
  'data: {"delta":{"text":"Hi"}}',
  "",
  "event: message_delta",
  'data: {"usage":{"output_tokens":1}}',
  "",
  "event: message_stop",
  'data: {"type":"message_stop","stop_reason":"end_turn"}',
];

// ---------- tests -----------------------------------------------------------

describe("examples — runnable snippets stay aligned with the API", () => {
  test("quickstart runs", async () => {
    const server = startJsonServer(anthropicOk);
    try {
      const c = anthropic("k");
      c.provider.baseUrl = server.url;
      await quickstartMain(c);
    } finally {
      server.stop();
    }
  });

  test("agent runs", async () => {
    const server = startJsonServer(anthropicOk);
    try {
      const c = anthropic("k");
      c.provider.baseUrl = server.url;
      await agentMain(c);
    } finally {
      server.stop();
    }
  });

  test("streaming runs", async () => {
    const server = startSseServer(anthropicSse);
    try {
      const c = anthropic("k");
      c.provider.baseUrl = server.url;
      await streamingMain(c);
    } finally {
      server.stop();
    }
  });

  test("image runs", async () => {
    const server = startJsonServer(googleImageResponse());
    const cwd = process.cwd();
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const pathMod = await import("node:path");
    const dir = await fs.mkdtemp(pathMod.join(os.tmpdir(), "llmkit-ex-img-"));
    process.chdir(dir);
    try {
      const c = google("k");
      c.provider.baseUrl = server.url;
      await imageMain(c);
      // Confirm the example actually wrote the file.
      await fs.access(pathMod.join(dir, "out.png"));
    } finally {
      process.chdir(cwd);
      await fs.rm(dir, { recursive: true, force: true });
      server.stop();
    }
  });

  test("upload runs", async () => {
    const server = startJsonServer(openaiFileOk);
    const cwd = process.cwd();
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const pathMod = await import("node:path");
    const dir = await fs.mkdtemp(pathMod.join(os.tmpdir(), "llmkit-ex-up-"));
    await fs.writeFile(pathMod.join(dir, "data.pdf"), "%PDF-1.4 stub");
    process.chdir(dir);
    try {
      const c = openai("k");
      c.provider.baseUrl = server.url;
      await uploadMain(c);
    } finally {
      process.chdir(cwd);
      await fs.rm(dir, { recursive: true, force: true });
      server.stop();
    }
  });

  test("middleware runs", async () => {
    const server = startJsonServer(anthropicOk);
    try {
      const c = anthropic("k");
      c.provider.baseUrl = server.url;
      await middlewareMain(c);
    } finally {
      server.stop();
    }
  });

  test("catalogue runs", async () => {
    // The catalogue's scoped/raw HTTP path resolves the URL from the
    // *user-supplied* Provider, not the Client's pinned baseUrl, so
    // startJsonServer + baseUrl pinning isn't sufficient. Intercept
    // fetch globally (mirrors tests/catalogue_http.test.ts).
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (!url.includes("/v1/models")) {
        throw new Error(`unexpected catalogue url: ${url}`);
      }
      return Promise.resolve(
        new Response(JSON.stringify(anthropicModels), {
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
    try {
      await catalogueMain(anthropic("k"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("music runs", async () => {
    const server = startJsonServer(vertexMusicResponse());
    const cwd = process.cwd();
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const pathMod = await import("node:path");
    const dir = await fs.mkdtemp(pathMod.join(os.tmpdir(), "llmkit-ex-mus-"));
    process.chdir(dir);
    try {
      const c = vertex("k");
      c.provider.baseUrl = server.url;
      await musicMain(c);
      await fs.access(pathMod.join(dir, "out.wav"));
    } finally {
      process.chdir(cwd);
      await fs.rm(dir, { recursive: true, force: true });
      server.stop();
    }
  });

  test("batch runs", async () => {
    const server = startAnthropicBatchServer();
    try {
      const c = anthropic("k");
      c.provider.baseUrl = server.url;
      await batchMain(c);
    } finally {
      server.stop();
    }
  });

  test("caching runs", async () => {
    const server = startJsonServer(anthropicCachingOk);
    try {
      const c = anthropic("k");
      c.provider.baseUrl = server.url;
      await cachingMain(c);
    } finally {
      server.stop();
    }
  });

  test("reasoning runs", async () => {
    const server = startJsonServer(openaiReasoningOk);
    try {
      const c = openai("k");
      c.provider.baseUrl = server.url;
      await reasoningMain(c);
    } finally {
      server.stop();
    }
  });
});
