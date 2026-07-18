# @aktagon/llmkit-ts

One TypeScript API for Anthropic, OpenAI, Google, and 20+ other providers — including local models through Ollama and vLLM. Switch providers without rewriting your request.

No runtime dependencies. Runs on Node ≥18, Bun, Deno, Cloudflare Workers, or any modern bundler (Vite, Next.js, esbuild, webpack 5+) — anywhere with `fetch` and Web Crypto.

Also available for Go, Python, and Rust.

<p align="center">
  <img src="https://raw.githubusercontent.com/aktagon/llmkit-ts/master/assets/logos/llmkit-languages.svg" alt="Go, TypeScript, Python, Rust" height="26">
</p>
<p align="center">
  <img src="https://raw.githubusercontent.com/aktagon/llmkit-ts/master/assets/logos/llmkit-providers.svg" alt="Anthropic, OpenAI, Google, and 20+ more providers" height="26">
</p>

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
const resp = await c.text
  .system("You are concise.")
  .prompt("Why is the sky blue?");

console.log(resp.text);
console.log(resp.usage.input, resp.usage.output);
```

`c.text`, `c.image`, `c.music`, `c.video`, `c.agent`, and `c.upload` are fields on the `Client` — access them without parentheses. Chain methods (`.system(...)`, `.temperature(...)`) clone the builder and return the clone, so a forked chain shares no state with its parent. The typed builder is the only public surface as of v1.0.0. One mental model — `client.<capability>.<chain>.<terminal>` — across every capability.

Runnable examples for each capability live in [`examples/`](./examples); `tests/examples.test.ts` exercises every documented call shape against a mock HTTP server, so the snippets in this README cannot drift from the actual API surface.

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

36 providers, 4 API shapes (OpenAI-compatible, Anthropic Messages, Google Generative AI, AWS Bedrock Converse). Bedrock auth uses SigV4; other providers use API-key auth.

Per-provider factory functions: `ai21`, `anthropic`, `assemblyai`, `azure`, `bedrock`, `cerebras`, `cohere`, `deepseek`, `doubao`, `ernie`, `fireworks`, `google`, `grok`, `groq`, `inworld`, `jan`, `llamacpp`, `lmstudio`, `minimax`, `mistral`, `moonshot`, `ollama`, `openai`, `openrouter`, `perplexity`, `pixverse`, `qwen`, `recraft`, `sambanova`, `together`, `vertex`, `vidu`, `vllm`, `workersai`, `yi`, `zhipu`. Or use the generic `newClient(name, key)`.

## API

### Text — one-shot prompt

```ts
const resp = await c.text
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

<!-- llmkit:include ts/examples/streaming.ts#stream -->
```ts
const stream = client.text
  .system("Be brief")
  .stream("Tell me a one-line joke");
for await (const chunk of stream) {
  process.stdout.write(chunk);
}
process.stdout.write("\n");
const final = stream.response();
if (final !== null) {
  console.log(
    `input=${final.usage.input} output=${final.usage.output} ` +
      `finishReason=${final.finishReason ?? ""}`,
  );
}
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

const bot = c.agent
  .system("You are a calculator.")
  .addTool(add)
  .maxToolIterations(5);

const resp = await bot.prompt("What is 2+3?");
console.log(resp.text);
```

`*Agent` is **stateful** — repeated `bot.prompt(...)` calls accumulate history. Chain methods (`.system(...)`, `.addTool(...)`) clone and reset state, so a forked builder gets a fresh conversation. `bot.reset()` clears state without dropping chained config.

Tool dispatch covers Anthropic `tool_use`, OpenAI `tool_calls`, Google `functionCall`, and Bedrock Converse `toolUse`. Tool errors surface to the model as the result string verbatim — sanitise tool inputs at the source.

### Image input (vision)

Attach an image to a text prompt with `.image(mime, bytes)`; it is sent as the
provider's native image block (works on Anthropic, OpenAI, Google, and
Bedrock). Bytes-based, so it works with no filesystem (e.g. a browser
extension passing a screenshot straight through):

```ts
const resp = await c.text
  .image("image/png", screenshotBytes)
  .prompt("Describe this screenshot in one sentence.");
```

### Image — text-to-image and edit

