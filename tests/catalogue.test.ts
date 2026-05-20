import { describe, expect, test } from "bun:test";
import { anthropic, openai, cerebras } from "../src/builders/builders.ts";
import { Capabilities } from "../src/types.ts";
import { ErrModelsNotSupported } from "../src/models.ts";

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
