import type { VideoResponse } from "./structs.ts";

export class APIError extends Error {
  /**
   * @param hint names the stated catalogue facts a rejected request for a
   * listed model contradicts, for example "catalogue: heygen/heygen-video-1
   * lists no last frame". Set only on a 400 or 422 reply. When set, `message` is
   * the provider's text, then "; " and the hint.
   */
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly retryable: boolean = false,
    public readonly hint?: string,
  ) {
    super(hint ? `${message}; ${hint}` : message);
    this.name = "APIError";
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

// VideoDeleteError reports that VideoHandle.wait() has the finished video but
// could not delete the provider's stored job (HANDOFF-109). wait() rejects
// with it instead of resolving, so `video` carries the finished video and
// the caller still has it:
//
//   try { resp = await handle.wait() } catch (e) {
//     if (e instanceof VideoDeleteError) { resp = e.video /* job e.id is still stored */ }
//   }
//
// `cause` is the delete call's error (an APIError for a 4xx/5xx reply).
export class VideoDeleteError extends Error {
  constructor(
    public readonly id: string,
    public readonly video: VideoResponse,
    cause: unknown,
  ) {
    super(
      `video delete: stored job ${id} was not deleted: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "VideoDeleteError";
  }
}
