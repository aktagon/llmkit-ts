// The one fetch every provider send path goes through (BUG-062). `timeoutMs`
// (Client.timeout) bounds how long the SDK waits for the NEXT bytes from the
// provider: the response headers, then every gap between body chunks. The
// timer runs only while a read is pending, so a long healthy stream never
// times out. 0 disables it; undefined (a Provider built by hand, e.g. to
// resume a handle across processes) takes DEFAULT_TIMEOUT_MS. On expiry the request aborts and the
// pending fetch / body read rejects with a DOMException named "TimeoutError",
// the same error AbortSignal.timeout raises. A caller's own signal still
// aborts the request; the two compose with AbortSignal.any.

import { DEFAULT_TIMEOUT_MS } from "./builders/builders.ts";

// Statuses that must not carry a body; new Response() throws on them.
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

export async function sendHTTP(
  url: string,
  init: RequestInit,
  timeoutMs: number | undefined,
): Promise<Response> {
  const ms = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (ms <= 0) return fetch(url, init);

  const ctl = new AbortController();
  const signal = init.signal ? AbortSignal.any([init.signal, ctl.signal]) : ctl.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectPendingRead: ((err: unknown) => void) | undefined;
  const arm = () => {
    timer = setTimeout(() => {
      const err = new DOMException(
        `no response bytes from the provider for ${ms} ms`,
        "TimeoutError",
      );
      ctl.abort(err);
      rejectPendingRead?.(err);
    }, ms);
  };
  const disarm = () => clearTimeout(timer);

  arm();
  let resp: Response;
  try {
    resp = await fetch(url, { ...init, signal });
  } finally {
    disarm();
  }
  if (!resp.body || NULL_BODY_STATUS.has(resp.status)) return resp;

  // Re-wrap the body so each read re-arms the timer. A read that races the
  // timer rejects through `stalled` even if the runtime does not propagate the
  // abort into an in-flight body read.
  const reader = resp.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const stalled = new Promise<never>((_, reject) => {
        rejectPendingRead = reject;
      });
      arm();
      try {
        const chunk = await Promise.race([reader.read(), stalled]);
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      } finally {
        disarm();
        rejectPendingRead = undefined;
      }
    },
    cancel(reason) {
      disarm();
      return reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
  });
}
