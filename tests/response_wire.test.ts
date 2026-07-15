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

function assertResponseGolden(shape: string, resp: Response): void {
  const art = responseArtifact(resp);
  const out = artifactPath(shape);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(art, null, 2));
  const golden = JSON.parse(readFileSync(goldenPath(shape), "utf8"));
  expect(art).toEqual(golden);
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
});
