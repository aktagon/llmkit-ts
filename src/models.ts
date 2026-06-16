//
//

import type { Capability, Provider } from "./types.ts";
import type { LiveResult, ModelInfo, ProviderError } from "./structs.ts";
import {
  compiledInModels,
  catalogueByProvider,
  ontologyCapabilities,
} from "./catalogue.ts";
import type { Models, ScopedModels } from "./builders/catalogue.ts";
import {
  PROVIDERS,
  type ProviderSpec,
  type ProviderName,
} from "./providers/providers.ts";
import { buildAuthHeaders } from "./request.ts";
import { firePre, firePost } from "./middleware.ts";
import {
  parseAnthropicModelsResponse,
  parseGoogleModelsResponse,
  parseOpenAICohortModelsResponse,
  type ParsedModelRecord,
  type ParsedModelsPage,
} from "./providers/models_parsers.ts";

//
//
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

const scopeBodyPattern = /scope|permission/i;





export function classifyCatalogueError(err: unknown): string {
  if (err instanceof ErrModelsNotSupported) return "not_supported";
  if (err instanceof ErrModelsScope) return "scope";
  return "unavailable";
}




export function catalogueFilter(c: Capability | undefined): ModelInfo[] {
  if (!c) return [...compiledInModels];
  return compiledInModels.filter((m) => m.capabilities.includes(c));
}


export function catalogueLookup(id: string): ModelInfo | undefined {
  return compiledInModels.find((m) => m.id === id);
}