```ts
import { google } from "@aktagon/llmkit-ts/builders";

const c = google(process.env.GOOGLE_API_KEY!);
const img = await c.image
  .model("gemini-3.1-flash-image-preview")
  .aspectRatio("16:9")
  .imageSize("2K")
  .generate("A nano banana dish, studio lighting");

await Bun.write("out.png", img.images[0]!.bytes);
```

For compositional editing, chain `.text(...)` and `.image(mime, bytes)` to interleave references with descriptions. The terminal `msg` is appended as a final text Part:

```ts
await c.image
  .model("gemini-3.1-flash-image-preview")
  .text("Person:")
  .image("image/png", personBytes)
  .text("Outfit:")
  .image("image/png", outfitBytes)
  .generate("Generate the person wearing the outfit.");
```

Aspect ratios and sizes validate against a per-model whitelist before the HTTP request — `imageSize("512")` on Pro throws `ValidationError` without paying for a 4xx round-trip. Empty whitelists mean "no client-side check; pass through" — providers like OpenAI accept arbitrary sizes within documented bounds, so the SDK trusts the API boundary instead of carrying a stale list.

| Provider | Model                          | Aspect ratios                                                                   | Sizes                               |
| -------- | ------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------- |
| Google   | Nano Banana 2 (Flash)          | 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9, **1:4, 4:1, 1:8, 8:1**     | 512, 1K, 2K, 4K                     |
| Google   | Nano Banana Pro                | 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9                             | 1K, 2K, 4K                          |
| OpenAI   | gpt-image-2 / 1.5 / 1 / 1-mini | n/a (size only)                                                                 | any (e.g. `1024x1024`, `1536x1024`) |
| xAI      | grok-imagine-image-quality     | 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 1:2, 2:1, 19.5:9, 9:19.5, 20:9, 9:20, auto | 1k, 2k                              |
| Vertex   | imagen-3.0 / 4.0               | 1:1, 9:16, 16:9, 3:4, 4:3                                                       | fixed per model                     |

OpenAI gpt-image-\* models accept arbitrary sizes within documented bounds (max edge ≤3840, both edges multiples of 16, ratio ≤3:1, total pixels 655K–8.3M). They always return base64-encoded images, so `resp.images[0].bytes` works the same on both providers.

Provider knobs are typed chain methods on the `Image` builder:

| Method               | Provider support            | Wire field       |
| -------------------- | --------------------------- | ---------------- |
| `.quality(s)`        | OpenAI gpt-image-\*         | `quality`        |
| `.outputFormat(s)`   | OpenAI gpt-image-\*         | `output_format`  |
| `.background(s)`     | OpenAI gpt-image-\*         | `background`     |
| `.count(n)`          | OpenAI + xAI Grok           | `n`              |
| `.mask(mime, bytes)` | OpenAI gpt-image-\* (edits) | multipart `mask` |

The chain validates per provider — calling `.quality(...)` on a Google or xAI builder rejects with `ValidationError` immediately, no HTTP round-trip. Knobs without typed methods (OpenAI: `output_compression`, `moderation`) remain reachable via `.extraFields(...)`, which is unvalidated and freeform.

```ts
import { openai } from "@aktagon/llmkit-ts/builders";

const c = openai(process.env.OPENAI_API_KEY!);
const resp = await c.image
  .model("gpt-image-2")
  .imageSize("1024x1024")
  .quality("high")
  .count(4)
  .generate("A red circle on a white background");
```

Dispatch is automatic: chains without image parts hit OpenAI's `/v1/images/generations` (JSON); chains carrying one or more `.image(...)` parts hit `/v1/images/edits` (multipart/form-data with one `image[]` field per reference, in caller order). gpt-image-\* requires organization verification — see [platform.openai.com/docs/guides/your-data#organization-verification](https://platform.openai.com/docs/guides/your-data#organization-verification).

Up to 14 reference images per Google request, 16 per OpenAI request.

#### Vertex AI Imagen (Google Cloud)

Vertex Imagen uses the `:predict` endpoint family and OAuth bearer auth instead of API keys. The SDK takes a bearer token (string); caller manages OAuth refresh externally (e.g. `gcloud auth print-access-token`, service-account JSON, or workload identity).

