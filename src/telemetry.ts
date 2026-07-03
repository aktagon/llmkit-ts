//
//
//
//
//
//

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

//
//
//
//
//
//
//
//
export interface Telemetry {
  export: (bytes: Uint8Array) => void;
  captureContent?: boolean;
}

//
//
//

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

//
//
//
//
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

//
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

//
//
//
//
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

//
//
//
//
//
//
//
//
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

//
//
//
//
//
export function telemetryMiddleware(t: Telemetry): MiddlewareFn {
  return (_ctx, e): Error | null => {
    if (e.phase !== "post") return null;
    try {
      t.export(buildTelemetryPayload(e));
    } catch {
      //
    }
    return null;
  };
}

//
//
//
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
  //
  //
  //
  //
  this.text._middleware = [...this.text._middleware, mw];
  this.image._middleware = [...this.image._middleware, mw];
  this.music._middleware = [...this.music._middleware, mw];
  this.video._middleware = [...this.video._middleware, mw];
  this.agent._middleware = [...this.agent._middleware, mw];
  this.upload._middleware = [...this.upload._middleware, mw];
  return this;
};
