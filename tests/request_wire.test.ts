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

import { newClient } from "../src/llmkit.ts";
// Providers (the slug map) is no longer on the public barrel (ADR-038 PMD-005,
// superseded by ProviderName); the request-wire driver reads it from the
// internal providers module.
import { Providers } from "../src/providers/providers.ts";
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
          task_id: "vid_test", // VideoMinimax: top-level task_id submit handle
          invocationArn: "arn:aws:bedrock:test:async-invoke/vid_test", // VideoBedrock submit handle
          name: "models/veo-test/operations/op_test", // VideoVeo: operation-name submit handle
          output: { task_id: "vid_test", task_status: "PENDING" }, // VideoQwen: output.task_id submit handle
          Resp: { video_id: 318633193768896 }, // VideoPixVerse: Resp.video_id submit handle (numeric)
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

  test("text + document (Anthropic) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.anthropic, "key");
      c.provider.baseUrl = m.url;
      await c.text
        .model(wi.wireAnthropicTextDocumentModel)
        .file(wi.wireAnthropicTextDocumentFileId)
        .prompt(wi.wireAnthropicTextDocumentPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("anthropic-text-document", m.body());
  });

  test("text + document (OpenAI) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.openai, "key");
      c.provider.baseUrl = m.url;
      await c.text
        .model(wi.wireOpenaiTextDocumentModel)
        .file(wi.wireOpenaiTextDocumentFileId)
        .prompt(wi.wireOpenaiTextDocumentPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("openai-text-document", m.body());
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

  // Recraft generations JSON body (JSONGenerations shape): {model, prompt,
  // size, n} plus the forced response_format=b64_json (Recraft defaults to
  // URL delivery; the SDK forces b64_json for a uniform decode path).
  test("image gen (Recraft) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.recraft, "key");
      c.provider.baseUrl = m.url;
      await c.image.model(wi.wireImageGenRecraftModel).imageSize(wi.wireImageGenRecraftImageSize).count(wi.wireImageGenRecraftCount)
        .generate(wi.wireImageGenRecraftPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("image-gen-recraft", m.body());
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

  // BUG-010: Grok image-to-video submit body {model, prompt, image:{url}}. The
  // seed frame inlines as a data URL at image.url (the same encoding the Grok
  // image-EDIT path uses); the text-to-video golden above has no image field.
  test("video submit (Grok, image-to-video) matches shared golden", async () => {
    const seed = Uint8Array.from(atob(wi.wireVideoGrokI2vImageBase64), (c) =>
      c.charCodeAt(0),
    );
    const m = startMock();
    try {
      const c = newClient(Providers.grok, "key");
      c.provider.baseUrl = m.url;
      await c.video
        .model(wi.wireVideoGrokI2vModel)
        .image(wi.wireVideoGrokI2vImageMime, seed)
        .submit(wi.wireVideoGrokI2vPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("video-grok-i2v", m.body());
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

  // ADR-034 fan-out: Vidu (Shengshu) video-submit body {model, prompt} —
  // structurally identical to Grok's/Zhipu's (the shared {model, prompt} arm);
  // the lifecycle divergence is delivery-side, covered by the unit tests.
  test("video submit (Vidu) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.vidu, "key");
      c.provider.baseUrl = m.url;
      await c.video
        .model(wi.wireVideoViduModel)
        .submit(wi.wireVideoViduPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("video-vidu", m.body());
  });

  // ADR-034 fan-out: PixVerse video-submit body {model, prompt, duration,
  // quality, aspect_ratio} — the dedicated PixVerse arm (all five fields
  // required); the dynamic Ai-trace-id header is omitted from the golden (it
  // is a per-request UUID) and asserted in the lifecycle unit tests.
  test("video submit (PixVerse) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.pixverse, "key");
      c.provider.baseUrl = m.url;
      await c.video
        .model(wi.wireVideoPixverseModel)
        .submit(wi.wireVideoPixversePrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("video-pixverse", m.body());
  });

  // ADR-034 fan-out: Together video-submit body {model, prompt} —
  // structurally identical to Grok's/Zhipu's (the shared {model, prompt} arm);
  // the lifecycle divergence is delivery-side, covered by the unit tests.
  test("video submit (Together) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.together, "key");
      c.provider.baseUrl = m.url;
      await c.video
        .model(wi.wireVideoTogetherModel)
        .submit(wi.wireVideoTogetherPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("video-together", m.body());
  });

  // ADR-034 fan-out: Qwen (DashScope) video-submit body is the NESTED
  // {model, input:{prompt}} shape — the first divergent submit body. Also
  // asserts the load-bearing X-DashScope-Async: enable header in-driver
  // (mirrors the Anthropic beta-header assert).
  test("video submit (Qwen) matches shared golden + async header", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.qwen, "key");
      c.provider.baseUrl = m.url;
      await c.video.model(wi.wireVideoQwenModel).submit(wi.wireVideoQwenPrompt);
    } finally {
      m.stop();
    }
    expect(m.headers().get("x-dashscope-async")).toBe("enable");
    assertWireGolden("video-qwen", m.body());
  });

  // ADR-034 fan-out: MiniMax video-submit body is the shared {model, prompt}.
  // The two-hop result (poll file_id -> file-retrieve download_url) is
  // delivery-side, covered by the unit tests.
  test("video submit (MiniMax) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.minimax, "key");
      c.provider.baseUrl = m.url;
      await c.video
        .model(wi.wireVideoMinimaxModel)
        .submit(wi.wireVideoMinimaxPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("video-minimax", m.body());
  });

  // ADR-034 fan-out: Google Veo video-submit body is the nested
  // {instances:[{prompt}]} shape — the first video-submit body with NO model
  // field, because Veo carries the model in the submit PATH
  // (/v1beta/models/{model}:predictLongRunning). The LRO lifecycle and ?key=
  // query-param auth are delivery-side, covered by the unit tests.
  test("video submit (Veo) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.google, "key");
      c.provider.baseUrl = m.url;
      await c.video
        .model(wi.wireVideoGoogleModel)
        .submit(wi.wireVideoGooglePrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("video-google", m.body());
  });

  // ADR-034 delivery-mode phase: Bedrock Nova Reel video-submit body is the
  // nested {modelId, modelInput:{taskType, textToVideoParams:{text}},
  // outputDataConfig:{s3OutputDataConfig:{s3Uri}}} shape — model in the BODY
  // (unlike Veo's path), carrying the caller S3 URI. The SigV4 signing and the
  // output-uri delivery (no download) are covered by the unit tests.
  test("video submit (Bedrock Nova Reel) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.bedrock, "key");
      c.provider.baseUrl = m.url;
      await c.video
        .model(wi.wireVideoBedrockModel)
        .outputURI("s3://llmkit-wire-fixtures/out/")
        .submit(wi.wireVideoBedrockPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("video-bedrock", m.body());
  });

  // ADR-034 delivery-mode phase: Vertex Veo video-submit body is the nested
  // {instances:[{prompt}]} shape — byte-identical to the Veo golden (model in
  // the PATH, not the body). The POST-poll lifecycle (:fetchPredictOperation,
  // inline-base64 download delivery) is covered by the unit tests.
  test("video submit (Vertex Veo) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.vertex, "key");
      c.provider.baseUrl = m.url;
      await c.video
        .model(wi.wireVideoVertexModel)
        .submit(wi.wireVideoVertexPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("video-vertex", m.body());
  });

  // Prompt 043: Cloudflare Workers AI's OpenAI-compatible chat-completions body
  // {model, messages, max_tokens, temperature, top_p} — structurally identical
  // to the gpt-4o options golden (OpenAI ArgsFormat, system-in-messages); the
  // novel bit (account-id-in-URL) is delivery-side, not request-body-side.
  test("workersai (OpenAI-compatible chat) matches shared golden", async () => {
    const m = startMock();
    try {
      const c = newClient(Providers.workersai, "key");
      c.provider.baseUrl = m.url;
      await c.text
        .model(wi.wireWorkersaiModel)
        .maxTokens(wi.wireWorkersaiMaxTokens)
        .temperature(wi.wireWorkersaiTemperature)
        .topP(wi.wireWorkersaiTopP)
        .prompt(wi.wireWorkersaiPrompt);
    } finally {
      m.stop();
    }
    assertWireGolden("workersai", m.body());
  });
});
