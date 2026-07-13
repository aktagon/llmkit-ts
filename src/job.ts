// Job engine (ADR-062 / ADR-063) — the ONE shared poll runtime for llmkit's
// async, poll-until-done capabilities. Slice 1 migrates batch + transcription
// onto it; video lands in slice 2. Mirror of go/job.go.
//
// Four "poll"-family names, kept deliberately distinct (glossary):
//   - poll()    — the PUBLIC handle method (BatchHandle.poll / TranscriptionHandle.poll):
//                 exactly one provider round-trip, normalized, NO loop (ADR-063 POLL-001).
//   - pollJob   — the internal engine: the bounded loop over pollOnce that owns the
//                 deadline backstop and the monotonic Running -> (Succeeded | Failed)
//                 state machine. The single writer of job state.
//   - pollOnce  — one engine iteration (poll -> classify -> result-when-Succeeded).
//                 poll() IS pollOnce made public; wait() IS pollJob (a loop over pollOnce).
//   - PollBody  — the once-decoded provider poll response; confines the untyped JSON
//                 leaf so no raw object crosses an adapter signature (S04).
//   - JobAdapter.poll — the adapter seam that performs the round-trip and returns a PollBody.
//
// The engine is generic on the result type T so no `any` crosses the public seam
// (CLAUDE.md concrete-types rule; ADR-062 H1 typed-waist fix).

import { APIError, PollTimeoutError } from "./errors.ts";
import { extractPath } from "./paths.ts";

// JobState is the lifecycle state of an async job. PUBLIC because it is what
// poll() returns (ADR-063 POLL-004). Members are exactly running/succeeded/failed
// — there is deliberately NO "unknown" member (ADR-063 §"Implementation
// refinements" 2): JobStatus is always constructed with an explicit state, so an
// Unknown zero-value would be a public state the library never returns.
export type JobState = "running" | "succeeded" | "failed";

// JobFailure is the normalized failure detail carried by a failed JobStatus. It
// is ONE terminal, not a taxonomy (ADR-062): the raw provider status, an optional
// provider error message, and a timedOut flag.
export interface JobFailure {
  // status is the raw provider status string that classified as failure (OpenAI
  // batch "failed"/"expired"/"cancelled"; AssemblyAI "error"). Empty when the
  // failure is the engine's deadline backstop firing.
  status: string;
  // message is the provider error message when the provider reports one
  // (AssemblyAI's top-level "error"); empty otherwise.
  message: string;
  // timedOut is true iff this failure is the engine's deadline backstop, not a
  // provider-reported terminal.
  timedOut: boolean;
}

// JobStatus is the normalized result of a single poll() (ADR-063 POLL-001): the
// state plus the result XOR the failure cause — never a raw provider payload.
// result is set iff state === "succeeded"; cause is set iff state === "failed".
export interface JobStatus<T> {
  state: JobState;
  // result is the normalized capability response, set iff state === "succeeded"
  // (the second network hop, if any, has already been performed).
  result?: T;
  // cause is the normalized failure detail, set iff state === "failed".
  cause?: JobFailure;
  // rawStatus is the provider's raw status string, for logging or a consumer that
  // wants to branch below the normalized state.
  rawStatus: string;
}

// LifecycleConfig is the config half of the engine seam: the classification facts
// (status path + done / error value sets + the error-message path) and the poll
// cadence. Each capability assembles it from its own generated facts.
export interface LifecycleConfig {
  // noun labels the capability in the failure error string ("transcription",
  // "batch") so a failed terminal reads "<noun> failed: <message>" (S02).
  noun: string;
  // statusPath is the dotted path to the status string in the poll body.
  statusPath: string;
  // doneValues are the status strings marking terminal success (precedence over
  // errorValues).
  doneValues: string[];
  // errorValues are the status strings marking terminal failure. An empty set
  // means "no failure terminal" — today's Anthropic-batch behavior.
  errorValues: string[];
  // errorMessagePath is the dotted path to a provider error message, surfaced in
  // JobFailure.message. Empty = no message extraction.
  errorMessagePath: string;
  // pollIntervalMs is the cadence between polls.
  pollIntervalMs: number;
  // pollTimeoutMs is the overall wall-clock backstop for the pollJob LOOP — NOT a
  // per-request HTTP timeout (S05). Zero = no backstop.
  pollTimeoutMs: number;
}

// PollBody is the once-decoded provider poll response (S04). It confines the
// untyped JSON leaf: classification reads a config path via status(); result reads
// the decoded tree via raw. No adapter signature carries a bare object.
export class PollBody {
  constructor(readonly raw: Record<string, unknown>) {}

  // status returns the string at the given dotted path, or "" if absent.
  status(path: string): string {
    return extractPath(this.raw, path);
  }
}

