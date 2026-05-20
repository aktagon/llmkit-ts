// Hand-coded catalogue runtime (ADR-019). The generated builder classes
// in builders/catalogue.ts delegate their terminal methods here.

import type { Capability, Provider } from "./types.ts";
import type { LiveResult, ModelInfo } from "./structs.ts";
import { compiledInModels, catalogueByProvider } from "./catalogue.ts";
import type { Models, ScopedModels } from "./builders/catalogue.ts";

// Error sentinels. Plain Error subclasses so consumers can use
// `instanceof` or `err.name` for routing.
export class ErrModelsNotSupported extends Error {
  constructor(message = "llmkit: provider does not expose a models endpoint") {
    super(message);
    this.name = "ErrModelsNotSupported";
  }
}

export class ErrModelsUnavailable extends Error {
  constructor(message = "llmkit: provider models endpoint unavailable") {
    super(message);
    this.name = "ErrModelsUnavailable";
  }
}

export class ErrModelsScope extends Error {
  constructor(message = "llmkit: api key lacks scope for models endpoint") {
    super(message);
    this.name = "ErrModelsScope";
  }
}

/** Walk the compiled-in slice and return records whose capabilities array
 *  contains c. Returns a fresh array so callers cannot mutate the
 *  module-level constant. */
export function catalogueFilter(c: Capability | undefined): ModelInfo[] {
  if (!c) return [...compiledInModels];
  return compiledInModels.filter((m) => m.capabilities.includes(c));
}

/** Linear scan over the compiled-in slice. Returns undefined on miss. */
export function catalogueLookup(id: string): ModelInfo | undefined {
  return compiledInModels.find((m) => m.id === id);
}

/** Fan out per-provider live calls and aggregate into LiveResult.
 *  Phase 3 wires real HTTP; this scaffold inherits the same shape so the
 *  builder surface is stable. WithCapability composes post-fetch. */
export async function catalogueRunLive(models: Models): Promise<LiveResult> {
  const configured = models.client.providers.list();
  const all: ModelInfo[] = [];
  const errors: Record<string, string> = {};

  const results = await Promise.allSettled(
    configured.map(async (p) => {
      // Each provider runs through the ScopedModels path; ts re-exports
      // the constructor via the builders module.
      const { ScopedModels } = await import("./builders/catalogue.ts");
      const scoped = new ScopedModels(models.client, p, models.capFilter);
      return scoped.list();
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const p = configured[i]!;
    const r = results[i]!;
    if (r.status === "fulfilled") {
      all.push(...r.value);
    } else {
      errors[p.name] =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
    }
  }

  let filtered = all;
  if (models.capFilter) {
    filtered = all.filter((m) => m.capabilities.includes(models.capFilter!));
  }
  filtered.sort((a, b) => {
    if (a.provider.name !== b.provider.name) {
      return a.provider.name < b.provider.name ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return { models: filtered, errors };
}

/** Single-provider live HTTP — Phase 3 stub. */
export async function catalogueRunList(
  scoped: ScopedModels,
): Promise<ModelInfo[]> {
  if (!catalogueByProvider[scoped.target.name]) {
    throw new ErrModelsNotSupported();
  }
  throw new ErrModelsUnavailable();
}

/** Single-provider live model fetch — Phase 3 stub. */
export async function catalogueRunGet(
  scoped: ScopedModels,
  _id: string,
): Promise<ModelInfo> {
  if (!catalogueByProvider[scoped.target.name]) {
    throw new ErrModelsNotSupported();
  }
  throw new ErrModelsUnavailable();
}
