import type { Message } from "./structs.ts";

export class APIError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "APIError";
  }
}

// AgentError is the error an Agent call throws once the call has started
// (owner decision 4, HANDOFF-105 F4). Agent chat is all-or-nothing: on any
// error the history is what it was before the call, and unsavedTurns holds the
// turns the call made and did not save, in order: the user turn, then each
// assistant turn and tool result. cause is the error that stopped the call.
export class AgentError extends Error {
  constructor(
    public override readonly cause: unknown,
    public readonly unsavedTurns: Message[],
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "AgentError";
  }
}

export class ValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
    this.name = "ValidationError";
  }
}

// PollTimeoutError is the typed error a blocking wait() / waitBatch() throws when
// the deadline backstop fires (ADR-063 POLL-008). Branch on it with `instanceof`:
//
//   try { await handle.wait() } catch (e) {
//     if (e instanceof PollTimeoutError) { /* the job may still be running — poll
//        the handle later, or raise pollTimeoutMs */ }
//   }
//
// It is reachable only from wait()/waitBatch(), never from poll(): a single poll()
// is one round-trip and never times out. Provider-reported failures are NOT this
// error — branch on them via poll()'s JobStatus.cause.
export class PollTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PollTimeoutError";
  }
}
