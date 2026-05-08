// Public entry point for the typed-builder API.
//
// builders.ts (codegen-emitted) imports the wired terminals from
// text.ts / image.ts directly via `import { textPrompt } from "./text.ts"`,
// so importing builders.ts is enough to get the wired methods. This
// file just re-exports the public surface so callers can write
// `from "@aktagon/llmkit-ts/builders"` without reaching into a sub-file.

export * from "./builders.ts";
