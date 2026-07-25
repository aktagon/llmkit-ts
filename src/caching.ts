//
//
//
//
//
//

import { type CachingDef, cachingConfig } from "./providers/caching.ts";
import {
  type ProviderSpec,
  type ProviderName,
} from "./providers/providers.ts";
import { APIError, ValidationError } from "./errors.ts";
import { optIntPath, extractIntPath, extractPath } from "./paths.ts";
import { mergeCallerHeaders, resolveModel } from "./request.ts";
import { firePost, firePre } from "./middleware.ts";
import type { Event } from "./providers/middleware.ts";
import type { Provider, PromptOptions } from "./types.ts";

export async function applyCaching(
  body: Record<string, unknown>,
  provider: Provider,
  cfg: ProviderSpec,
  options: PromptOptions = {},
): Promise<void> {
  const cc = cachingConfig(provider.name);
  if (!cc) {
    throw new ValidationError("caching", `not supported by ${provider.name}`);
  }
  switch (cc.mode) {
    case "AutomaticCaching":
      return;
    case "ExplicitCaching":
      applyExplicit(body, cc, cfg);
      return;
    case "ResourceCaching":
      await applyResource(body, provider, cfg, cc, options);
      return;
  }
}

function applyExplicit(
  body: Record<string, unknown>,
  cc: CachingDef,
  cfg: ProviderSpec,
): void {
  const controlType = cc.controlType || "ephemeral";

  if (cfg.systemPlacement === "TopLevelField") {
    const sys = body.system;
    if (typeof sys === "string" && sys.length > 0) {
      body.system = [
        {
          type: "text",
          text: sys,
          cache_control: { type: controlType },
        },
      ];
    }
    return;
  }

  if (cfg.systemPlacement === "MessageInArray") {
    const msgs = body.messages;
    if (!Array.isArray(msgs)) return;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i] as Record<string, unknown> | undefined;
      if (!msg || msg.role !== "system") continue;
      const content = msg.content;
      if (typeof content === "string") {
        msg.content = [
          {
            type: "text",
            text: content,
            cache_control: { type: controlType },
          },
        ];
      }
      return;
    }
  }
}

async function applyResource(
  body: Record<string, unknown>,
  provider: Provider,
  cfg: ProviderSpec,
  cc: CachingDef,
  options: PromptOptions,
): Promise<void> {
  const lc = cc.lifecycle;
  if (!lc) {
    throw new ValidationError(
      "caching",
      "resource caching requires lifecycle config",
    );
  }
  const sysInstr = body.system_instruction;
  if (!sysInstr) {
    //
    return;
  }

  const baseEvent: Event = {
    op: "cache_create",
    phase: "pre",
    provider: provider.name,
    model: resolveModel(provider, cfg),
  };
  const veto = firePre(options.middleware, baseEvent);
  if (veto) throw veto;
  const start = performance.now();

  try {
    const model = resolveModel(provider, cfg);
    const ttlSeconds = options.cacheTTL ?? Number(cc.defaultTtl || "0");
    const createBody: Record<string, unknown> = {
      model: `models/${model}`,
      ttl: `${ttlSeconds}s`,
      systemInstruction: sysInstr,
      contents: [{ role: "user", parts: [{ text: "cache" }] }],
    };

    const baseUrl = provider.baseUrl || cfg.baseUrl;
    let createUrl = baseUrl + lc.createEndpoint;
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (cfg.authScheme === "QueryParamKey" && cfg.authQueryParam) {
      const sep = createUrl.includes("?") ? "&" : "?";
      createUrl += `${sep}${cfg.authQueryParam}=${encodeURIComponent(provider.apiKey)}`;
    } else if (cfg.authScheme === "BearerToken") {
      headers[cfg.authHeader] = `${cfg.authPrefix} ${provider.apiKey}`;
    } else if (cfg.authScheme === "HeaderAPIKey") {
      headers[cfg.authHeader] = provider.apiKey;
    }
    //
    mergeCallerHeaders(headers, provider);

    const httpResp = await fetch(createUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(createBody),
      signal: options.signal,
    });
    const respText = await httpResp.text();
    if (!httpResp.ok) {
      throw new APIError(
        httpResp.status,
        respText,
        httpResp.status === 429 || httpResp.status >= 500,
      );
    }
    const raw = JSON.parse(respText) as unknown;
    const resourceId = extractPath(raw, lc.responseIdPath);
    if (!resourceId) {
      throw new APIError(0, "cache create: empty resource ID", false);
    }

    body[lc.referenceField] = resourceId;
    delete body.system_instruction;
    firePost(options.middleware, {
      ...baseEvent,
      duration: performance.now() - start,
    });
  } catch (err) {
    firePost(options.middleware, {
      ...baseEvent,
      err: err instanceof Error ? err : new Error(String(err)),
      duration: performance.now() - start,
    });
    throw err;
  }
}

export function parseCacheUsage(
  raw: unknown,
  provider: ProviderName,
): { write: number | undefined; read: number | undefined } {
  const cc = cachingConfig(provider);
  //
  //
  if (!cc) return { write: undefined, read: undefined };
  return {
    write: optIntPath(raw, cc.writeTokensPath),
    read: optIntPath(raw, cc.readTokensPath),
  };
}
