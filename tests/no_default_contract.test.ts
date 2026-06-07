import { describe, test, expect } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { ValidationError } from "../src/errors.ts";
import { PROVIDERS } from "../src/providers/providers.ts";

// ADR-031 honest no-default contract: local daemons declare no registry
// default — what a daemon serves is runtime inventory — so a missing model
// choice surfaces an instructive ValidationError instead of guessing a model
// the daemon may not have pulled (the BUG-009 guess-then-404).
describe("no-default contract (ADR-031)", () => {
  const locals = ["ollama", "vllm", "llamacpp", "lmstudio", "jan"];

  test("no model on a local daemon throws naming the provider", async () => {
    const client = newClient("ollama", "unused");
    expect(client.text.prompt("hi")).rejects.toThrow(ValidationError);
    try {
      await client.text.prompt("hi");
      throw new Error("expected ValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const ve = err as ValidationError;
      expect(ve.message).toContain('"ollama" declares no default');
      expect(ve.message).toContain("models.live()");
    }
  });

  test("registry facts: locals declare no default, clouds declare one", () => {
    for (const [name, cfg] of Object.entries(PROVIDERS)) {
      if (locals.includes(name)) {
        expect(cfg.defaultModel).toBe("");
      } else {
        expect(cfg.defaultModel).not.toBe("");
      }
    }
  });
});
