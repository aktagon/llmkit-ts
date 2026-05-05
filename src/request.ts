// Provider-shaped HTTP request building: body, options, auth, URL.
// Shared by prompt(), promptStream(), submitBatch().

import {
  PROVIDERS,
  type ProviderConfig,
  type ProviderName,
} from "./providers/providers.ts";
import {
  OptionKeys,
  type OptionKey,
  type OptionOverrideDef,
  optionOverrides,
  supportedOptions,
} from "./providers/options.ts";
import { ValidationError } from "./errors.ts";
import type {
  Provider,
  Request as PromptRequest,
  PromptOptions,
} from "./types.ts";

export function buildRequest(
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

  const supportedMap = new Map(
    supportedOptions(provider.name).map((o) => [o.key, o.jsonKey]),
  );
  const overridesMap = new Map(
    optionOverrides(provider.name).map((o) => [o.key, o]),
  );

  const maxTokensKey = supportedMap.get(OptionKeys.MAX_TOKENS);
  const maxTokensValue = options.maxTokens ?? cfg.defaultMaxTokens;
  if (maxTokensKey !== undefined) {
    setNestedField(body, maxTokensKey, maxTokensValue);
  }

  if (isBedrock(cfg)) {
    if (request.system) {
      body.system = [{ text: request.system }];
    }
    body.messages = buildBedrockMessages(request, cfg);
  } else if (cfg.systemPlacement === "SiblingObject") {
    if (request.system) {
      body.system_instruction = { parts: [{ text: request.system }] };
    }
    body.contents = buildGoogleContents(request, cfg);
  } else {
    body.messages = buildMessages(request, cfg);
    if (cfg.systemPlacement === "TopLevelField" && request.system) {
      body.system = request.system;
    }
  }

  if (cfg.wrapsOptionsIn) {
    const optBody: Record<string, unknown> = {};
    applyOptions(optBody, options, supportedMap, overridesMap);
    if (maxTokensKey !== undefined) {
      setNestedField(optBody, maxTokensKey, maxTokensValue);
      delete body[maxTokensKey.split(".")[0]!];
    }
    if (Object.keys(optBody).length > 0) {
      body[cfg.wrapsOptionsIn] = optBody;
    }
  } else {
    applyOptions(body, options, supportedMap, overridesMap);
  }

  return body;
}

function applyOptions(
  target: Record<string, unknown>,
  options: PromptOptions,
  supportedMap: Map<OptionKey, string>,
  overridesMap: Map<OptionKey, OptionOverrideDef>,
): void {
  const apply = (key: OptionKey, value: unknown): void => {
    const jsonKey = supportedMap.get(key);
    if (jsonKey === undefined) return;
    setNestedField(target, jsonKey, value);
    const override = overridesMap.get(key);
    if (override?.extraFieldsJson) {
      const extras = JSON.parse(override.extraFieldsJson) as Record<
        string,
        unknown
      >;
      mergeIntoParent(target, jsonKey, extras);
    }
  };
  if (options.temperature !== undefined)
    apply(OptionKeys.TEMPERATURE, options.temperature);
  if (options.topP !== undefined) apply(OptionKeys.TOP_P, options.topP);
  if (options.topK !== undefined) apply(OptionKeys.TOP_K, options.topK);
  if (options.stopSequences && options.stopSequences.length > 0)
    apply(OptionKeys.STOP_SEQUENCES, options.stopSequences);
  if (options.seed !== undefined) apply(OptionKeys.SEED, options.seed);
  if (options.frequencyPenalty !== undefined)
    apply(OptionKeys.FREQUENCY_PENALTY, options.frequencyPenalty);
  if (options.presencePenalty !== undefined)
    apply(OptionKeys.PRESENCE_PENALTY, options.presencePenalty);
  if (options.thinkingBudget !== undefined)
    apply(OptionKeys.THINKING_BUDGET, options.thinkingBudget);
  if (options.reasoningEffort)
    apply(OptionKeys.REASONING_EFFORT, options.reasoningEffort);
}

function setNestedField(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    let next = cur[part];
    if (typeof next !== "object" || next === null) {
      next = {};
      cur[part] = next;
    }
    cur = next as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function mergeIntoParent(
  target: Record<string, unknown>,
  path: string,
  extras: Record<string, unknown>,
): void {
  const parts = path.split(".");
  if (parts.length === 1) {
    Object.assign(target, extras);
    return;
  }
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]!] as Record<string, unknown>;
  }
  Object.assign(cur, extras);
}

