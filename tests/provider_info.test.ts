import { describe, test, expect } from "bun:test";
// Import the `providers` namespace from the package barrel (the TS public
// surface) — this is the BUG-012 boundary guard: providers.info / providers.list
// must be reachable here, not only in the internal providers module. A missing
// `export * as providers` re-export fails this import at compile time.
import { providers, type ProviderInfo } from "../src/llmkit.ts";

describe("providers namespace (ADR-038)", () => {
  test("info projects anthropic metadata from the registry", () => {
    const info: ProviderInfo = providers.info("anthropic");
    expect(info.name).toBe("anthropic");
    expect(info.envVar).toBe("ANTHROPIC_API_KEY");
    expect(info.defaultModel).toBe("claude-sonnet-4-6");
    expect(info.baseUrl).toBe("https://api.anthropic.com");
  });

  test("info projects exactly the four contract fields (guards against widening)", () => {
    const keys = Object.keys(providers.info("openai")).sort();
    expect(keys).toEqual(["baseUrl", "defaultModel", "envVar", "name"]);
  });

  test("list enumerates every provider, sorted by name", () => {
    const all = providers.list();
    // anthropic is among them and the list is sorted ascending by name.
    expect(all.some((p) => p.name === "anthropic")).toBe(true);
    const names = all.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
