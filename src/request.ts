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
  wireShapeOptionOverrides,
} from "./providers/options.ts";
import { fileUploadConfig } from "./providers/upload.ts";
import { ValidationError } from "./errors.ts";
import { resolveTurns } from "./provider_turn.ts";
import type {
  Provider,
  Request as PromptRequest,
  PromptOptions,
  Tool,
} from "./types.ts";
import type {
  MediaRef,
  Message,
  Part,
  ToolCall,
  ToolResult,
} from "./structs.ts";
import { checkPartKinds, partKind } from "./part_kinds.ts";
import { bytesToBase64 } from "./image.ts";
import { sendHTTP } from "./http.ts";

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
    cfg.chatWireShape,
    OptionKeys.MAX_TOKENS,
    supportedMap,
  );
  const maxTokensValue = options.maxTokens ?? cfg.defaultMaxTokens;
  if (maxTokensKey !== undefined) {
    setNestedField(body, maxTokensKey, maxTokensValue);
  }

  // resolveTurns runs first and only here: it is the one place cfg and the
  // message list meet, so the ADR-085 RSN-006 shape check is made once rather
  // than remembered in each builder below.
  const msgs = resolveTurns(requestMsgs(request), cfg);
  if (cfg.chatWireShape === "ChatBedrock") {
    if (request.system) {
      body.system = [{ text: request.system }];
    }
    body.messages = buildBedrockMessages(msgs, cfg);
  } else if (cfg.chatWireShape === "ChatGoogle") {
    if (request.system) {
      body.system_instruction = { parts: [{ text: request.system }] };
    }
    body.contents = buildGoogleContents(msgs, cfg);
  } else if (cfg.chatWireShape === "ChatResponsesOpenAI") {
    // ADR-055 Responses envelope: the SAME flat {role, content} array as Chat
    // Completions, but under the "input" key (not "messages") and POSTed to
    // /v1/responses. buildMessages is shared so the only wire delta is the key.
    body.input = buildMessages(msgs, request.system ?? "", cfg);
  } else {
    body.messages = buildMessages(msgs, request.system ?? "", cfg);
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
      cfg.chatWireShape,
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
      cfg.chatWireShape,
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

  // BUG-017: when the request references uploaded files, it carries the beta
  // the provider's upload declares (uploadBetaHeader), composed onto any
  // existing anthropic-beta (e.g. structured output) — comma-separated,
  // deduped. Anthropic declares none since its Files API left beta (BUG-078).
  if (headersOut && requestHasFiles(request)) {
    const fu = fileUploadConfig(provider.name);
    if (fu && fu.betaHeader) {
      headersOut["anthropic-beta"] = appendBeta(
        headersOut["anthropic-beta"] ?? "",
        fu.betaHeader,
      );
    }
  }

  return body;
}