// Classification is what classify() returns: the state plus the failure detail
// when failed. Internal — the public boundary is JobState.
export interface Classification {
  state: JobState;
  failure?: JobFailure;
  rawStatus: string;
}

// JobAdapter carries the capability seams the engine cannot share. classify has a
// config-backed default (classifyByConfig); result is the capability tail and MAY
// perform a second network hop (batch's output_file_id -> GET /content), so it is
// async and takes an optional AbortSignal.
export interface JobAdapter<T> {
  config(): LifecycleConfig;
  poll(signal?: AbortSignal): Promise<PollBody>;
  classify(body: PollBody): Classification;
  result(body: PollBody, signal?: AbortSignal): Promise<T>;
}

// classifyByConfig is the shared config-driven default classifier. Precedence
// done > error > running: a status in doneValues -> succeeded; in errorValues ->
// failed (message extracted); in NEITHER set -> running (poll on, bounded by the
// backstop). So an unmodeled/new terminal degrades to a bounded timeout — never a
// false success and never a false failure of a live job (safe-degradation, S01).
export function classifyByConfig(
  lc: LifecycleConfig,
  body: PollBody,
): Classification {
  const status = body.status(lc.statusPath);
  for (const d of lc.doneValues) {
    if (status === d) {
      return { state: "succeeded", rawStatus: status };
    }
  }
  for (const e of lc.errorValues) {
    if (status === e) {
      const failure: JobFailure = {
        status,
        message: lc.errorMessagePath ? body.status(lc.errorMessagePath) : "",
        timedOut: false,
      };
      return { state: "failed", failure, rawStatus: status };
    }
  }
  return { state: "running", rawStatus: status };
}

// jobFailedMessage renders a provider-reported failure as "<noun> failed: <detail>",
// preserving each capability's error surface via LifecycleConfig.noun (S02).
function jobFailedMessage(noun: string, failure: JobFailure): string {
  const detail = failure.message || failure.status;
  return detail ? `${noun} failed: ${detail}` : `${noun} failed`;
}

// pollOnce runs a single engine iteration: poll -> classify -> (on success) the
// capability result tail, including any second network hop. It is poll()'s body
// and pollJob's per-iteration step — no loop, no deadline (ADR-063 POLL-001).
export async function pollOnce<T>(
  adapter: JobAdapter<T>,
  signal?: AbortSignal,
): Promise<JobStatus<T>> {
  const body = await adapter.poll(signal);
  const c = adapter.classify(body);
  const st: JobStatus<T> = { state: c.state, rawStatus: c.rawStatus };
  if (c.state === "succeeded") {
    st.result = await adapter.result(body, signal);
  } else if (c.state === "failed") {
    st.cause = c.failure;
  }
  return st;
}

// pollJob is the shared engine (ADR-062). It loops pollOnce on the configured
// cadence until the first terminal classification or the deadline backstop,
// honoring the optional AbortSignal both between polls and during the sleep (S06).
// Monotonicity is a consequence of returning on the first terminal, not of any
// stored state. A provider-reported failure throws an APIError carrying the
// "<noun> failed: <msg>" surface; the backstop throws PollTimeoutError (POLL-008).
export async function pollJob<T>(
  adapter: JobAdapter<T>,
  signal?: AbortSignal,
): Promise<T> {
  const lc = adapter.config();
  const interval = lc.pollIntervalMs > 0 ? lc.pollIntervalMs : 2000;
  const deadline = lc.pollTimeoutMs > 0 ? performance.now() + lc.pollTimeoutMs : 0;

  while (true) {
    signal?.throwIfAborted();
    const st = await pollOnce(adapter, signal);
    if (st.state === "succeeded") {
      return st.result as T;
    }
    if (st.state === "failed") {
      throw new APIError(0, jobFailedMessage(lc.noun, st.cause!), false);
    }
    // Still running: fire the deadline backstop, then sleep (abort-aware).
    if (deadline > 0 && performance.now() > deadline) {
      throw new PollTimeoutError(
        `${lc.noun} poll: timed out; the job may still be running — poll the handle across requests, or raise the deadline with pollTimeoutMs`,
      );
    }
    await sleep(interval, signal);
  }
}

// nonEmptyValues filters out empty strings so a provider that leaves a status
// value unset contributes an empty set rather than a value that would match a
// missing/empty poll status. Mirror of go nonEmptyValues.
export function nonEmptyValues(...values: string[]): string[] {
  return values.filter((v) => v !== "");
}

// sleep resolves after ms, or rejects promptly with the abort reason when the
// optional signal is triggered mid-sleep (S06). No dependency — WHATWG AbortSignal.
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
