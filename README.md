# @aktagon/llmkit-ts

TypeScript library for unified LLM API access. Write one chain, hit any provider. Per-provider config in `src/providers/` is generated; runtime behavior (HTTP, transforms, agent loop, SigV4) is hand-coded with the help of AI. Shares a code-generation pipeline with the [Go](https://github.com/aktagon/llmkit-go), [Python](https://github.com/aktagon/llmkit-python), and [Rust](https://github.com/aktagon/llmkit-rust) SDKs.

Runtime: Node ≥18, Bun, Deno, Cloudflare Workers, or any modern bundler (Vite, Next.js, esbuild, webpack 5+) — anywhere with `fetch` and Web Crypto.

## Install

From npm:

```bash
bun add @aktagon/llmkit-ts
# or
npm install @aktagon/llmkit-ts
```

From GitHub (skip the npm publish loop):

```bash
bun add github:aktagon/llmkit-ts#ts-v1.0.1
# or
npm install github:aktagon/llmkit-ts#ts-v1.0.1
```

The package ships compiled ESM in `dist/` (works in plain Node ESM, Workers, Deno) plus the TypeScript source in `src/` (consumed for type info by Bun, Vite, Next.js, and any bundler with `moduleResolution: "bundler"`). No build step required at the consumer.

## Quick Start

```ts
import { anthropic } from "@aktagon/llmkit-ts/builders";

const c = anthropic(process.env.ANTHROPIC_API_KEY!);
const resp = await c
  .text()
  .system("You are concise.")
  .prompt("Why is the sky blue?");

console.log(resp.text);
console.log(resp.usage.input, resp.usage.output);
```

The typed builder is the only public surface as of v1.0.0. One mental model — `client.<capability>().<chain>.<terminal>` — across every capability.

## Providers

| Provider  | Default model                               | Env var           |
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

Per-provider factory functions: `ai21`, `anthropic`, `azure`, `bedrock`, `cerebras`, `cohere`, `deepseek`, `doubao`, `ernie`, `fireworks`, `google`, `grok`, `groq`, `lmstudio`, `minimax`, `mistral`, `moonshot`, `ollama`, `openai`, `openrouter`, `perplexity`, `qwen`, `sambanova`, `together`, `vllm`, `yi`, `zhipu`. Or use the generic `newClient(name, key)`.

## API

### Text — one-shot prompt

```ts
const resp = await c
  .text()
  .system("You are helpful")
  .temperature(0.7)
  .maxTokens(200)
  .prompt("What is 2+2?");

console.log(resp.text); // "4"
console.log(resp.usage.input); // prompt tokens
console.log(resp.usage.output); // completion tokens
console.log(resp.usage.cacheRead); // tokens served from cache
console.log(resp.usage.cacheWrite); // tokens written to cache (Anthropic explicit)
console.log(resp.usage.reasoning); // internal reasoning tokens (OpenAI o-series, Gemini 2.5+)
```

Capability-scoped fields (`cacheRead`, `cacheWrite`, `reasoning`) are zero when the provider doesn't report them separately.

### Stream — chunks + trailing handle

```ts
const stream = c.text().system("Be brief").stream("Tell me a joke");
for await (const chunk of stream) {
  process.stdout.write(chunk);
}
console.log("\n", stream.response()?.usage);
```

`TextStream` implements `AsyncIterable<string>`. After iteration completes, `stream.response()` returns the final `Response` (with token counts) and `stream.error()` returns any terminal error. Handles both Anthropic-style typed events and OpenAI-style data-only frames internally.

### Agent — tool loop

```ts
import type { Tool } from "@aktagon/llmkit-ts";

const add: Tool = {
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
};

const bot = c
  .agent()
  .system("You are a calculator.")
  .tool(add)
  .maxToolIterations(5);

const resp = await bot.prompt("What is 2+3?");
console.log(resp.text);
```

`*Agent` is **stateful** — repeated `bot.prompt(...)` calls accumulate history. Chain methods (`.system(...)`, `.tool(...)`) clone and reset state, so a forked builder gets a fresh conversation. `bot.reset()` clears state without dropping chained config.

Tool dispatch covers Anthropic `tool_use`, OpenAI `tool_calls`, Google `functionCall`, and Bedrock Converse `toolUse`. Tool errors surface to the model as the result string verbatim — sanitise tool inputs at the source.

### Image — text-to-image and edit

```ts
import { google } from "@aktagon/llmkit-ts/builders";

const c = google(process.env.GOOGLE_API_KEY!);
const img = await c
  .image()
  .model("gemini-3.1-flash-image-preview")
  .aspectRatio("16:9")
  .imageSize("2K")
  .generate("A nano banana dish, studio lighting");

await Bun.write("out.png", img.images[0].data);
```

For compositional editing, chain `.text(...)` and `.image(mime, bytes)` to interleave references with descriptions. The terminal `msg` is appended as a final text Part:

```ts
await c
  .image()
  .model("gemini-3.1-flash-image-preview")
  .text("Person:")
  .image("image/png", personBytes)
  .text("Outfit:")
  .image("image/png", outfitBytes)
  .generate("Generate the person wearing the outfit.");
```

Aspect ratios and sizes validate against a per-model whitelist before the HTTP request — `imageSize: "512"` on Pro throws `ValidationError` without paying for a 4xx round-trip.

| Model                 | Aspect ratios                                                               | Sizes           |
| --------------------- | --------------------------------------------------------------------------- | --------------- |
| Nano Banana 2 (Flash) | 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9, **1:4, 4:1, 1:8, 8:1** | 512, 1K, 2K, 4K |
| Nano Banana Pro       | 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9                         | 1K, 2K, 4K      |

Up to 14 reference images per request.

### Upload — Path or Bytes

```ts
import { openai } from "@aktagon/llmkit-ts/builders";

const c = openai(process.env.OPENAI_API_KEY!);

// from a path (Node/Bun only)
const file = await c.upload().path("./data.pdf").run();

// from bytes (works everywhere)
const file2 = await c
  .upload()
  .bytes(buf) // Uint8Array
  .filename("report.pdf")
  .mimeType("application/pdf")
  .run();
```

The `.path()` branch dynamically loads `node:fs/promises` and is unavailable in browsers / Cloudflare Workers / Deno without `--allow-read`. Use `.bytes()` for portable code.

### Batches

```ts
const results = await c
  .text()
  .system("Be brief")
  .batch([
    "Translate hello to French",
    "Translate hello to Spanish",
    "Translate hello to German",
  ]);
results.forEach((r) => console.log(r.text));
```

`.batch(prompts)` is `.submitBatch(prompts)` + `handle.wait()`. Use `.submitBatch(prompts)` to get a `BatchHandle` you can persist, then call `handle.wait()` later. Both inline (Anthropic) and file-reference (OpenAI two-hop) flows are handled internally.

### Caching

```ts
// Anthropic — explicit cache_control wrap of the system prompt:
await c.text().system(longSysPrompt).caching().prompt("...");

// OpenAI — automatic server-side caching (caching() is a hint; reads
// surface in resp.usage.cacheRead regardless):
await c.text().system(longSysPrompt).caching().prompt("...");

// Google — pre-flight POST creates a cachedContents resource, then the
// main call references it. Google requires ~1k+ tokens of system prompt:
await c.text().system(bigSysPrompt).caching().prompt("...");
```

The mode is provider-specific and inferred from the provider config. The default TTL comes from `src/providers/caching.ts` (Google: 3600s).

## Options

Across every `*Text` / `*Agent` builder:

| Concept           | Method                | Notes                                                                                     |
| ----------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| System prompt     | `.system(s)`          |                                                                                           |
| Model override    | `.model(name)`        |                                                                                           |
| Sampling          | `.temperature(t)`     |                                                                                           |
| Token cap         | `.maxTokens(n)`       |                                                                                           |
| Caching           | `.caching()`          |                                                                                           |
| Conversation hist | `.history(msgs)`      |                                                                                           |
| Structured output | `.schema(json)`       | OpenAI strict mode requires `additionalProperties: false` and `required` on object types. |
| Middleware hooks  | `.middleware(fns)`    | See below.                                                                                |
| Reasoning effort  | `.reasoningEffort(l)` | OpenAI o-series, Gemini 2.5+                                                              |
| Thinking budget   | `.thinkingBudget(n)`  | Anthropic, Gemini                                                                         |

Sampling hyperparameters (`.topP`, `.topK`, `.seed`, `.frequencyPenalty`, `.presencePenalty`, `.stopSequences`) are validated per provider; unsupported options throw `ValidationError` rather than silently dropping.

The Image builder has a narrower set: `.model`, `.aspectRatio`, `.imageSize`, `.includeText`, `.text`, `.image`, `.middleware`. Upload: `.path`, `.bytes`, `.filename`, `.mimeType`, `.middleware`.

## Middleware

Register pre/post hooks around LLM requests, tool calls, cache creation, uploads, and batch submits. Pre-phase middleware can veto by returning a non-null `Error`; post-phase runs for observation only.

```ts
import type { Event, MiddlewareFn } from "@aktagon/llmkit-ts";

// Observation: log token usage after every LLM request.
const logUsage: MiddlewareFn = (e) => {
  if (e.op === "llm_request" && e.phase === "post") {
    console.log(
      `${e.provider}/${e.model}: ${e.usage?.input} in, ${e.usage?.output} out, ${e.duration?.toFixed(1)}ms`,
    );
  }
  return null;
};

// Veto: abort if a daily budget is exceeded.
const budgetGate =
  (limit: number, spent: { value: number }): MiddlewareFn =>
  (e) => {
    if (e.op === "llm_request" && e.phase === "pre" && spent.value >= limit) {
      return new Error(`daily budget $${limit.toFixed(2)} exceeded`);
    }
    return null;
  };

await c
  .text()
  .middleware([budgetGate(5.0, spent), logUsage])
  .prompt("...");
```

A pre-phase veto throws `MiddlewareVetoError` so it can be discriminated from transport or provider errors. Middlewares fire in registration order; the first non-null pre-phase return aborts.

Wired at seven sites: `Text.prompt`, `Text.stream`, `Agent` LLM call, `Agent` tool execution (`op=tool_call`), `Upload.run` (`op=upload`), `Text.submitBatch` / `Text.batch` (`op=batch_submit`), Google resource caching pre-flight (`op=cache_create`).

## Self-hosted endpoints

```ts
import { openai } from "@aktagon/llmkit-ts/builders";

const c = openai("anything").withBaseUrl("http://localhost:8080/v1");
```

Works for any OpenAI-compatible server (vLLM, LM Studio, Ollama, corporate gateways).

## Architecture

- **Generated** (`src/providers/*.ts`, `src/builders/builders.ts`) — per-provider config + the typed-builder API surface. Pure data and class skeletons, no business logic.
- **Hand-coded** (`src/llmkit.ts`, `src/agent.ts`, `src/request.ts`, `src/sigv4.ts`, `src/caching.ts`, `src/batch.ts`, `src/upload.ts`, `src/middleware.ts`, `src/paths.ts`, `src/types.ts`, `src/errors.ts`, `src/builders/{text,agent,image,stream,batch,upload}.ts`) — HTTP, request shaping, SSE consumer, agent tool loop, SigV4 signing, caching, batch lifecycle, multipart upload, middleware fanout, builder terminals.

Transforms dispatch on config fields (`systemPlacement`, `wrapsOptionsIn`, `authScheme`), not provider names. Adding an OpenAI-compatible provider requires no TypeScript code.

## Mirror

This repo is a read-only mirror of a private monorepo. File issues here; code patches should target the private source via `christian@aktagon.com`.

## License

MIT
