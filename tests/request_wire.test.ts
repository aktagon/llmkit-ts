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
      // The inlineData part and the data[] array are the image-shaped fields
      // for the Google and OpenAI image paths (ADR-028 two-helper rule:
      // extend the canned response, don't add capture helpers).
      return new Response(
        JSON.stringify({
          id: "msgbatch_test",
          candidates: [
            {
              content: {
                parts: [
                  { text: `{"color":"blue"}` },
                  { inlineData: { mimeType: "image/png", data: TINY_PNG_BASE64 } },
                ],
              },
            },
          ],
          content: [{ type: "text", text: "done" }],
          data: [{ b64_json: TINY_PNG_BASE64 }],
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

// 69-byte 1x1 RGB PNG (single brick-red pixel) — the FIXED reference image
// for the image-edit fixture. SAME base64 constant in all four SDK drivers.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YWQEAALyAS2saifrAAAAAElFTkSuQmCC";

const tinyPngBytes = Uint8Array.from(atob(TINY_PNG_BASE64), (c) => c.charCodeAt(0));

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

  // === M2: options fixtures, one per model family (see the Go drivers — the
  // minting reference — for the WIRE-005 provenance notes and the live
  // rejection matrix that shaped each option chain). ===

  test("options (OpenAI gpt-5) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.openai, "key");
      c.provider.baseUrl = m.url;
      await c.text.model("gpt-5").maxTokens(1024).reasoningEffort("low").seed(42)
        .prompt("Summarize the plot of Hamlet in two sentences.");
    } finally {
      m.stop();
    }
    assertWireGolden("options-openai-gpt5", m.body());
  });

  test("options (OpenAI o-series) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.openai, "key");
      c.provider.baseUrl = m.url;
      await c.text.model("o4-mini").maxTokens(1024).reasoningEffort("medium").seed(7)
        .prompt("What is the capital of Finland?");
    } finally {
      m.stop();
    }
    assertWireGolden("options-openai-o-series", m.body());
  });

  test("options (OpenAI gpt-4o baseline) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.openai, "key");
      c.provider.baseUrl = m.url;
      await c.text.model("gpt-4o").maxTokens(256).temperature(0.7).topP(0.9)
        .stopSequences("END_OF_LIST").seed(42).frequencyPenalty(0.25).presencePenalty(0.15)
        .prompt("List three primary colors, then write END_OF_LIST.");
    } finally {
      m.stop();
    }
    assertWireGolden("options-openai-gpt4o", m.body());
  });

  test("options (Anthropic thinking) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.anthropic, "key");
      c.provider.baseUrl = m.url;
      await c.text.model("claude-sonnet-4-6").maxTokens(2048).thinkingBudget(1024)
        .stopSequences("END_OF_ANSWER")
        .prompt("Explain in one sentence why the sky appears blue at noon, then write END_OF_ANSWER.");
    } finally {
      m.stop();
    }
    assertWireGolden("options-anthropic", m.body());
  });

  test("options (Google gemini-3.5) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.google, "key");
      c.provider.baseUrl = m.url;
      await c.text.model("gemini-3.5-flash").maxTokens(1024).temperature(0.7).topP(0.9).topK(40)
        .stopSequences("END_OF_ANSWER").seed(7)
        .safetySettings([{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }])
        .prompt("Name the two largest moons of Jupiter, then write END_OF_ANSWER.");
    } finally {
      m.stop();
    }
    assertWireGolden("options-google", m.body());
  });

  test("options (Google gemini-2.5 thinking budget) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.google, "key");
      c.provider.baseUrl = m.url;
      await c.text.model("gemini-2.5-flash").maxTokens(1024).temperature(0.5).thinkingBudget(512)
        .prompt("How many planets orbit the Sun? Answer with a number.");
    } finally {
      m.stop();
    }
    assertWireGolden("options-google-gemini25", m.body());
  });

  // === M2: image-generation fixtures (M5 pull-forward, JSON bodies only;
  // multipart edits are a WIRE-008 documented exclusion). ===

  test("image gen (Google Flash) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.google, "key");
      c.provider.baseUrl = m.url;
      await c.image.model("gemini-3.1-flash-image-preview").aspectRatio("16:9").imageSize("2K")
        .generate("A lighthouse on a rocky coastline at dusk");
    } finally {
      m.stop();
    }
    assertWireGolden("image-gen-google-flash", m.body());
  });

  test("image gen (Google Pro, includeText) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.google, "key");
      c.provider.baseUrl = m.url;
      await c.image.model("gemini-3-pro-image-preview").aspectRatio("4:3").imageSize("1K")
        .includeText()
        .generate("A watercolor map of the Baltic Sea");
    } finally {
      m.stop();
    }
    assertWireGolden("image-gen-google-pro", m.body());
  });

  test("image gen (OpenAI gpt-image-2) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.openai, "key");
      c.provider.baseUrl = m.url;
      await c.image.model("gpt-image-2").imageSize("1024x1024").quality("low")
        .outputFormat("png").background("opaque").count(1)
        .generate("A minimalist line drawing of a sailboat");
    } finally {
      m.stop();
    }
    assertWireGolden("image-gen-openai", m.body());
  });

  test("image edit (Google Flash, inline reference) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.google, "key");
      c.provider.baseUrl = m.url;
      await c.image.model("gemini-3.1-flash-image-preview").image("image/png", tinyPngBytes)
        .generate("Recolor the square to deep blue");
    } finally {
      m.stop();
    }
    assertWireGolden("image-edit-google-flash", m.body());
  });
});
