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
import * as wi from "./wire_inputs.ts";

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
          request_id: "vid_test", // VID-007: Grok video-submit handle id
          candidates: [
            {
              content: {
                parts: [
                  { text: `{"color":"blue"}` },
                  { inlineData: { mimeType: "image/png", data: wi.wireImageEditGoogleFlashImageBase64 } },
                ],
              },
            },
          ],
          content: [{ type: "text", text: "done" }],
          data: [{ b64_json: wi.wireImageEditGoogleFlashImageBase64 }],
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

// Canonical inputs are single-sourced from ontology/wire-fixtures.ttl (plan
// 039) via the generated ./wire_inputs.ts consts. The schema omits "required"
// so the goldens witness EnforceStrict normalization (auto-required); it
// carries additionalProperties:false so Google's strip is witnessed too. See
// the Go driver comment (the minting reference).
const tinyPngBytes = Uint8Array.from(atob(wi.wireImageEditGoogleFlashImageBase64), (c) =>
  c.charCodeAt(0),
);

describe("request wire — cross-capability", () => {
  test("structured output (Google) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.google, "key");
      c.provider.baseUrl = m.url;
      await c.text
        .schema(wi.wireStructuredOutputSchema)
        .prompt(wi.wireStructuredOutputPrompt);
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
        .schema(wi.wireStructuredOutputSchema)
        .prompt(wi.wireStructuredOutputPrompt);
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
        .schema(wi.wireStructuredOutputSchema)
        .prompt(wi.wireStructuredOutputPrompt);
    } finally {
      m.stop();
    }
    // ADR-028 Open Questions: load-bearing headers assert in-driver. Without
    // this beta header Anthropic rejects output_format with a 400.
    expect(m.headers().get("anthropic-beta")).toBe("structured-outputs-2025-11-13");
    assertWireGolden("structured-output-anthropic", m.body());
  });

  // === Plan 039: nested-schema fixtures — the recursive normalization walk
  // (witness-lint first catch; see the Go drivers for the rationale). ===

  test("nested structured output (Google) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.google, "key");
      c.provider.baseUrl = m.url;
      await c.text
        .schema(wi.wireStructuredOutputNestedSchema)
        .prompt(wi.wireStructuredOutputNestedPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("structured-output-nested-google", m.body());
  });

  test("nested structured output (OpenAI) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.openai, "key");
      c.provider.baseUrl = m.url;
      await c.text
        .schema(wi.wireStructuredOutputNestedSchema)
        .prompt(wi.wireStructuredOutputNestedPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("structured-output-nested-openai", m.body());
  });

  test("nested structured output (Anthropic) matches shared golden + beta header", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.anthropic, "key");
      c.provider.baseUrl = m.url;
      await c.text
        .schema(wi.wireStructuredOutputNestedSchema)
        .prompt(wi.wireStructuredOutputNestedPrompt);
    } finally {
      m.stop();
    }
    expect(m.headers().get("anthropic-beta")).toBe("structured-outputs-2025-11-13");
    assertWireGolden("structured-output-nested-anthropic", m.body());
  });

  test("agent-path caching (Anthropic) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.anthropic, "key");
      c.provider.baseUrl = m.url;
      await c.agent.system(wi.wireCachingSystem).caching().prompt(wi.wireCachingPrompt);
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
      await c.text.system(wi.wireCachingSystem).caching().prompt(wi.wireCachingPrompt);
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
      await c.text.system(wi.wireCachingSystem).caching().submitBatch(wi.wireCachingPrompt);
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
      await c.text.model(wi.wireOptionsOpenaiGpt5Model).maxTokens(wi.wireOptionsOpenaiGpt5MaxTokens).reasoningEffort(wi.wireOptionsOpenaiGpt5ReasoningEffort).seed(wi.wireOptionsOpenaiGpt5Seed)
        .prompt(wi.wireOptionsOpenaiGpt5Prompt);
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
      await c.text.model(wi.wireOptionsOpenaiOSeriesModel).maxTokens(wi.wireOptionsOpenaiOSeriesMaxTokens).reasoningEffort(wi.wireOptionsOpenaiOSeriesReasoningEffort).seed(wi.wireOptionsOpenaiOSeriesSeed)
        .prompt(wi.wireOptionsOpenaiOSeriesPrompt);
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
      await c.text.model(wi.wireOptionsOpenaiGpt4oModel).maxTokens(wi.wireOptionsOpenaiGpt4oMaxTokens).temperature(wi.wireOptionsOpenaiGpt4oTemperature).topP(wi.wireOptionsOpenaiGpt4oTopP)
        .stopSequences(wi.wireOptionsOpenaiGpt4oStopSequences).seed(wi.wireOptionsOpenaiGpt4oSeed).frequencyPenalty(wi.wireOptionsOpenaiGpt4oFrequencyPenalty).presencePenalty(wi.wireOptionsOpenaiGpt4oPresencePenalty)
        .prompt(wi.wireOptionsOpenaiGpt4oPrompt);
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
      await c.text.model(wi.wireOptionsAnthropicModel).maxTokens(wi.wireOptionsAnthropicMaxTokens).thinkingBudget(wi.wireOptionsAnthropicThinkingBudget)
        .stopSequences(wi.wireOptionsAnthropicStopSequences)
        .prompt(wi.wireOptionsAnthropicPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("options-anthropic", m.body());
  });

  test("options (Anthropic plain, thinking off) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.anthropic, "key");
      c.provider.baseUrl = m.url;
      await c.text.model(wi.wireOptionsAnthropicPlainModel).maxTokens(wi.wireOptionsAnthropicPlainMaxTokens)
        .temperature(wi.wireOptionsAnthropicPlainTemperature).topK(wi.wireOptionsAnthropicPlainTopK)
        .stopSequences(wi.wireOptionsAnthropicPlainStopSequences)
        .prompt(wi.wireOptionsAnthropicPlainPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("options-anthropic-plain", m.body());
  });

  test("options (Anthropic adaptive thinking) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.anthropic, "key");
      c.provider.baseUrl = m.url;
      await c.text.model(wi.wireOptionsAnthropicAdaptiveModel).maxTokens(wi.wireOptionsAnthropicAdaptiveMaxTokens)
        .reasoningEffort(wi.wireOptionsAnthropicAdaptiveReasoningEffort)
        .stopSequences(wi.wireOptionsAnthropicAdaptiveStopSequences)
        .prompt(wi.wireOptionsAnthropicAdaptivePrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("options-anthropic-adaptive", m.body());
  });

  test("options (Google gemini-3.5) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.google, "key");
      c.provider.baseUrl = m.url;
      await c.text.model(wi.wireOptionsGoogleModel).maxTokens(wi.wireOptionsGoogleMaxTokens).temperature(wi.wireOptionsGoogleTemperature).topP(wi.wireOptionsGoogleTopP).topK(wi.wireOptionsGoogleTopK)
        .stopSequences(wi.wireOptionsGoogleStopSequences).seed(wi.wireOptionsGoogleSeed)
        .reasoningEffort(wi.wireOptionsGoogleReasoningEffort)
        .safetySettings([{ category: wi.wireOptionsGoogleSafetyCategory, threshold: wi.wireOptionsGoogleSafetyThreshold }])
        .prompt(wi.wireOptionsGooglePrompt);
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
      await c.text.model(wi.wireOptionsGoogleGemini25Model).maxTokens(wi.wireOptionsGoogleGemini25MaxTokens).temperature(wi.wireOptionsGoogleGemini25Temperature).thinkingBudget(wi.wireOptionsGoogleGemini25ThinkingBudget)
        .prompt(wi.wireOptionsGoogleGemini25Prompt);
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
      await c.image.model(wi.wireImageGenGoogleFlashModel).aspectRatio(wi.wireImageGenGoogleFlashAspectRatio).imageSize(wi.wireImageGenGoogleFlashImageSize)
        .generate(wi.wireImageGenGoogleFlashPrompt);
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
      await c.image.model(wi.wireImageGenGoogleProModel).aspectRatio(wi.wireImageGenGoogleProAspectRatio).imageSize(wi.wireImageGenGoogleProImageSize)
        .includeText()
        .generate(wi.wireImageGenGoogleProPrompt);
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
      await c.image.model(wi.wireImageGenOpenaiModel).imageSize(wi.wireImageGenOpenaiImageSize).quality(wi.wireImageGenOpenaiQuality)
        .outputFormat(wi.wireImageGenOpenaiOutputFormat).background(wi.wireImageGenOpenaiBackground).count(wi.wireImageGenOpenaiCount)
        .generate(wi.wireImageGenOpenaiPrompt);
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
      await c.image.model(wi.wireImageEditGoogleFlashModel).image(wi.wireImageEditGoogleFlashImageMime, tinyPngBytes)
        .generate(wi.wireImageEditGoogleFlashPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("image-edit-google-flash", m.body());
  });

  // ADR-034 / VID-007: video-submit body {model, prompt}. The async
  // VideoHandle is discarded — only the outbound submit bytes are asserted.
  test("video submit (Grok) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.grok, "key");
      c.provider.baseUrl = m.url;
      await c.video.model(wi.wireVideoGrokModel).submit(wi.wireVideoGrokPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("video-grok", m.body());
  });

  // ADR-034 fan-out: Zhipu CogVideoX video-submit body {model, prompt} —
  // structurally identical to Grok's (the shared {model, prompt} arm); the
  // lifecycle divergence is delivery-side, covered by the unit tests.
  test("video submit (Zhipu) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.zhipu, "key");
      c.provider.baseUrl = m.url;
      await c.video
        .model(wi.wireVideoZhipuModel)
        .submit(wi.wireVideoZhipuPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("video-zhipu", m.body());
  });
});
