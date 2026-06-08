import { describe, test, expect, afterEach } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";
import { MiddlewareVetoError, ValidationError } from "../src/llmkit.ts";

const vertexModel = "lyria-002";
const googleModel = "lyria-3-pro-preview";
const minimaxModel = "music-2.6";

// A short fake WAV-ish payload — distinct bytes so round-trip asserts are real.
const fakeAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03]);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ===== Vertex Lyria 2 (MusicPredict wire shape) =====

describe("Music.generate — Vertex Lyria 2 (MusicPredict)", () => {
  test("happy path: instances/parameters body, bearer auth, base64 round-trip", async () => {
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
            predictions: [
              { audioContent: encoded, mimeType: "audio/wav" },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    try {
      const c = newClient(Providers.vertex, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.music
        .model(vertexModel)
        .generate("Upbeat synthwave instrumental");

      expect(receivedPath).toBe(`/${vertexModel}:predict`);
      expect(receivedAuth).toBe("Bearer test-token");
      expect(receivedBody.instances).toHaveLength(1);
      expect(receivedBody.instances[0].prompt).toBe(
        "Upbeat synthwave instrumental",
      );
      expect(receivedBody.parameters.sampleCount).toBe(1);

      expect(resp.audio.length).toBe(1);
      expect(resp.audio[0]!.mimeType).toBe("audio/wav");
      expect(Array.from(resp.audio[0]!.bytes)).toEqual(Array.from(fakeAudio));
      expect(resp.text).toBe("");
      expect(resp.usage.input).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("surfaces raiFilteredReason as finishReason when blocked", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          JSON.stringify({
            predictions: [{ raiFilteredReason: "Blocked by safety filter" }],
          }),
        ),
    });
    try {
      const c = newClient(Providers.vertex, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.music.model(vertexModel).generate("blocked prompt");
      expect(resp.audio.length).toBe(0);
      expect(resp.finishReason).toBe("Blocked by safety filter");
    } finally {
      server.stop(true);
    }
  });

  test("rejects lyrics on instrumental-only model", async () => {
    const c = newClient(Providers.vertex, "test-token");
    c.provider.baseUrl = "http://unused";
    let err: unknown;
    try {
      await c.music.model(vertexModel).lyrics("la la la").generate("a song");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("parts");
  });
});

// ===== Google Lyria 3 (MusicGenerateContent wire shape) =====

describe("Music.generate — Google Lyria 3 (MusicGenerateContent)", () => {
  test("happy path: contents/parts body, query-param auth, base64 round-trip", async () => {
    const encoded = bytesToBase64(fakeAudio);
    let receivedPath = "";
    let receivedKey = "";
    let receivedBody: any;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        receivedPath = url.pathname;
        receivedKey = url.searchParams.get("key") ?? "";
        receivedBody = await req.json();
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { text: "Verse 1: ..." },
                    {
                      inlineData: { mimeType: "audio/mpeg", data: encoded },
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    try {
      const c = newClient(Providers.google, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.music
        .model(googleModel)
        .generate("A cheerful pop tune");

      expect(receivedPath).toContain(`${googleModel}:generateContent`);
      expect(receivedKey).toBe("test-key");
      expect(receivedBody.contents).toHaveLength(1);
      expect(receivedBody.contents[0].parts).toEqual([
        { text: "A cheerful pop tune" },
      ]);
      expect(receivedBody.generationConfig.responseModalities).toEqual([
        "AUDIO",
      ]);

      expect(resp.audio.length).toBe(1);
      expect(resp.audio[0]!.mimeType).toBe("audio/mpeg");
      expect(Array.from(resp.audio[0]!.bytes)).toEqual(Array.from(fakeAudio));
      expect(resp.text).toBe("Verse 1: ...");
      expect(resp.finishReason).toBe("STOP");
    } finally {
      server.stop(true);
    }
  });

  test("lyrics part serialises as a {text} part in caller order", async () => {
    const encoded = bytesToBase64(fakeAudio);
    let receivedBody: any;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: { mimeType: "audio/mpeg", data: encoded },
                    },
                  ],
                },
              },
            ],
          }),
        );
      },
    });
    try {
      const c = newClient(Providers.google, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.music
        .model(googleModel)
        .text("A ballad")
        .lyrics("Hello darkness my old friend")
        .generate("");

      expect(receivedBody.contents[0].parts).toEqual([
        { text: "A ballad" },
        { text: "Hello darkness my old friend" },
      ]);
    } finally {
      server.stop(true);
    }
  });
});

// ===== MiniMax Music 2.6 (MusicMinimax wire shape) =====
//
// MiniMax's genEndpoint is an absolute https URL, so this branch mocks the
// global fetch rather than overriding baseUrl.