```ts
import { vertex } from "@aktagon/llmkit-ts/builders";

// Caller substitutes {project_id} and {location} before passing the URL.
const baseUrl =
  "https://us-central1-aiplatform.googleapis.com" +
  "/v1/projects/my-gcp-project/locations/us-central1/publishers/google/models";

const c = vertex(process.env.VERTEX_BEARER_TOKEN!).baseURL(baseUrl);

const resp = await c.image
  .model("imagen-3.0-generate-002")
  .aspectRatio("16:9")
  .count(2)
  .generate("A red circle");
```

Edit-mode (single image into `instances[0].image`) and inpainting (`.mask(mime, bytes)` into `instances[0].mask.image`) work the same way. Imagen-specific knobs like `negativePrompt` and `safetySetting` are reachable through `.extraFields(...)` — they spread into the request's `parameters` block. Vertex's `:predict` response does not carry token counts; `resp.usage` stays zero.

### Music — text-to-music

Generate audio from a text prompt via the typed-builder chain on `c.music`. Decoded audio bytes come back on `resp.audio[0].bytes`. Models that support vocals take lyrics via `.lyrics(...)` (use section tags like `[verse]`); instrumental-only models reject lyrics before the request is sent.

<!-- llmkit:include ts/examples/music.ts#music -->
```typescript
const r = await client.music
  .model("lyria-002")
  .generate("a calm instrumental, warm piano and soft strings");

const first = r.audio[0];
if (!first) throw new Error("no audio returned");
await Bun.write("out.wav", first.bytes);
```

Models with vocals take lyrics via `.lyrics(...)`:

```typescript
const song = await c.music.model("lyria-3-pro-preview").lyrics("[verse] neon lights").generate("dream pop, 90 bpm");
```

| Provider | Model(s)                                      | Lyrics | Output     |
| -------- | --------------------------------------------- | ------ | ---------- |
| Vertex   | `lyria-002`                                   | no     | WAV (~30s) |
| Google   | `lyria-3-pro-preview`, `lyria-3-clip-preview` | yes    | MP3        |
| MiniMax  | `music-2.6`                                   | yes    | MP3        |

### Video — text-to-video

Generate video from a text prompt. Video generation is asynchronous: `submit` returns a handle immediately, and `handle.wait()` polls until the job finishes. The result carries a temporary hosted URL on `resp.videos[0].url` — download it yourself.

<!-- llmkit:include ts/examples/video.ts#video -->
```typescript
const handle = await client.video
  .model("grok-imagine-video")
  .submit(
    "a slow cinematic drone shot flying over snow-capped alpine peaks at golden hour",
  );

const r = await handle.wait();

const v = r.videos[0];
if (!v) throw new Error("no video returned");
console.log(
  `done: url=${v.url} duration=${v.durationSeconds}s mime=${v.mimeType}`,
);
```

| Provider | Model                | Delivery |
| -------- | -------------------- | -------- |
| Grok     | `grok-imagine-video` | URL      |

### Safety Settings

Control content filtering for Gemini providers. `safetySettings` applies to text
generation, streaming, agents, and Gemini image generation. `safetyFilter` applies
to Vertex Imagen only.

```ts
import {
  google,
  vertex,
  HARM_CATEGORY_DANGEROUS_CONTENT,
  HARM_CATEGORY_HARASSMENT,
  HARM_BLOCK_THRESHOLD_NONE,
  HARM_BLOCK_THRESHOLD_HIGH_ONLY,
  IMAGE_SAFETY_FILTER_BLOCK_FEW,
} from "@aktagon/llmkit-ts/builders";

// Gemini text or agent
const c = google(process.env.GOOGLE_API_KEY!);
const resp = await c.text
  .safetySettings([
    {
      category: HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HARM_BLOCK_THRESHOLD_NONE,
    },
    {
      category: HARM_CATEGORY_HARASSMENT,
      threshold: HARM_BLOCK_THRESHOLD_HIGH_ONLY,
    },
  ])
  .prompt("Write a story");

// Vertex Imagen
const vc = vertex(process.env.VERTEX_BEARER_TOKEN!);
const img = await vc.image
  .model("imagen-3.0-generate-002")
  .safetyFilter(IMAGE_SAFETY_FILTER_BLOCK_FEW)
  .generate("A landscape");
```

