// Regression guard for HANDOFF-004 (docs/handoffs/004-workers-createrequire-crash.md).
//
// The published bundle must not contain an eager top-level
// `createRequire(import.meta.url)`. On Cloudflare Workers / workerd
// `import.meta.url` is undefined, so such an initializer throws at module load
// — before any llmkit code runs — making the SDK unusable on Workers.
//
// The shim is emitted by bun's `--target node` CJS-interop for the guarded
// `await import("node:fs/promises")` in builders/upload.ts (the helper is dead
// — never called — but its eager initializer still crashes). The fix is to
// bundle with `--target browser`, which leaves node: builtins as native
// dynamic imports and emits no createRequire shim, while still running on
// Node/Bun/Deno/Workers (the SDK uses web-standard fetch + crypto.subtle and a
// guarded dynamic node:fs import).
//
// The target is read from package.json#scripts.build rather than hardcoded, so
// a regression that flips the build back to `--target node` makes this test go
// red instead of silently passing.
import { test, expect } from "bun:test";

const BUILD_ENTRYPOINTS = ["src/llmkit.ts", "src/builders/index.ts"];

async function buildTargetFromPackageJson(): Promise<"browser" | "bun" | "node"> {
  const pkg = (await Bun.file("package.json").json()) as {
    scripts?: { build?: string };
  };
  const buildScript = pkg.scripts?.build ?? "";
  const match = buildScript.match(/--target\s+(browser|bun|node)\b/);
  // bun's default target is "browser" when --target is omitted.
  return (match?.[1] as "browser" | "bun" | "node") ?? "browser";
}

test("published bundle has no eager createRequire(import.meta.url) (workerd boot guard)", async () => {
  const target = await buildTargetFromPackageJson();

  const result = await Bun.build({
    entrypoints: BUILD_ENTRYPOINTS,
    target,
    format: "esm",
    splitting: true,
  });

  expect(result.success).toBe(true);

  const offenders: string[] = [];
  for (const output of result.outputs) {
    if (output.kind === "sourcemap") continue;
    const text = await output.text();
    if (text.includes("createRequire(import.meta.url)")) {
      offenders.push(output.path);
    }
  }

  expect(offenders).toEqual([]);
});
