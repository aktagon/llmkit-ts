// Phase 3 slice 2b — wires Text.stream against the legacy
// promptStream callback API. The codegen-emitted Text.stream method
// delegates to `textStream(this, msg)` (see TS_BUILDER_SKIP_TERMINALS
// in codegen/generate.py).
//
// The bridge: legacy promptStream takes an onChunk callback and
// resolves with a final Response when streaming completes. The
// typed-builder API exposes an AsyncIterable<string>. We adapt by
// running promptStream concurrently with the iterator, parking
// chunks in an in-memory queue and waking the iterator when each
// chunk arrives.
//
// Cancellation: the consumer's `for await ... break` triggers the
// generator's `finally` block; we abort the underlying fetch via
// AbortController so the producer task unwinds promptly. AbortError
// from a consumer-initiated abort is swallowed (clean cancellation);
// any other producer error is re-thrown to the consumer at the next
// pull.

import { promptStream as legacyPromptStream } from "../llmkit.ts";
import type { Text } from "./builders.ts";
import { buildRequest } from "./text.ts";

// Maximum chunks held in the bridge queue before the producer
// pauses. Matches Go chan(64) and Python asyncio.Queue(maxsize=64)
// for cross-SDK consistency. A hostile or buggy provider streaming
// faster than the consumer drains will block at this ceiling
// instead of growing the queue unboundedly.
const STREAM_QUEUE_MAX = 64;

export async function* textStream(b: Text, msg: string): AsyncIterable<string> {
  const { provider, request, options } = buildRequest(b, msg);
  const ac = new AbortController();
  const opts = { ...options, signal: ac.signal };

  const queue: string[] = [];
  let consumerWaiter: { resolve: () => void } | null = null;
  let producerWaiter: { resolve: () => void } | null = null;
  let done = false;
  let error: Error | null = null;

  const wakeConsumer = () => {
    const w = consumerWaiter;
    consumerWaiter = null;
    w?.resolve();
  };

  const wakeProducer = () => {
    const w = producerWaiter;
    producerWaiter = null;
    w?.resolve();
  };

  legacyPromptStream(
    provider,
    request,
    async (chunk) => {
      queue.push(chunk);
      wakeConsumer();
      // Backpressure: wait for consumer to drain when at capacity.
      // promptStream awaits this Promise (its onChunk type is now
      // `(text: string) => void | Promise<void>`), so the underlying
      // SSE reader pauses until space frees up.
      while (queue.length >= STREAM_QUEUE_MAX) {
        await new Promise<void>((resolve) => {
          producerWaiter = { resolve };
        });
      }
    },
    opts,
  ).then(
    () => {
      done = true;
      wakeConsumer();
    },
    (err) => {
      // Consumer-initiated abort is clean cancellation, not an error.
      if (!(err instanceof Error) || err.name !== "AbortError") {
        error = err instanceof Error ? err : new Error(String(err));
      }
      done = true;
      wakeConsumer();
    },
  );

  try {
    while (true) {
      if (queue.length > 0) {
        const chunk = queue.shift() as string;
        wakeProducer();
        yield chunk;
        continue;
      }
      if (done) {
        if (error) throw error;
        return;
      }
      await new Promise<void>((resolve) => {
        consumerWaiter = { resolve };
      });
    }
  } finally {
    if (!done) ac.abort();
    // Unblock any parked producer so it can observe abort and exit.
    wakeProducer();
  }
}
