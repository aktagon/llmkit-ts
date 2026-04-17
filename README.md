# @aktagon/llmkit-ts

TypeScript library for unified LLM API access. Per-provider config in `src/providers/` is generated; runtime is hand-coded. Shares a code-generation pipeline with the [Go SDK](https://github.com/aktagon/llmkit-go).

Status: early. Supports `prompt()` for `BearerToken` / `HeaderAPIKey` providers and the common system-placement styles. Caching, batching, streaming, tool use, and Google/Bedrock aren't ported yet.

## Install

```bash
bun add github:aktagon/llmkit-ts
```

## Quick Start

```ts
import { prompt, Provider } from "@aktagon/llmkit-ts";

const p: Provider = {
  name: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY!,
};
const resp = await prompt(p, { system: "You are helpful", user: "Hello" });
console.log(resp.text);
```

## Mirror

This repo is a read-only mirror of a private monorepo. Generated code (`src/providers/`) and handwritten runtime (`src/llmkit.ts`, `src/types.ts`, etc.) are synced from the source. File issues here; code patches should target the private source.

## License

MIT
