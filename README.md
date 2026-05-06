# @aktagon/llmkit-ts

TypeScript library for unified LLM API access. Write OpenAI-shaped requests, hit any provider. Per-provider config in `src/providers/` is generated; runtime behavior (HTTP, transforms, agent loop, SigV4) is hand-coded. Shares a code-generation pipeline with the [Go SDK](https://github.com/aktagon/llmkit-go).

Runtime: Bun, Node 19+, Deno, or any environment with `fetch` and Web Crypto.

## Install

```bash
bun add github:aktagon/llmkit-ts
```

## Quick Start

```ts
import { prompt, Providers } from "@aktagon/llmkit-ts";

const resp = await prompt(
  { name: Providers.anthropic, apiKey: process.env.ANTHROPIC_API_KEY! },
  { system: "You are helpful", user: "Hello" },
);
console.log(resp.text);
console.log(resp.tokens.input, resp.tokens.output);
```

## Providers

| Provider  | Default Model                               | Env Var           |
| --------- | ------------------------------------------- | ----------------- |
| anthropic | claude-sonnet-4-6                           | ANTHROPIC_API_KEY |
| openai    | gpt-4o                                      | OPENAI_API_KEY    |
| google    | gemini-2.5-flash                            | GOOGLE_API_KEY    |
| bedrock   | anthropic.claude-sonnet-4-20250514-v1:0     | AWS_ACCESS_KEY_ID |
| grok      | grok-3-fast                                 | GROK_API_KEY      |
| mistral   | mistral-large-latest                        | MISTRAL_API_KEY   |
| deepseek  | deepseek-chat                               | DEEPSEEK_API_KEY  |
| groq      | llama-3.3-70b-versatile                     | GROQ_API_KEY      |
| together  | meta-llama/Llama-3.3-70B-Instruct-Turbo     | TOGETHER_API_KEY  |
| cohere    | command-r-plus                              | COHERE_API_KEY    |
| ai21      | jamba-1.5-large                             | AI21_API_KEY      |
| cerebras  | llama-3.3-70b                               | CEREBRAS_API_KEY  |
| ...       | (full list in `src/providers/providers.ts`) |                   |

27 providers, 4 API shapes (OpenAI-compatible, Anthropic Messages, Google Generative AI, AWS Bedrock Converse). Bedrock auth uses SigV4; other providers use API-key auth.

## API

### prompt

One-shot request:

```ts
const resp = await prompt(
  provider,
  {
    system: "You are helpful",
    user: "What is 2+2?",
  },
  { temperature: 0.7 },
);

console.log(resp.text); // "4"
console.log(resp.tokens.input); // prompt tokens
console.log(resp.tokens.output); // completion tokens
console.log(resp.tokens.cacheRead); // tokens served from cache
console.log(resp.tokens.cacheWrite); // tokens written to cache (Anthropic explicit)
console.log(resp.tokens.reasoning); // internal reasoning tokens (OpenAI o-series, Gemini 2.5+)
```

Capability-scoped fields (`cacheRead`, `cacheWrite`, `reasoning`) are zero when the provider doesn't report them separately.

### promptStream

Streaming with a chunk callback:

```ts
const resp = await promptStream(provider, { user: "Count to 5" }, (chunk) =>
  process.stdout.write(chunk),
);
console.log("\n", resp.tokens);
```

Handles both Anthropic-style typed events (`event: content_block_delta`) and OpenAI-style data-only frames with the `data: [DONE]` sentinel.

### Agent with tools

Multi-turn conversations with function calling:

```ts
import { Agent } from "@aktagon/llmkit-ts";

const agent = new Agent(provider);
agent.setSystem("You are a calculator");
agent.addTool({
  name: "add",
  description: "Add two numbers",
  schema: {
    type: "object",
    properties: {
      a: { type: "number" },
      b: { type: "number" },
    },
  },
  run: ({ a, b }) => String(Number(a) + Number(b)),
});

const resp = await agent.chat("What is 2+3?");
console.log(resp.text);
```

The loop runs up to `maxToolIterations` (default 10), executing tools and feeding results back until the model returns text. Tool calls are dispatched per provider shape (Anthropic `tool_use`, OpenAI `tool_calls`, Google `functionCall`, Bedrock Converse `toolUse`).

### uploadFile

Upload a file to a provider's file API:

```ts
import { uploadFile, Providers } from "@aktagon/llmkit-ts";

const data = await Bun.file("document.pdf").bytes();
const file = await uploadFile(
  { name: Providers.openai, apiKey: process.env.OPENAI_API_KEY! },
  data,
  "document.pdf",
);
console.log(file.id, file.uri);
```

### GenerateImage

Generate images from text, optionally conditioned on reference images for
editing or composition. Currently supports Google's Nano Banana 2
(`gemini-3.1-flash-image-preview`) and Pro (`gemini-3-pro-image-preview`).

```ts
import { generateImage, Providers } from "@aktagon/llmkit-ts";

const resp = await generateImage(
  { name: Providers.google, apiKey: process.env.GOOGLE_API_KEY! },
  {
    prompt: "A nano banana dish in a fancy restaurant",
    model: "gemini-3.1-flash-image-preview",
  },
  { aspectRatio: "16:9", imageSize: "2K" },
);
await Bun.write("out.png", resp.images[0].bytes);
```

Pass reference images to edit or compose:

```ts
const edited = await generateImage(provider, {
  prompt: "Add snow and frost; overcast sky.",
  model: "gemini-3.1-flash-image-preview",
  referenceImages: [{ mimeType: "image/png", bytes: pngBytes }],
});
```

Aspect ratios and sizes are validated against a per-model whitelist before
the HTTP request — `imageSize: "512"` on Pro throws `ValidationError`
without paying for a 4xx round-trip.

| Model                 | Aspect ratios                                                               | Sizes           |
| --------------------- | --------------------------------------------------------------------------- | --------------- |
| Nano Banana 2 (Flash) | 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9, **1:4, 4:1, 1:8, 8:1** | 512, 1K, 2K, 4K |
| Nano Banana Pro       | 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9                         | 1K, 2K, 4K      |

Up to 14 reference images per request.

### Batches

Submit many requests at once for the provider's batch tier:

```ts
import { promptBatch } from "@aktagon/llmkit-ts";

const results = await promptBatch(provider, [
  { user: "Translate hello to French" },
  { user: "Translate hello to Spanish" },
  { user: "Translate hello to German" },
]);
results.forEach((r) => console.log(r.text));
```

`promptBatch` is `submitBatch` + `waitBatch`. Use `submitBatch` to get a `BatchHandle` you can persist, then call `waitBatch(handle)` later. Both inline (Anthropic) and file-reference (OpenAI two-hop) flows are handled internally.

### Caching

Opt in with `caching: true`. The mode is provider-specific and inferred:

```ts
// Anthropic — explicit cache_control wrap of the system prompt:
await prompt(
  anthropic,
  { system: longSysPrompt, user: "..." },
  { caching: true },
);

// OpenAI — automatic server-side caching (caching: true is a hint; reads
// surface in resp.tokens.cacheRead regardless):
await prompt(openai, { system: longSysPrompt, user: "..." }, { caching: true });

// Google — pre-flight POST creates a cachedContents resource, then the
// main call references it. Google requires ~1k+ tokens of system prompt:
await prompt(
  google,
  { system: bigSysPrompt, user: "..." },
  {
    caching: true,
    cacheTTL: 3600, // seconds
  },
);
```

## Options

```ts
const options = {
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  maxTokens: 1000,
  stopSequences: ["END"],
  seed: 42,
  frequencyPenalty: 0.5,
  presencePenalty: 0.5,
  thinkingBudget: 2000,
  reasoningEffort: "high",
  caching: true,
  cacheTTL: 300,
  signal: abortController.signal,
  middleware: [logUsage],
};
```

| Option           | anthropic | openai | google | grok |
| ---------------- | --------- | ------ | ------ | ---- |
| temperature      | x         | x      | x      | x    |
| topP             | x         | x      | x      | x    |
| topK             | x         |        | x      | x    |
| maxTokens        | x         | x      | x      | x    |
| stopSequences    | x         | x      | x      | x    |
| seed             |           | x      | x      | x    |
| frequencyPenalty |           | x      |        | x    |
| presencePenalty  |           | x      |        | x    |
| thinkingBudget   | x         |        | x      |      |
| reasoningEffort  |           | x      | x      |      |

Unsupported options throw `ValidationError` rather than silently dropping. Provider-specific dotted-path overrides (Anthropic `thinking.budget_tokens` with sibling `type: "enabled"`) are nested correctly.

## Middleware

Register pre/post hooks around LLM requests, tool calls, cache creation, uploads, and batch submits. Pre-phase middleware can veto an operation by returning a non-null `Error`; post-phase runs for observation only.

```ts
import type { Event, MiddlewareFn } from "@aktagon/llmkit-ts";

// Observation: log token usage after every LLM request.
const logUsage: MiddlewareFn = (_ctx, e) => {
  if (e.op === "llm_request" && e.phase === "post") {
    console.log(
      `${e.provider}/${e.model}: ${e.usage?.input} in, ${e.usage?.output} out, ${e.duration?.toFixed(1)}ms`,
    );
  }
  return null;
};

// Veto: abort if a daily budget is exceeded (pre-phase).
const budgetGate =
  (limit: number, spent: { value: number }): MiddlewareFn =>
  (_ctx, e) => {
    if (e.op === "llm_request" && e.phase === "pre" && spent.value >= limit) {
      return new Error(`daily budget $${limit.toFixed(2)} exceeded`);
    }
    return null;
  };

await prompt(provider, request, {
  middleware: [budgetGate(5.0, spent), logUsage],
});
```

A pre-phase veto throws `MiddlewareVetoError` from the call site so it can be discriminated from transport or provider errors. Middlewares fire in registration order; the first non-null pre-phase return aborts.

Streaming uses the same shape: one pre-phase before the request, one post-phase after the stream closes. `Event.usage` reflects accumulated usage at stream close. Per-chunk observation stays on the `onChunk` callback.

The seven wired sites: `prompt`, `promptStream`, `Agent` LLM call, `Agent` tool execution (`op=tool_call`), `uploadFile` (`op=upload`), `submitBatch` (`op=batch_submit`), Google resource caching pre-flight (`op=cache_create`).

## Architecture

- **Generated** (`src/providers/*.ts`) — per-provider config: URLs, auth, options, SSE framing, JSON paths. Pure data, no logic.
- **Hand-coded** (`src/llmkit.ts`, `src/agent.ts`, `src/request.ts`, `src/sigv4.ts`, `src/caching.ts`, `src/batch.ts`, `src/upload.ts`, `src/middleware.ts`, `src/paths.ts`, `src/types.ts`, `src/errors.ts`) — HTTP, request shaping, SSE consumer, agent tool loop, SigV4 signing, caching, batch lifecycle, multipart upload, middleware fanout.

Transforms are dispatched by config fields (`systemPlacement`, `wrapsOptionsIn`, `authScheme`), not provider names. Adding an OpenAI-compatible provider requires no TypeScript code — just regenerate.

## Mirror

This repo is a read-only mirror of a private monorepo. File issues here; code patches should target the private source via `christian@aktagon.com`.

## License

MIT
