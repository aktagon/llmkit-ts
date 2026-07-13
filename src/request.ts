//
//

import {
  PROVIDERS,
  type ProviderSpec,
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
import { fileUploadConfig } from "./providers/upload.ts";
import { ValidationError } from "./errors.ts";
import { extractIntPath, extractPath } from "./paths.ts";
import type {
  InputImage,
  Provider,
  Request as PromptRequest,
  PromptOptions,
  Response,
  Tool,
} from "./types.ts";
import type { File, Message, ToolCall, ToolResult } from "./structs.ts";

//
//
//
//
export function resolveModel(provider: Provider, cfg: ProviderSpec): string {
  if (provider.model) return provider.model;
  if (!cfg.defaultModel) {
    throw new ValidationError(
      "model",
      `no model chosen and "${provider.name}" declares no default; pick one (models.live() lists what the daemon serves)`,
    );
  }
  return cfg.defaultModel;
}

//
//
//
//
//
export const Responses = "responses";

//
//
//
function protocolWireShape(token: string): string {
  switch (token) {
    case Responses:
      return "ChatResponsesOpenAI";
  }
  return "";
}

//
//
//
//
//
//
export function resolveChatProtocol(
  cfg: ProviderSpec,
  token: string,
): ProviderSpec {
  if (!token) return cfg;
  const want = protocolWireShape(token);
  if (!want) {
    throw new ValidationError("protocol", `unknown protocol: ${token}`);
  }
  for (const cp of cfg.chatProtocols) {
    if (cp.wireShape === want) {
      return { ...cfg, endpoint: cp.endpoint, chatWireShape: cp.wireShape };
    }
  }
  throw new ValidationError(
    "protocol",
    `provider "${cfg.name}" does not support protocol "${token}"`,
  );
}

//
//
//
//
//
//
//
export function parseResponsesEnvelope(raw: unknown): Response {
  const result: Response = {
    text: extractResponsesText(raw),
    usage: {
      input: extractIntPath(raw, "usage.input_tokens"),
      output: extractIntPath(raw, "usage.output_tokens"),
      cacheWrite: 0,
      cacheRead: extractIntPath(raw, "usage.input_tokens_details.cached_tokens"),
      reasoning: extractIntPath(
        raw,
        "usage.output_tokens_details.reasoning_tokens",
      ),
      cost: 0,
    },
  };
  const status = extractPath(raw, "status");
  if (status) result.finishReason = status;
  return result;
}

//
//
//
function extractResponsesText(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return "";
  const output = (raw as Record<string, unknown>).output;
  if (!Array.isArray(output)) return "";
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const m = item as Record<string, unknown>;
    if (m.type !== "message" || !Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (typeof block !== "object" || block === null) continue;
      const cm = block as Record<string, unknown>;
      if (cm.type === "output_text" && typeof cm.text === "string") {
        return cm.text;
      }
    }
  }
  return "";
}

