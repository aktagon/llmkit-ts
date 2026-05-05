# Changelog

All notable changes to the TypeScript SDK are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
