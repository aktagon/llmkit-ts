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
// Chain immutability is preserved by the codegen post-mutation hook
// (TS_BUILDER_POST_MUTATION["Agent"] = "out._state = undefined"):
// every chain method clones the receiver and zeroes the clone's
// state. So a forked clone via `.system("new")` starts with fresh
// state, even though the parent's state is preserved. This is the
// load-bearing contract — without the post-mutation hook, forks
// would silently share their parent's accumulated history.

import { Agent as LegacyAgent } from "../agent.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { AgentOptions, Provider, Response } from "../types.ts";
import type { Agent } from "./builders.ts";

export class AgentState {
  agent: LegacyAgent;
  constructor(agent: LegacyAgent) {
    this.agent = agent;
  }
}

function initAgent(b: Agent): AgentState {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
  };
  if (b._model) provider.model = b._model;
  if (b.client.provider.baseUrl) provider.baseUrl = b.client.provider.baseUrl;

  const options: AgentOptions = {};
  if (b._maxTokens !== undefined) options.maxTokens = b._maxTokens;
  if (b._temperature !== undefined) options.temperature = b._temperature;
  if (b._topP !== undefined) options.topP = b._topP;
  if (b._topK !== undefined) options.topK = b._topK;
  if (b._frequencyPenalty !== undefined)
    options.frequencyPenalty = b._frequencyPenalty;
  if (b._presencePenalty !== undefined)
    options.presencePenalty = b._presencePenalty;
  if (b._seed !== undefined) options.seed = b._seed;
  if (b._stopSequences.length > 0) options.stopSequences = b._stopSequences;
  if (b._thinkingBudget !== undefined)
    options.thinkingBudget = b._thinkingBudget;
  if (b._reasoningEffort) options.reasoningEffort = b._reasoningEffort;
  if (b._maxToolIterations !== undefined)
    options.maxToolIterations = b._maxToolIterations;
  if (b._caching) options.caching = true;
  if (b._middleware.length > 0) options.middleware = b._middleware;
  if (b._safetySettings.length > 0) options.safetySettings = b._safetySettings;

  const agent = new LegacyAgent(provider, options);
  if (b._system) agent.setSystem(b._system);
  for (const t of b._tools) agent.addTool(t);
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
