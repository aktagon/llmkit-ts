import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseAnthropicModelsResponse,
  parseOpenAICohortModelsResponse,
  parseGoogleModelsResponse,
} from "../src/providers/models_parsers.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  // ts/tests/<this> -> ../../codegen/fixtures/models/<name>
  const path = join(
    __dirname,
    "..",
    "..",
    "codegen",
    "fixtures",
    "models",
    name,
  );
  return readFileSync(path, "utf-8");
}

describe("parseAnthropicModelsResponse", () => {
  test("decodes the captured fixture", () => {
    const body = loadFixture("anthropic.json");
    const page = parseAnthropicModelsResponse(body);
    expect(page.records.length).toBe(9);
    expect(page.records[0]!.id).not.toBe("");
    expect(page.records[0]!.displayName).toBeDefined();
    expect(page.records[0]!.contextWindow).toBeGreaterThan(0);
    expect(page.records[0]!.maxOutput).toBeGreaterThan(0);
  });

  test("populates raw round-trip", () => {
    const body = loadFixture("anthropic.json");
    const page = parseAnthropicModelsResponse(body);
    expect(page.records[0]!.raw).toBeDefined();
  });
});

describe("parseOpenAICohortModelsResponse", () => {
  test("decodes the captured fixture", () => {
    const body = loadFixture("openai.json");
    const page = parseOpenAICohortModelsResponse(body);
    expect(page.records.length).toBe(124);
    expect(page.nextCursor).toBe("");
    expect(page.records[0]!.id).not.toBe("");
    expect(page.records[0]!.created).toBeDefined();
  });
});

describe("parseGoogleModelsResponse", () => {
  test("decodes the captured fixture", () => {
    const body = loadFixture("google.json");
    const page = parseGoogleModelsResponse(body);
    expect(page.records.length).toBe(50);
    for (const r of page.records) {
      expect(r.id).not.toBe("");
      expect(r.id.startsWith("models/")).toBe(false);
    }
    const hasContext = page.records.some((r) => (r.contextWindow ?? 0) > 0);
    expect(hasContext).toBe(true);
  });
});
