import { PROVIDERS, type ProviderConfig } from "./providers/providers.ts";
import { APIError, ValidationError } from "./errors.ts";
import { extractPath, extractIntPath } from "./paths.ts";
import type {
  Provider,
  Request as PromptRequest,
  Response as PromptResponse,
  PromptOptions,
} from "./types.ts";

export type {
  Provider,
  Request,
  Response,
  PromptOptions,
  Message,
  Usage,
} from "./types.ts";
export { Providers } from "./providers/providers.ts";
export { APIError, ValidationError } from "./errors.ts";

export async function prompt(
  provider: Provider,
  request: PromptRequest,
  options: PromptOptions = {},
): Promise<PromptResponse> {
  const cfg = PROVIDERS[provider.name];
  if (!cfg) {
    throw new ValidationError("provider", `unknown: ${provider.name}`);
  }
  if (!provider.apiKey) {
    throw new ValidationError("apiKey", "required");
  }

  const body = buildRequest(provider, request, cfg, options);
  const headers = buildAuthHeaders(provider, cfg);

  const baseUrl = provider.baseUrl || cfg.baseUrl;
  const url = buildUrl(baseUrl + cfg.endpoint, provider, cfg);

  const httpResp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
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
  return {
    text: extractPath(raw, cfg.responseTextPath),
    tokens: {
      input: extractIntPath(raw, cfg.usageInputPath),
      output: extractIntPath(raw, cfg.usageOutputPath),
      cacheCreation: 0,
      cacheRead: 0,
    },
  };
}

function buildRequest(
  provider: Provider,
  request: PromptRequest,
  cfg: ProviderConfig,
  options: PromptOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const model = provider.model || cfg.defaultModel;

  if (cfg.modelInBody) {
    body.model = model;
  }
  body.max_tokens = options.maxTokens ?? cfg.defaultMaxTokens;

  const messages = buildMessages(request, cfg);
  body.messages = messages;

  // System placement
  if (cfg.systemPlacement === "TopLevelField" && request.system) {
    body.system = request.system;
  }

  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.topP !== undefined) body.top_p = options.topP;

  return body;
}

function buildMessages(
  request: PromptRequest,
  cfg: ProviderConfig,
): Array<Record<string, string>> {
  const msgs: Array<Record<string, string>> = [];

  if (cfg.systemPlacement === "MessageInArray" && request.system) {
    msgs.push({
      role: cfg.roleMappings.system ?? "system",
      content: request.system,
    });
  }

  if (request.messages && request.messages.length > 0) {
    for (const m of request.messages) {
      msgs.push({
        role: cfg.roleMappings[m.role] ?? m.role,
        content: m.content,
      });
    }
  } else if (request.user) {
    msgs.push({ role: cfg.roleMappings.user ?? "user", content: request.user });
  }

  return msgs;
}

function buildAuthHeaders(
  provider: Provider,
  cfg: ProviderConfig,
): Record<string, string> {
  const headers: Record<string, string> = {};
  switch (cfg.authScheme) {
    case "BearerToken":
      headers[cfg.authHeader] = `${cfg.authPrefix} ${provider.apiKey}`;
      break;
    case "HeaderAPIKey":
      headers[cfg.authHeader] = provider.apiKey;
      break;
  }
  if (cfg.requiredHeader) {
    headers[cfg.requiredHeader] = cfg.requiredHeaderValue;
  }
  return headers;
}

function buildUrl(
  base: string,
  provider: Provider,
  cfg: ProviderConfig,
): string {
  if (cfg.authScheme === "QueryParamKey" && cfg.authQueryParam) {
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}${cfg.authQueryParam}=${encodeURIComponent(provider.apiKey)}`;
  }
  return base;
}
