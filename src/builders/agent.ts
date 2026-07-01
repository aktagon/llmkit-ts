//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//

import { Agent as LegacyAgent } from "../agent.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { Message, ToolCall, ToolResult } from "../structs.ts";
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
    headers: b.client.provider.headers,
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
  if (b._raw) options.raw = true;

  const agent = new LegacyAgent(provider, options);
  if (b._system) agent.setSystem(b._system);
  for (const t of b._tools) agent.addTool(t);
  //
  //
  //
  //
  //
  //
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

//
//
//
//
//
//
export function agentReset(b: Agent): void {
  b._state = undefined;
}

//
//
//
//
//
//
//
export function agentMessages(b: Agent): readonly Message[] {
  if (!b._state) return [];
  const out: Message[] = [];
  for (const m of b._state.agent.historyView()) {
    const role = m.role === "tool_result" ? "tool" : m.role;
    const toolCalls: ToolCall[] = [];
    for (const tc of m.toolCalls ?? []) {
      toolCalls.push({ id: tc.id, name: tc.name, input: tc.input });
    }
    const msg: Message = {
      role,
      content: m.content ?? "",
      toolCalls,
      toolResult: m.toolResult
        ? ({
            toolUseId: m.toolResult.toolUseId,
            content: m.toolResult.content,
          } as ToolResult)
        : null,
    };
    out.push(msg);
  }
  return out;
}
