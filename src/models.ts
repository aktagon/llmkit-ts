// Hand-coded catalogue runtime (ADR-019). The generated builder classes
// in builders/catalogue.ts delegate their terminal methods here.

import type { Capability, Provider } from "./types.ts";
import type { ImageHints, LiveResult, ModelInfo, ProviderError, VideoHints } from "./structs.ts";
import {
  catalogueByProvider,
  ontologyCapabilities,
  type CatalogueConfig,
} from "./catalogue.ts";
import type { Models, ScopedModels } from "./builders/catalogue.ts";
import {
  PROVIDERS,
  type ProviderSpec,
  type ProviderName,
} from "./providers/providers.ts";
import { buildAuthHeaders } from "./request.ts";
import { lookupModel } from "./model_lookup.ts";
import { imageGenConfig, type ImageModelDef } from "./providers/image_gen.ts";
import { speechGenConfig } from "./providers/speech_gen.ts";
import { videoGenConfig, type VideoModelDef } from "./providers/video_gen.ts";
import { firePre, firePost } from "./middleware.ts";
import { sendHTTP } from "./http.ts";
import {
  parseAnthropicModelsResponse,
  parseGoogleModelsResponse,
  parseOpenAICohortModelsResponse,
  type ParsedModelRecord,
  type ParsedModelsPage,
} from "./providers/models_parsers.ts";

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

const scopeBodyPattern = /scope|permission/i;

/** Map a caught error to the wire-format discriminant carried in
 *  ProviderError.kind (ADR-019 Amendment 1). Unknown errors fall back
 *  to "unavailable" — safer than "scope" since scope implies a
 *  documented retry path. */
export function classifyCatalogueError(err: unknown): string {
  if (err instanceof ErrModelsNotSupported) return "not_supported";
  if (err instanceof ErrModelsScope) return "scope";
  return "unavailable";
}

/** Return the records whose capabilities array contains c; no filter when
 *  c is unset. Always a fresh array. The single capability predicate
 *  (HANDOFF-036 A4): shared by the scoped live list (catalogueRunList)
 *  and — through it — the live aggregate. get stays an unfiltered point
 *  lookup by id. */
export function applyCapFilter(
  models: ModelInfo[],
  c: Capability | undefined,
): ModelInfo[] {
  if (!c) return [...models];
  return models.filter((m) => m.capabilities.includes(c));
}

/** Fan out per-provider live calls and aggregate into LiveResult.
 *  capFilter is applied per-provider inside scoped.list()
 *  (HANDOFF-036 A4). Errors land in result.errors as typed
 *  ProviderError per Amendment 1. */
