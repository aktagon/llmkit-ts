// Hand-coded providers-namespace runtime (ADR-019). The generated
// Providers class in builders/catalogue.ts delegates here.

import type { Client } from "./builders/builders.ts";
import { catalogueByProvider } from "./catalogue.ts";
import { info, parse, type ProviderInfo } from "./providers/provider_info.ts";

/** Eligibility test per ADR-019: credentials configured on this Client
 *  AND llm:hasModelsEndpoint declared in the ontology. A TS Client carries
 *  one provider's credentials, so the result is either a single-element
 *  array (when its provider has a catalogue endpoint) or empty. Each entry
 *  is secret-free ProviderInfo (ADR-040 PSR-005). */
export function catalogueProvidersList(client: Client): ProviderInfo[] {
  const slug = client.provider.name;
  if (!catalogueByProvider[slug]) return [];
  const id = parse(slug);
  if (id === undefined) return [];
  return [info(id)];
}
