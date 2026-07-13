//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//

import { APIError, PollTimeoutError } from "./errors.ts";
import { extractPath } from "./paths.ts";

//
//
//
//
//
export type JobState = "running" | "succeeded" | "failed";

//
//
//
export interface JobFailure {
  //
  //
  //
  status: string;
  //
  //
  message: string;
  //
  //
  timedOut: boolean;
}

//
//
//
export interface JobStatus<T> {
  state: JobState;
  //
  //
  result?: T;
  //
  cause?: JobFailure;
  //
  //
  rawStatus: string;
}

//
//
//
export interface LifecycleConfig {
  //
  //
  noun: string;
  //
  statusPath: string;
  //
  //
  doneValues: string[];
  //
  //
  errorValues: string[];
  //
  //
  errorMessagePath: string;
  //
  pollIntervalMs: number;
  //
  //
  pollTimeoutMs: number;
}

//
//
//
export class PollBody {
  constructor(readonly raw: Record<string, unknown>) {}

  //
  status(path: string): string {
    return extractPath(this.raw, path);
  }
}

//
//
export interface Classification {
  state: JobState;
  failure?: JobFailure;
  rawStatus: string;
}

//
//
//
//
export interface JobAdapter<T> {
  config(): LifecycleConfig;
  poll(signal?: AbortSignal): Promise<PollBody>;
  classify(body: PollBody): Classification;
  result(body: PollBody, signal?: AbortSignal): Promise<T>;
}

//
//
//
//
//
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

//
//
function jobFailedMessage(noun: string, failure: JobFailure): string {
  const detail = failure.message || failure.status;
  return detail ? `${noun} failed: ${detail}` : `${noun} failed`;
}

//
//
//
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

//
//
//
//
//
//
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
    //
    if (deadline > 0 && performance.now() > deadline) {
      throw new PollTimeoutError(
        `${lc.noun} poll: timed out; the job may still be running — poll the handle across requests, or raise the deadline with pollTimeoutMs`,
      );
    }
    await sleep(interval, signal);
  }
}

//
//
//
export function nonEmptyValues(...values: string[]): string[] {
  return values.filter((v) => v !== "");
}

//
//
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