export async function catalogueRunLive(models: Models): Promise<LiveResult> {
  //
  //
  //
  const cfg = models.client.provider;
  const configured: Provider[] = models.client.providers.list().map((p) => ({
    name: p.id,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
  }));
  const all: ModelInfo[] = [];
  const errors: Record<string, ProviderError> = {};

  const results = await Promise.allSettled(
    configured.map(async (p) => {
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
      //
      const message =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors[p.name] = { kind: classifyCatalogueError(r.reason), message };
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





export async function catalogueRunList(
  scoped: ScopedModels,
): Promise<ModelInfo[]> {
  const cfg = catalogueByProvider[scoped.target.name];
  if (!cfg) throw new ErrModelsNotSupported();
  const pcfg = PROVIDERS[scoped.target.name as ProviderName];
  if (!pcfg) throw new ErrModelsNotSupported();

  const baseEvent = {
    op: "models_list" as const,
    phase: "pre" as const,
    provider: scoped.target.name,
    model: "",
  };
  const start = performance.now();
  const veto = firePre(undefined, baseEvent);
  if (veto) throw veto;

  let cursor = "";
  const records: ParsedModelRecord[] = [];
  let caught: unknown = null;
  try {
    for (;;) {
      const reqUrl = appendCursor(
        buildCatalogueUrl(scoped.target, pcfg, cfg.endpoint),
        cfg.pagination,
        cursor,
      );
      const page = await fetchCataloguePage(
        reqUrl,
        scoped.target,
        pcfg,
        cfg.parserKind,
      );
      records.push(...page.records);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
  } catch (err) {
    caught = err;
  }

  firePost(undefined, {
    ...baseEvent,
    phase: "post" as const,
    duration: performance.now() - start,
  });

  if (caught) throw caught;
  return enrich(scoped, records);
}






export async function catalogueRunGet(
  scoped: ScopedModels,
  id: string,
): Promise<ModelInfo> {
  const cfg = catalogueByProvider[scoped.target.name];
  if (!cfg) throw new ErrModelsNotSupported();
  if (
    cfg.parserKind === "ParseVertexModels" ||
    cfg.parserKind === "ParseBedrockModels"
  ) {
    throw new ErrModelsNotSupported();
  }
  const pcfg = PROVIDERS[scoped.target.name as ProviderName];
  if (!pcfg) throw new ErrModelsNotSupported();

  const baseEvent = {
    op: "models_list" as const,
    phase: "pre" as const,
    provider: scoped.target.name,
    model: id,
  };
  const veto = firePre(undefined, baseEvent);
  if (veto) throw veto;
  let caught: unknown = null;
  let record: ParsedModelRecord | undefined;
  try {
    const url = buildCatalogueUrl(scoped.target, pcfg, `${cfg.endpoint}/${id}`);
    const headers = {
      "content-type": "application/json",
      ...buildAuthHeaders(scoped.target, pcfg),
    };
    const httpResp = await fetch(url, { method: "GET", headers });
    const text = await httpResp.text();
    if (!httpResp.ok) {
      throw mapCatalogueHttpErr(httpResp.status, text);
    }
    record = parseSingleRecord(cfg.parserKind, text);
  } catch (err) {
    caught = err;
  }
  firePost(undefined, { ...baseEvent, phase: "post" as const });
  if (caught) throw caught;
  return enrich(scoped, [record!])[0]!;
}

//

async function fetchCataloguePage(
  reqUrl: string,
  provider: Provider,
  pcfg: ProviderSpec,
  parserKind: string,
): Promise<ParsedModelsPage> {
  const headers = {
    "content-type": "application/json",
    ...buildAuthHeaders(provider, pcfg),
  };
  const httpResp = await fetch(reqUrl, { method: "GET", headers });
  const text = await httpResp.text();
  if (!httpResp.ok) {
    throw mapCatalogueHttpErr(httpResp.status, text);
  }
  return dispatchParser(parserKind, text);
}

function dispatchParser(kind: string, body: string): ParsedModelsPage {
  switch (kind) {
    case "ParseAnthropicModels":
      return parseAnthropicModelsResponse(body);
    case "ParseGoogleModels":
      return parseGoogleModelsResponse(body);
    case "ParseOpenAICohortModels":
      return parseOpenAICohortModelsResponse(body);
    default:
      throw new ErrModelsNotSupported();
  }
}

function parseSingleRecord(kind: string, body: string): ParsedModelRecord {
  //
  //
  switch (kind) {
    case "ParseAnthropicModels": {
      const page = parseAnthropicModelsResponse(`{"data":[${body}]}`);
      const r = page.records[0];
      if (!r) throw new ErrModelsUnavailable("parse anthropic single record");
      return r;
    }
    case "ParseGoogleModels": {
      const page = parseGoogleModelsResponse(`{"models":[${body}]}`);
      const r = page.records[0];
      if (!r) throw new ErrModelsUnavailable("parse google single record");
      return r;
    }
    case "ParseOpenAICohortModels": {
      const page = parseOpenAICohortModelsResponse(`{"data":[${body}]}`);
      const r = page.records[0];
      if (!r) throw new ErrModelsUnavailable("parse openai single record");
      return r;
    }
    default:
      throw new ErrModelsNotSupported();
  }
}

function appendCursor(
  rawUrl: string,
  pagination: string,
  cursor: string,
): string {
  if (!cursor) return rawUrl;
  const sep = rawUrl.includes("?") ? "&" : "?";
  switch (pagination) {
    case "CursorByLastID":
      return `${rawUrl}${sep}after_id=${encodeURIComponent(cursor)}`;
    case "CursorOpaqueToken":
      return `${rawUrl}${sep}pageToken=${encodeURIComponent(cursor)}`;
    default:
      return rawUrl;
  }
}

function buildCatalogueUrl(
  provider: Provider,
  pcfg: ProviderSpec,
  endpoint: string,
): string {
  const base = provider.baseUrl || pcfg.baseUrl;
  let url = base + endpoint;
  if (pcfg.authScheme === "QueryParamKey" && pcfg.authQueryParam) {
    const sep = url.includes("?") ? "&" : "?";
    url = `${url}${sep}${pcfg.authQueryParam}=${encodeURIComponent(provider.apiKey)}`;
  }
  return url;
}

function mapCatalogueHttpErr(status: number, body: string): Error {
  if (status === 403 && scopeBodyPattern.test(body)) {
    return new ErrModelsScope(
      `llmkit: api key lacks scope for models endpoint (status ${status})`,
    );
  }
  return new ErrModelsUnavailable(
    `llmkit: provider models endpoint unavailable (status ${status})`,
  );
}

function enrich(
  scoped: ScopedModels,
  records: ParsedModelRecord[],
): ModelInfo[] {
  const providerName = scoped.target.name;
  const ontologyForProvider = ontologyCapabilities[providerName] ?? {};
  return records.map((rec) => {
    const info: ModelInfo = {
      id: rec.id,
      provider: { name: providerName, apiKey: "" },
      capabilities: ontologyForProvider[rec.id] ?? [],
      displayName: rec.displayName ?? "",
      description: rec.description ?? "",
      contextWindow: rec.contextWindow ?? 0,
      maxOutput: rec.maxOutput ?? 0,
      created: rec.created ?? 0,
    };
    if (scoped.rawFlag) {
      info.raw = rec.raw;
    }
    return info;
  });
}
