// Provider-shaped HTTP request building: body, options, auth, URL.
// Shared by prompt(), promptStream(), submitBatch().

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

// ADR-031 honest no-default contract: the single predicate every model
// resolution point dispatches on. Local daemons declare no default — what a
// daemon serves is runtime inventory, not a registry fact — so both empty
// throws instead of guessing a model the daemon may not have pulled.
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

// Responses is the ADR-055 opt-in chat-protocol token for OpenAI's Responses
// API. Pass it to Text.protocol to POST the {input} envelope to /v1/responses
// instead of the default Chat Completions {messages} envelope to
// /v1/chat/completions. It is a plain string; c.text.protocol("responses") is
// equivalent (per-SDK idiom note, ADR-055).
export const Responses = "responses";

// protocolWireShape maps a public protocol token to its ChatWireShape.
// An empty token keeps the provider's default protocol; an unknown token
// returns "" (the caller raises ValidationError).
function protocolWireShape(token: string): string {
  switch (token) {
    case Responses:
      return "ChatResponsesOpenAI";
  }
  return "";
}

// resolveChatProtocol returns a cfg copy with endpoint + chatWireShape
// overridden for a non-default chat protocol opt-in (ADR-055 protocol(...)).
// An empty token keeps the default (cfg unchanged). A provider that does not
// expose the requested protocol throws ValidationError(field:"protocol") — the
// loud, uniform error the ADR requires — before any network call. cfg is
// copied, so the override never leaks to other calls.
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

// parseResponsesEnvelope extracts text + usage from OpenAI's Responses reply
// (ADR-055). Unlike Chat Completions (choices[].message.content), the reply is
// an output[] array whose message item carries content[] blocks of type
// "output_text"; usage is input_tokens/output_tokens with cached + reasoning
// sub-details. Live-anchored 2026-07-02. Hand-coded per wire shape, symmetric
// with the ChatResponsesOpenAI request arm (ADR-028: behavior held by tests,
// not by declared response paths).
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

// extractResponsesText walks the Responses output[] array for the first message
// item and returns its first output_text block. Iterating (rather than a fixed
// output[0].content[0] path) tolerates a leading reasoning item.
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
  // headersOut, when supplied, collects request headers produced during body
  // construction (e.g. the anthropic-beta header for structured output). The
  // caller merges these into executeRequest. Body-only callers (batch) omit it.
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
    // ADR-055 Responses envelope: the SAME flat {role, content} array as Chat
    // Completions, but under the "input" key (not "messages") and POSTed to
    // /v1/responses. buildMessages is shared so the only wire delta is the key.
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

  // Tool definitions (Agent path). The Text/batch paths pass no tools, so this
  // is a no-op there — the body stays byte-identical (PIPE-005).
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

  // BUG-017: when the request references uploaded files, the Messages request
  // must carry the provider's file-upload beta header so the {type:"document",
  // source:{type:"file"}} block is accepted. Composed onto any existing
  // anthropic-beta (e.g. structured output) — comma-separated, deduped.
  if (headersOut && (request.files?.length ?? 0) > 0) {
    const fu = fileUploadConfig(provider.name);
    if (fu && fu.betaHeader) {
      headersOut["anthropic-beta"] = appendBeta(
        headersOut["anthropic-beta"] ?? "",
        fu.betaHeader,
      );
    }
  }

  // ADR-055 Responses wire-shape body fixup: the Responses API names the
  // output-token cap max_output_tokens and rejects max_tokens with a 400
  // (live-verified 2026-07-02). Every other body field is shared with Chat
  // Completions, so this single rename is the only option-key divergence.
  if (cfg.chatWireShape === "ChatResponsesOpenAI" && "max_tokens" in body) {
    body.max_output_tokens = body.max_tokens;
    delete body.max_tokens;
  }

  return body;
}

// appendBeta composes a beta token onto an existing anthropic-beta header value
// without overwriting: comma-separated, deduped (never re-adds a token already
// present). Mirrors the Go appendBeta helper (BUG-017).
function appendBeta(existing: string, add: string): string {
  if (add === "") return existing;
  if (existing === "") return add;
  const present = existing.split(",").map((t) => t.trim());
  if (present.includes(add)) return existing;
  return `${existing},${add}`;
}

// applyStructuredOutput writes the provider-shaped structured-output fields onto
// the body, mirroring the Go/Python/Rust addStructuredOutput. Selection is by
// config (StructuredOutputDef), never by provider name. The beta header (if any)
// is collected into headersOut for the caller to forward to executeRequest.
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

  // SiblingOfFormat placement (Google): formatField carries the literal
  // formatType (responseMimeType: "application/json") and the schema is an
  // independent sibling at schemaPath (responseSchema), not nested in a wrapper.
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

// setAdditionalPropertiesFalse recursively sets additionalProperties:false and
// auto-populates `required` (OpenAI strict mode). Mirrors the Go helper.
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

