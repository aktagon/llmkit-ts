import { describe, test, expect } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";
import { MiddlewareVetoError, ValidationError } from "../src/llmkit.ts";

const flashModel = "gemini-3.1-flash-image-preview";
const proModel = "gemini-3-pro-image-preview";

const fakePNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

describe("Image.generate — Google Flash", () => {
  test("happy path: round-trips inline base64 image and reports usage", async () => {
    const encoded = bytesToBase64(fakePNG);
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
                    { inlineData: { mimeType: "image/png", data: encoded } },
                  ],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 1290 },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    try {
      const c = newClient(Providers.google, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.image
        .model(flashModel)
        .aspectRatio("16:9")
        .imageSize("2K")
        .generate("A nano banana dish");

      expect(receivedPath).toContain(`${flashModel}:generateContent`);
      expect(receivedKey).toBe("test-key");
      expect(receivedBody.generationConfig.responseModalities).toEqual([
        "IMAGE",
      ]);
      expect(receivedBody.generationConfig.imageConfig.aspectRatio).toBe(
        "16:9",
      );
      expect(receivedBody.generationConfig.imageConfig.imageSize).toBe("2K");

      expect(resp.images.length).toBe(1);
      expect(resp.images[0]!.mimeType).toBe("image/png");
      expect(Array.from(resp.images[0]!.bytes)).toEqual(Array.from(fakePNG));
      expect(resp.tokens.input).toBe(12);
      expect(resp.tokens.output).toBe(1290);
      expect(resp.text).toBe("");
    } finally {
      server.stop(true);
    }
  });
});

describe("Image.generate — includeText", () => {
  test("captures text parts when includeText is set", async () => {
    const encoded = bytesToBase64(fakePNG);
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
                    { text: "Here is your image:" },
                    { inlineData: { mimeType: "image/png", data: encoded } },
                  ],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 100 },
          }),
        );
      },
    });
    try {
      const c = newClient(Providers.google, "k");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.image.model(flashModel).includeText().generate("x");
      expect(receivedBody.generationConfig.responseModalities).toEqual([
        "TEXT",
        "IMAGE",
      ]);
      expect(resp.text).toBe("Here is your image:");
    } finally {
      server.stop(true);
    }
  });
});

describe("Image.generate — Parts (canonical multimodal)", () => {
  test("preserves caller-controlled positional ordering on the wire", async () => {
    // ADR-008's motivating scenario: text and reference images interleaved
    // so the model attends to the description-image pairing as intended.
    const encoded = bytesToBase64(fakePNG);
    const refA = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x41]);
    const refB = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x42]);
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
                    { inlineData: { mimeType: "image/png", data: encoded } },
                  ],
                },
              },
            ],
          }),
        );
      },
    });
    try {
      const c = newClient(Providers.google, "k");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image
        .model(flashModel)
        .text("Person:")
        .image("image/png", refA)
        .text("Outfit:")
        .image("image/png", refB)
        .generate("Generate the person wearing the outfit.");
      const parts = receivedBody.contents[0].parts;
      expect(parts.length).toBe(5);
      expect(parts[0].text).toBe("Person:");
      expect(Array.from(base64ToBytes(parts[1].inlineData.data))).toEqual(
        Array.from(refA),
      );
      expect(parts[2].text).toBe("Outfit:");
      expect(Array.from(base64ToBytes(parts[3].inlineData.data))).toEqual(
        Array.from(refB),
      );
      expect(parts[4].text).toBe("Generate the person wearing the outfit.");
    } finally {
      server.stop(true);
    }
  });
});

describe("Image.generate — pre-flight validation", () => {
  test("rejects unsupported aspect ratio on Pro", async () => {
    let err: unknown;
    try {
      const c = newClient(Providers.google, "k");
      c.provider.baseUrl = "http://unused";
      await c.image.model(proModel).aspectRatio("8:1").generate("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("aspect_ratio");
  });

  test("rejects 512 size on Pro", async () => {
    let err: unknown;
    try {
      const c = newClient(Providers.google, "k");
      c.provider.baseUrl = "http://unused";
      await c.image.model(proModel).imageSize("512").generate("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("image_size");
  });

  test("rejects too many image parts", async () => {
    let err: unknown;
    try {
      const c = newClient(Providers.google, "k");
      c.provider.baseUrl = "http://unused";
      let img = c.image.model(flashModel).text("describe and edit:");
      for (let i = 0; i < 15; i++) img = img.image("image/png", fakePNG);
      await img.generate("");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("parts");
  });

  // The "both prompt and parts set" XOR test from the legacy free-function
  // surface is no longer reachable via typed-builder: chain methods either
  // accumulate parts or pass a final-text msg, never both as a free-form
  // pair. The only remaining "neither" condition is exercised below.

  test("rejects when neither parts accumulator nor generate msg is set", async () => {
    let err: unknown;
    try {
      const c = newClient(Providers.google, "k");
      c.provider.baseUrl = "http://unused";
      await c.image.model(flashModel).generate("");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("prompt");
  });

  test("requires model", async () => {
    let err: unknown;
    try {
      const c = newClient(Providers.google, "k");
      await c.image.generate("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("model");
  });
});

describe("Image.generate — middleware", () => {
  test("fires pre+post in order", async () => {
    const encoded = bytesToBase64(fakePNG);
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { inlineData: { mimeType: "image/png", data: encoded } },
                  ],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 },
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
      const c = newClient(Providers.google, "k");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image.model(flashModel).middleware(mw).generate("x");
      expect(ops).toEqual(["image_generation", "image_generation"]);
      expect(phases).toEqual(["pre", "post"]);
    } finally {
      server.stop(true);
    }
  });

  test("pre-phase veto aborts before HTTP", async () => {
    const mw = (_ctx: unknown, ev: any) => {
      if (ev.phase === "pre") return new Error("no images today");
      return null;
    };
    let err: unknown;
    try {
      const c = newClient(Providers.google, "k");
      c.provider.baseUrl = "http://unused";
      await c.image.model(flashModel).middleware(mw).generate("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MiddlewareVetoError);
  });
});