export function buildRequest(
  provider: Provider,
  request: PromptRequest,
  cfg: ProviderSpec,
  options: PromptOptions,
  tools: Tool[] = [],
  //
  //
  //
  headersOut?: Record<string, string>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const model = resolveModel(provider, cfg);

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
  if (cfg.chatWireShape === "ChatBedrock") {
    if (request.system) {
      body.system = [{ text: request.system }];
    }
    body.messages = buildBedrockMessages(msgs, cfg, request.images ?? []);
  } else if (cfg.chatWireShape === "ChatGoogle") {
    if (request.system) {
      body.system_instruction = { parts: [{ text: request.system }] };
    }
    body.contents = buildGoogleContents(
      msgs,
      cfg,
      request.files ?? [],
      request.images ?? [],
    );
  } else if (cfg.chatWireShape === "ChatResponsesOpenAI") {
    //
    //
    //
    body.input = buildMessages(
      msgs,
      request.system ?? "",
      cfg,
      request.files ?? [],
      request.images ?? [],
    );
  } else {
    body.messages = buildMessages(
      msgs,
      request.system ?? "",
      cfg,
      request.files ?? [],
      request.images ?? [],
    );
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
      body,
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

  //
  //
  //
  //
  if (headersOut && (request.files?.length ?? 0) > 0) {
    const fu = fileUploadConfig(provider.name);
    if (fu && fu.betaHeader) {
      headersOut["anthropic-beta"] = appendBeta(
        headersOut["anthropic-beta"] ?? "",
        fu.betaHeader,
      );
    }
  }

  //
  //
  //
  //
  if (cfg.chatWireShape === "ChatResponsesOpenAI" && "max_tokens" in body) {
    body.max_output_tokens = body.max_tokens;
    delete body.max_tokens;
  }

  return body;
}

//
//
//
//
export function appendBeta(existing: string, add: string): string {
  if (add === "") return existing;
  if (existing === "") return add;
  const present = existing.split(",").map((t) => t.trim());
  if (present.includes(add)) return existing;
  return `${existing},${add}`;
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

//
//
//
//
//
//
function applyOptions(
  root: Record<string, unknown>,
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
    if (override?.rootExtraFieldsJson) {
      const extras = JSON.parse(override.rootExtraFieldsJson) as Record<
        string,
        unknown
      >;
      deepMerge(root, extras);
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

//
//
//
//
function deepMerge(
  dst: Record<string, unknown>,
  src: Record<string, unknown>,
): void {
  for (const [k, v] of Object.entries(src)) {
    const dv = dst[k];
    if (
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v) &&
      typeof dv === "object" &&
      dv !== null &&
      !Array.isArray(dv)
    ) {
      deepMerge(dv as Record<string, unknown>, v as Record<string, unknown>);
      continue;
    }
    dst[k] = v;
  }
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

  const requireOption = (key: OptionKey, field: string): void => {
    if (!supported.has(key)) {
      throw new ValidationError(field, `not supported by ${name}`);
    }
  };
  if (options.topK !== undefined) requireOption(OptionKeys.TOP_K, "topK");
  if (options.seed !== undefined) requireOption(OptionKeys.SEED, "seed");
  if (options.stopSequences && options.stopSequences.length > 0)
    requireOption(OptionKeys.STOP_SEQUENCES, "stopSequences");
  if (options.frequencyPenalty !== undefined)
    requireOption(OptionKeys.FREQUENCY_PENALTY, "frequencyPenalty");
  if (options.presencePenalty !== undefined)
    requireOption(OptionKeys.PRESENCE_PENALTY, "presencePenalty");
  if (options.thinkingBudget !== undefined)
    requireOption(OptionKeys.THINKING_BUDGET, "thinkingBudget");
  if (options.reasoningEffort)
    requireOption(OptionKeys.REASONING_EFFORT, "reasoningEffort");

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
  cfg: ProviderSpec,
  images: InputImage[] = [],
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
          content:
            images.length > 0 && m.role === "user" && msgs.length === 1
              ? buildBedrockContentParts(m.text, images)
              : [{ text: m.text }],
        };
      default: {
        const _exhaustive: never = m;
        throw new Error(
          `unhandled Msg variant: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  });
}

function buildGoogleContents(
  msgs: Msg[],
  cfg: ProviderSpec,
  files: File[] = [],
  images: InputImage[] = [],
): Array<Record<string, unknown>> {
  const hasMedia = files.length > 0 || images.length > 0;
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
          parts:
            hasMedia && m.role === "user" && msgs.length === 1
              ? buildGoogleContentParts(m.text, files, images)
              : [{ text: m.text }],
        };
      default: {
        const _exhaustive: never = m;
        throw new Error(
          `unhandled Msg variant: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  });
}

//
//
//
//
//
//
function buildFlatContentParts(
  text: string,
  files: File[],
  images: InputImage[],
  cfg: ProviderSpec,
): Array<Record<string, unknown>> {
  const isAnthropic = cfg.chatWireShape === "ChatAnthropic";
  const parts: Array<Record<string, unknown>> = [];
  for (const f of files) {
    parts.push(
      isAnthropic
        ? { type: "document", source: { type: "file", file_id: f.id } }
        : { type: "file", file: { file_id: f.id } },
    );
  }
  for (const img of images) {
    if (isAnthropic) {
      if (img.url.startsWith("data:")) {
        const [mimeType, data] = parseDataURI(img.url);
        parts.push({
          type: "image",
          source: { type: "base64", media_type: mimeType, data },
        });
      } else {
        parts.push({ type: "image", source: { type: "url", url: img.url } });
      }
    } else {
      parts.push({
        type: "image_url",
        image_url: { url: img.url, detail: img.detail || "auto" },
      });
    }
  }
  parts.push({ type: "text", text });
  return parts;
}

//
//
//
function parseDataURI(uri: string): [string, string] {
  if (!uri.startsWith("data:")) return ["", uri];
  const rest = uri.slice("data:".length);
  const comma = rest.indexOf(",");
  if (comma < 0) return ["", uri];
  const meta = rest.slice(0, comma); // "image/png;base64"
  const data = rest.slice(comma + 1);
  const mimeType = meta.endsWith(";base64")
    ? meta.slice(0, -";base64".length)
    : meta;
  return [mimeType, data];
}

//
//
//
function buildGoogleContentParts(
  text: string,
  files: File[],
  images: InputImage[],
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  for (const f of files) {
    parts.push({
      file_data: { file_uri: f.uri, mime_type: f.mimeType },
    });
  }
  for (const img of images) {
    const [uriMime, data] = parseDataURI(img.url);
    const mimeType = uriMime || img.mimeType || "image/jpeg";
    parts.push({ inline_data: { mime_type: mimeType, data } });
  }
  parts.push({ text });
  return parts;
}

//
//
function buildBedrockContentParts(
  text: string,
  images: InputImage[],
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  for (const img of images) {
    const [uriMime, data] = parseDataURI(img.url);
    const mimeType = uriMime || img.mimeType;
    parts.push({
      image: { format: bedrockImageFormat(mimeType), source: { bytes: data } },
    });
  }
  parts.push({ text });
  return parts;
}

//
//
function bedrockImageFormat(mimeType: string): string {
  const i = mimeType.lastIndexOf("/");
  return i >= 0 ? mimeType.slice(i + 1) : mimeType;
}

function buildMessages(
  msgs: Msg[],
  system: string,
  cfg: ProviderSpec,
  files: File[] = [],
  images: InputImage[] = [],
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  if (cfg.systemPlacement === "MessageInArray" && system) {
    out.push({
      role: cfg.roleMappings.system ?? "system",
      content: system,
    });
  }

  const hasMedia = files.length > 0 || images.length > 0;
  for (const m of msgs) {
    switch (m.kind) {
      case "result":
        out.push(toolResultMsg(m.result, cfg));
        break;
      case "calls":
        out.push(toolCallMsg(m.calls, cfg));
        break;
      case "text":
        //
        //
        //
        out.push({
          role: cfg.roleMappings[m.role] ?? m.role,
          content:
            hasMedia && m.role === "user" && msgs.length === 1
              ? buildFlatContentParts(m.text, files, images, cfg)
              : m.text,
        });
        break;
      default: {
        const _exhaustive: never = m;
        throw new Error(
          `unhandled Msg variant: ${JSON.stringify(_exhaustive)}`,
        );
      }
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
  cfg: ProviderSpec,
): void {
  if (cfg.chatWireShape === "ChatBedrock") {
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
  if (cfg.chatWireShape === "ChatAnthropic") {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema,
    }));
    return;
  }
  if (cfg.chatWireShape === "ChatGoogle") {
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
  if (cfg.chatWireShape === "ChatOpenAI") {
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
  cfg: ProviderSpec,
): Record<string, unknown> {
  if (cfg.chatWireShape === "ChatAnthropic") {
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
  cfg: ProviderSpec,
): Record<string, unknown> {
  if (cfg.chatWireShape === "ChatAnthropic") {
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
  cfg: ProviderSpec,
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
    const signed = await signSigV4(
      url,
      new TextEncoder().encode(jsonBody),
      provider.apiKey,
      secret,
      session,
      region,
      cfg.serviceName,
    );
    //
    //
    //
    headers = { ...signed };
    headers["Content-Type"] = "application/json";
    mergeCallerHeaders(headers, provider);
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








export function mergeCallerHeaders(
  headers: Record<string, string>,
  provider: Provider,
): void {
  const existing = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
  for (const [k, v] of Object.entries(provider.headers ?? {})) {
    if (!existing.has(k.toLowerCase())) headers[k] = v;
  }
}

export function buildAuthHeaders(
  provider: Provider,
  cfg: ProviderSpec,
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
  mergeCallerHeaders(headers, provider); // additive; never clobbers auth/required above.
  return headers;
}

export function buildUrl(
  base: string,
  provider: Provider,
  cfg: ProviderSpec,
): string {
  const model = resolveModel(provider, cfg);
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
