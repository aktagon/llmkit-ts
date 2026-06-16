//
//

import type { Client } from "./builders/builders.ts";
import { catalogueByProvider } from "./catalogue.ts";
import { info, parse, type ProviderInfo } from "./providers/provider_info.ts";






export function catalogueProvidersList(client: Client): ProviderInfo[] {
  const slug = client.provider.name;
  if (!catalogueByProvider[slug]) return [];
  const id = parse(slug);
  if (id === undefined) return [];
  return [info(id)];
}
