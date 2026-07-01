# Changelog

All notable changes to the TypeScript SDK are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] — 2026-07-01

### Added

- `cachingConfig(provider)` — per-provider prompt-caching capability, re-exported from the package entry alongside `imageGenConfig`/`videoGenConfig`/`musicGenConfig`/`speechGenConfig`. Returns the provider's `CachingDef` (mode, write/read token paths, default TTL, lifecycle) or `undefined` when the provider has no caching support. Lets a consumer gate the text builder's `.caching()` on real support — it throws for a provider with no caching config (e.g. `grok`) rather than no-op'ing — instead of mirroring the capability by hand. The `CachingDef` / `CachingMode` / `CachingLifecycle` types are exported too.

## [1.1.1] — 2026-06-17

### Fixed

- Cloudflare Workers / workerd compatibility: the bundled `dist/` no longer emits an eager `createRequire(import.meta.url)` shim, which crashed at module load on workerd (where `import.meta.url` is `undefined`) and broke both `wrangler dev` and deploys for any Worker importing the package. Root cause was `bun build --target node` injecting CJS-interop for a guarded `await import("node:fs/promises")`; the build now uses `--target browser`, leaving `node:` builtins as native dynamic imports with no interop shim. Verified under both Node and Bun, and guarded by a regression test (`tests/dist_no_createrequire.test.ts`) that reads the build target and asserts the output is free of the shim.

## [1.1.0] — 2026-06-09

### Added

- Video generation — `c.video.model(id).submit(prompt)` returns a `VideoHandle` immediately; `handle.wait()` polls until the job finishes and returns `VideoResponse { videos: VideoData[], usage, finishReason, finishMessage }`. Each `VideoData` carries `url`, `mimeType`, and `durationSeconds`. One provider so far: xAI Grok Imagine (`grok-imagine-video`), which delivers a temporary hosted URL — download it yourself.
- Music generation — `c.music.model(id).generate(prompt)` produces audio from a text prompt, with an optional `.lyrics(...)` chain method for models that support vocals. Returns `MusicResponse { audio: AudioData[], text, usage }` with decoded audio bytes. Three providers: Vertex Lyria 2 (`lyria-002`, instrumental WAV), Google Lyria 3 (`lyria-3-pro-preview` / `lyria-3-clip-preview`, MP3 with lyrics), and MiniMax (`music-2.6`). Instrumental-only models reject lyrics before the request is sent.
- `Response.finishReason` and `Response.finishMessage` — provider stop signal + free-text explanation passed through verbatim on `c.text.prompt()`, `c.agent.prompt()`, `c.text.batch()`, and `c.text.stream()` (the latter via the trailing `TextStream.response()?.finishReason`). Examples: Anthropic `stop_reason`, OpenAI `choices[0].finish_reason`, Google `candidates[0].finishReason`. Optional fields (`?: string`); empty when the provider response carries no signal. Streaming uses ADR-013's `event_name:json.path` locator — Anthropic captures from the `message_stop` event body; OpenAI/Grok/Google use last-non-empty-wins on the data frames; Google additionally filters `FINISH_REASON_UNSPECIFIED`. Bedrock Converse streaming is not yet wired.
- `ImageResponse.finishReason` and `ImageResponse.finishMessage` — same shape on `c.image.generate()`. Google populates both (including the user-facing `IMAGE_OTHER` / `SAFETY` / `MAX_TOKENS` reasons that previously vanished into "no image returned"); Vertex Imagen surfaces `predictions[0].raiFilteredReason` as `finishReason`; OpenAI Images API and xAI Grok have no equivalent fields and leave them undefined. Callers can now render a useful message when `images.length === 0` instead of synthesizing one.

## [1.0.0] — 2026-05-09

### Packaging

- Bundled `dist/` build output (`bun build` → ESM, code-split, with sourcemaps). The package resolves under plain `node` (Node ≥18 ESM), Cloudflare Workers, Deno (with `--allow-net`), and any modern bundler — not just Bun. The `dist/llmkit.js` and `dist/builders/index.js` entry points are auto-generated on `bun run build` and on `npm pack` via the `prepack` hook.
- `package.json` `exports` map multi-targets: `types` resolves to the `.ts` source (Bun, Vite, Next.js, esbuild, modern bundlers consume the source directly for type info), `import` resolves to `dist/.js` (compiled output for runtimes that can't load `.ts`).
- `engines.node = ">=18"` declared alongside `engines.bun`.
- `@aktagon/llmkit-ts/builders` is the explicit subpackage entry. The main entry also re-exports the typed-builder factories so `import { anthropic } from "@aktagon/llmkit-ts"` works for the common case.
- `.d.ts` declaration files are not yet shipped — types come from the bundled `.ts` source. NodeNext-strict TypeScript consumers (rare; require explicit file extensions) need `allowImportingTsExtensions: true` or to wait for a follow-up patch with a `tsc --emitDeclarationOnly` step. Tracked as a 1.0.x follow-up.

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
- `TextStream` trailing-handle class. Iterate via `for await ... of stream` to consume chunks; `stream.response()` returns the accumulated `Response` (text + token counts) once iteration ends, and `stream.error()` exposes any terminal error. Implements `AsyncIterable<string>` so existing `for await ... of` loops keep working.

### Changed

- **Breaking**: `c.text.stream(msg)` now returns `TextStream` instead of `AsyncIterable<string>`. The class still implements `AsyncIterable<string>` so existing iteration code is source-compatible; the type signature changed because the new accessors (`response()`, `error()`) are not part of `AsyncIterable`.

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
