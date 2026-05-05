// Middleware runtime: pre-phase veto + post-phase observation.
//
// @invariant every successful firePre is paired with exactly one firePost.
//   When firePre returns a veto, no firePost runs (no work began).

import type { Event, MiddlewareFn } from "./providers/middleware.ts";

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
  for (const m of middleware) {
    try {
      m(undefined, ev);
    } catch {
      // post-phase is observational; swallow user-thrown errors.
    }
  }
}

export type { Event, MiddlewareFn } from "./providers/middleware.ts";
