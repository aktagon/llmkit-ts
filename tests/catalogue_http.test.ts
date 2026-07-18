// Mock-fetch tests for the catalogue HTTP runtime (ADR-019 Phase 3).
//
// Each test installs a custom globalThis.fetch implementation that
// inspects the requested URL + headers and returns a canned response
// body. Pagination tests assert that the runtime threads the cursor
// (after_id for Anthropic, pageToken for Google) across requests; error
// tests cover scope-vs-unavailable classification.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { anthropic, openai, google, cohere } from "../src/builders/builders.ts";
import {
  ErrModelsNotSupported,
  ErrModelsScope,
  ErrModelsUnavailable,
} from "../src/models.ts";
import type { Event } from "../src/providers/middleware.ts";
import { Capabilities } from "../src/types.ts";

type FetchInput = string | URL | Request;
type FetchInit = RequestInit | undefined;

const originalFetch = globalThis.fetch;

function installFetchStub(
  handler: (req: { url: string; init: FetchInit }) => {
    status: number;
    body: string;
  },
): { calls: Array<{ url: string; init: FetchInit }> } {
  const calls: Array<{ url: string; init: FetchInit }> = [];
  const impl = (input: FetchInput, init?: FetchInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ url, init });
    const { status, body } = handler({ url, init });
    return Promise.resolve(
      new Response(body, {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  // Cast — the test stub does not need to implement `preconnect`.
  globalThis.fetch = impl as unknown as typeof fetch;
  return { calls };
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ScopedModels.list HTTP — Anthropic cursor pagination", () => {
  test("threads after_id across pages and stops on has_more=false", async () => {
    const page1 = JSON.stringify({
      data: [
        {
          type: "model",
          id: "claude-opus-4-7",
          display_name: "Claude Opus 4.7",
          created_at: "2026-04-14T00:00:00Z",
          max_input_tokens: 1000000,
          max_tokens: 128000,
        },
        {
          type: "model",
          id: "claude-sonnet-4-6",
          display_name: "Claude Sonnet 4.6",
          created_at: "2026-04-14T00:00:00Z",
          max_input_tokens: 1000000,
          max_tokens: 128000,
        },
      ],
      has_more: true,
      last_id: "claude-sonnet-4-6",
    });
    const page2 = JSON.stringify({
      data: [
        {
          type: "model",
          id: "claude-haiku-4-5-20251001",
          display_name: "Claude Haiku 4.5",
          created_at: "2026-04-14T00:00:00Z",
          max_input_tokens: 200000,
          max_tokens: 64000,
        },
      ],
      has_more: false,
      last_id: "claude-haiku-4-5-20251001",
    });
    const { calls } = installFetchStub(({ url, init }) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers["x-api-key"] !== "test-key") {
        return { status: 401, body: '{"error":"missing key"}' };
      }
      if (url.includes("after_id=claude-sonnet-4-6")) {
        return { status: 200, body: page2 };
      }
      return { status: 200, body: page1 };
    });

    const c = anthropic("test-key");
    const models = await c.models
      .provider({ name: "anthropic", apiKey: "test-key" })
      .list();
    expect(models.length).toBe(3);
    expect(calls.length).toBe(2);
    expect(calls[1]!.url).toContain("after_id=claude-sonnet-4-6");
    // Ontology enrichment for known IDs.
    const opus = models.find((m) => m.id === "claude-opus-4-7");
    expect(opus).toBeDefined();
    expect(opus!.capabilities.length).toBeGreaterThan(0);
  });
});

