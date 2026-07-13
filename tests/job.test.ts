// Job-engine public-surface tests (ADR-062 / ADR-063) — mirror of go/job_test.go.
// Covers the new poll() primitive (one normalized round-trip), wait()'s
// "<noun> failed: <msg>" surface, the deadline backstop -> PollTimeoutError, a
// provider failure classified on the first poll (NOT a timeout), and S06 abort.

import { describe, test, expect } from "bun:test";
import { Providers } from "../src/providers/providers.ts";
import type { Provider } from "../src/types.ts";
import { TranscriptionHandle } from "../src/builders/transcription.ts";
import { BatchHandle } from "../src/builders/batch.ts";
import { PollTimeoutError, APIError } from "../src/errors.ts";

// completedTranscript is the AssemblyAI transcript object on terminal success.
function completedTranscript(): Record<string, unknown> {
  return {
    id: "transcript-7c2",
    status: "completed",
    text: "The quarterly review is scheduled for Tuesday.",
    words: [
      { text: "The", start: 120, end: 280, speaker: "A" },
      { text: "quarterly", start: 280, end: 760 },
    ],
  };
}

// assemblyAIPollServer serves GET /v2/transcript/{id}: pending for the first
// `pendingPolls` calls, then `doneBody`.
function assemblyAIPollServer(
  pendingPolls: number,
  doneBody: Record<string, unknown>,
) {
  let polls = 0;
  return Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname.includes("/v2/transcript/")) {
        polls += 1;
        if (polls <= pendingPolls) {
          return new Response(
            JSON.stringify({ id: "transcript-7c2", status: "processing" }),
            { headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify(doneBody), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected " + url.pathname, { status: 404 });
    },
  });
}

function assemblyAIHandle(baseUrl: string): TranscriptionHandle {
  const provider: Provider = {
    name: Providers.assemblyai,
    apiKey: "test-key",
    baseUrl,
  };
  return new TranscriptionHandle("transcript-7c2", provider);
}

// batchPollServer serves GET /v1/batches/{id} with a fixed status.
function batchPollServer(status: string) {
  return Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname.startsWith("/v1/batches/")) {
        return new Response(JSON.stringify({ id: "batch_1", status }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected " + url.pathname, { status: 404 });
    },
  });
}

function openAIBatchHandle(baseUrl: string): BatchHandle {
  const provider: Provider = {
    name: Providers.openai,
    apiKey: "test-key",
    baseUrl,
  };
  return new BatchHandle("batch_1", provider);
}

describe("TranscriptionHandle.poll (ADR-063 POLL-001)", () => {
  test("poll on a completed job -> succeeded with result inline, no cause", async () => {
    const server = assemblyAIPollServer(0, completedTranscript());
    try {
      const st = await assemblyAIHandle(
        `http://localhost:${server.port}`,
      ).poll();
      expect(st.state).toBe("succeeded");
      expect(st.rawStatus).toBe("completed");
      expect(st.cause).toBeUndefined();
      expect(st.result).toBeDefined();
      expect(st.result!.text).toBe(
        "The quarterly review is scheduled for Tuesday.",
      );
    } finally {
      server.stop(true);
    }
  });

  test("poll on an in-progress job -> running, no result and no cause", async () => {
    const server = assemblyAIPollServer(5, completedTranscript());
    try {
      const st = await assemblyAIHandle(
        `http://localhost:${server.port}`,
      ).poll();
      expect(st.state).toBe("running");
      expect(st.rawStatus).toBe("processing");
      expect(st.result).toBeUndefined();
      expect(st.cause).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("poll on a failed job -> failed with the provider message on cause", async () => {
    const failed = {
      id: "transcript-7c2",
      status: "error",
      error:
        "Download error, unable to download https://storage.example.com/meeting.mp3",
    };
    const server = assemblyAIPollServer(0, failed);
    try {
      const st = await assemblyAIHandle(
        `http://localhost:${server.port}`,
      ).poll();
      expect(st.state).toBe("failed");
      expect(st.result).toBeUndefined();
      expect(st.cause).toBeDefined();
      expect(st.cause!.status).toBe("error");
      expect(st.cause!.message).toContain("Download error");
      expect(st.cause!.timedOut).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});

describe("TranscriptionHandle.wait failure surface (S02 / POLL-008)", () => {
  test('wait on a failed job throws "transcription failed: <msg>", not PollTimeoutError', async () => {
    const failed = {
      id: "transcript-7c2",
      status: "error",
      error: "Download error, unable to download the source audio",
    };
    const server = assemblyAIPollServer(0, failed);
    try {
      const p = assemblyAIHandle(`http://localhost:${server.port}`).wait({
        pollIntervalMs: 1,
      });
      await expect(p).rejects.toThrow(/^transcription failed: .*Download error/);
      await expect(p).rejects.not.toBeInstanceOf(PollTimeoutError);
    } finally {
      server.stop(true);
    }
  });
});

describe("BatchHandle.poll (ADR-063)", () => {
  test("poll on an in-progress batch -> running, no two-hop result fetch", async () => {
    const server = batchPollServer("in_progress");
    try {
      const st = await openAIBatchHandle(
        `http://localhost:${server.port}`,
      ).poll();
      expect(st.state).toBe("running");
      expect(st.rawStatus).toBe("in_progress");
      expect(st.result).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("poll on a provider-failed batch -> failed on the FIRST poll (pollingErrorValues)", async () => {
    const server = batchPollServer("failed");
    try {
      const st = await openAIBatchHandle(
        `http://localhost:${server.port}`,
      ).poll();
      expect(st.state).toBe("failed");
      expect(st.result).toBeUndefined();
      expect(st.cause).toBeDefined();
      expect(st.cause!.status).toBe("failed");
      expect(st.cause!.timedOut).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});

describe("waitBatch backstop + failure (ADR-062 OQ-1 / POLL-008)", () => {
  test('failed batch -> "batch failed: <status>", not PollTimeoutError', async () => {
    const server = batchPollServer("expired");
    try {
      const p = openAIBatchHandle(`http://localhost:${server.port}`).wait({
        pollIntervalMs: 1,
        pollTimeoutMs: 60 * 60 * 1000,
      });
      await expect(p).rejects.toThrow(/^batch failed: expired/);
      await expect(p).rejects.not.toBeInstanceOf(PollTimeoutError);
    } finally {
      server.stop(true);
    }
  });

  test("a never-completing batch terminates at the deadline backstop -> PollTimeoutError", async () => {
    const server = batchPollServer("in_progress");
    try {
      const p = openAIBatchHandle(`http://localhost:${server.port}`).wait({
        pollIntervalMs: 1,
        pollTimeoutMs: 20,
      });
      await expect(p).rejects.toBeInstanceOf(PollTimeoutError);
    } finally {
      server.stop(true);
    }
  });
});

describe("wait abort (S06)", () => {
  test("an aborted signal rejects the poll loop early", async () => {
    const server = batchPollServer("in_progress");
    try {
      const controller = new AbortController();
      const p = openAIBatchHandle(`http://localhost:${server.port}`).wait({
        pollIntervalMs: 50,
        pollTimeoutMs: 60 * 60 * 1000,
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(new Error("caller cancelled")), 5);
      await expect(p).rejects.toThrow("caller cancelled");
      // Not a timeout, not a provider failure — a caller-driven cancel.
      await expect(p).rejects.not.toBeInstanceOf(PollTimeoutError);
      await expect(p).rejects.not.toBeInstanceOf(APIError);
    } finally {
      server.stop(true);
    }
  });
});
