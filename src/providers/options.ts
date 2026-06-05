// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers";

export const OptionKeys = {
  FREQUENCY_PENALTY: "frequency_penalty",
  MAX_TOKENS: "max_tokens",
  PRESENCE_PENALTY: "presence_penalty",
  REASONING_EFFORT: "reasoning_effort",
  SEED: "seed",
  STOP_SEQUENCES: "stop_sequences",
  TEMPERATURE: "temperature",
  THINKING_BUDGET: "thinking_budget",
  TOP_K: "top_k",
  TOP_P: "top_p",
} as const;

export type OptionKey = typeof OptionKeys[keyof typeof OptionKeys];

export interface OptionDef {
  key: OptionKey;
  valueType: string;
  defaultJsonKey: string;
}

export interface SupportedOptionDef {
  key: OptionKey;
  jsonKey: string;
}

export interface OptionOverrideDef {
  key: OptionKey;
  jsonKey: string;
  allowedValues: readonly string[];
  extraFieldsJson: string;
  rootExtraFieldsJson: string;
}

export const ALL_OPTIONS: readonly OptionDef[] = [
  {
    key: OptionKeys.FREQUENCY_PENALTY,
    valueType: "float64",
    defaultJsonKey: "frequency_penalty",
  },
  {
    key: OptionKeys.MAX_TOKENS,
    valueType: "int",
    defaultJsonKey: "max_tokens",
  },
  {
    key: OptionKeys.PRESENCE_PENALTY,
    valueType: "float64",
    defaultJsonKey: "presence_penalty",
  },
  {
    key: OptionKeys.REASONING_EFFORT,
    valueType: "string",
    defaultJsonKey: "reasoning_effort",
  },
  {
    key: OptionKeys.SEED,
    valueType: "int64",
    defaultJsonKey: "seed",
  },
  {
    key: OptionKeys.STOP_SEQUENCES,
    valueType: "[]string",
    defaultJsonKey: "stop_sequences",
  },
  {
    key: OptionKeys.TEMPERATURE,
    valueType: "float64",
    defaultJsonKey: "temperature",
  },
  {
    key: OptionKeys.THINKING_BUDGET,
    valueType: "int",
    defaultJsonKey: "thinking_budget",
  },
  {
    key: OptionKeys.TOP_K,
    valueType: "int",
    defaultJsonKey: "top_k",
  },
  {
    key: OptionKeys.TOP_P,
    valueType: "float64",
    defaultJsonKey: "top_p",
  },
];

