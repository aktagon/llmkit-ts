// ADR-030: Client.supports(Capability) — public capability query.
// CAP-002 is proven by exhaustive comparison against the exact generated
// lookups the strict validation paths dispatch on, so the query and the
// error cannot drift.

import { describe, test, expect } from "bun:test";
import { anthropic, ollama, newClient } from "../src/builders/builders.ts";
import { Capabilities } from "../src/types.ts";
import { batchConfig } from "../src/providers/batch.ts";
import { cachingConfig } from "../src/providers/caching.ts";
import { imageGenConfig } from "../src/providers/image_gen.ts";
import { Providers as ProviderRegistry } from "../src/providers/providers.ts";
import { fileUploadConfig } from "../src/providers/upload.ts";

describe("Client.supports (ADR-030)", () => {
  test("gated capabilities answer from the gate tables", () => {
    expect(anthropic("k").supports(Capabilities.Caching)).toBe(true);
    expect(ollama("").supports(Capabilities.Caching)).toBe(false);
  });

  test("ungated capabilities are always true", () => {
    const c = ollama("");
    expect(c.supports(Capabilities.ChatCompletion)).toBe(true);
    expect(c.supports(Capabilities.ToolCalling)).toBe(true);
    expect(c.supports(Capabilities.Reasoning)).toBe(true);
    expect(c.supports(Capabilities.Catalogue)).toBe(true);
  });

  test("matches the strict-gate lookups for every provider (CAP-002)", () => {
    for (const name of Object.values(ProviderRegistry)) {
      const c = newClient(name, "k");
      expect(c.supports(Capabilities.Caching)).toBe(
        cachingConfig(name) !== undefined,
      );
      expect(c.supports(Capabilities.Batching)).toBe(
        batchConfig(name) !== undefined,
      );
      expect(c.supports(Capabilities.FileUpload)).toBe(
        fileUploadConfig(name) !== undefined,
      );
      expect(c.supports(Capabilities.ImageGeneration)).toBe(
        imageGenConfig(name) !== undefined,
      );
    }
  });
});
