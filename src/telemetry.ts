// Opt-in observability (ADR-054). Attach with Client.withTelemetry to export an
// OTEL GenAI-aligned span over OTLP/HTTP (JSON) on every provider call — success
// and rejection. Off unless attached; an empty endpoint is a ValidationError
// (the honest-contract lineage — no enabled-but-no-sink state). Handwritten
// runtime, a sibling of the ADR-052 baseURL / custom-header overrides; the OTEL
// semantic-convention bindings live in the generated telemetry_gen module.

import { APIError, ValidationError } from "./errors.ts";
import { Client } from "./builders/builders.ts";
import type { Event, MiddlewareFn } from "./providers/middleware.ts";
import {
  OTEL_ATTR_ERR,
  OTEL_ATTR_MODEL,
  OTEL_ATTR_OP,
  OTEL_ATTR_PROVIDER,
  OTEL_USAGE_INPUT,
  OTEL_USAGE_OUTPUT,
  TELEMETRY_OPERATION_NAME,
  TELEMETRY_SEMCONV_VERSION,
  TELEMETRY_TRACES_PATH,
} from "./providers/telemetry_gen.ts";

// Telemetry is the opt-in observability config (ADR-059). `export` receives the
// finished OTLP/HTTP proto3-JSON bytes for one span, called synchronously on the
// post phase; llmkit does no telemetry network I/O and spawns no worker. What the
// callback does — enqueue into an OTEL SDK, POST, drop — plus all batching and
// backpressure is the caller's concern. Use `httpExport` for a batteries POST. A
// missing `export` is a ValidationError (honest-contract lineage). `captureContent`
// gates tier-2 message payloads (default false); the Event carries none yet, so it
// reserves the semantics for a deferred follow-up.
export interface Telemetry {
  export: (bytes: Uint8Array) => void;
  captureContent?: boolean;
}

// --- OTLP/HTTP JSON encoding (ExportTraceServiceRequest, proto3-JSON) ---
// int64 fields (times, token counts) render as strings; traceId/spanId as hex.
// Asserted value-identical across all four SDKs by the telemetry wire goldens.

type OtlpValue = { stringValue: string } | { intValue: string };

interface OtlpKeyValue {
  key: string;
  value: OtlpValue;
}

function stringAttr(key: string, val: string): OtlpKeyValue {
  return { key, value: { stringValue: val } };
}

function intAttr(key: string, val: number): OtlpKeyValue {
  return { key, value: { intValue: String(val) } };
}

// buildOTLPTraces is the PURE, deterministic OTLP-payload builder. Given the
// call's primitives plus injectable span identity + timing, it returns the exact
// JSON the exporter POSTs — the parity fixtures call it with fixed inputs so all
// four SDKs are asserted value-identical.
export function buildOTLPTraces(
  operationName: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  errorType: string,
  traceId: string,
  spanId: string,
  startNano: string,
  endNano: string,
): string {
  const attributes: OtlpKeyValue[] = [
    stringAttr(OTEL_ATTR_OP, operationName),
    stringAttr(OTEL_ATTR_PROVIDER, provider),
    stringAttr(OTEL_ATTR_MODEL, model),
  ];
  if (inputTokens > 0) attributes.push(intAttr(OTEL_USAGE_INPUT, inputTokens));
  if (outputTokens > 0)
    attributes.push(intAttr(OTEL_USAGE_OUTPUT, outputTokens));

  const span: Record<string, unknown> = {
    traceId,
    spanId,
    name: `${operationName} ${model}`,
    kind: 3,
    startTimeUnixNano: startNano,
    endTimeUnixNano: endNano,
    attributes,
  };
  if (errorType !== "") {
    attributes.push(stringAttr(OTEL_ATTR_ERR, errorType));
    span.status = { code: 2 };
  }

  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [stringAttr("service.name", "llmkit")],
        },
        scopeSpans: [
          {
            scope: { name: "llmkit", version: TELEMETRY_SEMCONV_VERSION },
            spans: [span],
          },
        ],
      },
    ],
  };
  return JSON.stringify(payload);
}

