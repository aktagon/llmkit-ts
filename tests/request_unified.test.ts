// Regression net for ADR-026 (unified request builder, TS slice).
//
// buildRequest is the single body builder shared by Text, batch, and — after
// this slice — Agent. These snapshots freeze the Text/batch wire bodies for
// each provider shape BEFORE the agent was routed through buildRequest, and
// MUST stay byte-equal after the refactor (PIPE-005: no behavioural change to
// the paths that already worked). Batch constructs its per-item body via the
// same buildRequest, so this also pins the batch shape.

import { describe, test, expect } from "bun:test";
import { buildRequest } from "../src/request.ts";
import { ValidationError } from "../src/errors.ts";
import { PROVIDERS } from "../src/providers/providers.ts";
import type { Provider, Request, PromptOptions } from "../src/types.ts";

const opts: PromptOptions = { maxTokens: 256, temperature: 0.1, topP: 0.5 };

function body(name: keyof typeof PROVIDERS, req: Request) {
  const cfg = PROVIDERS[name]!;
  const provider: Provider = { name, apiKey: "k" };
  return buildRequest(provider, req, cfg, opts);
}

describe("buildRequest wire-body snapshots (Text/batch parity)", () => {
  const req: Request = { system: "be terse", user: "hello" };

  test("anthropic — TopLevelField", () => {
    expect(body("anthropic", req)).toEqual({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      messages: [{ role: "user", content: "hello" }],
      system: "be terse",
      temperature: 0.1,
      top_p: 0.5,
    });
  });

  test("openai — MessageInArray", () => {
    expect(body("openai", req)).toEqual({
      model: "gpt-4o-2024-08-06",
      max_tokens: 256,
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "hello" },
      ],
      temperature: 0.1,
      top_p: 0.5,
    });
  });

  test("google — SiblingObject + wrapsOptionsIn", () => {
    expect(body("google", req)).toEqual({
      system_instruction: { parts: [{ text: "be terse" }] },
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      generationConfig: {
        temperature: 0.1,
        top_p: 0.5,
        max_output_tokens: 256,
      },
    });
  });

  test("bedrock — SigV4 + inferenceConfig", () => {
    expect(body("bedrock", req)).toEqual({
      system: [{ text: "be terse" }],
      messages: [{ role: "user", content: [{ text: "hello" }] }],
      inferenceConfig: { temperature: 0.1, top_p: 0.5, maxTokens: 256 },
    });
  });
});

// ADR-026 PIPE-007/008: the public Message is converted to an internal sum
// (text | calls | result) at a single boundary (toInternal) before the builder
// dispatches. A message carrying more than one of {content, toolCalls,
// toolResult} is an illegal state the flat public struct can represent but the
// internal sum cannot — it is rejected at the boundary, not silently dropped.
describe("buildRequest carrier-disjointness boundary", () => {
  test("rejects a Message that sets both content and toolCalls", () => {
    const req: Request = {
      messages: [
        {
          role: "assistant",
          content: "here you go",
          toolCalls: [
            { id: "t1", name: "get_weather", input: { city: "NYC" } },
          ],
          toolResult: null,
        },
      ],
    };
    expect(() => body("anthropic", req)).toThrow(ValidationError);
  });
});
