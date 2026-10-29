// D2.6 (plan-018) — owns Agent.prompt + Agent.reset translation. The
// legacy `Agent` class (formerly exported from llmkit.ts) is now
// reachable only as an internal helper imported from agent.ts under
// the alias `LegacyAgent`; the typed-builder is the only public entry
// point for tool-calling sessions.
//
// Stateful builder pattern: *Agent (typed-builder) has a private
// `_state?: AgentState` field that wraps a live LegacyAgent instance.
// First call to .prompt() lazily constructs it from the chained
// config; subsequent calls reuse it so history accumulates.
//
//
// (TS_BUILDER_POST_MUTATION["Agent"] = "out._state = undefined"):
// every chain method clones the receiver and zeroes the clone's
// state. So a forked clone via `.system("new")` starts with fresh
// state, even though the parent's state is preserved. This is the
// load-bearing contract — without the post-mutation hook, forks
// would silently share their parent's accumulated history.

import { Agent as LegacyAgent, type AgentSendOptions } from "../agent.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { Message, ToolDefinition } from "../structs.ts";
import type { Provider, Request, Response, Tool } from "../types.ts";
import type { Agent } from "./builders.ts";

export class AgentState {
  agent: LegacyAgent;
  constructor(agent: LegacyAgent) {
    this.agent = agent;
  }
}

// toolDefinitions keeps what the request sends of each tool: its name,
// description and schema (ADR-098 RQC-018).
function toolDefinitions(tools: Tool[]): ToolDefinition[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.schema,
  }));
}

// initAgent constructs the underlying agent from the chained config: the
// Request each turn sends, the tools, and the send options. The builder's
// model goes into Request.model, so the provider carries none.
function initAgent(b: Agent): AgentState {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
    headers: b.client.provider.headers,
    timeoutMs: b.client.provider.timeoutMs,
  };
  if (b.client.provider.baseUrl) provider.baseUrl = b.client.provider.baseUrl;

  const request: Request = {};
  if (b._model) request.model = b._model;
  if (b._system) request.system = b._system;
  if (b._tools.length > 0) request.tools = toolDefinitions(b._tools);
  if (b._maxTokens !== undefined) request.maxTokens = b._maxTokens;
  if (b._temperature !== undefined) request.temperature = b._temperature;
  if (b._topP !== undefined) request.topP = b._topP;
  if (b._topK !== undefined) request.topK = b._topK;
  if (b._frequencyPenalty !== undefined)
    request.frequencyPenalty = b._frequencyPenalty;
  if (b._presencePenalty !== undefined)
    request.presencePenalty = b._presencePenalty;
  if (b._seed !== undefined) request.seed = b._seed;
  if (b._stopSequences.length > 0) request.stop = b._stopSequences;
  if (b._thinkingBudget !== undefined)
    request.thinkingBudget = b._thinkingBudget;
  if (b._reasoningEffort !== undefined)
    request.reasoningEffort = b._reasoningEffort;
  if (b._safetySettings.length > 0) request.safetySettings = b._safetySettings;

  const options: AgentSendOptions = {};
  if (b._maxToolIterations !== undefined)
    options.maxToolIterations = b._maxToolIterations;
  if (b._caching) options.caching = true;
  if (b._cacheTTL !== undefined) options.cacheTTL = b._cacheTTL;
  if (b._middleware.length > 0) options.middleware = b._middleware;
  if (b._raw) options.raw = true;

  const agent = new LegacyAgent(provider, request, [...b._tools], options);
  // ADR-020 HIST-007: seed the legacy agent's history from the chain's
  // typed Message list. Copies are shallow (the part payloads are shared
  // with the chain — per shallow-immutability the chain is already a
  // clone-of-clone-stem, so no aliasing concern).
  if (b._history.length > 0) {
    agent.seedHistory(b._history);
  }
  return new AgentState(agent);
}

export async function agentPrompt(b: Agent, msg: string): Promise<Response> {
  if (!b._state) {
    b._state = initAgent(b);
  }
  return await b._state.agent.chat(msg);
}

// Clears state. Chain config (system, tools, max-tokens, ...) is
// preserved — Reset on the typed builder does NOT throw away the
// configured tools, even though the underlying LegacyAgent.reset()
// clears tools too. Since we just nullify the wrapper, the next
// .prompt() re-runs initAgent and re-adds tools from the typed
// builder's own _tools slice.
export function agentReset(b: Agent): void {
  b._state = undefined;
}

// ADR-020 HIST-004: bot.messages returns the agent's history. Returns an
// empty readonly array before the first .prompt() call. The outer array and
// each Message.parts are fresh copies (no aliasing); the part payloads are
// shared with the agent's runtime state by ADR-020's shallow-immutability
// rule — treat the returned messages as read-only. A turn the agent
// received carries its providerTurn (ADR-085), so save() keeps it.
export function agentMessages(b: Agent): readonly Message[] {
  if (!b._state) return [];
  return b._state.agent.historyView();
}
