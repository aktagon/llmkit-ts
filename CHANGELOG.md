# Changelog

All notable changes to the TypeScript SDK are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking

- Legacy free-function layer removed from the public API (plan-018 D2, ADR-010). `prompt`, `promptStream`, `generateImage`, `uploadFile`, `promptBatch`, `submitBatch`, `waitBatch`, `Agent` (class), and the `text()` / `image()` Part constructors are no longer re-exported from `llmkit.ts`. Use the typed builder via `import { newClient } from "@aktagon/llmkit-ts/builders"`:
  - `c.text.system(...).prompt(msg)` — replaces `prompt`.
  - `c.text.<chain>.stream(msg)` — replaces `promptStream`; returns `AsyncIterable<string>` (iterate with `for await ... of`). Final usage stats are not yet surfaced through the iterator (carried forward).
  - `c.image.model(id).<chain>.generate(msg)` — replaces `generateImage`.
  - `c.upload.bytes(b).filename(n).run()` — replaces `uploadFile`.
  - `c.text.<chain>.batch(...prompts)` / `.submitBatch(...prompts).wait()` — replaces the batch trio.
  - `c.agent.<chain>.prompt(msg)` / `c.agent.reset()` — replaces the `Agent` class.
- `Part`-construction Part literals (`{ text: "..." }`, `{ image: { mimeType, bytes } }`) are the canonical construction path now that `text()` / `image()` are gone. The typed-builder accumulators (`c.text.text(s)`, `c.image.image(m, b)`) are the user-facing API.

### Added

- ADR-011 chain-field propagation lint integrated into `make check`. Catches silent-drop bugs across all four SDKs.
- All eight sampling/decoding chain methods (`topP`, `topK`, `frequencyPenalty`, `presencePenalty`, `seed`, `stopSequences`, `thinkingBudget`, `reasoningEffort`) now thread through to the wire body. They had been silently dropping since plan-016 phase 2b.
- `Agent.maxToolIterations(n)` chain method exposes the tool-loop depth cap (default 10) on the typed builder.
- `Upload.path()` is now wired in addition to `bytes()`. Reads via `Bun.file()` under Bun, otherwise dynamic-imports `node:fs/promises`. Edge runtimes without a filesystem (Cloudflare Workers, Deno without `--allow-read`, browsers) get a clear error directing them to `bytes()`.

### Removed

- `caching()` chain method on the `Image` builder. The legacy `generateImage` runtime never accepted a caching option, so the chain method had been a silent no-op.

## [0.3.0] — 2026-05-08

### Breaking

- `ImageRequest.referenceImages` (and the `ImageInput` type) is removed. Use `parts: Part[]` instead, with the `text(...)` and `image(...)` exports. Migration: `{ prompt: "X", referenceImages: [{ mimeType: m, bytes: b }] }` becomes `{ parts: [text("X"), image(m, b)] }`. Pure text-to-image callers using only `prompt: "X"` are unaffected.
- `ImageRequest` now requires exactly one of `prompt` or `parts` to be set (XOR). Both empty or both set throws `ValidationError`.
- Multi-reference compositional generation now works by ordering the parts array (e.g., `[text("Person:"), image(mime, refA), text("Outfit:"), image(mime, refB), text("Generate ...")]`) — the wire shape preserves caller-controlled ordering. See ADR-008.

### Added

- `Part`, `MediaRef` exports and `text(s)` / `image(mime, bytes)` constructors. Discriminated union: `type Part = { text: string } | { image: MediaRef }`.

## [0.2.0] — 2026-05-06

### Added

- `generateImage(provider, request, options?)` — text-to-image and edit/composition with reference images. Supports Google Nano Banana 2 (`gemini-3.1-flash-image-preview`) and Pro (`gemini-3-pro-image-preview`).
- `ImageRequest`, `ImageResponse`, `ImageData`, `ImageInput`, `ImageOptions` types.
- Pre-flight whitelist validation: rejects unsupported aspect ratios, image sizes, and reference-image counts before any HTTP call.
- Middleware fires around image generation (`op: "image_generation"`); pre-phase can veto.
- README: `GenerateImage` section with per-model whitelist table.

### Tooling

- 9 new unit tests in `tests/image.test.ts`. Total: 46 tests, all green under Bun.

## [0.1.0] — 2026-05-06

First public release. Feature parity with the Go SDK.

### Added

- `prompt(provider, request, options?)` — one-shot LLM request.
- `promptStream(provider, request, onChunk, options?)` — SSE streaming with both Anthropic-style typed events and OpenAI/Google data-only frames.
- `Agent` class with `setSystem`, `addTool`, `chat`, `reset` — multi-turn conversations with function calling. Tool dispatch covers Anthropic `tool_use`, OpenAI `tool_calls`, Google `functionCall`, and Bedrock Converse `toolUse`.
- `uploadFile(provider, data, name, options?)` — multipart file upload.
- `promptBatch` / `submitBatch` / `waitBatch` — batch lifecycle covering both inline-requests (Anthropic) and file-reference (OpenAI two-hop) flows.
- Three caching modes: automatic (OpenAI), explicit (Anthropic `cache_control`), and resource (Google `cachedContents` pre-flight + reference).
- All four `SystemPlacement` modes: `TopLevelField` (Anthropic), `MessageInArray` (OpenAI-compatible), `SiblingObject` (Google `system_instruction`), Bedrock Converse.
- Bedrock SigV4 signing via Web Crypto — runs in Bun, Node 19+, Deno, Cloudflare Workers, browsers.
- Middleware runtime wiring at seven sites (`prompt`, `promptStream`, `Agent` LLM call, `Agent` tool execution, `uploadFile`, `submitBatch`, Google `applyResource` cache create) with pre-veto + post-observation contract.
- 27 provider configs across 4 API shapes — all generated.
- `{model}` and `{region}` URL templating.
- Dotted-path option overrides (e.g. Anthropic `thinking.budget_tokens` with sibling `type: "enabled"`) correctly nested via `setNestedField` + `extraFieldsJson` merge.

### Tooling

- 37 unit tests against `Bun.serve` mock servers.
- `bun run typecheck` clean under TypeScript strict mode.
