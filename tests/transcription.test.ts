// Transcription (speech-to-text) mock-lifecycle tests — mirror of
// go/transcription_test.go. submit -> poll(processing) -> completed; the
// audioBytes upload hop; status=error -> terminal error; pre-flight rejections;
// unsupported provider.

import { describe, test, expect } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";
import { ValidationError, APIError } from "../src/llmkit.ts";
import { audio, audioBytes } from "../src/image.ts";

const FAST_WAIT = { pollIntervalMs: 1 };

const assemblyAIAudioURL =
  "https://storage.example.com/meeting-2026-06-24.mp3";

// completedTranscript is the AssemblyAI transcript object on terminal success:
// the full text plus word-level timing (start/end in milliseconds), with a
// diarized speaker label on the first word only.
function completedTranscript(): Record<string, unknown> {
  return {
    id: "transcript-7c2",
    status: "completed",
    text: "The quarterly review is scheduled for Tuesday.",
    words: [
      { text: "The", start: 120, end: 280, speaker: "A" },
      { text: "quarterly", start: 280, end: 760 },
      { text: "review", start: 760, end: 1100 },
    ],
  };
}

// assemblyAIServer serves the AssemblyAI upload + submit + poll endpoints. The
// poll returns `processing` for the first pendingPolls calls, then the supplied
// done body. uploadUrl, when non-empty, is returned from POST /v2/upload.
function assemblyAIServer(
  pendingPolls: number,
  doneBody: Record<string, unknown>,
  uploadUrl: string,
  onAuth?: (auth: string) => void,
  onUpload?: (contentType: string, byteLen: number) => void,
  onSubmit?: (body: Record<string, unknown>) => void,
) {
  let polls = 0;
  return Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      onAuth?.(req.headers.get("authorization") ?? "");
      if (req.method === "POST" && url.pathname.endsWith("/v2/upload")) {
        const raw = new Uint8Array(await req.arrayBuffer());
        onUpload?.(req.headers.get("content-type") ?? "", raw.byteLength);
        return new Response(JSON.stringify({ upload_url: uploadUrl }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (req.method === "POST" && url.pathname.endsWith("/v2/transcript")) {
        const body = (await req.json()) as Record<string, unknown>;
        onSubmit?.(body);
        return new Response(
          JSON.stringify({ id: "transcript-7c2", status: "queued" }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (
        req.method === "GET" &&
        url.pathname.includes("/v2/transcript/transcript-7c2")
      ) {
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

describe("Transcription.submit + wait — AssemblyAI", () => {
  test("submit -> poll(processing) -> completed, text + 3 timed segments", async () => {
    let receivedAuth = "";
    let submitBody: Record<string, unknown> | undefined;
    const server = assemblyAIServer(
      2,
      completedTranscript(),
      "",
      (auth) => {
        receivedAuth = auth;
      },
      undefined,
      (body) => {
        submitBody = body;
      },
    );
    try {
      const c = newClient(Providers.assemblyai, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;

      const handle = await c.transcription.submit(audio(assemblyAIAudioURL));
      expect(handle.id).toBe("transcript-7c2");
      // AssemblyAI auth: the raw key with no Bearer prefix (HeaderAPIKey).
      expect(receivedAuth).toBe("test-key");
      expect(submitBody!.audio_url).toBe(assemblyAIAudioURL);

      const resp = await handle.wait(FAST_WAIT);
      expect(resp.text).toBe(
        "The quarterly review is scheduled for Tuesday.",
      );
      expect(resp.segments).toHaveLength(3);
      expect(resp.segments[0]!.text).toBe("The");
      expect(resp.segments[0]!.start).toBe(120);
      expect(resp.segments[0]!.end).toBe(280);
      expect(resp.segments[0]!.speaker).toBe("A");
      expect(resp.segments[1]!.speaker).toBeUndefined();
      expect(resp.usage.input).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("audioBytes upload hop: POST raw octet-stream, submit references upload_url", async () => {
    const uploadedURL = "https://cdn.assemblyai.com/upload/abc123";
    let uploadContentType = "";
    let uploadByteLen = 0;
    let submitBody: Record<string, unknown> | undefined;
    const server = assemblyAIServer(
      1,
      completedTranscript(),
      uploadedURL,
      undefined,
      (ct, len) => {
        uploadContentType = ct;
        uploadByteLen = len;
      },
      (body) => {
        submitBody = body;
      },
    );
    try {
      const c = newClient(Providers.assemblyai, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;

      const wav = new TextEncoder().encode("RIFF....WAVEfmt fake-audio-bytes");
      const handle = await c.transcription.submit(audioBytes("audio/wav", wav));
      const resp = await handle.wait(FAST_WAIT);

      expect(uploadContentType).toBe("application/octet-stream");
      expect(uploadByteLen).toBe(wav.byteLength);
      expect(submitBody!.audio_url).toBe(uploadedURL);
      expect(resp.text).toBe(
        "The quarterly review is scheduled for Tuesday.",
      );
    } finally {
      server.stop(true);
    }
  });

  test("status=error surfaces as an error carrying the provider message", async () => {
    const failed = {
      id: "transcript-7c2",
      status: "error",
      error:
        "Download error, unable to download https://storage.example.com/meeting-2026-06-24.mp3",
    };
    const server = assemblyAIServer(1, failed, "");
    try {
      const c = newClient(Providers.assemblyai, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;

      const handle = await c.transcription.submit(audio(assemblyAIAudioURL));
      const p = handle.wait(FAST_WAIT);
      await expect(p).rejects.toBeInstanceOf(APIError);
      await expect(p).rejects.toThrow("Download error");
    } finally {
      server.stop(true);
    }
  });

  test("non-audio part is rejected pre-flight, before any HTTP call", async () => {
    const c = newClient(Providers.assemblyai, "test-key");
    await expect(
      c.transcription.submit({ text: "transcribe this please" }),
    ).rejects.toThrow("only audio parts");
  });

  test("requires exactly one audio part (two rejected, zero rejected)", async () => {
    const c = newClient(Providers.assemblyai, "test-key");
    await expect(
      c.transcription.submit(
        audio(assemblyAIAudioURL),
        audio("https://storage.example.com/other.mp3"),
      ),
    ).rejects.toThrow("exactly one audio part");
    await expect(c.transcription.submit()).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("unsupported provider is rejected", async () => {
    // Anthropic does not support transcription (OpenAI now does, ADR-051).
    const c = newClient(Providers.anthropic, "test-key");
    await expect(
      c.transcription.submit(audio(assemblyAIAudioURL)),
    ).rejects.toThrow("does not support transcription");
  });
});

// === Synchronous transcription — OpenAI (TranscriptionOpenAI, ADR-051) ===

describe("Transcription.transcribe — OpenAI (sync multipart)", () => {
  const FAKE_MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x6d, 0x70, 0x33]);

  // OpenAI verbose_json: text + segments with start/end in SECONDS (float).
  function openaiVerboseTranscript(): Record<string, unknown> {
    return {
      text: "The quarterly review is scheduled for Tuesday.",
      segments: [
        { start: 0.0, end: 1.5, text: "The quarterly review" },
        { start: 1.5, end: 2.84, text: " is scheduled for Tuesday." },
      ],
    };
  }

  // Serves POST /v1/audio/transcriptions; parses the multipart body and exposes
  // the captured fields for assertion.
  function openaiServer(
    respBody: Record<string, unknown>,
    capture: (fields: {
      model: string;
      responseFormat: string;
      fileType: string;
      fileName: string;
    }) => void,
  ) {
    return Bun.serve({
      port: 0,
      fetch: async (req) => {
        if (new URL(req.url).pathname !== "/v1/audio/transcriptions") {
          return new Response("bad path", { status: 404 });
        }
        if (req.headers.get("authorization") !== "Bearer test-key") {
          return new Response("bad auth", { status: 401 });
        }
        const form = await req.formData();
        const file = form.get("file") as File;
        capture({
          model: String(form.get("model")),
          responseFormat: String(form.get("response_format")),
          fileType: file.type,
          fileName: file.name,
        });
        return new Response(JSON.stringify(respBody), {
          headers: { "content-type": "application/json" },
        });
      },
    });
  }

  test("happy path: multipart fields + verbose_json segments (sec -> ms)", async () => {
    let captured: any;
    const server = openaiServer(openaiVerboseTranscript(), (f) => {
      captured = f;
    });
    try {
      const c = newClient(Providers.openai, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.transcription
        .model("whisper-1")
        .transcribe(audioBytes("audio/mpeg", FAKE_MP3));

      expect(resp.text).toBe("The quarterly review is scheduled for Tuesday.");
      expect(resp.segments.length).toBe(2);
      expect(resp.segments[0]!.end).toBe(1500);
      expect(resp.segments[1]!.end).toBe(2840);
      expect(captured.model).toBe("whisper-1");
      expect(captured.responseFormat).toBe("verbose_json");
      expect(captured.fileType).toBe("audio/mpeg");
      expect(captured.fileName).toBe("audio.mp3");
    } finally {
      server.stop(true);
    }
  });

  test("models without verbose_json -> empty segments, not an error", async () => {
    const server = openaiServer({ text: "Hello there." }, () => {});
    try {
      const c = newClient(Providers.openai, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.transcription
        .model("whisper-1")
        .transcribe(audioBytes("audio/mpeg", FAKE_MP3));
      expect(resp.text).toBe("Hello there.");
      expect(resp.segments.length).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("submit on a sync provider is rejected, naming Transcribe", async () => {
    const c = newClient(Providers.openai, "test-key");
    await expect(
      c.transcription.model("whisper-1").submit(audioBytes("audio/mpeg", FAKE_MP3)),
    ).rejects.toThrow("Transcribe");
  });

  test("transcribe on an async provider is rejected, naming Submit/Wait", async () => {
    const c = newClient(Providers.assemblyai, "test-key");
    await expect(
      c.transcription.model("best").transcribe(audioBytes("audio/mpeg", FAKE_MP3)),
    ).rejects.toThrow("Submit/Wait");
  });

  test("a remote audio URL is rejected for OpenAI", async () => {
    const c = newClient(Providers.openai, "test-key");
    await expect(
      c.transcription.model("whisper-1").transcribe(audio(assemblyAIAudioURL)),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("missing model is rejected", async () => {
    const c = newClient(Providers.openai, "test-key");
    await expect(
      c.transcription.transcribe(audioBytes("audio/mpeg", FAKE_MP3)),
    ).rejects.toThrow("model");
  });
});