describe("ScopedModels.list HTTP — Google opaque-token pagination", () => {
  test("threads pageToken and strips models/ prefix from IDs", async () => {
    const page1 = JSON.stringify({
      models: [
        {
          name: "models/gemini-2.5-flash",
          displayName: "Gemini 2.5 Flash",
          description: "Stable",
          inputTokenLimit: 1048576,
          outputTokenLimit: 65536,
        },
      ],
      nextPageToken: "opaque-cursor-xyz",
    });
    const page2 = JSON.stringify({
      models: [
        {
          name: "models/gemini-2.5-pro",
          displayName: "Gemini 2.5 Pro",
          description: "Stable",
          inputTokenLimit: 1048576,
          outputTokenLimit: 65536,
        },
      ],
    });
    const { calls } = installFetchStub(({ url }) => {
      if (!url.includes("key=test-key")) {
        return { status: 401, body: '{"error":"missing key"}' };
      }
      if (url.includes("pageToken=opaque-cursor-xyz")) {
        return { status: 200, body: page2 };
      }
      return { status: 200, body: page1 };
    });

    const c = google("test-key");
    const models = await c.models
      .provider({ name: "google", apiKey: "test-key" })
      .list();
    expect(models.length).toBe(2);
    expect(calls.length).toBe(2);
    expect(models[0]!.id).toBe("gemini-2.5-flash"); // prefix stripped
  });
});

describe("ScopedModels.list HTTP — OpenAI non-paginated", () => {
  test("makes a single request and parses bare data array", async () => {
    const body = JSON.stringify({
      object: "list",
      data: [
        {
          id: "gpt-5",
          object: "model",
          created: 1715367049,
          owned_by: "system",
        },
        {
          id: "gpt-4o",
          object: "model",
          created: 1715367049,
          owned_by: "system",
        },
      ],
    });
    const { calls } = installFetchStub(({ url, init }) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers["Authorization"] !== "Bearer test-key") {
        return { status: 401, body: '{"error":"missing key"}' };
      }
      if (new URL(url).search !== "") {
        return { status: 400, body: '{"error":"unexpected query"}' };
      }
      return { status: 200, body };
    });

    const c = openai("test-key");
    const models = await c.models
      .provider({ name: "openai", apiKey: "test-key" })
      .list();
    expect(calls.length).toBe(1);
    expect(models.length).toBe(2);
  });
});

describe("ScopedModels.list HTTP — error sentinel mapping", () => {
  test("403 + scope/permission in body maps to ErrModelsScope", async () => {
    installFetchStub(() => ({
      status: 403,
      body: '{"error":{"message":"You have insufficient permissions for this operation. Missing scopes: api.model.read"}}',
    }));
    const c = openai("test-key");
    try {
      await c.models.provider({ name: "openai", apiKey: "test-key" }).list();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ErrModelsScope);
    }
  });

  test("503 maps to ErrModelsUnavailable (not Scope)", async () => {
    installFetchStub(() => ({ status: 503, body: '{"error":"down"}' }));
    const c = anthropic("test-key");
    try {
      await c.models.provider({ name: "anthropic", apiKey: "test-key" }).list();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ErrModelsUnavailable);
      expect(err).not.toBeInstanceOf(ErrModelsScope);
    }
  });

  test("endpoint-less provider keeps ErrModelsNotSupported (no HTTP issued)", async () => {
    const { calls } = installFetchStub(() => ({ status: 200, body: "{}" }));
    const c = cohere("test-key");
    try {
      await c.models.provider({ name: "cohere", apiKey: "k" }).list();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ErrModelsNotSupported);
    }
    expect(calls.length).toBe(0);
  });
});

describe("ScopedModels.get HTTP", () => {
  test("Anthropic single-record GET maps to ModelInfo with ontology caps", async () => {
    const body = JSON.stringify({
      type: "model",
      id: "claude-opus-4-7",
      display_name: "Claude Opus 4.7",
      created_at: "2026-04-14T00:00:00Z",
      max_input_tokens: 1000000,
      max_tokens: 128000,
    });
    const { calls } = installFetchStub(({ url }) => {
      if (!url.endsWith("/v1/models/claude-opus-4-7")) {
        return { status: 404, body: '{"error":"not found"}' };
      }
      return { status: 200, body };
    });
    const c = anthropic("test-key");
    const m = await c.models
      .provider({ name: "anthropic", apiKey: "test-key" })
      .get("claude-opus-4-7");
    expect(calls.length).toBe(1);
    expect(m.id).toBe("claude-opus-4-7");
    expect(m.capabilities.length).toBeGreaterThan(0);
  });
});

