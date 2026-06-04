// Spike 036 (PIVOT wire-conformance): request-byte conformance, generalized
// across capabilities (structured output, agent-path caching). Asserts the
// OUTBOUND request body produced by buildRequest is value-equal to the shared
// golden at codegen/testdata/wire/request/v1/<fixture>.json — the SAME golden
// every SDK asserts against. These are the wires BUG-007 (TS silent no-op) and
// BUG-004 (agent-path caching dropped) broke.

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { newClient, Providers } from "../src/llmkit.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function goldenPath(fixture: string): string {
  return resolve(REPO_ROOT, "codegen", "testdata", "wire", "request", "v1", `${fixture}.json`);
}

function artifactPath(fixture: string): string {
  return resolve(REPO_ROOT, "target", "wire", "request", fixture, "ts.json");
}

function assertWireGolden(fixture: string, body: unknown): void {
  const out = artifactPath(fixture);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(body, null, 2));
  const golden = JSON.parse(readFileSync(goldenPath(fixture), "utf8"));
  expect(body).toEqual(golden);
}

// startMock returns a server that records the outbound JSON body plus request
// headers (headers feed the in-driver asserts for load-bearing headers, e.g.
// Anthropic's structured-output beta header) and answers with a shape valid
// for both the text and agent paths.
function startMock(): {
  url: string;
  stop: () => void;
  body: () => unknown;
  headers: () => Headers;
} {
  let captured: unknown = {};
  let capturedHeaders = new Headers();
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      captured = await req.json();
      capturedHeaders = req.headers;
      return new Response(
        JSON.stringify({
          id: "msgbatch_test",
          candidates: [{ content: { parts: [{ text: `{"color":"blue"}` }] } }],
          content: [{ type: "text", text: "done" }],
          usage: { input_tokens: 2000, output_tokens: 5 },
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
        }),
      );
    },
  });
  return {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
    body: () => captured,
    headers: () => capturedHeaders,
  };
}

// Omits "required" so the goldens witness EnforceStrict normalization
// (auto-required); carries additionalProperties:false so Google's strip is
// witnessed too. See the Go driver comment (the minting reference).
const canonicalStructuredOutputSchema = `{"type":"object","properties":{"color":{"type":"string"}},"additionalProperties":false}`;

const canonicalStructuredOutputPrompt = "What color is a clear daytime sky?";

describe("request wire — cross-capability", () => {
  test("structured output (Google) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.google, "key");
      c.provider.baseUrl = m.url;
      await c.text
        .schema(canonicalStructuredOutputSchema)
        .prompt(canonicalStructuredOutputPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("structured-output-google", m.body());
  });

  test("structured output (OpenAI) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.openai, "key");
      c.provider.baseUrl = m.url;
      await c.text
        .schema(canonicalStructuredOutputSchema)
        .prompt(canonicalStructuredOutputPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("structured-output-openai", m.body());
  });

  test("structured output (Anthropic) matches shared golden + beta header", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.anthropic, "key");
      c.provider.baseUrl = m.url;
      await c.text
        .schema(canonicalStructuredOutputSchema)
        .prompt(canonicalStructuredOutputPrompt);
    } finally {
      m.stop();
    }
    // ADR-028 Open Questions: load-bearing headers assert in-driver. Without
    // this beta header Anthropic rejects output_format with a 400.
    expect(m.headers().get("anthropic-beta")).toBe("structured-outputs-2025-11-13");
    assertWireGolden("structured-output-anthropic", m.body());
  });

  test("agent-path caching (Anthropic) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.anthropic, "key");
      c.provider.baseUrl = m.url;
      await c.agent.system("a long stable system prefix").caching().prompt("hi");
    } finally {
      m.stop();
    }
    assertWireGolden("caching-agent-anthropic", m.body());
  });

  test("text-path caching (Anthropic) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.anthropic, "key");
      c.provider.baseUrl = m.url;
      await c.text.system("a long stable system prefix").caching().prompt("hi");
    } finally {
      m.stop();
    }
    assertWireGolden("caching-text-anthropic", m.body());
  });

  test("batch-path caching (Anthropic) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.anthropic, "key");
      c.provider.baseUrl = m.url;
      await c.text.system("a long stable system prefix").caching().submitBatch("hi");
    } finally {
      m.stop();
    }
    assertWireGolden("caching-batch-anthropic", m.body());
  });
});
