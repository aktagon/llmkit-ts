// Hand-coded providers-namespace runtime (ADR-019). The generated
// Providers class in builders/catalogue.ts delegates here.

import type { Provider } from "./types.ts";
import type { Client } from "./builders/builders.ts";
import { catalogueByProvider } from "./catalogue.ts";
import {
  Providers as ProviderRegistry,
  type ProviderName,
} from "./providers/providers.ts";

/** Eligibility test per ADR-019: credentials configured on this Client
 *  AND llm:hasModelsEndpoint declared in the ontology. A TS Client carries
 *  one provider's credentials, so the result is either a single-element
 *  array (when its provider has a catalogue endpoint) or empty. */
export function catalogueProvidersList(client: Client): Provider[] {
  const p = client.provider;
  if (!catalogueByProvider[p.name]) return [];
  return [
    { name: p.name as ProviderName, apiKey: p.apiKey, baseUrl: p.baseUrl },
  ];
}

/** Every provider the SDK was built to support — independent of Client
 *  credentials. Sorted by name for deterministic callers. */
export function catalogueProvidersSupported(): Provider[] {
  const names = Object.values(ProviderRegistry).sort();
  return names.map((name) => ({ name, apiKey: "" }));
}