export async function catalogueRunLive(models: Models): Promise<LiveResult> {
  // The secret-free ProviderInfo list reports WHICH providers are eligible;
  // the live fetch needs credentials, which the Client carries for its one
  // provider. Pair each eligible entry with the Client's own credentials.
  const cfg = models.client.provider;
  const configured: Provider[] = models.client.providers.list().map((p) => ({
    name: p.id,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    headers: cfg.headers, // ADR-052: custom headers reach the live catalogue too.
  }));
  const all: ModelInfo[] = [];
  const errors: Record<string, ProviderError> = {};

  const results = await Promise.allSettled(
    configured.map((p) => models.provider(p).list()),
  );

  for (let i = 0; i < results.length; i++) {
    const p = configured[i]!;
    const r = results[i]!;
    if (r.status === "fulfilled") {
      all.push(...r.value);
    } else {
      // ADR-019 Amendment 1: structured discriminant + message.
      const message =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors[p.name] = { kind: classifyCatalogueError(r.reason), message };
    }
  }

  all.sort((a, b) => {
    if (a.provider.name !== b.provider.name) {
      return a.provider.name < b.provider.name ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return { models: all, errors };
}

/**
 *  capability slice and filtered by the chain's capFilter
 *  (withCapability composes with provider(p).list() — HANDOFF-036 A4;
 *  get stays an unfiltered point lookup by id). A list younger than one
 *  hour comes from the client's cache unless fresh() is set (ADR-102
 *  MPT-005); otherwise the live call runs and a successful result
 *  refills the cache. */
export async function catalogueRunList(
  scoped: ScopedModels,
): Promise<ModelInfo[]> {
  let records = cachedRecords(scoped);
  if (!records) {
    records = await fetchList(scoped);
    scoped.client._modelCache.put(cacheKey(scoped), records);
  }
  return applyCapFilter(enrich(scoped, records), scoped.capFilter);
}

/** The provider's cached records, unless the chain asked for a fresh call. */
function cachedRecords(scoped: ScopedModels): ParsedModelRecord[] | undefined {
  if (scoped.freshFlag) return undefined;
  return scoped.client._modelCache.get(cacheKey(scoped));
}

/** Names the cached list by the provider and the base URL and API key the
 *  live call is sent with (owner, 2026-11-01): the scoped target carries
 *  them, so a target with another key or endpoint never reads a list
 *  fetched for the first one. The key stays in memory only. */
function cacheKey(scoped: ScopedModels): string {
  const pcfg = PROVIDERS[scoped.target.name as ProviderName];
  const base = scoped.target.baseUrl || pcfg?.baseUrl || "";
  return `${scoped.target.name}\u0000${base}\u0000${scoped.target.apiKey}`;
}

/** Single-provider live HTTP. Paginates per the catalogue config until
 *  the parser reports no next cursor. Middleware fires once per call (not
 *  per page). A list served from the cache makes no call and fires no
 *  event. */
async function fetchList(scoped: ScopedModels): Promise<ParsedModelRecord[]> {
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
  // Client-scoped hooks (telemetry, ADR-054) observe catalogue calls too
  // (HANDOFF-036 A3); the Swift seam is the reference.
  const mws = scoped.client._middleware;
  const start = performance.now();
  const veto = firePre(mws, baseEvent);
  if (veto) throw veto;

  let cursor = "";
  const records: ParsedModelRecord[] = [];
  let caught: unknown = null;
  try {
    for (;;) {
      const reqUrl = listPageUrl(scoped.target, pcfg, cfg, cursor);
      const page = await fetchCataloguePage(
        reqUrl,
        scoped.target,
        pcfg,
        cfg.parserKind,
        scoped.client.provider.timeoutMs,
      );
      records.push(...page.records);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
  } catch (err) {
    caught = err;
  }

  firePost(mws, {
    ...baseEvent,
    phase: "post" as const,
    duration: performance.now() - start,
    ...(caught ? { err: caught instanceof Error ? caught : new Error(String(caught)) } : {}),
  });

  if (caught) throw caught;
  return records;
}

/** One model record by id. A fresh cached list that holds the id answers
 *  without a call (ADR-102 MPT-005); otherwise the live point lookup
 *  runs. URL shapes pinned in plan 025
 *  (Anthropic /v1/models/{id}, OpenAI /v1/models/{id}, Google
 *  /v1beta/models/{id} — the parser strips models/ from the response,
 *  the URL itself uses the bare id). Vertex + Bedrock surface
 *  ErrModelsNotSupported until their parsers land. */
export async function catalogueRunGet(
  scoped: ScopedModels,
  id: string,
): Promise<ModelInfo> {
  const hit = cachedRecords(scoped)?.find((r) => r.id === id);
  if (hit) return enrich(scoped, [hit])[0]!;
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
  // Client-scoped hooks observe catalogue calls (HANDOFF-036 A3).
  const mws = scoped.client._middleware;
  const start = performance.now();
  const veto = firePre(mws, baseEvent);
  if (veto) throw veto;
  let caught: unknown = null;
  let record: ParsedModelRecord | undefined;
  try {
    const url = buildCatalogueUrl(scoped.target, pcfg, `${cfg.endpoint}/${id}`);
    const headers = {
      "content-type": "application/json",
      ...buildAuthHeaders(scoped.target, pcfg),
    };
    const httpResp = await sendHTTP(
      url,
      { method: "GET", headers },
      scoped.client.provider.timeoutMs,
    );
    const text = await httpResp.text();
    if (!httpResp.ok) {
      throw mapCatalogueHttpErr(httpResp.status, text);
    }
    record = parseSingleRecord(cfg.parserKind, text);
  } catch (err) {
    caught = err;
  }
  firePost(mws, {
    ...baseEvent,
    phase: "post" as const,
    duration: performance.now() - start,
    ...(caught ? { err: caught instanceof Error ? caught : new Error(String(caught)) } : {}),
  });
  if (caught) throw caught;
  return enrich(scoped, [record!])[0]!;
}

// --- internals ---

async function fetchCataloguePage(
  reqUrl: string,
  provider: Provider,
  pcfg: ProviderSpec,
  parserKind: string,
  timeoutMs: number | undefined,
): Promise<ParsedModelsPage> {
  const headers = buildCatalogueHeaders(provider, pcfg);
  const httpResp = await sendHTTP(reqUrl, { method: "GET", headers }, timeoutMs);
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
  // Each provider's /v1/models/{id} returns the bare record; wrap in
  // the listing envelope so the same parser handles both shapes.
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

// The URL of one list page: the endpoint, the provider's fixed list query
// (BUG-107: OpenRouter lists text-output models only without
// output_modalities=all), then the cursor. Get-by-id never sends the list query.
export function listPageUrl(
  provider: Provider,
  pcfg: ProviderSpec,
  cfg: CatalogueConfig,
  cursor: string,
): string {
  let reqUrl = buildCatalogueUrl(provider, pcfg, cfg.endpoint);
  if (cfg.listQuery) {
    const sep = reqUrl.includes("?") ? "&" : "?";
    reqUrl = `${reqUrl}${sep}${cfg.listQuery}`;
  }
  return appendCursor(reqUrl, cfg.cursorParam, cursor);
}

// Splices the pagination cursor into the URL using the cursor query-param
// name carried by the generated CatalogueConfig (ADR-067 Fix A). An empty
// cursor or an empty cursorParam (PaginationNone) leaves the URL unchanged.
export function appendCursor(
  rawUrl: string,
  cursorParam: string,
  cursor: string,
): string {
  if (!cursor || !cursorParam) return rawUrl;
  const sep = rawUrl.includes("?") ? "&" : "?";
  return `${rawUrl}${sep}${cursorParam}=${encodeURIComponent(cursor)}`;
}

export function buildCatalogueUrl(
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

// The catalogue-list request carries only the provider auth (+ any required /
// caller headers) — a bodyless GET, so no content-type. Same header set the
// other four SDKs' buildCatalogueHeaders produce (cross-SDK URL parity, CAT-006).
export function buildCatalogueHeaders(
  provider: Provider,
  pcfg: ProviderSpec,
): Record<string, string> {
  return buildAuthHeaders(provider, pcfg);
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
      // A copy: the record may be the cached one, which other calls read.
      info.raw = structuredClone(rec.raw);
    }
    Object.assign(info, catalogueHints(providerName as ProviderName, rec.id));
    return info;
  });
}

/** What the compiled catalogue states about modelId for image, video and
 *  speech generation (ADR-102 MPT-008). A capability whose catalogue does
 *  not list the model is left out. The lists are copies, so a caller
 *  cannot change the compiled facts. Mirrors go/models.go. */
function catalogueHints(
  provider: ProviderName,
  modelId: string,
): Pick<ModelInfo, "image" | "video" | "speech"> {
  const hints: Pick<ModelInfo, "image" | "video" | "speech"> = {};
  const image = lookupModel(imageGenConfig(provider)?.models ?? [], modelId).model;
  if (image) hints.image = imageHints(image);
  const video = lookupModel(videoGenConfig(provider)?.models ?? [], modelId).model;
  if (video) hints.video = videoHints(video);
  const speech = lookupModel(speechGenConfig(provider)?.models ?? [], modelId).model;
  if (speech) hints.speech = { style: speech.supportsSpeechStyle };
  return hints;
}

/** One image model's facts. The lists are copies, so a caller cannot
 *  change the compiled facts. Exported for tests only; the package barrel
 *  does not re-export it. */
export function imageHints(m: ImageModelDef): ImageHints {
  const hints: ImageHints = {
    aspectRatios: [...m.aspectRatios],
    sizes: [...m.imageSizes],
    imageInput: m.supportsImageInput,
  };
  if (m.maxInputImages > 0) hints.maxInputImages = m.maxInputImages;
  return hints;
}

/** One video model's facts. The lists are copies, so a caller cannot
 *  change the compiled facts. Exported for tests only; the package barrel
 *  does not re-export it. */
export function videoHints(m: VideoModelDef): VideoHints {
  const hints: VideoHints = {
    resolutions: [...m.resolutions],
    aspectRatios: [...m.aspectRatios],
    maxDurationSeconds: m.maxDurationSeconds,
    imageToVideo: m.supportsImageToVideo,
    lastFrame: m.supportsLastFrame,
    referenceImages: m.supportsReferenceImages,
  };
  // The catalogue table holds 0 when no source states a limit
  // (maxInputImages omitted); the hint is then absent (ADR-104 PUB-004).
  if (m.maxInputImages > 0) hints.maxInputImages = m.maxInputImages;
  return hints;
}
