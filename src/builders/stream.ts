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

//
//
//
//
//
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
      //
      //
      //
      //
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
      //
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
    //
    wakeProducer();
  }
}
