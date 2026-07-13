// Cross-SDK LIFECYCLE conformance (ADR-062 slice 1 / HANDOFF-032 step 5) — the
// TS driver. Mirror of go/lifecycle_wire_test.go. Where request_wire.test.ts
// asserts the OUTBOUND request bytes match the shared golden, this asserts the
// INBOUND classification does: given the same OpenAI two-hop batch poll
// response, BatchHandle.poll normalizes it to the SAME terminal JobStatus every
// SDK produces. One golden per scenario, shared by all four SDKs at
// codegen/testdata/wire/lifecycle/v1/<fixture>.json; this driver drops
// target/wire/lifecycle/<fixture>/ts.json for codegen/test_cross_sdk_lifecycle.py.

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BatchHandle } from "../src/builders/batch.ts";
import type { JobStatus } from "../src/job.ts";
import { Providers } from "../src/providers/providers.ts";
import type { Provider, Response } from "../src/types.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function goldenPath(fixture: string): string {
  return resolve(REPO_ROOT, "codegen", "testdata", "wire", "lifecycle", "v1", `${fixture}.json`);
}

function artifactPath(fixture: string): string {
  return resolve(REPO_ROOT, "target", "wire", "lifecycle", fixture, "ts.json");
}

// lifecycleArtifact is the normalized, cross-SDK-comparable projection of a
// terminal JobStatus. Booleans/strings only — no provider payload — so the four
// SDKs agree regardless of their internal result types. cause is null unless
// failed; when present it carries ONLY {status, timedOut} (message is omitted:
// batch has no error-message path, so asserting it would test absence, not parity).
function lifecycleArtifact(st: JobStatus<Response[]>): unknown {
  return {
    state: st.state,
    hasResult: st.result !== undefined && st.result !== null,
    rawStatus: st.rawStatus,
    cause:
      st.cause !== undefined
        ? { status: st.cause.status, timedOut: st.cause.timedOut }
        : null,
  };
}

function assertLifecycleGolden(fixture: string, st: JobStatus<Response[]>): void {
  const art = lifecycleArtifact(st);
  const out = artifactPath(fixture);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(art, null, 2));
  const golden = JSON.parse(readFileSync(goldenPath(fixture), "utf8"));
  expect(art).toEqual(golden);
}

// lifecycleMockServer serves the OpenAI two-hop batch shape: GET the batch
// status, and (for the succeeded fixture) GET the result file content as one
// JSONL line (the body wrapped at response.body, OpenAI's shape).
function lifecycleMockServer(status: string, outputFileID: string) {
  return Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname.startsWith("/v1/batches/")) {
        const body: Record<string, unknown> = { id: "batch_1", status };
        if (outputFileID !== "") body.output_file_id = outputFileID;
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        });
      }
      if (req.method === "GET" && url.pathname.startsWith("/v1/files/")) {
        const line =
          '{"custom_id":"req-0","response":{"body":{"choices":[{"message":{"role":"assistant","content":"ok"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}}}';
        return new Response(line + "\n");
      }
      return new Response("unexpected " + url.pathname, { status: 404 });
    },
  });
}

function openAIBatchHandle(baseUrl: string): BatchHandle {
  const provider: Provider = {
    name: Providers.openai,
    apiKey: "test-key",
    baseUrl,
  };
  return new BatchHandle("batch_1", provider);
}

describe("lifecycle wire — cross-SDK conformance (ADR-062)", () => {
  test("batch succeeded matches shared golden", async () => {
    const server = lifecycleMockServer("completed", "file-out-1");
    try {
      const st = await openAIBatchHandle(`http://localhost:${server.port}`).poll();
      assertLifecycleGolden("batch-succeeded", st);
    } finally {
      server.stop(true);
    }
  });

  test("batch failed matches shared golden", async () => {
    const server = lifecycleMockServer("failed", "");
    try {
      const st = await openAIBatchHandle(`http://localhost:${server.port}`).poll();
      assertLifecycleGolden("batch-failed", st);
    } finally {
      server.stop(true);
    }
  });
});
