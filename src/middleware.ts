//
//
//
//

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
      //
    }
  }
}

//
//
//
//
//
export function eventErrType(err: Error): string {
  if (err instanceof APIError) return "api_error";
  if (err instanceof ValidationError) return "validation_error";
  return "error";
}

export type { Event, MiddlewareFn } from "./providers/middleware.ts";
