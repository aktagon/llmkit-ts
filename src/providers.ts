//
//

import type { Provider } from "./types.ts";
import type { Client } from "./builders/builders.ts";
import { catalogueByProvider } from "./catalogue.ts";
import {
  Providers as ProviderRegistry,
  type ProviderName,
} from "./providers/providers.ts";





export function catalogueProvidersList(client: Client): Provider[] {
  const p = client.provider;
  if (!catalogueByProvider[p.name]) return [];
  return [
    { name: p.name as ProviderName, apiKey: p.apiKey, baseUrl: p.baseUrl },
  ];
}



export function catalogueProvidersSupported(): Provider[] {
  const names = Object.values(ProviderRegistry).sort();
  return names.map((name) => ({ name, apiKey: "" }));
}