const SUPPORTED_OPTIONS: Record<ProviderName, readonly SupportedOptionDef[]> = {
  ai21: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  anthropic: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.REASONING_EFFORT,
      jsonKey: "output_config.effort",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop_sequences",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.THINKING_BUDGET,
      jsonKey: "thinking.budget_tokens",
    },
    {
      key: OptionKeys.TOP_K,
      jsonKey: "top_k",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  azure: [
    {
      key: OptionKeys.FREQUENCY_PENALTY,
      jsonKey: "frequency_penalty",
    },
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.PRESENCE_PENALTY,
      jsonKey: "presence_penalty",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  bedrock: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "maxTokens",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stopSequences",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  cerebras: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  cohere: [
    {
      key: OptionKeys.FREQUENCY_PENALTY,
      jsonKey: "frequency_penalty",
    },
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.PRESENCE_PENALTY,
      jsonKey: "presence_penalty",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_K,
      jsonKey: "top_k",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  deepseek: [
    {
      key: OptionKeys.FREQUENCY_PENALTY,
      jsonKey: "frequency_penalty",
    },
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.PRESENCE_PENALTY,
      jsonKey: "presence_penalty",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  doubao: [
    {
      key: OptionKeys.FREQUENCY_PENALTY,
      jsonKey: "frequency_penalty",
    },
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.PRESENCE_PENALTY,
      jsonKey: "presence_penalty",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  ernie: [
    {
      key: OptionKeys.FREQUENCY_PENALTY,
      jsonKey: "frequency_penalty",
    },
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.PRESENCE_PENALTY,
      jsonKey: "presence_penalty",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  fireworks: [
    {
      key: OptionKeys.FREQUENCY_PENALTY,
      jsonKey: "frequency_penalty",
    },
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.PRESENCE_PENALTY,
      jsonKey: "presence_penalty",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_K,
      jsonKey: "top_k",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  google: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_output_tokens",
    },
    {
      key: OptionKeys.REASONING_EFFORT,
      jsonKey: "thinkingConfig.thinkingLevel",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop_sequences",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.THINKING_BUDGET,
      jsonKey: "thinkingConfig.thinkingBudget",
    },
    {
      key: OptionKeys.TOP_K,
      jsonKey: "top_k",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  grok: [
    {
      key: OptionKeys.FREQUENCY_PENALTY,
      jsonKey: "frequency_penalty",
    },
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.PRESENCE_PENALTY,
      jsonKey: "presence_penalty",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_K,
      jsonKey: "top_k",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  groq: [
    {
      key: OptionKeys.FREQUENCY_PENALTY,
      jsonKey: "frequency_penalty",
    },
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.PRESENCE_PENALTY,
      jsonKey: "presence_penalty",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  jan: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_K,
      jsonKey: "top_k",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  llamacpp: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_K,
      jsonKey: "top_k",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  lmstudio: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  minimax: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  mistral: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  moonshot: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  ollama: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_K,
      jsonKey: "top_k",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  openai: [
    {
      key: OptionKeys.FREQUENCY_PENALTY,
      jsonKey: "frequency_penalty",
    },
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.PRESENCE_PENALTY,
      jsonKey: "presence_penalty",
    },
    {
      key: OptionKeys.REASONING_EFFORT,
      jsonKey: "reasoning_effort",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  openrouter: [
    {
      key: OptionKeys.FREQUENCY_PENALTY,
      jsonKey: "frequency_penalty",
    },
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.PRESENCE_PENALTY,
      jsonKey: "presence_penalty",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_K,
      jsonKey: "top_k",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  perplexity: [
    {
      key: OptionKeys.FREQUENCY_PENALTY,
      jsonKey: "frequency_penalty",
    },
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.PRESENCE_PENALTY,
      jsonKey: "presence_penalty",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  qwen: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_K,
      jsonKey: "top_k",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  sambanova: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  together: [
    {
      key: OptionKeys.FREQUENCY_PENALTY,
      jsonKey: "frequency_penalty",
    },
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.PRESENCE_PENALTY,
      jsonKey: "presence_penalty",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_K,
      jsonKey: "top_k",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  vertex: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
  ],
  vllm: [
    {
      key: OptionKeys.FREQUENCY_PENALTY,
      jsonKey: "frequency_penalty",
    },
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.PRESENCE_PENALTY,
      jsonKey: "presence_penalty",
    },
    {
      key: OptionKeys.SEED,
      jsonKey: "seed",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_K,
      jsonKey: "top_k",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  yi: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
  zhipu: [
    {
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_tokens",
    },
    {
      key: OptionKeys.STOP_SEQUENCES,
      jsonKey: "stop",
    },
    {
      key: OptionKeys.TEMPERATURE,
      jsonKey: "temperature",
    },
    {
      key: OptionKeys.TOP_P,
      jsonKey: "top_p",
    },
  ],
};

const OPTION_OVERRIDES: Record<ProviderName, readonly OptionOverrideDef[]> = {
  ai21: [
  ],
  anthropic: [
    {
      key: OptionKeys.REASONING_EFFORT,
      jsonKey: "output_config.effort",
      allowedValues: ["low", "medium", "high", "xhigh", "max"],
      extraFieldsJson: "",
      rootExtraFieldsJson: "{\"thinking\":{\"type\":\"adaptive\"}}",
    },
    {
      key: OptionKeys.THINKING_BUDGET,
      jsonKey: "thinking.budget_tokens",
      allowedValues: [],
      extraFieldsJson: "{\"type\":\"enabled\"}",
      rootExtraFieldsJson: "",
    },
  ],
  azure: [
  ],
  bedrock: [
  ],
  cerebras: [
  ],
  cohere: [
  ],
  deepseek: [
  ],
  doubao: [
  ],
  ernie: [
  ],
  fireworks: [
  ],
  google: [
    {
      key: OptionKeys.REASONING_EFFORT,
      jsonKey: "thinkingConfig.thinkingLevel",
      allowedValues: ["low", "high"],
      extraFieldsJson: "",
      rootExtraFieldsJson: "",
    },
  ],
  grok: [
  ],
  groq: [
  ],
  jan: [
  ],
  llamacpp: [
  ],
  lmstudio: [
  ],
  minimax: [
  ],
  mistral: [
  ],
  moonshot: [
  ],
  ollama: [
  ],
  openai: [
    {
      key: OptionKeys.REASONING_EFFORT,
      jsonKey: "reasoning_effort",
      allowedValues: ["low", "medium", "high"],
      extraFieldsJson: "",
      rootExtraFieldsJson: "",
    },
  ],
  openrouter: [
  ],
  perplexity: [
  ],
  qwen: [
  ],
  sambanova: [
  ],
  together: [
  ],
  vertex: [
  ],
  vllm: [
  ],
  yi: [
  ],
  zhipu: [
  ],
};

export interface ModelOptionOverrideDef {
  matcherKind: "id" | "pattern";
  matcherValue: string;
  key: OptionKey;
  jsonKey: string;
}

const MODEL_OPTION_OVERRIDES: Record<ProviderName, readonly ModelOptionOverrideDef[]> = {
  ai21: [
  ],
  anthropic: [
  ],
  azure: [
  ],
  bedrock: [
  ],
  cerebras: [
  ],
  cohere: [
  ],
  deepseek: [
  ],
  doubao: [
  ],
  ernie: [
  ],
  fireworks: [
  ],
  google: [
  ],
  grok: [
  ],
  groq: [
  ],
  jan: [
  ],
  llamacpp: [
  ],
  lmstudio: [
  ],
  minimax: [
  ],
  mistral: [
  ],
  moonshot: [
  ],
  ollama: [
  ],
  openai: [
    {
      matcherKind: "pattern",
      matcherValue: "gpt-5*",
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_completion_tokens",
    },
    {
      matcherKind: "pattern",
      matcherValue: "o*",
      key: OptionKeys.MAX_TOKENS,
      jsonKey: "max_completion_tokens",
    },
  ],
  openrouter: [
  ],
  perplexity: [
  ],
  qwen: [
  ],
  sambanova: [
  ],
  together: [
  ],
  vertex: [
  ],
  vllm: [
  ],
  yi: [
  ],
  zhipu: [
  ],
};

export function supportedOptions(provider: ProviderName): readonly SupportedOptionDef[] {
  return SUPPORTED_OPTIONS[provider];
}

export function optionOverrides(provider: ProviderName): readonly OptionOverrideDef[] {
  return OPTION_OVERRIDES[provider];
}

export function modelOptionOverrides(provider: ProviderName): readonly ModelOptionOverrideDef[] {
  return MODEL_OPTION_OVERRIDES[provider];
}
