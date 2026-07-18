// ADR-054 opt-in telemetry. The two parity tests drop the per-SDK OTLP artifact
// for the cross-SDK comparator and assert it is JSON-value-equal to the shared
// golden at codegen/testdata/wire/telemetry/v1/<fixture>.json — the SAME golden
// every SDK asserts against. The remaining tests cover the exporter wiring, the
// fail-loud empty-endpoint contract, and the fail-open guarantee.

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { newClient } from "../src/llmkit.ts";
import { APIError, ValidationError } from "../src/errors.ts";
import {
  buildOTLPTraces,
  buildTelemetryPayloadAt,
  httpExport,
  telemetryMiddleware,
} from "../src/telemetry.ts";
import { firePost } from "../src/middleware.ts";
import type { Event } from "../src/providers/middleware.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Fixed span identity + timing for the deterministic parity fixtures (TEL-011).
const TRACE_ID = "5b8efff798038103d269b633813fc60c";
const SPAN_ID = "eee19b7ec3c1b174";
const START_NANO = "1700000000000000000";
const END_NANO = "1700000001000000000";

function goldenPath(fixture: string): string {
  return resolve(
    REPO_ROOT,
    "codegen",
    "testdata",
    "wire",
    "telemetry",
    "v1",
    `${fixture}.json`,
  );
}

function artifactPath(fixture: string): string {
  return resolve(REPO_ROOT, "target", "wire", "telemetry", fixture, "ts.json");
}

function assertTelemetryGolden(fixture: string, payload: string): void {
  const out = artifactPath(fixture);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, payload);
  const golden = JSON.parse(readFileSync(goldenPath(fixture), "utf8"));
  expect(JSON.parse(payload)).toEqual(golden);
}

describe("telemetry — OTLP wire parity", () => {
  test("success payload matches shared golden", () => {
    const payload = buildOTLPTraces(
      "chat",
      "openai",
      "gpt-4o",
      10,
      20,
      "",
      TRACE_ID,
      SPAN_ID,
      START_NANO,
      END_NANO,
    );
    assertTelemetryGolden("telemetry-success", payload);
  });

  test("rejection payload matches shared golden", () => {
    const payload = buildOTLPTraces(
      "chat",
      "openai",
      "gpt-4o",
      0,
      0,
      "rate_limit_exceeded",
      TRACE_ID,
      SPAN_ID,
      START_NANO,
      END_NANO,
    );
    assertTelemetryGolden("telemetry-rejection", payload);
  });

  // Exercises classification end-to-end (ADR-071 ETY-004): a typed API error
  // routes through the REAL firePost stamping seam, and the stamped event
  // renders to the shared telemetry-error golden via the pure builder — no
  // error.type is hand-fed anywhere.
  test("error payload stamps errType at the firePost seam and matches shared golden", () => {
    let captured: Event | undefined;
    firePost(
      [
        (_ctx, e) => {
          captured = e;
          return null;
        },
      ],
      {
        op: "llm_request",
        phase: "post",
        provider: "openai",
        model: "gpt-4o",
        err: new APIError(429, "rate limited", true),
      },
    );
    expect(captured?.errType).toBe("api_error");
    const payload = buildTelemetryPayloadAt(
      captured as Event,
      TRACE_ID,
      SPAN_ID,
      START_NANO,
      END_NANO,
    );
    assertTelemetryGolden(
      "telemetry-error",
      new TextDecoder().decode(payload),
    );
  });
});

const POST_EVENT: Event = {
  op: "llm_request",
  phase: "post",
  provider: "openai",
  model: "gpt-4o",
  usage: {
    input: 10,
    output: 20,
    cacheWrite: 0,
    cacheRead: 0,
    reasoning: 0,
    cost: 0,
  },
};

describe("telemetry — export callback (ADR-059)", () => {
  test("post phase hands finished OTLP bytes to export exactly once", () => {
    const got: Uint8Array[] = [];
    const mw = telemetryMiddleware({ export: (b) => got.push(b) });

    // Pre phase never exports.
    expect(mw(undefined, { ...POST_EVENT, phase: "pre" })).toBeNull();
    expect(got.length).toBe(0);

    expect(mw(undefined, POST_EVENT)).toBeNull();
    expect(got.length).toBe(1);
    const parsed = JSON.parse(new TextDecoder().decode(got[0])) as {
      resourceSpans?: unknown;
    };
    expect(parsed.resourceSpans).toBeDefined();
  });

  test("a throwing callback fails open — never surfaces to the caller", () => {
    const mw = telemetryMiddleware({
      export: () => {
        throw new Error("callback blew up");
      },
    });
    expect(mw(undefined, POST_EVENT)).toBeNull();
  });
});

describe("telemetry — httpExport batteries", () => {
  test("httpExport POSTs to /v1/traces with headers + resourceSpans", async () => {
    let resolveReq: (v: {
      path: string;
      auth: string | null;
      contentType: string | null;
      body: string;
    }) => void;
    const received = new Promise<{
      path: string;
      auth: string | null;
      contentType: string | null;
      body: string;
    }>((r) => {
      resolveReq = r;
    });
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const body = await req.text();
        resolveReq({
          path: new URL(req.url).pathname,
          auth: req.headers.get("authorization"),
          contentType: req.headers.get("content-type"),
          body,
        });
        return new Response("ok");
      },
    });
    try {
      const mw = telemetryMiddleware({
        export: httpExport(`http://localhost:${server.port}`, {
          authorization: "Bearer secret",
        }),
      });
      const err = mw(undefined, POST_EVENT);
      expect(err).toBeNull();

      const got = await received;
      expect(got.path).toBe("/v1/traces");
      expect(got.auth).toBe("Bearer secret");
      expect(got.contentType).toBe("application/json");
      const parsed = JSON.parse(got.body) as { resourceSpans?: unknown };
      expect(parsed.resourceSpans).toBeDefined();
    } finally {
      server.stop(true);
    }
  });

  test("httpExport to a dead endpoint fails open", () => {
    const mw = telemetryMiddleware({
      export: httpExport("http://127.0.0.1:1"),
    });
    expect(mw(undefined, POST_EVENT)).toBeNull();
  });
});

describe("telemetry — config contract", () => {
  test("addTelemetry throws ValidationError on missing export (TEL-017)", () => {
    const c = newClient("openai", "key");
    let caught: unknown;
    try {
      // deliberately omit export to exercise the honest-contract guard
      c.addTelemetry({} as never);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).field).toBe("telemetry.export");
  });
});
