// Code generated — DO NOT EDIT.

// Catalogue builder classes (ADR-019). Chain methods are immutable; the
// HTTP-touching terminals delegate to hand-coded runtime in ../models.ts
// and ../providers.ts.

import type { Capability, Provider } from "../types.ts";
import type { LiveResult, ModelInfo } from "../structs.ts";
import type { ProviderInfo } from "../providers/provider_info.ts";
import type { Client } from "./builders.ts";
import {
  catalogueRunLive,
  catalogueRunList,
  catalogueRunGet,
} from "../models.ts";
import { catalogueProvidersList } from "../providers.ts";

/**
 * Models is the catalogue builder. Chain methods are immutable; list()
 * fans out HTTP across configured providers, served from the client's
 * one-hour model-list cache unless fresh() is set, and provider(p)
 * returns ScopedModels.
 */
export class Models {
  /** @internal */ readonly client: Client;
  /** @internal */ readonly capFilter?: Capability;
  /** @internal */ readonly freshFlag: boolean;

  /** @internal */
  constructor(client: Client, capFilter?: Capability, freshFlag = false) {
    this.client = client;
    this.capFilter = capFilter;
    this.freshFlag = freshFlag;
  }

  /**
   *  array contains c. Composes with list / provider(p).list. */
  withCapability(c: Capability): Models {
    return new Models(this.client, c, this.freshFlag);
  }

  /** Bypass the client's model-list cache: the live call is made, and a
   *  successful list refills the cache. Carries through provider(p). */
  fresh(): Models {
    return new Models(this.client, this.capFilter, true);
  }

  /** Scope the catalogue to a single provider; returns ScopedModels on
   *  which raw(), list(), and get(id) are reachable. */
  provider(p: Provider): ScopedModels {
    return new ScopedModels(this.client, p, this.capFilter, false, this.freshFlag);
  }

  /** The live model list across configured providers: an aggregated
   *  LiveResult. withCapability composes post-fetch. */
  async list(): Promise<LiveResult> {
    return catalogueRunLive(this);
  }
}

/**
 * ScopedModels is the single-provider live-catalogue sub-builder.
 * Reached via Models.provider(p). raw() opts into populating
 * ModelInfo.raw per ADR-014.
 */
export class ScopedModels {
  /** @internal */ readonly client: Client;
  /** @internal */ readonly target: Provider;
  /** @internal */ readonly capFilter?: Capability;
  /** @internal */ readonly rawFlag: boolean;
  /** @internal */ readonly freshFlag: boolean;

  /** @internal */
  constructor(client: Client, target: Provider, capFilter?: Capability, rawFlag = false, freshFlag = false) {
    this.client = client;
    this.target = target;
    this.capFilter = capFilter;
    this.rawFlag = rawFlag;
    this.freshFlag = freshFlag;
  }

  raw(): ScopedModels {
    return new ScopedModels(this.client, this.target, this.capFilter, true, this.freshFlag);
  }

  /** This provider's model list: from the client's cache when it holds a
   *  list younger than one hour, otherwise from the live call. */
  async list(): Promise<ModelInfo[]> {
    return catalogueRunList(this);
  }

  /** One model record by id: from the cached list when it is fresh and
   *  holds the id, otherwise from the live point lookup. */
  async get(id: string): Promise<ModelInfo> {
    return catalogueRunGet(this, id);
  }
}

/**
 * Providers is the providers-namespace prototype. list() returns the
 * providers with both credentials configured and hasModelsEndpoint
 * declared, as secret-free ProviderInfo (ADR-040 PSR-005). The static
 * roster of every supported provider is the `providers.list()` namespace.
 */
export class Providers {
  /** @internal */ readonly client: Client;

  /** @internal */
  constructor(client: Client) {
    this.client = client;
  }

  list(): ProviderInfo[] {
    return catalogueProvidersList(this.client);
  }
}
