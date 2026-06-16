// Code generated — DO NOT EDIT.

//
//
//

import type { Capability, Provider } from "../types.ts";
import type { LiveResult, ModelInfo } from "../structs.ts";
import type { ProviderInfo } from "../providers/provider_info.ts";
import type { Client } from "./builders.ts";
import {
  catalogueFilter,
  catalogueLookup,
  catalogueRunLive,
  catalogueRunList,
  catalogueRunGet,
} from "../models.ts";
import { catalogueProvidersList } from "../providers.ts";






export class Models {
 readonly client: Client;
 readonly capFilter?: Capability;

  constructor(client: Client, capFilter?: Capability) {
    this.client = client;
    this.capFilter = capFilter;
  }



  withCapability(c: Capability): Models {
    return new Models(this.client, c);
  }



  provider(p: Provider): ScopedModels {
    return new ScopedModels(this.client, p, this.capFilter);
  }



  list(): ModelInfo[] {
    return catalogueFilter(this.capFilter);
  }


  get(id: string): ModelInfo | undefined {
    return catalogueLookup(id);
  }



  async live(): Promise<LiveResult> {
    return catalogueRunLive(this);
  }
}






export class ScopedModels {
 readonly client: Client;
 readonly target: Provider;
 readonly capFilter?: Capability;
 readonly rawFlag: boolean;

  constructor(client: Client, target: Provider, capFilter?: Capability, rawFlag = false) {
    this.client = client;
    this.target = target;
    this.capFilter = capFilter;
    this.rawFlag = rawFlag;
  }

  raw(): ScopedModels {
    return new ScopedModels(this.client, this.target, this.capFilter, true);
  }

  async list(): Promise<ModelInfo[]> {
    return catalogueRunList(this);
  }

  async get(id: string): Promise<ModelInfo> {
    return catalogueRunGet(this, id);
  }
}







export class Providers {
 readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  list(): ProviderInfo[] {
    return catalogueProvidersList(this.client);
  }
}
