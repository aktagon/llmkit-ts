import { describe, test, expect } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";
import { ValidationError } from "../src/llmkit.ts";

const inworldTTS2 = "inworld-tts-2";

// A short fake WAV-ish payload — distinct bytes so round-trip asserts are real.
const fakeAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x57, 0x41]);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

describe("Speech.generate — Inworld (SpeechInworld)", () => {
  test("happy path: flat body, Basic auth (key verbatim), base64 round-trip", async () => {
    const encoded = bytesToBase64(fakeAudio);
    let receivedPath = "";
    let receivedAuth = "";
    let receivedBody: any;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedPath = new URL(req.url).pathname;
        receivedAuth = req.headers.get("authorization") ?? "";
        receivedBody = await req.json();
        return new Response(
          JSON.stringify({
            audioContent: encoded,
            usage: { processedCharactersCount: 18, modelId: inworldTTS2 },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    try {
      const c = newClient(Providers.inworld, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.speech
        .model(inworldTTS2)
        .voice("Dennis")
        .generate("Hello from llmkit.");

      expect(resp.audio.mimeType).toBe("audio/wav");
      expect(Array.from(resp.audio.bytes)).toEqual(Array.from(fakeAudio));
      expect(receivedPath).toBe("/tts/v1/voice");
      expect(receivedAuth).toBe("Basic test-token");
      expect(receivedBody).toEqual({
        text: "Hello from llmkit.",
        voiceId: "Dennis",
        modelId: inworldTTS2,
        audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 22050 },
        deliveryMode: "BALANCED",
      });
    } finally {
      server.stop(true);
    }
  });

  test("unknown voice is rejected pre-flight, before any HTTP call", async () => {
    let called = false;
    const server = Bun.serve({
      port: 0,
      fetch: async () => {
        called = true;
        return new Response("{}");
      },
    });
    try {
      const c = newClient(Providers.inworld, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await expect(
        c.speech.model(inworldTTS2).voice("Nonexistent").generate("Hi"),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(called).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("unknown model is rejected", async () => {
    const c = newClient(Providers.inworld, "test-token");
    await expect(
      c.speech.model("inworld-tts-99").voice("Dennis").generate("Hi"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("missing voice is rejected", async () => {
    const c = newClient(Providers.inworld, "test-token");
    await expect(
      c.speech.model(inworldTTS2).generate("Hi"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("unsupported provider is rejected", async () => {
    const c = newClient(Providers.openai, "test-token");
    await expect(
      c.speech.model(inworldTTS2).voice("Dennis").generate("Hi"),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
