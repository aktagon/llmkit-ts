// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";

//
//
//
export interface ProviderInfo {
  name: string;
  envVar: string;
  defaultModel: string;
  baseUrl: string;
}

const PROVIDER_INFO: Record<ProviderName, ProviderInfo> = {
  ai21: {
    name: "ai21",
    envVar: "AI21_API_KEY",
    defaultModel: "jamba-1.5-large",
    baseUrl: "https://api.ai21.com",
  },
  anthropic: {
    name: "anthropic",
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-6",
    baseUrl: "https://api.anthropic.com",
  },
  azure: {
    name: "azure",
    envVar: "AZURE_OPENAI_API_KEY",
    defaultModel: "gpt-4o",
    baseUrl: "https://REPLACE-WITH-YOUR-RESOURCE.openai.azure.com",
  },
  bedrock: {
    name: "bedrock",
    envVar: "AWS_ACCESS_KEY_ID",
    defaultModel: "anthropic.claude-sonnet-4-20250514-v1:0",
    baseUrl: "https://bedrock-runtime.{region}.amazonaws.com",
  },
  cerebras: {
    name: "cerebras",
    envVar: "CEREBRAS_API_KEY",
    defaultModel: "llama-3.3-70b",
    baseUrl: "https://api.cerebras.ai",
  },
  cohere: {
    name: "cohere",
    envVar: "COHERE_API_KEY",
    defaultModel: "command-r-plus",
    baseUrl: "https://api.cohere.com/compatibility",
  },
  deepseek: {
    name: "deepseek",
    envVar: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
  },
  doubao: {
    name: "doubao",
    envVar: "ARK_API_KEY",
    defaultModel: "doubao-1.5-pro-32k-250115",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  },
  ernie: {
    name: "ernie",
    envVar: "QIANFAN_API_KEY",
    defaultModel: "ernie-4.0-8k",
    baseUrl: "https://qianfan.baidubce.com/v2",
  },
  fireworks: {
    name: "fireworks",
    envVar: "FIREWORKS_API_KEY",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    baseUrl: "https://api.fireworks.ai/inference",
  },
  google: {
    name: "google",
    envVar: "GOOGLE_API_KEY",
    defaultModel: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com",
  },
  grok: {
    name: "grok",
    envVar: "XAI_API_KEY",
    defaultModel: "grok-3-fast",
    baseUrl: "https://api.x.ai",
  },
  groq: {
    name: "groq",
    envVar: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
    baseUrl: "https://api.groq.com/openai",
  },
  jan: {
    name: "jan",
    envVar: "JAN_API_KEY",
    defaultModel: "",
    baseUrl: "http://localhost:1337",
  },
  llamacpp: {
    name: "llamacpp",
    envVar: "LLAMACPP_API_KEY",
    defaultModel: "",
    baseUrl: "http://localhost:8080",
  },
  lmstudio: {
    name: "lmstudio",
    envVar: "LM_STUDIO_API_KEY",
    defaultModel: "",
    baseUrl: "http://localhost:1234",
  },
  minimax: {
    name: "minimax",
    envVar: "MINIMAX_API_KEY",
    defaultModel: "MiniMax-Text-01",
    baseUrl: "https://api.minimax.chat",
  },
  mistral: {
    name: "mistral",
    envVar: "MISTRAL_API_KEY",
    defaultModel: "mistral-large-latest",
    baseUrl: "https://api.mistral.ai",
  },
  moonshot: {
    name: "moonshot",
    envVar: "MOONSHOT_API_KEY",
    defaultModel: "moonshot-v1-8k",
    baseUrl: "https://api.moonshot.ai",
  },
  ollama: {
    name: "ollama",
    envVar: "OLLAMA_API_KEY",
    defaultModel: "",
    baseUrl: "http://localhost:11434",
  },
  openai: {
    name: "openai",
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-2024-08-06",
    baseUrl: "https://api.openai.com",
  },
  openrouter: {
    name: "openrouter",
    envVar: "OPENROUTER_API_KEY",
    defaultModel: "openai/gpt-4o",
    baseUrl: "https://openrouter.ai/api",
  },
  perplexity: {
    name: "perplexity",
    envVar: "PERPLEXITY_API_KEY",
    defaultModel: "sonar-pro",
    baseUrl: "https://api.perplexity.ai",
  },
  qwen: {
    name: "qwen",
    envVar: "DASHSCOPE_API_KEY",
    defaultModel: "qwen-plus",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode",
  },
  sambanova: {
    name: "sambanova",
    envVar: "SAMBANOVA_API_KEY",
    defaultModel: "Meta-Llama-3.3-70B-Instruct",
    baseUrl: "https://api.sambanova.ai",
  },
  together: {
    name: "together",
    envVar: "TOGETHER_API_KEY",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    baseUrl: "https://api.together.xyz",
  },
  vertex: {
    name: "vertex",
    envVar: "VERTEX_BEARER_TOKEN",
    defaultModel: "imagen-3.0-generate-002",
    baseUrl: "https://{location}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/publishers/google/models",
  },
  vllm: {
    name: "vllm",
    envVar: "VLLM_API_KEY",
    defaultModel: "",
    baseUrl: "http://localhost:8000",
  },
  yi: {
    name: "yi",
    envVar: "YI_API_KEY",
    defaultModel: "yi-large",
    baseUrl: "https://api.01.ai",
  },
  zhipu: {
    name: "zhipu",
    envVar: "ZHIPU_API_KEY",
    defaultModel: "glm-4-plus",
    baseUrl: "https://open.bigmodel.cn/api/paas",
  },
};

//
export function info(provider: ProviderName): ProviderInfo {
  return PROVIDER_INFO[provider];
}

//
export function list(): ProviderInfo[] {
  return Object.values(PROVIDER_INFO).sort((a, b) => a.name.localeCompare(b.name));
}