export function validateOptions(
  name: ProviderName,
  options: PromptOptions,
): void {
  if (!PROVIDERS[name]) return;
  const supported = new Set(supportedOptions(name).map((o) => o.key));
  const overrides = new Map(optionOverrides(name).map((o) => [o.key, o]));

  const require = (key: OptionKey, field: string): void => {
    if (!supported.has(key)) {
      throw new ValidationError(field, `not supported by ${name}`);
    }
  };
  if (options.topK !== undefined) require(OptionKeys.TOP_K, "topK");
  if (options.seed !== undefined) require(OptionKeys.SEED, "seed");
  if (options.stopSequences && options.stopSequences.length > 0)
    require(OptionKeys.STOP_SEQUENCES, "stopSequences");
  if (options.frequencyPenalty !== undefined)
    require(OptionKeys.FREQUENCY_PENALTY, "frequencyPenalty");
  if (options.presencePenalty !== undefined)
    require(OptionKeys.PRESENCE_PENALTY, "presencePenalty");
  if (options.thinkingBudget !== undefined)
    require(OptionKeys.THINKING_BUDGET, "thinkingBudget");
  if (options.reasoningEffort)
    require(OptionKeys.REASONING_EFFORT, "reasoningEffort");

  if (options.reasoningEffort) {
    const ov = overrides.get(OptionKeys.REASONING_EFFORT);
    if (
      ov &&
      ov.allowedValues.length > 0 &&
      !ov.allowedValues.includes(options.reasoningEffort)
    ) {
      throw new ValidationError(
        "reasoningEffort",
        `invalid value ${JSON.stringify(options.reasoningEffort)}, must be one of: ${ov.allowedValues.join(",")}`,
      );
    }
  }
}

export function isBedrock(cfg: ProviderConfig): boolean {
  return cfg.wrapsOptionsIn === "inferenceConfig" && cfg.authScheme === "SigV4";
}

function buildBedrockMessages(
  request: PromptRequest,
  cfg: ProviderConfig,
): Array<Record<string, unknown>> {
  const msgs: Array<Record<string, unknown>> = [];
  if (request.messages && request.messages.length > 0) {
    for (const m of request.messages) {
      msgs.push({
        role: cfg.roleMappings[m.role] ?? m.role,
        content: [{ text: m.content }],
      });
    }
  } else if (request.user) {
    msgs.push({
      role: cfg.roleMappings.user ?? "user",
      content: [{ text: request.user }],
    });
  }
  return msgs;
}

function buildGoogleContents(
  request: PromptRequest,
  cfg: ProviderConfig,
): Array<Record<string, unknown>> {
  const contents: Array<Record<string, unknown>> = [];
  if (request.messages && request.messages.length > 0) {
    for (const m of request.messages) {
      contents.push({
        role: cfg.roleMappings[m.role] ?? m.role,
        parts: [{ text: m.content }],
      });
    }
  } else if (request.user) {
    contents.push({
      role: cfg.roleMappings.user ?? "user",
      parts: [{ text: request.user }],
    });
  }
  return contents;
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

export async function executeRequest(
  provider: Provider,
  cfg: ProviderConfig,
  body: Record<string, unknown>,
  options: PromptOptions,
): Promise<{ status: number; ok: boolean; text: string }> {
  const baseUrl = provider.baseUrl || cfg.baseUrl;
  const url = buildUrl(baseUrl + cfg.endpoint, provider, cfg);
  const jsonBody = JSON.stringify(body);

  let headers: Record<string, string>;
  if (cfg.authScheme === "SigV4") {
    const { signSigV4 } = await import("./sigv4.ts");
    const region = process.env[cfg.regionEnvVar] || "";
    const secret = process.env[cfg.secretKeyEnvVar] || "";
    const session = process.env[cfg.sessionTokenEnvVar] || "";
    headers = await signSigV4(
      url,
      new TextEncoder().encode(jsonBody),
      provider.apiKey,
      secret,
      session,
      region,
      cfg.serviceName,
    );
    headers["Content-Type"] = "application/json";
  } else {
    headers = {
      "content-type": "application/json",
      ...buildAuthHeaders(provider, cfg),
    };
  }

  const httpResp = await fetch(url, {
    method: "POST",
    headers,
    body: jsonBody,
    signal: options.signal,
  });
  const text = await httpResp.text();
  return { status: httpResp.status, ok: httpResp.ok, text };
}

export function buildAuthHeaders(
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

export function buildUrl(
  base: string,
  provider: Provider,
  cfg: ProviderConfig,
): string {
  const model = provider.model || cfg.defaultModel;
  let url = base.replaceAll("{model}", model);
  if (cfg.regionEnvVar) {
    const region = process.env[cfg.regionEnvVar] || "";
    url = url.replaceAll("{region}", region);
  }
  if (cfg.authScheme === "QueryParamKey" && cfg.authQueryParam) {
    const sep = url.includes("?") ? "&" : "?";
    url = `${url}${sep}${cfg.authQueryParam}=${encodeURIComponent(provider.apiKey)}`;
  }
  return url;
}
