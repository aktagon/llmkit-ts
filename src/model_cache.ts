// Each client's in-memory model-list cache (ADR-102 MPT-005). Mirrors
// go/model_cache.go.

import type { ParsedModelRecord } from "./providers/models_parsers.ts";

/** How long a provider's live model list stays fresh, in milliseconds. */
export const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;

/** Holds each provider's last successful live model list, keyed by
 *  provider name. It stores the parsed records, before enrichment, so the
 *  chain's raw and withCapability settings apply on every read. Only the
 *  catalogue runtime reads it; sends never do. */
export class ModelCache {
  /** The clock, in epoch milliseconds. Tests replace it. */
  now: () => number = Date.now;
  private readonly entries = new Map<string, { records: ParsedModelRecord[]; fetchedAt: number }>();

  /** The provider's cached records when they are younger than the TTL. */
  get(provider: string): ParsedModelRecord[] | undefined {
    const e = this.entries.get(provider);
    if (!e || this.now() - e.fetchedAt >= MODEL_CACHE_TTL_MS) return undefined;
    return e.records;
  }

  /** Stores a successful live list. Failed calls never reach it. */
  put(provider: string, records: ParsedModelRecord[]): void {
    this.entries.set(provider, { records, fetchedAt: this.now() });
  }
}
