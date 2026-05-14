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

// ===== OpenAI Image API (plan 020 phase 4) =====
//
// Two endpoints: /v1/images/generations (JSON; no image parts) and
// /v1/images/edits (multipart/form-data; one or more image parts).
// Output is forced to b64_json so the response shape stays uniform.

const openaiImage2 = "gpt-image-2";

function openaiImageResponse(b64: string, n: number): unknown {
  const data = Array.from({ length: n }, () => ({ b64_json: b64 }));
  return {
    created: 1700000000,
    data,
    usage: { input_tokens: 7, output_tokens: 1500 },
  };
}

async function readMultipart(req: Request): Promise<{
  fields: Record<string, string>;
  files: Record<string, { mime: string; bytes: Uint8Array }[]>;
}> {
  const form = await req.formData();
  const fields: Record<string, string> = {};
  const files: Record<string, { mime: string; bytes: Uint8Array }[]> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") {
      fields[k] = v;
    } else {
      const blob = v as Blob;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const mime = (blob as Blob).type || "";
      (files[k] ||= []).push({ mime, bytes });
    }
  }
  return { fields, files };
}

describe("Image.generate — OpenAI", () => {
  test("generations: JSON body omits response_format (gpt-image-* rejects it)", async () => {
    const encoded = bytesToBase64(fakePNG);
    let receivedPath = "";
    let receivedAuth = "";
    let receivedBody: any;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        receivedPath = url.pathname;
        receivedAuth = req.headers.get("authorization") ?? "";
        receivedBody = await req.json();
        return new Response(JSON.stringify(openaiImageResponse(encoded, 1)), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    try {
      const c = newClient(Providers.openai, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.image.model(openaiImage2).generate("A red circle");

      expect(receivedPath).toBe("/v1/images/generations");
      expect(receivedAuth).toBe("Bearer test-key");
      expect(receivedBody.model).toBe(openaiImage2);
      expect(receivedBody.prompt).toBe("A red circle");
      expect(receivedBody.response_format).toBeUndefined();
      expect(receivedBody.size).toBeUndefined();

      expect(resp.images.length).toBe(1);
      expect(Array.from(resp.images[0]!.bytes)).toEqual(Array.from(fakePNG));
      expect(resp.tokens.input).toBe(7);
      expect(resp.tokens.output).toBe(1500);
    } finally {
      server.stop(true);
    }
  });

  test("edits: single reference image lands as image[] form field", async () => {
    const encoded = bytesToBase64(fakePNG);
    const refBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x41]);
    let receivedPath = "";
    let parsed:
      | {
          fields: Record<string, string>;
          files: Record<string, { mime: string; bytes: Uint8Array }[]>;
        }
      | undefined;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedPath = new URL(req.url).pathname;
        parsed = await readMultipart(req);
        return new Response(JSON.stringify(openaiImageResponse(encoded, 1)), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    try {
      const c = newClient(Providers.openai, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.image
        .model(openaiImage2)
        .image("image/png", refBytes)
        .generate("Add a hat");

      expect(receivedPath).toBe("/v1/images/edits");
      expect(parsed!.fields.model).toBe(openaiImage2);
      expect(parsed!.fields.prompt).toBe("Add a hat");
      expect(parsed!.files["image[]"]!.length).toBe(1);
      expect(Array.from(parsed!.files["image[]"]![0]!.bytes)).toEqual(
        Array.from(refBytes),
      );
      expect(parsed!.files["image[]"]![0]!.mime).toBe("image/png");

      expect(resp.images.length).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("edits: three reference images preserve caller order", async () => {
    const encoded = bytesToBase64(fakePNG);
    const refA = new Uint8Array([0x89, 0x50, 0x41]);
    const refB = new Uint8Array([0x89, 0x50, 0x42]);
    const refC = new Uint8Array([0x89, 0x50, 0x43]);
    let parsed:
      | {
          fields: Record<string, string>;
          files: Record<string, { mime: string; bytes: Uint8Array }[]>;
        }
      | undefined;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        parsed = await readMultipart(req);
        return new Response(JSON.stringify(openaiImageResponse(encoded, 1)), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    try {
      const c = newClient(Providers.openai, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image
        .model(openaiImage2)
        .image("image/png", refA)
        .image("image/png", refB)
        .image("image/png", refC)
        .generate("Combine them");

      const arr = parsed!.files["image[]"]!;
      expect(arr.length).toBe(3);
      expect(Array.from(arr[0]!.bytes)).toEqual(Array.from(refA));
      expect(Array.from(arr[1]!.bytes)).toEqual(Array.from(refB));
      expect(Array.from(arr[2]!.bytes)).toEqual(Array.from(refC));
    } finally {
      server.stop(true);
    }
  });

  test("extraFields propagates quality into JSON body", async () => {
    const encoded = bytesToBase64(fakePNG);
    let receivedBody: any;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(JSON.stringify(openaiImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.openai, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image
        .model(openaiImage2)
        .extraFields({ quality: "high" })
        .generate("x");
      expect(receivedBody.quality).toBe("high");
    } finally {
      server.stop(true);
    }
  });

  test("extraFields n=4 returns 4-image response", async () => {
    const encoded = bytesToBase64(fakePNG);
    let receivedBody: any;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(JSON.stringify(openaiImageResponse(encoded, 4)));
      },
    });
    try {
      const c = newClient(Providers.openai, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.image
        .model(openaiImage2)
        .extraFields({ n: 4 })
        .generate("x");
      expect(receivedBody.n).toBe(4);
      expect(resp.images.length).toBe(4);
    } finally {
      server.stop(true);
    }
  });

  test("arbitrary size accepted (empty whitelist trusts API boundary)", async () => {
    const encoded = bytesToBase64(fakePNG);
    let receivedBody: any;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(JSON.stringify(openaiImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.openai, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image.model(openaiImage2).imageSize("1536x1024").generate("x");
      expect(receivedBody.size).toBe("1536x1024");
    } finally {
      server.stop(true);
    }
  });

  test("middleware fires pre+post on both branches", async () => {
    const encoded = bytesToBase64(fakePNG);
    const server = Bun.serve({
      port: 0,
      fetch: async () =>
        new Response(JSON.stringify(openaiImageResponse(encoded, 1))),
    });
    try {
      for (const branch of ["generations", "edits"] as const) {
        const ops: string[] = [];
        const phases: string[] = [];
        const mw = (_ctx: unknown, ev: any) => {
          ops.push(ev.op);
          phases.push(ev.phase);
          return null;
        };
        const c = newClient(Providers.openai, "test-key");
        c.provider.baseUrl = `http://localhost:${server.port}`;
        let b = c.image.model(openaiImage2).middleware(mw);
        if (branch === "edits") {
          b = b.image("image/png", new Uint8Array([0x89, 0x50, 0x4e]));
        }
        await b.generate("x");
        expect(ops).toEqual(["image_generation", "image_generation"]);
        expect(phases).toEqual(["pre", "post"]);
      }
    } finally {
      server.stop(true);
    }
  });

  test("pre-phase veto aborts before HTTP", async () => {
    let httpHit = false;
    const server = Bun.serve({
      port: 0,
      fetch: async () => {
        httpHit = true;
        return new Response("{}");
      },
    });
    try {
      const mw = (_ctx: unknown, ev: any) => {
        if (ev.phase === "pre") return new Error("blocked");
        return null;
      };
      const c = newClient(Providers.openai, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      let err: unknown;
      try {
        await c.image.model(openaiImage2).middleware(mw).generate("x");
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

// ===== xAI Grok Imagine =====
//
// JSON throughout — both endpoints. Image refs travel as data URLs in the
// body. response_format must be forced to b64_json (xAI defaults to URL).

const grokImagineQuality = "grok-imagine-image-quality";

function grokImageResponse(b64: string, n: number, mime?: string): unknown {
  const data = Array.from({ length: n }, () => {
    const entry: Record<string, unknown> = { b64_json: b64 };
    if (mime) entry.mime_type = mime;
    return entry;
  });
  return { data, usage: { cost_in_usd_ticks: 1234567 } };
}

describe("Image.generate — xAI Grok", () => {
  test("generations: JSON body forces response_format=b64_json", async () => {
    const encoded = bytesToBase64(fakePNG);
    let receivedPath = "";
    let receivedBody: any;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedPath = new URL(req.url).pathname;
        receivedBody = await req.json();
        return new Response(
          JSON.stringify(grokImageResponse(encoded, 1, "image/png")),
        );
      },
    });
    try {
      const c = newClient(Providers.grok, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.image
        .model(grokImagineQuality)
        .generate("A red circle");

      expect(receivedPath).toBe("/v1/images/generations");
      expect(receivedBody.model).toBe(grokImagineQuality);
      expect(receivedBody.prompt).toBe("A red circle");
      expect(receivedBody.response_format).toBe("b64_json");
      expect(receivedBody.image).toBeUndefined();
      expect(receivedBody.images).toBeUndefined();

      expect(resp.images.length).toBe(1);
      expect(Array.from(resp.images[0]!.bytes)).toEqual(Array.from(fakePNG));
      expect(resp.images[0]!.mimeType).toBe("image/png");
      expect(resp.tokens.input).toBe(0);
      expect(resp.tokens.output).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("aspectRatio + imageSize map to aspect_ratio + resolution", async () => {
    const encoded = bytesToBase64(fakePNG);
    let receivedBody: any;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(JSON.stringify(grokImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.grok, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image
        .model(grokImagineQuality)
        .aspectRatio("16:9")
        .imageSize("2k")
        .generate("x");
      expect(receivedBody.aspect_ratio).toBe("16:9");
      expect(receivedBody.resolution).toBe("2k");
    } finally {
      server.stop(true);
    }
  });

  test("rejects unsupported aspect ratio (4:5 not in xAI whitelist)", async () => {
    const c = newClient(Providers.grok, "test-key");
    c.provider.baseUrl = "http://unused";
    let err: unknown;
    try {
      await c.image.model(grokImagineQuality).aspectRatio("4:5").generate("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
  });

  test("accepts auto aspect ratio (xAI sentinel — model picks)", async () => {
    const encoded = bytesToBase64(fakePNG);
    let receivedBody: any;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(JSON.stringify(grokImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.grok, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image.model(grokImagineQuality).aspectRatio("auto").generate("x");
      expect(receivedBody.aspect_ratio).toBe("auto");
    } finally {
      server.stop(true);
    }
  });

  test("edits: single reference image lands as image: {url: data:...}", async () => {
    const encoded = bytesToBase64(fakePNG);
    const refBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x41]);
    const expectedDataURL = `data:image/png;base64,${bytesToBase64(refBytes)}`;
    let receivedPath = "";
    let receivedBody: any;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedPath = new URL(req.url).pathname;
        receivedBody = await req.json();
        return new Response(JSON.stringify(grokImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.grok, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image
        .model(grokImagineQuality)
        .image("image/png", refBytes)
        .generate("Add a hat");

      expect(receivedPath).toBe("/v1/images/edits");
      expect(receivedBody.image.url).toBe(expectedDataURL);
      expect(receivedBody.images).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("edits: multiple references land as images: [...] in caller order", async () => {
    const encoded = bytesToBase64(fakePNG);
    const refA = new Uint8Array([0x89, 0x41]);
    const refB = new Uint8Array([0x89, 0x42]);
    const refC = new Uint8Array([0x89, 0x43]);
    let receivedBody: any;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(JSON.stringify(grokImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.grok, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image
        .model(grokImagineQuality)
        .image("image/png", refA)
        .image("image/png", refB)
        .image("image/png", refC)
        .generate("Combine them");

      expect(Array.isArray(receivedBody.images)).toBe(true);
      expect(receivedBody.images.length).toBe(3);
      expect(receivedBody.images[0].url).toBe(
        `data:image/png;base64,${bytesToBase64(refA)}`,
      );
      expect(receivedBody.images[1].url).toBe(
        `data:image/png;base64,${bytesToBase64(refB)}`,
      );
      expect(receivedBody.images[2].url).toBe(
        `data:image/png;base64,${bytesToBase64(refC)}`,
      );
      expect(receivedBody.image).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("extraFields n=4 returns 4-image response", async () => {
    const encoded = bytesToBase64(fakePNG);
    let receivedBody: any;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(JSON.stringify(grokImageResponse(encoded, 4)));
      },
    });
    try {
      const c = newClient(Providers.grok, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.image
        .model(grokImagineQuality)
        .extraFields({ n: 4 })
        .generate("x");
      expect(receivedBody.n).toBe(4);
      expect(resp.images.length).toBe(4);
    } finally {
      server.stop(true);
    }
  });

  test("middleware fires pre+post on both branches", async () => {
    const encoded = bytesToBase64(fakePNG);
    const server = Bun.serve({
      port: 0,
      fetch: async () =>
        new Response(JSON.stringify(grokImageResponse(encoded, 1))),
    });
    try {
      for (const branch of ["generations", "edits"] as const) {
        const ops: string[] = [];
        const phases: string[] = [];
        const mw = (_ctx: unknown, ev: any) => {
          ops.push(ev.op);
          phases.push(ev.phase);
          return null;
        };
        const c = newClient(Providers.grok, "test-key");
        c.provider.baseUrl = `http://localhost:${server.port}`;
        let b = c.image.model(grokImagineQuality).middleware(mw);
        if (branch === "edits") {
          b = b.image("image/png", new Uint8Array([0x89, 0x50, 0x4e]));
        }
        await b.generate("x");
        expect(ops).toEqual(["image_generation", "image_generation"]);
        expect(phases).toEqual(["pre", "post"]);
      }
    } finally {
      server.stop(true);
    }
  });
});

// =============================================================================
// Plan 020 phase 2 — typed image-gen knob tests
// =============================================================================

describe("Image.generate — plan 020 phase 2 typed knobs", () => {
  test("OpenAI quality lands in JSON body", async () => {
    const encoded = bytesToBase64(fakePNG);
    let received: any = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        received = await req.json();
        return new Response(JSON.stringify(openaiImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.openai, "k");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image.model(openaiImage2).quality("high").generate("x");
      expect(received.quality).toBe("high");
    } finally {
      server.stop(true);
    }
  });

  test("OpenAI outputFormat lands in JSON body", async () => {
    const encoded = bytesToBase64(fakePNG);
    let received: any = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        received = await req.json();
        return new Response(JSON.stringify(openaiImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.openai, "k");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image.model(openaiImage2).outputFormat("webp").generate("x");
      expect(received.output_format).toBe("webp");
    } finally {
      server.stop(true);
    }
  });

  test("OpenAI background lands in JSON body", async () => {
    const encoded = bytesToBase64(fakePNG);
    let received: any = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        received = await req.json();
        return new Response(JSON.stringify(openaiImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.openai, "k");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image.model(openaiImage2).background("transparent").generate("x");
      expect(received.background).toBe("transparent");
    } finally {
      server.stop(true);
    }
  });

  test("OpenAI count(3) lands as n=3 and yields 3 images", async () => {
    const encoded = bytesToBase64(fakePNG);
    let received: any = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        received = await req.json();
        return new Response(JSON.stringify(openaiImageResponse(encoded, 3)));
      },
    });
    try {
      const c = newClient(Providers.openai, "k");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.image.model(openaiImage2).count(3).generate("x");
      expect(received.n).toBe(3);
      expect(resp.images.length).toBe(3);
    } finally {
      server.stop(true);
    }
  });

  test("OpenAI typed knobs propagate as multipart fields on edit branch", async () => {
    const encoded = bytesToBase64(fakePNG);
    let parsed: { fields: Record<string, string>; files: any[] } | null = null;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const form = await req.formData();
        const fields: Record<string, string> = {};
        const files: any[] = [];
        for (const [k, v] of form.entries()) {
          if (typeof v === "string") fields[k] = v;
          else files.push({ k, v });
        }
        parsed = { fields, files };
        return new Response(JSON.stringify(openaiImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.openai, "k");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image
        .model(openaiImage2)
        .quality("medium")
        .outputFormat("png")
        .background("auto")
        .count(2)
        .image("image/png", fakePNG)
        .generate("edit it");
      expect(parsed!.fields.quality).toBe("medium");
      expect(parsed!.fields.output_format).toBe("png");
      expect(parsed!.fields.background).toBe("auto");
      expect(parsed!.fields.n).toBe("2");
    } finally {
      server.stop(true);
    }
  });

  test("Google rejects OpenAI-only typed knobs", async () => {
    const c = newClient(Providers.google, "k");
    await expect(
      c.image.model(flashModel).quality("high").generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.image.model(flashModel).outputFormat("png").generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.image.model(flashModel).background("auto").generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.image.model(flashModel).count(2).generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("OpenAI mask attaches a mask file to the edit multipart form", async () => {
    const encoded = bytesToBase64(fakePNG);
    const maskBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    let received: {
      fields: Record<string, string>;
      maskBytes?: Uint8Array;
      maskType?: string;
    } = { fields: {} };
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const form = await req.formData();
        for (const [k, v] of form.entries()) {
          if (typeof v === "string") received.fields[k] = v;
          else if (k === "mask") {
            received.maskBytes = new Uint8Array(await v.arrayBuffer());
            received.maskType = v.type;
          }
        }
        return new Response(JSON.stringify(openaiImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.openai, "k");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image
        .model(openaiImage2)
        .image("image/png", fakePNG)
        .mask("image/png", maskBytes)
        .generate("patch the hat region");
      expect(received.maskBytes).toBeDefined();
      expect(Array.from(received.maskBytes!)).toEqual(Array.from(maskBytes));
      expect(received.maskType).toBe("image/png");
    } finally {
      server.stop(true);
    }
  });

  test("OpenAI mask without image parts is rejected (edits-only)", async () => {
    const c = newClient(Providers.openai, "k");
    await expect(
      c.image
        .model(openaiImage2)
        .mask("image/png", new Uint8Array([0xde, 0xad]))
        .generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("Google + Grok reject mask outright", async () => {
    const google = newClient(Providers.google, "k");
    await expect(
      google.image
        .model(flashModel)
        .mask("image/png", new Uint8Array([0xde, 0xad]))
        .generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);

    const grok = newClient(Providers.grok, "k");
    await expect(
      grok.image
        .model(grokImagineQuality)
        .mask("image/png", new Uint8Array([0xde, 0xad]))
        .generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("Grok rejects quality/outputFormat/background, accepts count", async () => {
    const c = newClient(Providers.grok, "k");
    await expect(
      c.image.model(grokImagineQuality).quality("high").generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.image.model(grokImagineQuality).outputFormat("png").generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.image.model(grokImagineQuality).background("auto").generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);

    // count IS allowed on Grok.
    const encoded = bytesToBase64(fakePNG);
    let received: any = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        received = await req.json();
        return new Response(JSON.stringify(grokImageResponse(encoded, 2)));
      },
    });
    try {
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.image
        .model(grokImagineQuality)
        .count(2)
        .generate("x");
      expect(received.n).toBe(2);
      expect(resp.images.length).toBe(2);
    } finally {
      server.stop(true);
    }
  });
});

// =============================================================================
// Vertex Imagen (plan 021) — JSONPredict input mode, bearer auth
// =============================================================================

const vertexImagen3 = "imagen-3.0-generate-002";

function vertexImageResponse(b64: string, n: number, mime?: string) {
  const predictions = [];
  for (let i = 0; i < n; i++) {
    const entry: Record<string, unknown> = { bytesBase64Encoded: b64 };
    if (mime) entry.mimeType = mime;
    predictions.push(entry);
  }
  return { predictions };
}

describe("Image.generate — Vertex Imagen (JSONPredict)", () => {
  test("happy path: instances/parameters body shape, bearer auth, base64 round-trip", async () => {
    const encoded = bytesToBase64(fakePNG);
    let receivedPath = "";
    let receivedAuth = "";
    let receivedBody: any = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedPath = new URL(req.url).pathname;
        receivedAuth = req.headers.get("authorization") || "";
        receivedBody = await req.json();
        return new Response(
          JSON.stringify(vertexImageResponse(encoded, 1, "image/png")),
        );
      },
    });
    try {
      const c = newClient(Providers.vertex, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.image.model(vertexImagen3).generate("A red circle");
      expect(receivedPath).toBe(`/${vertexImagen3}:predict`);
      expect(receivedAuth).toBe("Bearer test-token");
      expect(receivedBody.instances).toHaveLength(1);
      expect(receivedBody.instances[0].prompt).toBe("A red circle");
      expect(receivedBody.instances[0].image).toBeUndefined();
      expect(receivedBody.parameters.sampleCount).toBe(1);
      expect(resp.images).toHaveLength(1);
      expect(Array.from(resp.images[0]!.bytes)).toEqual(Array.from(fakePNG));
      expect(resp.images[0]!.mimeType).toBe("image/png");
      // Vertex predict does not return token counts.
      expect(resp.tokens.input).toBe(0);
      expect(resp.tokens.output).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("edit: first image part lifts into instances[0].image.bytesBase64Encoded", async () => {
    const encoded = bytesToBase64(fakePNG);
    const refBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const expectedRefB64 = bytesToBase64(refBytes);
    let receivedBody: any = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(JSON.stringify(vertexImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.vertex, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image
        .model(vertexImagen3)
        .image("image/png", refBytes)
        .generate("Make it winter");
      expect(receivedBody.instances[0].image.bytesBase64Encoded).toBe(
        expectedRefB64,
      );
    } finally {
      server.stop(true);
    }
  });

  test("mask: maps to instances[0].mask.image.bytesBase64Encoded", async () => {
    const encoded = bytesToBase64(fakePNG);
    const maskBytes = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const expectedMaskB64 = bytesToBase64(maskBytes);
    let receivedBody: any = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(JSON.stringify(vertexImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.vertex, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image
        .model(vertexImagen3)
        .image("image/png", new Uint8Array([0x01]))
        .mask("image/png", maskBytes)
        .generate("Inpaint here");
      expect(receivedBody.instances[0].mask.image.bytesBase64Encoded).toBe(
        expectedMaskB64,
      );
    } finally {
      server.stop(true);
    }
  });

  test("count maps to parameters.sampleCount", async () => {
    const encoded = bytesToBase64(fakePNG);
    let receivedBody: any = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(JSON.stringify(vertexImageResponse(encoded, 4)));
      },
    });
    try {
      const c = newClient(Providers.vertex, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.image.model(vertexImagen3).count(4).generate("x");
      expect(receivedBody.parameters.sampleCount).toBe(4);
      expect(resp.images).toHaveLength(4);
    } finally {
      server.stop(true);
    }
  });

  test("aspect ratio maps to parameters.aspectRatio", async () => {
    const encoded = bytesToBase64(fakePNG);
    let receivedBody: any = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(JSON.stringify(vertexImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.vertex, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image.model(vertexImagen3).aspectRatio("16:9").generate("x");
      expect(receivedBody.parameters.aspectRatio).toBe("16:9");
    } finally {
      server.stop(true);
    }
  });

  test("extra fields spread into parameters (negativePrompt, safetySetting)", async () => {
    const encoded = bytesToBase64(fakePNG);
    let receivedBody: any = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(JSON.stringify(vertexImageResponse(encoded, 1)));
      },
    });
    try {
      const c = newClient(Providers.vertex, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image
        .model(vertexImagen3)
        .extraFields({ negativePrompt: "ugly", safetySetting: "block_some" })
        .generate("x");
      expect(receivedBody.parameters.negativePrompt).toBe("ugly");
      expect(receivedBody.parameters.safetySetting).toBe("block_some");
    } finally {
      server.stop(true);
    }
  });

  test("rejects quality/output_format/background as OpenAI-only", async () => {
    const c = newClient(Providers.vertex, "test-token");
    c.provider.baseUrl = "http://unused";

    await expect(
      c.image.model(vertexImagen3).quality("high").generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.image.model(vertexImagen3).outputFormat("png").generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.image.model(vertexImagen3).background("transparent").generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("Image.generate — finishReason / finishMessage", () => {
  test("Google: surfaces finishReason + finishMessage on blocked response", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                // No content.parts — model declined to produce.
                finishReason: "IMAGE_OTHER",
                finishMessage:
                  "Could not generate image. Try rephrasing the prompt.",
              },
            ],
            usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 0 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    });
    try {
      const c = newClient(Providers.google, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.image.model(flashModel).generate("a refused prompt");
      expect(resp.images.length).toBe(0);
      expect(resp.finishReason).toBe("IMAGE_OTHER");
      expect(resp.finishMessage).toBe(
        "Could not generate image. Try rephrasing the prompt.",
      );
    } finally {
      server.stop(true);
    }
  });

  test("Google: happy path leaves finishReason/finishMessage undefined when absent", async () => {
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
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 100 },
          }),
        ),
    });
    try {
      const c = newClient(Providers.google, "test-key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.image.model(flashModel).generate("a cat");
      expect(resp.images.length).toBe(1);
      expect(resp.finishReason).toBeUndefined();
      expect(resp.finishMessage).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("Vertex: surfaces raiFilteredReason as finishReason", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          JSON.stringify({
            predictions: [
              { raiFilteredReason: "Image filtered by safety system" },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    });
    try {
      const c = newClient(
        Providers.vertex,
        "Bearer fake-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const resp = await c.image.model(vertexImagen3).generate("blocked");
      expect(resp.images.length).toBe(0);
      expect(resp.finishReason).toBe("Image filtered by safety system");
      expect(resp.finishMessage).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("safetyFilter maps to parameters.safetySetting", async () => {
    const encoded = bytesToBase64(fakePNG);
    let receivedBody: any = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return new Response(
          JSON.stringify(vertexImageResponse(encoded, 1, "image/png")),
        );
      },
    });
    try {
      const c = newClient(
        Providers.vertex,
        "Bearer fake-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image
        .model(vertexImagen3)
        .safetyFilter("block_few")
        .generate("x");
      expect(receivedBody.parameters.safetySetting).toBe("block_few");
    } finally {
      server.stop(true);
    }
  });

  test("safetyFilter rejected on non-Vertex provider", async () => {
    const c = newClient(Providers.google, "key");
    await expect(
      c.image.model(flashModel).safetyFilter("block_few").generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("Image.generate — safetySettings (Google InlineParts)", () => {
  test("safetySettings written as top-level wire field", async () => {
    const encoded = bytesToBase64(fakePNG);
    let receivedBody: any = {};
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
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    try {
      const c = newClient(Providers.google, "key");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.image
        .model(flashModel)
        .safetySettings([
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        ])
        .generate("a cat");
      expect(receivedBody.safetySettings).toEqual([
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("safetySettings rejected on OpenAI", async () => {
    const c = newClient(Providers.openai, "key");
    await expect(
      c.image
        .model("gpt-image-1")
        .safetySettings([
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        ])
        .generate("x"),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