// removeAdditionalProperties recursively strips additionalProperties (Google).
// Mirrors the Go helper.
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

// resolveOptionKey returns the wire (JSON) key for param on (provider, model).
// Per-model overrides (ADR-024) outrank the provider default table: an exact
// modelId match wins outright, otherwise the longest-prefix glob wins, and
// failing any override the provider's default supported-options key is used.
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

// applyOptions writes generation parameters onto target (the option object —
// the body itself, or the wrapsOptionsIn wrapper). root is the true body
// root: an override's rootExtraFieldsJson (ADR-029 THK-003) deep-merges
// there, for options that imply a sibling object elsewhere in the body
// (e.g. {"thinking":{"type":"adaptive"}} alongside Anthropic's
// output_config.effort).
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

// deepMerge merges src into dst recursively: when both sides hold an object
// at the same key the objects merge, otherwise src overwrites. Used for
// rootExtraFieldsJson (ADR-029) so e.g. {"thinking":{"type":"adaptive"}}
// composes with an existing thinking object rather than replacing it.
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

// The message builders below are tool-aware (ADR-020 / ADR-026): each turn is
// dispatched on its carrier field — toolResult, then toolCalls, then text — so
// the Agent path (history with tool turns) and the Text/batch path (text-only)
// route through the same builder. A text turn is the degenerate no-tool case.

// toolCallInput normalises ToolCall.input (widened to `unknown` in ADR-020)
// back to a plain object for the wire, mirroring the Tool.run({...}) contract.
// Exported so the agent loop reuses the one definition (no duplicate).
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

// Internal message representation (ADR-026 PIPE-007). A message is a sum: it
// is *exactly one of* text, tool-calls, or tool-result. The public `Message`
// (structs.ts) is a flat product that can represent illegal multi-carrier
// combinations; this internal union cannot, so the builders below dispatch on
// `kind` exhaustively — a missing case is a compile error, with no silent-drop
// branch and no runtime carrier guard.
type Msg =
  | { kind: "text"; role: string; text: string }
  | { kind: "calls"; calls: ToolCall[] }
  | { kind: "result"; result: ToolResult };

// Exhaustiveness at each Msg dispatch is enforced inline (ADR-026 PIPE-007):
// the `const _: never = m` in every `default:` makes adding a fourth kind
// without handling it a compile error, rather than a silent runtime fallthrough.

// toInternal converts the public, untrusted Message[] into the internal sum
// (ADR-026 PIPE-008). This is the single carrier-validation boundary: a message
// carrying more than one of {content, toolCalls, toolResult} is rejected here,
// not silently mis-serialized downstream.
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

// toMessageList funnels both request shapes — explicit history
// (request.messages) and the degenerate single turn (request.user) — into one
// internal list, so every path dispatches on the same sum.
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

// buildFlatContentParts builds the OpenAI/Anthropic user-message content array
// when files or images are attached, mirroring the Go/Python/Rust
// _build_flat_content_parts (BUG-014, ADR-060). File blocks come first, then
// image blocks, then the prompt text last. The document-vs-file and the image
// block shape are selected by chatWireShape (ChatAnthropic), never by provider
// name.
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

// parseDataURI extracts the MIME type and base64 payload from a data URI
// ("data:image/png;base64,iVBOR..."). A non-data URI returns ["", uri].
// Mirrors Go's parseDataURI.
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

// buildGoogleContentParts builds a Google parts[] array with file_data +
// inline_data media ahead of the prompt text (ADR-060), mirroring Go's
// buildGoogleContentParts.
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

// buildBedrockContentParts builds a Converse content[] array with image blocks
// ahead of the prompt text (ADR-060), mirroring Go's buildBedrockContentParts.
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

// bedrockImageFormat derives the Converse `format` token from a MIME type
// (image/png -> "png"). Mirrors Go's bedrockImageFormat.
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
        // Attach media only on the degenerate single-turn user path, matching
        // Go's `len(msgs)==0 && req.User != ""` media branch — history turns
        // carry plain-string content.
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

// attachToolDefs writes the provider-shaped tool definitions onto the body.
// Selection is by config shape (ADR-025 toolParamsWireField for Google), never
// by provider name.
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
    // Google carries tool params under a per-provider wire field (ADR-025):
    // "parametersJsonSchema" accepts native JSON Schema verbatim, vs the
    // OpenAPI-3.0-subset "parameters" default.
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
    // ADR-052: start from the AWS-signed headers, then add caller headers that
    // don't collide (case-insensitively) so the signature is never altered;
    // a gateway header still rides alongside the signed request.
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

/**
 * ADR-052: add caller-supplied custom headers (Client.addHeader) to `headers`
 * that are NOT already present (case-insensitively). Call AFTER the SDK-set
 * headers (auth, required) so those can never be clobbered — HTTP header names
 * are case-insensitive, so a caller "authorization" must not shadow the
 * provider's "Authorization". The caller can still add a new gateway header.
 */
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