// classifyError maps an error to a stable OTEL error.type value.
function classifyError(err: Error | undefined): string {
  if (!err) return "";
  if (err instanceof APIError) return "api_error";
  if (err instanceof ValidationError) return "validation_error";
  return "error";
}

function randHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let out = "";
  for (const b of arr) out += b.toString(16).padStart(2, "0");
  return out;
}

// buildTelemetryPayload classifies a post-phase Event and renders it to the OTLP
// traces bytes. Span identity + timing are stamped here (the pure builder takes
// them as arguments so the parity goldens can inject fixed values). Returns bytes
// so the Export contract is uniform with Go []byte / Python bytes / Rust &[u8].
function buildTelemetryPayload(e: Event): Uint8Array {
  const op = TELEMETRY_OPERATION_NAME[e.op] ?? e.op;
  const errType = classifyError(e.err);
  const now = String(BigInt(Date.now()) * 1_000_000n);
  const json = buildOTLPTraces(
    op,
    e.provider,
    e.model,
    e.usage?.input ?? 0,
    e.usage?.output ?? 0,
    errType,
    randHex(16),
    randHex(8),
    now,
    now,
  );
  return new TextEncoder().encode(json);
}

// httpExport returns an Export callback that POSTs each OTLP payload to
// endpoint + "/v1/traces" with caller headers, fail-open (a dead collector never
// surfaces). It spawns no background worker and needs no close.
//
// Low-volume only: hand your own callback to your OTEL SDK for high volume. JS
// has no blocking HTTP, so unlike the Go/Python/Rust batteries POST the fetch is
// fire-and-forget (not awaited) — llmkit still spawns nothing; the callback just
// dispatches a non-blocking request.
export function httpExport(
  endpoint: string,
  headers?: Record<string, string>,
): (bytes: Uint8Array) => void {
  const url = endpoint.replace(/\/+$/, "") + TELEMETRY_TRACES_PATH;
  return (bytes: Uint8Array): void => {
    const h: Record<string, string> = {
      "content-type": "application/json",
      ...(headers ?? {}),
    };
    void fetch(url, { method: "POST", headers: h, body: bytes }).catch(() => {});
  };
}

// telemetryMiddleware builds the export hook. Only the post phase exports; the
// pre phase is a no-op (no veto). Missing-export validation happens earlier in
// withTelemetry (fail-loud at attach time, the JS idiom). Export is called
// SYNCHRONOUSLY (ADR-059) inside a try/catch so a throwing callback never
// surfaces to the caller (fail-open).
export function telemetryMiddleware(t: Telemetry): MiddlewareFn {
  return (_ctx, e): Error | null => {
    if (e.phase !== "post") return null;
    try {
      t.export(buildTelemetryPayload(e));
    } catch {
      // fail-open: telemetry must never surface to the caller.
    }
    return null;
  };
}

// Augment the generated Client with the handwritten withTelemetry method — the
// Go reference adds it as a method in a sibling file of the same package; the TS
// equivalent is a prototype augmentation, since builders.ts is codegen-owned.
declare module "./builders/builders.ts" {
  interface Client {
    withTelemetry(t: Telemetry): Client;
  }
}

Client.prototype.withTelemetry = function (
  this: Client,
  t: Telemetry,
): Client {
  if (typeof t.export !== "function") {
    throw new ValidationError(
      "telemetry.export",
      "export is required when telemetry is enabled (use httpExport for a batteries POST)",
    );
  }
  const mw = telemetryMiddleware(t);
  // Inject into every builder that carries a middleware seam. Chain clones copy
  // the builder's array reference, so this reaches every call. Speech and
  // Transcription have no middleware runtime yet (ADR-049/051); they are covered
  // when that seam lands (mirrors the Go reference).
  this.text._middleware = [...this.text._middleware, mw];
  this.image._middleware = [...this.image._middleware, mw];
  this.music._middleware = [...this.music._middleware, mw];
  this.video._middleware = [...this.video._middleware, mw];
  this.agent._middleware = [...this.agent._middleware, mw];
  this.upload._middleware = [...this.upload._middleware, mw];
  return this;
};
