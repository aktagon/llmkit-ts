// Internal barrel for the typed-builder API. The package's only entry point
// is ../llmkit.ts (ADR-103 PUB-009); tests and examples import this file.
//
//
// text.ts / image.ts directly via `import { textPrompt } from "./text.ts"`,
// so importing builders.ts is enough to get the wired methods. This
// file just re-exports builders.ts.

export * from "./builders.ts";
