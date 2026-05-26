//
//

import {
  PROVIDERS,
  type ProviderConfig,
  type ProviderName,
  structuredOutput,
} from "./providers/providers.ts";
import {
  OptionKeys,
  type OptionKey,
  type OptionOverrideDef,
  modelOptionOverrides,
  optionOverrides,
  supportedOptions,
} from "./providers/options.ts";
import { ValidationError } from "./errors.ts";
import type {
  Provider,
  Request as PromptRequest,
  PromptOptions,
  Tool,
} from "./types.ts";
import type { Message, ToolCall, ToolResult } from "./structs.ts";

export function buildRequest(
  provider: Provider,
  request: PromptRequest,
  cfg: ProviderConfig,
  options: PromptOptions,
  tools: Tool[] = [],
  //
  //
  //
  headersOut?: Record<string, string>,
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

  const maxTokensKey = resolveOptionKey(
    provider.name,
    model,
    OptionKeys.MAX_TOKENS,
    supportedMap,
  );
  const maxTokensValue = options.maxTokens ?? cfg.defaultMaxTokens;
  if (maxTokensKey !== undefined) {
    setNestedField(body, maxTokensKey, maxTokensValue);
  }

  const msgs = toMessageList(request);
  if (isBedrock(cfg)) {
    if (request.system) {
      body.system = [{ text: request.system }];
    }
    body.messages = buildBedrockMessages(msgs, cfg);
  } else if (cfg.systemPlacement === "SiblingObject") {
    if (request.system) {
      body.system_instruction = { parts: [{ text: request.system }] };
    }
    body.contents = buildGoogleContents(msgs, cfg);
  } else {
    body.messages = buildMessages(msgs, request.system ?? "", cfg);
    if (cfg.systemPlacement === "TopLevelField" && request.system) {
      body.system = request.system;
    }
  }

  //
  //
  if (tools.length > 0) {
    attachToolDefs(body, tools, cfg);
  }

  if (cfg.wrapsOptionsIn) {
    const optBody: Record<string, unknown> = {};
    applyOptions(
      optBody,
      options,
      provider.name,
      model,
      supportedMap,
      overridesMap,
    );
    if (maxTokensKey !== undefined) {
      setNestedField(optBody, maxTokensKey, maxTokensValue);
      delete body[maxTokensKey.split(".")[0]!];
    }
    if (Object.keys(optBody).length > 0) {
      body[cfg.wrapsOptionsIn] = optBody;
    }
  } else {
    applyOptions(
      body,
      options,
      provider.name,
      model,
      supportedMap,
      overridesMap,
    );
  }

  if (
    cfg.safetySettingsWirePath &&
    options.safetySettings &&
    options.safetySettings.length > 0
  ) {
    body[cfg.safetySettingsWirePath] = options.safetySettings.map((s) => ({
      category: s.category,
      threshold: s.threshold,
    }));
  }

  if (request.schema) {
    applyStructuredOutput(body, headersOut, request.schema, provider.name);
  }

  return body;
}

//
//
//
//
function applyStructuredOutput(
  body: Record<string, unknown>,
  headersOut: Record<string, string> | undefined,
  schema: string,
  providerName: ProviderName,
): void {
  const def = structuredOutput(providerName);
  if (!def) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(schema);
  } catch {
    return;
  }

  if (def.enforceStrict) setAdditionalPropertiesFalse(parsed);
  if (def.removeAdditionalProps) removeAdditionalProperties(parsed);

  if (def.betaHeader && headersOut) {
    headersOut["anthropic-beta"] = def.betaHeader;
  }

  //
  //
  //
  if (def.schemaPlacement === "SiblingOfFormat") {
    setNestedField(body, def.formatField, def.formatType);
    setNestedField(body, def.schemaPath, parsed);
    return;
  }

  const pathParts = def.schemaPath.split(".");
  if (pathParts.length === 1) {
    setNestedField(body, def.formatField, {
      type: def.formatType,
      [pathParts[0]!]: parsed,
    });
  } else {
    const inner: Record<string, unknown> = {
      name: "response",
      [pathParts[1]!]: parsed,
    };
    if (def.enforceStrict) inner.strict = true;
    setNestedField(body, def.formatField, {
      type: def.formatType,
      [pathParts[0]!]: inner,
    });
  }
}

