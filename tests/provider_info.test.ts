import { describe, test, expect } from "bun:test";
// Import the `providers` namespace from the package barrel (the TS public
// surface) — this is the BUG-012 boundary guard: providers.info / providers.list
// must be reachable here, not only in the internal providers module. A missing
// `export * as providers` re-export fails this import at compile time.
import { providers, type ProviderInfo } from "../src/llmkit.ts";

describe("providers namespace (ADR-038/040)", () => {
  test("info projects anthropic metadata from the registry", () => {
    const info: ProviderInfo = providers.info("anthropic");
    expect(info.id).toBe("anthropic");
    expect(info.slug).toBe("anthropic");
    expect(info.envVar).toBe("ANTHROPIC_API_KEY");
    expect(info.defaultModel).toBe("claude-sonnet-4-6");
    expect(info.baseUrl).toBe("https://api.anthropic.com");
    expect(info.browserCallable).toBe(false);
  });

  test("info projects exactly the contract fields (guards against widening)", () => {
    const keys = Object.keys(providers.info("openai")).sort();
    expect(keys).toEqual([
      "baseUrl",
      "browserCallable",
      "defaultModel",
      "envVar",
      "id",
      "slug",
    ]);
  });

  test("browserCallable is the CORS fact: true for google, false otherwise (ADR-035)", () => {
    expect(providers.info("google").browserCallable).toBe(true);
    expect(providers.info("grok").browserCallable).toBe(false);
  });

  test("list enumerates every provider, sorted by slug", () => {
    const all = providers.list();
    // anthropic is among them and the list is sorted ascending by slug.
    expect(all.some((p) => p.id === "anthropic")).toBe(true);
    const slugs = all.map((p) => p.slug);
    expect(slugs).toEqual([...slugs].sort((a, b) => a.localeCompare(b)));
  });

  test("parse round-trips a known slug to its typed id and rejects unknown", () => {
    const id = providers.parse("anthropic");
    expect(id).toBe("anthropic");
    // round-trip back through info: the typed id projects the same slug.
    expect(providers.info(id!).slug).toBe("anthropic");
    expect(providers.parse("not-a-provider")).toBeUndefined();
  });
});
