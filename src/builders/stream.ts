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

export async function* textStream(b: Text, msg: string): AsyncIterable<string> {
  const { provider, request, options } = buildRequest(b, msg);
  const ac = new AbortController();
  const opts = { ...options, signal: ac.signal };

  const queue: string[] = [];
  let waiter: { resolve: () => void } | null = null;
  let done = false;
  let error: Error | null = null;

  const wake = () => {
    const w = waiter;
    waiter = null;
    w?.resolve();
  };

  legacyPromptStream(
    provider,
    request,
    (chunk) => {
      queue.push(chunk);
      wake();
    },
    opts,
  ).then(
    () => {
      done = true;
      wake();
    },
    (err) => {
      // Consumer-initiated abort is clean cancellation, not an error.
      if (!(err instanceof Error) || err.name !== "AbortError") {
        error = err instanceof Error ? err : new Error(String(err));
      }
      done = true;
      wake();
    },
  );

  try {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift() as string;
        continue;
      }
      if (done) {
        if (error) throw error;
        return;
      }
      await new Promise<void>((resolve) => {
        waiter = { resolve };
      });
    }
  } finally {
    if (!done) ac.abort();
  }
}