//
//
function setAdditionalPropertiesFalse(schema: unknown): void {
  if (typeof schema !== "object" || schema === null) return;
  const m = schema as Record<string, unknown>;
  if (m.type === "object") {
    m.additionalProperties = false;
    const props = m.properties;
    if (typeof props === "object" && props !== null) {
      if (!("required" in m)) {
        m.required = Object.keys(props);
      }
      for (const v of Object.values(props)) {
        setAdditionalPropertiesFalse(v);
      }
    }
  }
  if (m.items !== undefined) setAdditionalPropertiesFalse(m.items);
}

//
//
function removeAdditionalProperties(schema: unknown): void {
  if (typeof schema !== "object" || schema === null) return;
  const m = schema as Record<string, unknown>;
  delete m.additionalProperties;
  const props = m.properties;
  if (typeof props === "object" && props !== null) {
    for (const v of Object.values(props)) {
      removeAdditionalProperties(v);
    }
  }
  if (m.items !== undefined) removeAdditionalProperties(m.items);
}

//
//
//
//
export function resolveOptionKey(
  provider: ProviderName,
  model: string,
  param: OptionKey,
  supportedMap: Map<OptionKey, string>,
): string | undefined {
  let bestKey: string | undefined;
  let bestLen = -1;
  for (const ov of modelOptionOverrides(provider)) {
    if (ov.key !== param) continue;
    if (ov.matcherKind === "id") {
      if (ov.matcherValue === model) return ov.jsonKey;
    } else {
      const prefix = ov.matcherValue.endsWith("*")
        ? ov.matcherValue.slice(0, -1)
        : ov.matcherValue;
      if (model.startsWith(prefix) && prefix.length > bestLen) {
        bestKey = ov.jsonKey;
        bestLen = prefix.length;
      }
    }
  }
  if (bestLen >= 0) return bestKey;
  return supportedMap.get(param);
}

function applyOptions(
  target: Record<string, unknown>,
  options: PromptOptions,
  provider: ProviderName,
  model: string,
  supportedMap: Map<OptionKey, string>,
  overridesMap: Map<OptionKey, OptionOverrideDef>,
): void {
  const apply = (key: OptionKey, value: unknown): void => {
    const jsonKey = resolveOptionKey(provider, model, key, supportedMap);
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

//
//
//
//

//
//
//
export function toolCallInput(call: ToolCall): Record<string, unknown> {
  if (
    call.input &&
    typeof call.input === "object" &&
    !Array.isArray(call.input)
  ) {
    return call.input as Record<string, unknown>;
  }
  return {};
}

//
//
//
//
//
//
type Msg =
  | { kind: "text"; role: string; text: string }
  | { kind: "calls"; calls: ToolCall[] }
  | { kind: "result"; result: ToolResult };

//
//
//
function assertNever(m: never): never {
  throw new Error(`unhandled Msg variant: ${JSON.stringify(m)}`);
}

//
//
//
//
function toInternal(messages: Message[]): Msg[] {
  return messages.map((m): Msg => {
    const hasResult = m.toolResult != null;
    const hasCalls = (m.toolCalls?.length ?? 0) > 0;
    const hasText = (m.content ?? "").length > 0;
    if ((hasResult ? 1 : 0) + (hasCalls ? 1 : 0) + (hasText ? 1 : 0) > 1) {
      throw new ValidationError(
        "message",
        "must carry only one of text, toolCalls, or toolResult",
      );
    }
    if (hasResult) return { kind: "result", result: m.toolResult! };
    if (hasCalls) return { kind: "calls", calls: m.toolCalls! };
    return { kind: "text", role: m.role, text: m.content ?? "" };
  });
}

//
//
//
function toMessageList(request: PromptRequest): Msg[] {
  if (request.messages && request.messages.length > 0) {
    return toInternal(request.messages);
  }
  if (request.user) {
    return [{ kind: "text", role: "user", text: request.user }];
  }
  return [];
}

function buildBedrockMessages(
  msgs: Msg[],
  cfg: ProviderConfig,
): Array<Record<string, unknown>> {
  return msgs.map((m): Record<string, unknown> => {
    switch (m.kind) {
      case "result":
        return {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: m.result.toolUseId,
                content: [{ text: m.result.content }],
              },
            },
          ],
        };
      case "calls":
        return {
          role: cfg.roleMappings.assistant ?? "assistant",
          content: m.calls.map((c) => ({
            toolUse: { toolUseId: c.id, name: c.name, input: toolCallInput(c) },
          })),
        };
      case "text":
        return {
          role: cfg.roleMappings[m.role] ?? m.role,
          content: [{ text: m.text }],
        };
      default:
        return assertNever(m);
    }
  });
}