describe("ScopedModels.get HTTP — OpenAI + Google single-record", () => {
  test("OpenAI single-record GET maps to ModelInfo", async () => {
    const body = JSON.stringify({
      id: "gpt-5",
      object: "model",
      created: 1715367049,
      owned_by: "system",
    });
    installFetchStub(({ url }) => {
      if (!url.endsWith("/v1/models/gpt-5")) {
        return { status: 404, body: '{"error":"not found"}' };
      }
      return { status: 200, body };
    });
    const c = openai("test-key");
    const m = await c.models
      .provider({ name: "openai", apiKey: "test-key" })
      .get("gpt-5");
    expect(m.id).toBe("gpt-5");
    expect(m.capabilities.length).toBeGreaterThan(0);
  });

  test("Google single-record GET strips models/ prefix", async () => {
    const body = JSON.stringify({
      name: "models/gemini-2.5-flash",
      displayName: "Gemini 2.5 Flash",
      description: "Stable",
      inputTokenLimit: 1048576,
      outputTokenLimit: 65536,
    });
    installFetchStub(() => ({ status: 200, body }));
    const c = google("test-key");
    const m = await c.models
      .provider({ name: "google", apiKey: "test-key" })
      .get("gemini-2.5-flash");
    expect(m.id).toBe("gemini-2.5-flash");
  });
});

describe("Models.live HTTP — typed ProviderError on failure", () => {
  test("503 lands in result.errors with kind=unavailable per Amendment 1", async () => {
    installFetchStub(() => ({ status: 503, body: '{"error":"down"}' }));
    const c = openai("test-key");
    const res = await c.models.live();
    expect(res.models.length).toBe(0);
    const err = res.errors["openai"];
    expect(err).toBeDefined();
    expect(err!.kind).toBe("unavailable");
  });
});

describe("ScopedModels.list HTTP — capability filter (HANDOFF-036 A4)", () => {
  test("withCapability composes with provider(p).list()", async () => {
    const body = JSON.stringify({
      object: "list",
      data: [
        { id: "gpt-4o-mini", object: "model", created: 1715367049, owned_by: "system" },
        { id: "gpt-image-1", object: "model", created: 1715367049, owned_by: "system" },
      ],
    });
    installFetchStub(() => ({ status: 200, body }));

    const c = openai("test-key");
    const target = { name: "openai", apiKey: "test-key" } as const;
    const unfiltered = await c.models.provider(target).list();
    expect(unfiltered.map((m) => m.id)).toEqual(["gpt-4o-mini", "gpt-image-1"]);

    const filtered = await c.models
      .withCapability(Capabilities.ImageGeneration)
      .provider(target)
      .list();
    expect(filtered.map((m) => m.id)).toEqual(["gpt-image-1"]);
  });
});

describe("ScopedModels.list HTTP — client-scoped middleware (HANDOFF-036 A3)", () => {
  test("client hooks observe modelsList pre+post with a duration on post", async () => {
    const body = JSON.stringify({
      object: "list",
      data: [
        { id: "gpt-5", object: "model", created: 1715367049, owned_by: "system" },
      ],
    });
    installFetchStub(() => ({ status: 200, body }));

    const events: Event[] = [];
    const c = openai("test-key");
    c._middleware.push((_ctx, e) => {
      events.push(e);
      return null;
    });
    const models = await c.models
      .provider({ name: "openai", apiKey: "test-key" })
      .list();
    expect(models.length).toBe(1);
    expect(events.length).toBe(2);
    expect(events[0]!.phase).toBe("pre");
    expect(events[0]!.op).toBe("models_list");
    expect(events[1]!.phase).toBe("post");
    expect(events[1]!.op).toBe("models_list");
    expect(events[1]!.duration).toBeGreaterThanOrEqual(0);
  });
});
