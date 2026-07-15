// Cross-SDK RESPONSE-body conformance (ADR-065 / prompt 045 Track B) — the TS
// driver. Mirror of go/response_wire_test.go. Where request_wire.test.ts asserts
// the OUTBOUND request bytes match, and lifecycle_wire.test.ts asserts the poll
// CLASSIFICATION matches, this asserts the INBOUND body PARSE matches: given the
// same anchored provider reply, c.text.prompt() normalizes it to the same
// projection (Usage dims + finish reason + content) every SDK produces. The
// parser INPUT lives at codegen/testdata/wire/response/v1/bodies/<shape>.json;
// this driver drops target/wire/response/<shape>/ts.json for
// codegen/test_cross_sdk_response.py, which compares it to the EXPECTED golden
// codegen/testdata/wire/response/v1/<shape>.json.

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";
import type { ProviderName } from "../src/providers/providers.ts";
import type { Response } from "../src/types.ts";
import type { ImageResponse, SpeechResponse, TranscriptionResponse } from "../src/structs.ts";
import { audioBytes } from "../src/image.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function bodyPath(shape: string): string {
  return resolve(REPO_ROOT, "codegen", "testdata", "wire", "response", "v1", "bodies", `${shape}.json`);
}

function goldenPath(shape: string): string {
  return resolve(REPO_ROOT, "codegen", "testdata", "wire", "response", "v1", `${shape}.json`);
}

function artifactPath(shape: string): string {
  return resolve(REPO_ROOT, "target", "wire", "response", shape, "ts.json");
}

// responseArtifact is the normalized, cross-SDK-comparable projection of a parsed
// Response — the contract-bearing parse output only. finishReason is optional on
// the TS Response (Go/Python/Rust default it to ""), so it is coalesced to "" to
// keep the artifact structurally identical across SDKs.
function responseArtifact(resp: Response): unknown {
  return {
    usage: {
      input: resp.usage.input,
      output: resp.usage.output,
      cacheRead: resp.usage.cacheRead,
      cacheWrite: resp.usage.cacheWrite,
      reasoning: resp.usage.reasoning,
      cost: resp.usage.cost,
    },
    finishReason: resp.finishReason ?? "",
    content: resp.text,
    error: null,
  };
}

// responseMockServer serves the anchored body verbatim on any path — the parse
// path is single-hop, so a catch-all is enough. The parser dispatches on the
// client's provider, not the URL.
function responseMockServer(body: string) {
  return Bun.serve({
    port: 0,
    fetch: () => new Response(body, { headers: { "content-type": "application/json" } }),
  });
}

// imageArtifact projects an ImageResponse. For media the Content discriminant is
// {kind,mimeType,byteLen,count} (RWR-004): the four SDKs must agree the same body
// decodes to the same number of images with the same mime and decoded byte length
// — the batch×image parse-drift class (BUG-024) lands here. finishReason is
// optional on the TS ImageResponse (Go/Python/Rust default it to "").
function imageArtifact(resp: ImageResponse): unknown {
  const first = resp.images[0];
  return {
    usage: {
      input: resp.usage.input,
      output: resp.usage.output,
      cacheRead: resp.usage.cacheRead,
      cacheWrite: resp.usage.cacheWrite,
      reasoning: resp.usage.reasoning,
      cost: resp.usage.cost,
    },
    finishReason: resp.finishReason ?? "",
    content: {
      kind: "image",
      mimeType: first ? first.mimeType : "",
      byteLen: first ? first.bytes.length : 0,
      count: resp.images.length,
    },
    error: null,
  };
}

// speechArtifact projects a SpeechResponse — the media discriminant
// {kind,mimeType,byteLen} (the ADR-018 bytes/mime accessor contract).
function speechArtifact(resp: SpeechResponse): unknown {
  return {
    usage: {
      input: resp.usage.input,
      output: resp.usage.output,
      cacheRead: resp.usage.cacheRead,
      cacheWrite: resp.usage.cacheWrite,
      reasoning: resp.usage.reasoning,
      cost: resp.usage.cost,
    },
    finishReason: "",
    content: { kind: "speech", mimeType: resp.audio.mimeType, byteLen: resp.audio.bytes.length },
    error: null,
  };
}

