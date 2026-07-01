import { describe, test, expect } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";

// Minimal mock server (mirrors prompt.test.ts).
function startMockServer(
  handler: (req: Request) => Response | Promise<Response>,
): { url: string; stop: () => void } {
  const server = Bun.serve({ port: 0, fetch: handler });
  return {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
  };
}

// Proves a custom header set via Client.addHeader (ADR-052) lands on the
// outgoing request alongside the provider auth header — the BUG-015 gateway
// case. Covers the text path and one media path (image generation); the
// per-capability Provider copy is the BUG-007/BUG-014 drift spot.
describe("addHeader — custom request headers reach the wire (ADR-052)", () => {
  test("text path: cf-aig-authorization rides alongside x-api-key", async () => {
    let received: Headers | undefined;
    const server = startMockServer(async (req) => {
      received = req.headers;
      await req.json();
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "pong" }],
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    try {
      const c = newClient(Providers.anthropic, "test-key")
        .baseURL(server.url)
        .addHeader("cf-aig-authorization", "Bearer gw-token");
      const resp = await c.text.prompt("ping");
      expect(resp.text).toBe("pong");
      expect(received?.get("x-api-key")).toBe("test-key");
      expect(received?.get("cf-aig-authorization")).toBe("Bearer gw-token");
    } finally {
      server.stop();
    }
  });

  test("image path: custom header reaches the media wire", async () => {
    const flashModel = "gemini-3.1-flash-image-preview";
    const encoded = btoa("PNGDATA");
    let received: Headers | undefined;
    const server = startMockServer(async (req) => {
      received = req.headers;
      await req.json();
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: "image/png", data: encoded } }],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 1290 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    try {
      const c = newClient(Providers.google, "test-key")
        .baseURL(server.url)
        .addHeader("cf-aig-authorization", "Bearer gw-token");
      const resp = await c.image.model(flashModel).generate("A nano banana dish");
      expect(resp.images.length).toBe(1);
      expect(received?.get("cf-aig-authorization")).toBe("Bearer gw-token");
    } finally {
      server.stop();
    }
  });

  test("caller header cannot clobber the provider auth header", async () => {
    let received: Headers | undefined;
    const server = startMockServer(async (req) => {
      received = req.headers;
      await req.json();
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "pong" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    try {
      const c = newClient(Providers.anthropic, "test-key")
        .baseURL(server.url)
        .addHeader("x-api-key", "attacker-override");
      await c.text.prompt("ping");
      expect(received?.get("x-api-key")).toBe("test-key");
    } finally {
      server.stop();
    }
  });

  test("different-cased caller header cannot clobber provider auth", async () => {
    let received: Headers | undefined;
    const server = startMockServer(async (req) => {
      received = req.headers;
      await req.json();
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "pong" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    try {
      // Anthropic auth header is "x-api-key"; an upper-cased caller variant
      // must not shadow it (HTTP header names are case-insensitive).
      const c = newClient(Providers.anthropic, "test-key")
        .baseURL(server.url)
        .addHeader("X-API-KEY", "attacker-override");
      await c.text.prompt("ping");
      expect(received?.get("x-api-key")).toBe("test-key");
    } finally {
      server.stop();
    }
  });
});