describe("Music.generate — MiniMax (MusicMinimax)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("happy path: hex round-trip, lyrics + prompt split, absolute URL", async () => {
    const hexAudio = bytesToHex(fakeAudio);
    let receivedUrl = "";
    let receivedAuth = "";
    let receivedBody: any;
    globalThis.fetch = (async (input: any, init: any) => {
      receivedUrl = typeof input === "string" ? input : input.url;
      const h = init?.headers ?? {};
      receivedAuth = h["Authorization"] ?? h["authorization"] ?? "";
      receivedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          data: { audio: hexAudio },
          base_resp: { status_code: 0, status_msg: "success" },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const c = newClient(Providers.minimax, "mm-key");
    const resp = await c.music
      .model(minimaxModel)
      .lyrics("Sing a song of sixpence")
      .generate("A nursery rhyme melody");

    expect(receivedUrl).toBe("https://api.minimax.io/v1/music_generation");
    expect(receivedAuth).toBe("Bearer mm-key");
    expect(receivedBody.model).toBe(minimaxModel);
    expect(receivedBody.prompt).toBe("A nursery rhyme melody");
    expect(receivedBody.lyrics).toBe("Sing a song of sixpence");
    expect(receivedBody.output_format).toBe("hex");
    expect(receivedBody.audio_setting).toEqual({
      sample_rate: 44100,
      bitrate: 128000,
      format: "mp3",
    });

    expect(resp.audio.length).toBe(1);
    expect(resp.audio[0]!.mimeType).toBe("audio/mpeg");
    expect(Array.from(resp.audio[0]!.bytes)).toEqual(Array.from(fakeAudio));
  });

  test("non-success base_resp status_msg surfaces as finishMessage", async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          data: {},
          base_resp: { status_code: 1004, status_msg: "rate limited" },
        }),
      );
    }) as unknown as typeof fetch;

    const c = newClient(Providers.minimax, "mm-key");
    const resp = await c.music.model(minimaxModel).generate("x");
    expect(resp.audio.length).toBe(0);
    expect(resp.finishMessage).toBe("rate limited");
  });
});

// ===== Pre-flight validation =====

describe("Music.generate — pre-flight validation", () => {
  test("rejects image parts", async () => {
    const c = newClient(Providers.google, "k");
    c.provider.baseUrl = "http://unused";
    let err: unknown;
    try {
      // The image() chain method exists on Music (shared Part accumulator),
      // so an image part can reach the runtime and must be rejected there.
      const builder: any = c.music.model(googleModel);
      builder._parts = [
        { image: { mimeType: "image/png", bytes: new Uint8Array([0x89]) } },
      ];
      await builder.generate("a song");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("parts[0]");
  });

  test("requires model", async () => {
    const c = newClient(Providers.google, "k");
    let err: unknown;
    try {
      await c.music.generate("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("model");
  });

  test("rejects when neither parts accumulator nor generate msg is set", async () => {
    const c = newClient(Providers.google, "k");
    c.provider.baseUrl = "http://unused";
    let err: unknown;
    try {
      await c.music.model(googleModel).generate("");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("prompt");
  });

  test("rejects unknown music model", async () => {
    const c = newClient(Providers.google, "k");
    c.provider.baseUrl = "http://unused";
    let err: unknown;
    try {
      await c.music.model("not-a-real-model").generate("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("model");
  });

  test("rejects provider without music support", async () => {
    const c = newClient(Providers.openai, "k");
    c.provider.baseUrl = "http://unused";
    let err: unknown;
    try {
      await c.music.model("anything").generate("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("provider");
  });
});

// ===== Middleware =====

describe("Music.generate — middleware", () => {
  test("fires pre+post in order", async () => {
    const encoded = bytesToBase64(fakeAudio);
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          JSON.stringify({
            predictions: [{ audioContent: encoded, mimeType: "audio/wav" }],
          }),
        ),
    });
    try {
      const ops: string[] = [];
      const phases: string[] = [];
      const mw = (_ctx: unknown, ev: any) => {
        ops.push(ev.op);
        phases.push(ev.phase);
        return null;
      };
      const c = newClient(Providers.vertex, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.music.model(vertexModel).addMiddleware(mw).generate("x");
      expect(ops).toEqual(["music_generation", "music_generation"]);
      expect(phases).toEqual(["pre", "post"]);
    } finally {
      server.stop(true);
    }
  });

  test("pre-phase veto aborts before HTTP", async () => {
    let httpHit = false;
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        httpHit = true;
        return new Response("{}");
      },
    });
    try {
      const mw = (_ctx: unknown, ev: any) => {
        if (ev.phase === "pre") return new Error("no music today");
        return null;
      };
      const c = newClient(Providers.vertex, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      let err: unknown;
      try {
        await c.music.model(vertexModel).addMiddleware(mw).generate("x");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(MiddlewareVetoError);
      expect(httpHit).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});

// ===== Raw opt-in (ADR-014) =====

describe("Music.generate — raw opt-in", () => {
  test("populates raw with parsed provider body when .raw() set", async () => {
    const encoded = bytesToBase64(fakeAudio);
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          JSON.stringify({
            predictions: [{ audioContent: encoded, mimeType: "audio/wav" }],
          }),
        ),
    });
    try {
      const c = newClient(Providers.vertex, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.music.model(vertexModel).raw().generate("x");
      expect(resp.raw).toBeDefined();
      expect((resp.raw as any).predictions).toHaveLength(1);
    } finally {
      server.stop(true);
    }
  });
});