// transcriptArtifact projects a TranscriptionResponse — {kind,text,segments}.
function transcriptArtifact(resp: TranscriptionResponse): unknown {
  return {
    usage: {
      input: resp.usage.input,
      output: resp.usage.output,
      cacheRead: resp.usage.cacheRead,
      cacheWrite: resp.usage.cacheWrite,
      reasoning: resp.usage.reasoning,
      cost: resp.usage.cost,
    },
    finishReason: "",
    content: { kind: "transcript", text: resp.text, segments: resp.segments.length },
    error: null,
  };
}

function assertGolden(shape: string, art: unknown): void {
  const out = artifactPath(shape);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(art, null, 2));
  const golden = JSON.parse(readFileSync(goldenPath(shape), "utf8"));
  expect(art).toEqual(golden);
}

function assertResponseGolden(shape: string, resp: Response): void {
  assertGolden(shape, responseArtifact(resp));
}

async function driveResponse(shape: string, provider: ProviderName): Promise<void> {
  const body = readFileSync(bodyPath(shape), "utf8");
  const server = responseMockServer(body);
  try {
    const c = newClient(provider, "k");
    c.provider.baseUrl = `http://localhost:${server.port}`;
    const resp = await c.text.prompt("ping");
    assertResponseGolden(shape, resp);
  } finally {
    server.stop(true);
  }
}

async function driveImage(shape: string, provider: ProviderName, model: string): Promise<void> {
  const body = readFileSync(bodyPath(shape), "utf8");
  const server = responseMockServer(body);
  try {
    const c = newClient(provider, "k");
    c.provider.baseUrl = `http://localhost:${server.port}`;
    const resp = await c.image.model(model).generate("a cat");
    assertGolden(shape, imageArtifact(resp));
  } finally {
    server.stop(true);
  }
}

async function driveSpeech(shape: string, provider: ProviderName, model: string, voice: string): Promise<void> {
  const body = readFileSync(bodyPath(shape), "utf8");
  const server = responseMockServer(body);
  try {
    const c = newClient(provider, "k");
    c.provider.baseUrl = `http://localhost:${server.port}`;
    const resp = await c.speech.model(model).voice(voice).generate("hello");
    assertGolden(shape, speechArtifact(resp));
  } finally {
    server.stop(true);
  }
}

async function driveTranscript(shape: string, provider: ProviderName, model: string): Promise<void> {
  const body = readFileSync(bodyPath(shape), "utf8");
  const server = responseMockServer(body);
  try {
    const c = newClient(provider, "k");
    c.provider.baseUrl = `http://localhost:${server.port}`;
    const resp = await c.transcription.model(model).transcribe(audioBytes("audio/wav", new Uint8Array([82, 73, 70, 70])));
    assertGolden(shape, transcriptArtifact(resp));
  } finally {
    server.stop(true);
  }
}

describe("response wire — cross-SDK conformance (ADR-065)", () => {
  test("chat-openai matches shared golden", async () => {
    await driveResponse("chat-openai", Providers.openai);
  });

  test("chat-anthropic matches shared golden", async () => {
    await driveResponse("chat-anthropic", Providers.anthropic);
  });

  test("chat-google matches shared golden", async () => {
    await driveResponse("chat-google", Providers.google);
  });

  // Phase 2: image response dispatch (BUG-024 surface) — one golden per
  // llm:imageResponseShape (GoogleParts / DataArrayB64Json / VertexPredictions).
  test("image-google matches shared golden", async () => {
    await driveImage("image-google", Providers.google, "gemini-3.1-flash-image-preview");
  });

  test("image-openai matches shared golden", async () => {
    await driveImage("image-openai", Providers.openai, "gpt-image-1");
  });

  test("image-vertex matches shared golden", async () => {
    await driveImage("image-vertex", Providers.vertex, "imagen-3.0-generate-002");
  });

  // Speech (TTS) + transcription (STT) — the media/transcript accessor contract.
  test("speech-inworld matches shared golden", async () => {
    await driveSpeech("speech-inworld", Providers.inworld, "inworld-tts-2", "Dennis");
  });

  test("transcription-openai matches shared golden", async () => {
    await driveTranscript("transcription-openai", Providers.openai, "whisper-1");
  });
});