// appendBeta composes a beta token onto an existing anthropic-beta header value
// without overwriting: comma-separated, deduped (never re-adds a token already
// present). Mirrors the Go appendBeta helper (BUG-017). Exported so the batch
// submit path can compose the per-request betas onto the batch CREATE request.
export function appendBeta(existing: string, add: string): string {
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

// resolveOptionKey returns the wire (JSON) key for param on (provider, model)
// under the effective chat wire shape. A wire-shape key (BUG-075) outranks
// everything: the Responses shape names MaxTokens max_output_tokens for every
// model. Next, per-model overrides (ADR-024) outrank the provider default
// table: an exact modelId match wins outright, otherwise the longest-prefix
// glob wins, and failing any override the provider's default supported-options
// key is used.
export function resolveOptionKey(
  provider: ProviderName,
  model: string,
  chatWireShape: string,
  param: OptionKey,
  supportedMap: Map<OptionKey, string>,
): string | undefined {
  const shapeKey = wireShapeOptionOverrides(chatWireShape)[param];
  if (shapeKey !== undefined) return shapeKey;
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
  chatWireShape: string,
  supportedMap: Map<OptionKey, string>,
  overridesMap: Map<OptionKey, OptionOverrideDef>,
): void {
  const apply = (key: OptionKey, value: unknown): void => {
    const jsonKey = resolveOptionKey(provider, model, chatWireShape, key, supportedMap);
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

// The message builders below read one ordered list of turns (ADR-100): each
// turn is a role plus parts, validated once in toInternal, so the Agent path
// (history with tool turns) and the Text/batch path route through the same
// builder.

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

// A validated turn: a role and its parts, each part one kind the role may
// carry (ADR-100 MSG-002).
export type PartsMsg = { kind: "parts"; role: string; parts: Part[] };

// Internal message representation (ADR-026 PIPE-007). Builders dispatch on
// `kind` exhaustively — a missing case is a compile error.
export type Msg =
  | PartsMsg
  // An assistant turn the provider itself serialized, replayed verbatim instead
  // of rebuilt (ADR-085). It carries the turn it replaces so resolveTurns can
  // drop back to reconstruction when the payload was captured under a
  // different wire shape — the alternative, deciding that at build time, would
  // put the same check in three places.
  | { kind: "turn"; shape: string; wire: string; fallback: PartsMsg };

// ROLE_PARTS lists the part kinds each role may carry (ADR-100 MSG-002).
const ROLE_PARTS: Readonly<Record<string, readonly string[]>> = {
  user: ["text", "image", "file"],
  assistant: ["text", "tool_call"],
  tool: ["tool_result"],
};

// toInternal converts the public, untrusted Message[] into the internal sum
// (ADR-026 PIPE-008). This is the single validation boundary: a part that
// sets no kind or two, a kind chat does not accept (MSG-011), or a kind the
// role cannot carry (MSG-002) is rejected here, naming it, not
// mis-serialized downstream.
function toInternal(messages: Message[]): Msg[] {
  return messages.map((m, i): Msg => {
    checkPartKinds("chat", m.parts, `messages[${i}].parts`);
    const allowed = ROLE_PARTS[m.role] ?? [];
    m.parts.forEach((p, j) => {
      const kind = partKind(p);
      if (!allowed.includes(kind)) {
        throw new ValidationError(
          `messages[${i}].parts[${j}]`,
          `${m.role} turn does not accept ${kind} parts`,
        );
      }
    });
    const projected: PartsMsg = { kind: "parts", role: m.role, parts: m.parts };
    // providerTurn is the same turn in the provider's own serialization. When
    // present it supersedes the parts on the wire while the parts stay what
    // consumers read.
    if (m.providerTurn) {
      return {
        kind: "turn",
        shape: m.providerTurn.wireShape,
        wire: m.providerTurn.wire,
        fallback: projected,
      };
    }
    return projected;
  });
}

// requestMsgs is the one place a public request becomes the message list the
// builders read: the validated turns, then `user` as a final text turn.
function requestMsgs(request: PromptRequest): Msg[] {
  const msgs = toInternal(request.messages ?? []);
  if (request.user) {
    msgs.push({ kind: "parts", role: "user", parts: [{ text: request.user }] });
  }
  return msgs;
}

// requestHasFiles reports whether any turn carries a file part.
function requestHasFiles(request: PromptRequest): boolean {
  return (request.messages ?? []).some((m) =>
    m.parts.some((p) => "file" in p),
  );
}

// plainText returns the text of a turn that is at most one text part, which
// the flat envelopes send as a content string rather than a block list. A
// turn with no parts sends "" as before ADR-100.
function plainText(parts: Part[]): string | undefined {
  if (parts.length === 0) return "";
  const [only] = parts;
  if (parts.length === 1 && only && "text" in only) return only.text;
  return undefined;
}

function toolCallsOf(parts: Part[]): ToolCall[] {
  return parts.flatMap((p) => ("toolCall" in p ? [p.toolCall] : []));
}

function dataURI(img: MediaRef): string {
  return `data:${img.mimeType};base64,${bytesToBase64(img.bytes)}`;
}

function unwrap(m: Msg): PartsMsg {
  return m.kind === "turn" ? m.fallback : m;
}

function buildBedrockMessages(
  msgs: Msg[],
  cfg: ProviderSpec,
): Array<Record<string, unknown>> {
  // Bedrock never replays: ChatBedrock declares assistantTurnUnanchored
  // rather than a position (ADR-085 OQ-5), so there is no container to splice
  // into. Reconstruct from the parts — resolveTurns should already have
  // unwrapped this. When OQ-5 anchors Converse, this becomes a real splice.
  //
  // Converse wants every toolResult answering one assistant turn inside ONE
  // user message; one message per result is a 400 (live, 2026-10-15). A tool
  // turn that follows a tool turn joins the message the first one opened.
  const out: Array<Record<string, unknown>> = [];
  let open: unknown[] | undefined;
  for (const m of msgs.map(unwrap)) {
    const content = bedrockContent(m.parts);
    if (m.role !== "tool") {
      open = undefined;
      out.push({ role: cfg.roleMappings[m.role] ?? m.role, content });
    } else if (open) {
      open.push(...content);
    } else {
      open = content;
      out.push({ role: "user", content });
    }
  }
  return out;
}

// bedrockContent renders a turn's parts as a Converse content array, in part
// order (ADR-060, ADR-100 MSG-003). Converse has no block for an uploaded
// file id, so a file part is not sent, as before ADR-100. A turn with no
// parts sends one empty text block.
function bedrockContent(parts: Part[]): Array<Record<string, unknown>> {
  if (parts.length === 0) return [{ text: "" }];
  return parts.flatMap((p): Array<Record<string, unknown>> => {
    if ("file" in p) return [];
    if ("image" in p) {
      return [
        {
          image: {
            format: bedrockImageFormat(p.image.mimeType),
            source: { bytes: bytesToBase64(p.image.bytes) },
          },
        },
      ];
    }
    if ("toolCall" in p) {
      const c = p.toolCall;
      return [{ toolUse: { toolUseId: c.id, name: c.name, input: toolCallInput(c) } }];
    }
    if ("toolResult" in p) {
      const r = p.toolResult;
      return [{ toolResult: { toolUseId: r.toolUseId, content: [{ text: r.content }] } }];
    }
    return [{ text: "text" in p ? p.text : "" }];
  });
}

function buildGoogleContents(
  msgs: Msg[],
  cfg: ProviderSpec,
): Array<Record<string, unknown>> {
  // Google's wire identifies a tool result by the function NAME, but the
  // universal ToolResult carries only toolUseId. Recover id->name from the
  // tool call parts, which always precede their result in a valid history.
  // An unmatched id passes through unchanged.
  const idToName = new Map<string, string>();
  return msgs.map((m): Record<string, unknown> => {
    const turn = unwrap(m);
    for (const c of toolCallsOf(turn.parts)) idToName.set(c.id, c.name);
    // A replayed Google turn is candidates[0].content verbatim — the same
    // {role, parts} object the contents array takes, so it drops straight in.
    // Its calls still fed idToName above, because a LATER tool result is
    // matched by name against them.
    if (m.kind === "turn" && m.shape === "ChatGoogle") {
      try {
        const payload: unknown = JSON.parse(m.wire);
        if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
          return payload as Record<string, unknown>;
        }
      } catch {
        // fall through to the reconstruction
      }
    }
    const role =
      turn.role === "tool" ? "user" : (cfg.roleMappings[turn.role] ?? turn.role);
    return { role, parts: googleParts(turn.parts, idToName) };
  });
}

// googleParts renders a turn's parts for Google, in part order. A turn with
// no parts sends one empty text part, as before ADR-100.
function googleParts(
  parts: Part[],
  idToName: Map<string, string>,
): Array<Record<string, unknown>> {
  if (parts.length === 0) return [{ text: "" }];
  return parts.map((p): Record<string, unknown> => {
    if ("file" in p) {
      return { file_data: { file_uri: p.file.uri, mime_type: p.file.mimeType } };
    }
    if ("image" in p) {
      return {
        inline_data: { mime_type: p.image.mimeType, data: bytesToBase64(p.image.bytes) },
      };
    }
    if ("toolCall" in p) {
      return { functionCall: { name: p.toolCall.name, args: toolCallInput(p.toolCall) } };
    }
    if ("toolResult" in p) {
      const r = p.toolResult;
      return {
        functionResponse: {
          name: idToName.get(r.toolUseId) || r.toolUseId,
          response: { result: r.content },
        },
      };
    }
    return { text: "text" in p ? p.text : "" };
  });
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
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  if (cfg.systemPlacement === "MessageInArray" && system) {
    out.push({
      role: cfg.roleMappings.system ?? "system",
      content: system,
    });
  }

  for (const m of msgs) {
    if (m.kind === "turn" && appendFlatReplayedTurn(out, m, cfg)) continue;
    out.push(...flatProjectedEntry(unwrap(m), cfg));
  }

  return out;
}

// flatProjectedEntry renders one turn as flat-envelope entries — the
// reconstruction path, and the counterpart of appendFlatReplayedTurn below.
// Both return a LIST for the same reason: one turn is not always one wire
// entry. A Chat Completions or Responses tool turn is one entry per result,
// and a Responses assistant turn is one entry per part.
function flatProjectedEntry(
  m: PartsMsg,
  cfg: ProviderSpec,
): Array<Record<string, unknown>> {
  const anthropic = cfg.chatWireShape === "ChatAnthropic";
  const responses = cfg.chatWireShape === "ChatResponsesOpenAI";
  if (m.role === "tool") {
    const results = m.parts.flatMap((p) => ("toolResult" in p ? [p.toolResult] : []));
    // Anthropic puts every result in one user message (ADR-100 MSG-009).
    if (anthropic) {
      return [{ role: "user", content: results.map(anthropicToolResultBlock) }];
    }
    return results.map((r) => (responses ? responsesToolResult(r) : openAIToolResult(r)));
  }
  const role = cfg.roleMappings[m.role] ?? m.role;
  if (anthropic) return [{ role, content: anthropicContent(m.parts) }];
  if (m.role !== "assistant") return [{ role, content: openAIContent(m.parts) }];
  if (responses) {
    // Responses keeps order: each text part is an assistant message entry and
    // each tool call its own function_call item (ADR-055, BUG-050).
    if (m.parts.length === 0) return [{ role, content: "" }];
    return m.parts.map((p) =>
      "toolCall" in p
        ? responsesFunctionCall(p.toolCall)
        : { role, content: "text" in p ? p.text : "" },
    );
  }
  // Chat Completions has no order between text and tool calls: the text parts
  // join into content and the tool calls go into tool_calls (ADR-100
  // MSG-003). A turn with only tool calls carries no content key.
  const calls = toolCallsOf(m.parts);
  const entry: Record<string, unknown> = { role };
  if (calls.length > 0) entry.tool_calls = calls.map(openAIToolCall);
  if (calls.length < m.parts.length || calls.length === 0) {
    entry.content = m.parts
      .flatMap((p) => ("text" in p ? [p.text] : []))
      .join("\n");
  }
  return [entry];
}

// openAIContent renders a user turn's content for Chat Completions and
// Responses: a string for at most one text part, else blocks in part order.
// The image detail stays "auto", the value every golden carries (MSG-015).
function openAIContent(parts: Part[]): unknown {
  const text = plainText(parts);
  if (text !== undefined) return text;
  return parts.map((p): Record<string, unknown> => {
    if ("file" in p) return { type: "file", file: { file_id: p.file.id } };
    if ("image" in p) {
      return { type: "image_url", image_url: { url: dataURI(p.image), detail: "auto" } };
    }
    return { type: "text", text: "text" in p ? p.text : "" };
  });
}

// anthropicContent renders a user or assistant turn's content for Anthropic: a
// string for at most one text part, else blocks in part order.
function anthropicContent(parts: Part[]): unknown {
  const text = plainText(parts);
  if (text !== undefined) return text;
  return parts.map((p): Record<string, unknown> => {
    if ("file" in p) {
      return { type: "document", source: { type: "file", file_id: p.file.id } };
    }
    if ("image" in p) {
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: p.image.mimeType,
          data: bytesToBase64(p.image.bytes),
        },
      };
    }
    if ("toolCall" in p) {
      const c = p.toolCall;
      return { type: "tool_use", id: c.id, name: c.name, input: toolCallInput(c) };
    }
    return { type: "text", text: "text" in p ? p.text : "" };
  });
}