function buildGoogleContents(
  msgs: Msg[],
  cfg: ProviderConfig,
): Array<Record<string, unknown>> {
  return msgs.map((m): Record<string, unknown> => {
    switch (m.kind) {
      case "result":
        return {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: m.result.toolUseId,
                response: { result: m.result.content },
              },
            },
          ],
        };
      case "calls":
        return {
          role: cfg.roleMappings.assistant ?? "model",
          parts: m.calls.map((c) => ({
            functionCall: { name: c.name, args: toolCallInput(c) },
          })),
        };
      case "text":
        return {
          role: cfg.roleMappings[m.role] ?? m.role,
          parts: [{ text: m.text }],
        };
      default:
        return assertNever(m);
    }
  });
}

function buildMessages(
  msgs: Msg[],
  system: string,
  cfg: ProviderConfig,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  if (cfg.systemPlacement === "MessageInArray" && system) {
    out.push({
      role: cfg.roleMappings.system ?? "system",
      content: system,
    });
  }

  for (const m of msgs) {
    switch (m.kind) {
      case "result":
        out.push(toolResultMsg(m.result, cfg));
        break;
      case "calls":
        out.push(toolCallMsg(m.calls, cfg));
        break;
      case "text":
        out.push({
          role: cfg.roleMappings[m.role] ?? m.role,
          content: m.text,
        });
        break;
      default:
        assertNever(m);
    }
  }

  return out;
}

//
//
//
function attachToolDefs(
  body: Record<string, unknown>,
  tools: Tool[],
  cfg: ProviderConfig,
): void {
  if (isBedrock(cfg)) {
    body.toolConfig = {
      tools: tools.map((t) => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.schema },
        },
      })),
    };
    return;
  }
  if (cfg.systemPlacement === "TopLevelField") {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema,
    }));
    return;
  }
  if (cfg.systemPlacement === "SiblingObject") {
    //
    //
    //
    const field = cfg.toolParamsWireField || "parameters";
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          [field]: t.schema,
        })),
      },
    ];
    return;
  }
  if (cfg.systemPlacement === "MessageInArray") {
    body.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.schema,
      },
    }));
    return;
  }
  throw new ValidationError(
    "provider",
    `agent tools not yet supported in TS for systemPlacement=${cfg.systemPlacement}`,
  );
}

function toolCallMsg(
  calls: ToolCall[],
  cfg: ProviderConfig,
): Record<string, unknown> {
  if (cfg.systemPlacement === "TopLevelField") {
    return {
      role: cfg.roleMappings.assistant ?? "assistant",
      content: calls.map((c) => ({
        type: "tool_use",
        id: c.id,
        name: c.name,
        input: toolCallInput(c),
      })),
    };
  }
  return {
    role: cfg.roleMappings.assistant ?? "assistant",
    tool_calls: calls.map((c) => ({
      id: c.id,
      type: "function",
      function: {
        name: c.name,
        arguments: JSON.stringify(toolCallInput(c)),
      },
    })),
  };
}

function toolResultMsg(
  result: ToolResult,
  cfg: ProviderConfig,
): Record<string, unknown> {
  if (cfg.systemPlacement === "TopLevelField") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: result.toolUseId,
          content: result.content,
        },
      ],
    };
  }
  return {
    role: "tool",
    content: result.content,
    tool_call_id: result.toolUseId,
  };
}

export async function executeRequest(
  provider: Provider,
  cfg: ProviderConfig,
  body: Record<string, unknown>,
  options: PromptOptions,
  extraHeaders?: Record<string, string>,
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

  if (extraHeaders) {
    Object.assign(headers, extraHeaders);
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