`safetySettings` on Vertex Imagen and `safetyFilter` on non-Imagen providers throw
a `ValidationError`. The `HARM_CATEGORY_*`, `HARM_BLOCK_THRESHOLD_*`, and
`IMAGE_SAFETY_FILTER_*` constants cover all documented values; raw strings also work.

### Upload — Path or Bytes

```ts
import { openai } from "@aktagon/llmkit-ts/builders";

const c = openai(process.env.OPENAI_API_KEY!);

// from a path (Node/Bun only)
const file = await c.upload.path("./data.pdf").run();

// from bytes (works everywhere)
const file2 = await c.upload
  .bytes(buf) // Uint8Array
  .filename("report.pdf")
  .mimeType("application/pdf")
  .run();
```

The `.path()` branch dynamically loads `node:fs/promises` and is unavailable in browsers / Cloudflare Workers / Deno without `--allow-read`. Use `.bytes()` for portable code.

### Batches

<!-- llmkit:include ts/examples/batch.ts#batch -->
```ts
const handle = await client.text
  .system("Be brief")
  .batch(
    "Translate hello to French",
    "Translate hello to Spanish",
    "Translate hello to German",
  );
const results = await handle.wait();
results.forEach((r) => console.log(r.text));
```

`c.text.<config>.batch(...prompts)` queues the batch and returns a `BatchHandle` you can persist. Call `handle.wait()` to block until completion, or `handle.poll()` to drive the loop yourself. The blocking one-liner is `(await c.text.batch(...prompts)).wait()`. Both inline (Anthropic) and file-reference (OpenAI two-hop) flows are handled internally.

### Caching

```ts
// Anthropic — explicit cache_control wrap of the system prompt:
await c.text.system(longSysPrompt).caching().prompt("...");

// OpenAI — automatic server-side caching (caching() is a hint; reads
// surface in resp.usage.cacheRead regardless):
await c.text.system(longSysPrompt).caching().prompt("...");

// Google — pre-flight POST creates a cachedContents resource, then the
// main call references it. Google requires ~1k+ tokens of system prompt:
await c.text.system(bigSysPrompt).caching().prompt("...");
```

The mode is provider-specific and inferred from the provider config. The default TTL comes from `src/providers/caching.ts` (Google: 3600s).

### Model catalogue

`c.models` and `c.providers` cover model discovery in three modes. Runnable counterpart at [`examples/catalogue.ts`](./examples/catalogue.ts).

```ts
import { Capabilities } from "@aktagon/llmkit-ts";
import type { Provider } from "@aktagon/llmkit-ts";

// 1. Compiled-in catalogue — synchronous, no HTTP.
const all = c.models.list();
const info = c.models.get("claude-opus-4-7"); // ModelInfo | undefined
const chat = c.models.withCapability(Capabilities.ChatCompletion).list();

// 2. Providers namespace.
c.providers.list(); // configured (credentials + /v1/models endpoint)
providers.list(); // every provider the SDK ships with (static, keyless)

// 3. Live + scoped HTTP.
const live = await c.models.live(); // LiveResult — fan-out
const p: Provider = { name: "anthropic", apiKey: "sk-..." };
const scoped = await c.models.provider(p).list(); // single-provider list
const raw = await c.models.provider(p).raw().list(); // ModelInfo.raw populated
```

`live()` calls every configured provider's `/v1/models` in parallel and aggregates results into `LiveResult.models` + a per-provider `LiveResult.errors` map (partial success is the normal case). `provider(p).raw().list()` opts into populating `ModelInfo.raw` with the provider-native record — useful when you need fields the universal `ModelInfo` does not carry (Anthropic's capability matrix, Google's `supportedGenerationMethods`, etc.).

## Options

Across every `*Text` / `*Agent` builder:

