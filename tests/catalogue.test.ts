import { describe, expect, test } from "bun:test";
import { anthropic, openai, cerebras } from "../src/builders/builders.ts";
import { Capabilities } from "../src/types.ts";
import {
  ErrModelsNotSupported,
  ErrModelsScope,
  ErrModelsUnavailable,
} from "../src/models.ts";

describe("Models.list (compiled-in)", () => {
  test("returns the compiled-in catalogue", () => {
    const c = anthropic("test-key");
    const models = c.models.list();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]!.provider.name).toBe("anthropic"); // sorted by (provider, id)
  });
});

describe("Models.withCapability filter", () => {
  test("narrows to image-generation models", () => {
    const c = openai("test-key");
    const all = c.models.list();
    const imageOnly = c.models
      .withCapability(Capabilities.ImageGeneration)
      .list();
    expect(imageOnly.length).toBeGreaterThan(0);
    expect(imageOnly.length).toBeLessThan(all.length);
    for (const m of imageOnly) {
      expect(m.capabilities).toContain(Capabilities.ImageGeneration);
    }
  });

  test("does not mutate parent (chain immutability)", () => {
    const c = openai("test-key");
    const parent = c.models;
    parent.withCapability(Capabilities.ImageGeneration);
    const all = parent.list();
    const filtered = parent.withCapability(Capabilities.ImageGeneration).list();
    expect(all.length).toBeGreaterThan(filtered.length);
  });
});

describe("Models.get", () => {
  test("returns a compiled-in model by id", () => {
    const c = anthropic("test-key");
    const got = c.models.get("claude-opus-4-7");
    expect(got).toBeDefined();
    expect(got!.id).toBe("claude-opus-4-7");
  });

  test("returns undefined for unknown ids", () => {
    const c = anthropic("test-key");
    expect(c.models.get("nonexistent-model-xyz")).toBeUndefined();
  });
});

describe("Providers.list", () => {
  test("returns the configured provider when it has a models endpoint", () => {
    const c = anthropic("test-key");
    const got = c.providers.list();
    expect(got.length).toBe(1);
    expect(got[0]!.name).toBe("anthropic");
  });

  test("returns empty when the provider has no models endpoint", () => {
    const c = cerebras("test-key");
    expect(c.providers.list().length).toBe(0);
  });
});

describe("Providers.supported", () => {
  test("returns the full SDK roster", () => {
    const c = anthropic("test-key");
    const supported = c.providers.supported();
    expect(supported.length).toBeGreaterThanOrEqual(10);
  });
});

describe("ScopedModels.list error sentinel", () => {
  test("throws ErrModelsNotSupported for endpoint-less providers", async () => {
    const c = cerebras("test-key");
    try {
      await c.models.provider({ name: "cerebras", apiKey: "test" }).list();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ErrModelsNotSupported);
    }
  });
});

describe("ScopedModels chain immutability", () => {
  test("raw() flips the chain flag without mutating parent", () => {
    const c = anthropic("test-key");
    const scoped = c.models.provider({ name: "anthropic", apiKey: "k" });
    const forked = scoped.raw();
    expect(scoped.rawFlag).toBe(false);
    expect(forked.rawFlag).toBe(true);
  });
});

describe("Error sentinel default messages", () => {
  test("each sentinel carries a default message", () => {
    expect(new ErrModelsNotSupported().message).toContain("models endpoint");
    expect(new ErrModelsUnavailable().message).toContain("unavailable");
    expect(new ErrModelsScope().message).toContain("scope");
  });
});

describe("Models.live aggregation", () => {
  test("aggregates + sorts + filters when scoped list resolves", async () => {
    // Phase 3 stub returns ErrModelsUnavailable; monkey-patch the
    // ScopedModels prototype so live() sees fulfilled values and we
    // exercise the merge/sort/filter closures in catalogueRunLive.
    const { ScopedModels } = await import("../src/builders/catalogue.ts");
    const { Providers: ProviderRegistry } =
      await import("../src/providers/providers.ts");
    const original = ScopedModels.prototype.list;
    ScopedModels.prototype.list = async function (this: {
      target: { name: string };
    }) {
      const name = this.target
        .name as (typeof ProviderRegistry)[keyof typeof ProviderRegistry];
      // Return two records out of (provider, id) order to exercise the sort.
      return [
        {
          id: "z-model",
          provider: { name, apiKey: "" },
          capabilities: [Capabilities.ChatCompletion],
        },
        {
          id: "a-model",
          provider: { name, apiKey: "" },
          capabilities: [Capabilities.ImageGeneration],
        },
      ];
    };
    try {
      const c = anthropic("test-key");
      const res = await c.models
        .withCapability(Capabilities.ImageGeneration)
        .live();
      expect(res.errors).toEqual({});
      expect(res.models.length).toBe(1);
      expect(res.models[0]!.id).toBe("a-model");
    } finally {
      ScopedModels.prototype.list = original;
    }
  });
});
