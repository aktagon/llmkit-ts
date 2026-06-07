import { PROVIDERS } from "./providers/providers.ts";
import { fileUploadConfig } from "./providers/upload.ts";
import { APIError, ValidationError } from "./errors.ts";
import { extractPath } from "./paths.ts";
import { buildAuthHeaders, resolveModel } from "./request.ts";
import { firePost, firePre } from "./middleware.ts";
import type { Event, MiddlewareFn } from "./providers/middleware.ts";
import type { File as LLMFile, Provider } from "./types.ts";

export interface UploadOptions {
  middleware?: MiddlewareFn[];
}

export async function uploadFile(
  provider: Provider,
  data: Uint8Array,
  name: string,
  options: UploadOptions = {},
): Promise<LLMFile> {
  const cfg = PROVIDERS[provider.name];
  if (!cfg) {
    throw new ValidationError("provider", `unknown: ${provider.name}`);
  }
  if (!provider.apiKey) {
    throw new ValidationError("apiKey", "required");
  }
  const fu = fileUploadConfig(provider.name);
  if (!fu) {
    throw new ValidationError(
      "provider",
      `file upload not supported: ${provider.name}`,
    );
  }

  const baseEvent: Event = {
    op: "upload",
    phase: "pre",
    provider: provider.name,
    model: resolveModel(provider, cfg),
  };
  const veto = firePre(options.middleware, baseEvent);
  if (veto) throw veto;
  const start = performance.now();

  try {
    const baseUrl = provider.baseUrl || cfg.baseUrl;
    let uploadUrl = baseUrl + fu.endpoint;
    if (cfg.authScheme === "QueryParamKey" && cfg.authQueryParam) {
      uploadUrl = `${uploadUrl}?${cfg.authQueryParam}=${encodeURIComponent(provider.apiKey)}`;
    }

    const headers = buildAuthHeaders(provider, cfg);
    if (fu.betaHeader) {
      headers["anthropic-beta"] = fu.betaHeader;
    }

    const form = new FormData();
    form.append(fu.fieldName, new Blob([data]), name);

    if (fu.extraFieldsJson) {
      try {
        const extras = JSON.parse(fu.extraFieldsJson) as Record<
          string,
          unknown
        >;
        for (const [k, v] of Object.entries(extras)) {
          form.append(k, String(v));
        }
      } catch {
        //
      }
    }

    const httpResp = await fetch(uploadUrl, {
      method: "POST",
      headers,
      body: form,
    });
    const respText = await httpResp.text();
    if (!httpResp.ok) {
      throw new APIError(
        httpResp.status,
        respText,
        httpResp.status === 429 || httpResp.status >= 500,
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(respText);
    } catch {
      throw new APIError(
        httpResp.status,
        "upload: invalid JSON response",
        false,
      );
    }

    const result: LLMFile = {
      id: fu.responseIdPath ? extractPath(raw, fu.responseIdPath) : "",
      uri: fu.responseUriPath ? extractPath(raw, fu.responseUriPath) : "",
      name: fu.responseNamePath ? extractPath(raw, fu.responseNamePath) : name,
      mimeType: fu.responseMimePath
        ? extractPath(raw, fu.responseMimePath)
        : "",
    };
    firePost(options.middleware, {
      ...baseEvent,
      duration: performance.now() - start,
    });
    return result;
  } catch (err) {
    firePost(options.middleware, {
      ...baseEvent,
      err: err instanceof Error ? err : new Error(String(err)),
      duration: performance.now() - start,
    });
    throw err;
  }
}
