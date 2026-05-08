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
      //
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