// appendFlatReplayedTurn appends a captured assistant turn to a flat-envelope
// array in whatever container that wire family expects, returning false when the
// payload cannot be placed so the caller reconstructs instead.
//
// The three families disagree on what assistantTurnPath even points at, which
// is why this cannot be one push:
//
//   - ChatOpenAI     "choices[0].message"  -> an assistant message object
//   - ChatAnthropic  "content"             -> the block ARRAY, with no message
//     object around it; the role wrapper below is llmkit's, the blocks are the
//     provider's
//   - ChatResponses  "output"              -> an ITEM LIST that spreads across N
//     input entries rather than becoming one (ADR-085 OQ-1)
function appendFlatReplayedTurn(
  out: Array<Record<string, unknown>>,
  turn: Extract<Msg, { kind: "turn" }>,
  cfg: ProviderSpec,
): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(turn.wire);
  } catch {
    return false;
  }
  if (turn.shape === "ChatAnthropic") {
    out.push({
      role: cfg.roleMappings.assistant ?? "assistant",
      content: payload,
    });
    return true;
  }
  if (turn.shape === "ChatResponsesOpenAI") {
    if (!Array.isArray(payload)) return false;
    for (const item of payload) {
      out.push(item as Record<string, unknown>);
    }
    return true;
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  out.push(payload as Record<string, unknown>);
  return true;
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

// openAIToolCall renders one Chat Completions tool call, with the arguments
// as a JSON string.
function openAIToolCall(c: ToolCall): Record<string, unknown> {
  return {
    id: c.id,
    type: "function",
    function: { name: c.name, arguments: JSON.stringify(toolCallInput(c)) },
  };
}

// Responses (ADR-055): each call is its own top-level input[] item, paired to
// its output by call_id rather than by position in a tool_calls array.
// LIVE-ANCHORED 2026-08-13 — the collapsed Chat Completions form is rejected
// 400 missing_required_parameter on input[1].content (Responses accepts the
// assistant role, then demands the content a tool_calls-only message lacks).
// Witnessed by reconstruct-responses-openai-parallel-calls.json.
function responsesFunctionCall(c: ToolCall): Record<string, unknown> {
  return {
    type: "function_call",
    call_id: c.id,
    name: c.name,
    arguments: JSON.stringify(toolCallInput(c)),
  };
}

function anthropicToolResultBlock(result: ToolResult): Record<string, unknown> {
  return {
    type: "tool_result",
    tool_use_id: result.toolUseId,
    content: result.content,
  };
}

// Responses (ADR-055) does not accept the Chat Completions tool message:
// input[] entries carry only the roles assistant/system/developer/user, and
// a tool result is a top-level typed item instead. LIVE-ANCHORED 2026-08-13
// — the shape below returns 200, the role:"tool" fallthrough is rejected 400
// invalid_value on input[3]. Witnessed by
// replay-responses-openai-reasoning.json.
function responsesToolResult(result: ToolResult): Record<string, unknown> {
  return {
    type: "function_call_output",
    call_id: result.toolUseId,
    output: result.content,
  };
}

function openAIToolResult(result: ToolResult): Record<string, unknown> {
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
    // Content-Type is passed to the signer so it joins the signed header set
    // (pack contract, CR-002) and arrives back in the signed headers.
    const signed = await signSigV4(
      url,
      new TextEncoder().encode(jsonBody),
      provider.apiKey,
      secret,
      session,
      region,
      cfg.serviceName,
      "POST",
      "application/json",
    );
    // ADR-052: start from the AWS-signed headers, then add caller headers that
    // don't collide (case-insensitively) so the signature is never altered;
    // a gateway header still rides alongside the signed request.
    headers = { ...signed };
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

  const httpResp = await sendHTTP(url, {
    method: "POST",
    headers,
    body: jsonBody,
    signal: options.signal,
  }, provider.timeoutMs);
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
