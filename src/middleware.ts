// Middleware runtime: pre-phase veto + post-phase observation.
//
// @invariant every successful firePre is paired with exactly one firePost.
//   When firePre returns a veto, no firePost runs (no work began).

import type { Event, MiddlewareFn } from "./providers/middleware.ts";
import { APIError, ValidationError } from "./errors.ts";

export class MiddlewareVetoError extends Error {
  public override readonly cause: Error;
  constructor(cause: Error) {
    super(`middleware veto: ${cause.message}`);
    this.name = "MiddlewareVetoError";
    this.cause = cause;
  }
}

export function firePre(
  middleware: ReadonlyArray<MiddlewareFn> | undefined,
  base: Event,
): MiddlewareVetoError | null {
  if (!middleware || middleware.length === 0) return null;
  const ev: Event = { ...base, phase: "pre" };
  for (const m of middleware) {
    const result = m(undefined, ev);
    if (result) return new MiddlewareVetoError(result);
  }
  return null;
}

export function firePost(
  middleware: ReadonlyArray<MiddlewareFn> | undefined,
  base: Event,
): void {
  if (!middleware || middleware.length === 0) return;
  const ev: Event = { ...base, phase: "post" };
  if (ev.err && !ev.errType) ev.errType = eventErrType(ev.err);
  for (const m of middleware) {
    try {
      m(undefined, ev);
    } catch {
      // post-phase is observational; swallow user-thrown errors.
    }
  }
}

// eventErrType maps a typed error to the stable OTEL error.type kind carried
// on Event.errType (ADR-071). Classification is structural (instanceof) and
// happens here, at the firePost seam — the one place the typed error still
// exists — so consumers (the OTLP builder included) read the kind verbatim
// and never re-parse a message string.
export function eventErrType(err: Error): string {
  if (err instanceof APIError) return "api_error";
  if (err instanceof ValidationError) return "validation_error";
  return "error";
}

export type { Event, MiddlewareFn } from "./providers/middleware.ts";