| Concept           | Method                   | Notes                                                                                                                                           |
| ----------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| System prompt     | `.system(s)`             |                                                                                                                                                 |
| Model override    | `.model(name)`           |                                                                                                                                                 |
| Sampling          | `.temperature(t)`        |                                                                                                                                                 |
| Token cap         | `.maxTokens(n)`          |                                                                                                                                                 |
| Caching           | `.caching()`             |                                                                                                                                                 |
| Conversation hist | `.history(...msgs)`      | `*Text` only. `*Agent` accumulates history across `.prompt(...)` calls on the same instance, so an explicit setter would shadow that semantics. |
| Structured output | `.schema(json)`          | OpenAI strict mode requires `additionalProperties: false` and `required` on object types.                                                       |
| Middleware hooks  | `.addMiddleware(...fns)` | See below.                                                                                                                                      |
| Reasoning effort  | `.reasoningEffort(l)`    | OpenAI o-series, Gemini 2.5+                                                                                                                    |
| Thinking budget   | `.thinkingBudget(n)`     | Anthropic, Gemini                                                                                                                               |

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

await c.text.addMiddleware(budgetGate(5.0, spent), logUsage).prompt("...");
```

A pre-phase veto throws `MiddlewareVetoError` so it can be discriminated from transport or provider errors. Middlewares fire in registration order; the first non-null pre-phase return aborts.

Wired at seven sites: `Text.prompt`, `Text.stream`, `Agent` LLM call, `Agent` tool execution (`op=tool_call`), `Upload.run` (`op=upload`), `Text.batch` (`op=batch_submit`), Google resource caching pre-flight (`op=cache_create`).

## Telemetry

Opt-in OpenTelemetry. Attach a `Telemetry` and every call — success and rejection alike — produces one OTEL GenAI span (operation, provider, model, token usage, and `error.type` on failure) as standards-compliant OTLP/JSON bytes. llmkit builds the span; you decide where the bytes go. Off unless attached.

```ts
import { openai, httpExport } from "@aktagon/llmkit-ts";

// Batteries: POST every span to an OTLP collector.
const client = openai(process.env.OPENAI_API_KEY).addTelemetry({
  export: httpExport("https://collector:4318"),
});

// Or bring your own transport — hand the bytes to your OTEL SDK:
client.addTelemetry({ export: (b) => batchProcessor.enqueue(b) });

const resp = await client.text.prompt("Hello");
```

`httpExport` is a fail-open POST — convenient for low volume; for high volume hand your own callback into your OTEL SDK's batch processor. The same OTLP span shape is emitted byte-for-byte across all six SDKs, so one collector serves a polyglot fleet. A telemetry config with no `export` throws a `ValidationError`.

## Self-hosted endpoints

```ts
import { openai } from "@aktagon/llmkit-ts/builders";

const c = openai("anything").baseURL("http://localhost:8080/v1");
```

Works for any OpenAI-compatible server (vLLM, LM Studio, Ollama, corporate gateways).

## Custom headers

Attach a custom HTTP header to every request — for example an authenticated gateway that needs its own auth header alongside the provider key. `addHeader` is chainable and calls accumulate.

```ts
import { anthropic } from "@aktagon/llmkit-ts/builders";

const c = anthropic(apiKey)
  .baseURL("https://gateway.example.com/anthropic")
  .addHeader("cf-aig-authorization", `Bearer ${gatewayToken}`);
```

The custom header is sent in addition to the provider's auth header; it cannot override the provider auth header or the required version header.

## Wire-format stability

`*Agent` history persists across process boundaries through two paired
functions:

```typescript
const data = bot.save(); // string
// ...later, fresh process...
const bot = c.agent.system("...").tool(t).load(data);
// throws UnsupportedWireVersionError on mismatch
```

Or the free-function form for admin tooling:

```typescript
import { saveHistory, loadHistory } from "@aktagon/llmkit";

const data = saveHistory(msgs);
const msgs = loadHistory(data);
```

The output is a JSON document with a `_v` integer envelope plus a
`messages` array. The version is tracked through
`WIRE_SCHEMA_VERSION`; the in-memory `Message` schema may evolve
additively under one version (new optional fields work on older
readers), but a renamed, removed, or retyped field requires a `_v`
bump and a migrator.

`saveHistory` / `loadHistory` are the ONLY guaranteed-stable
serialization path. Direct `JSON.stringify` on a `Message` produces
valid JSON but lacks the `_v` envelope, and `loadHistory` rejects it
with `MissingWireVersionError`. Use the contract path for anything
that crosses a process boundary or a release.

## Mirror

This repo is a read-only mirror of a private monorepo. File issues here; code patches should target the private source via `christian@aktagon.com`.

## License

MIT
