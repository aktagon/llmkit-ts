// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";
import { Capabilities, type Capability } from "../types.ts";

// ProviderInfo is WHAT a user wants to know about a provider [PUBLIC]: the
// narrow, stable catalogue (typed identity, env var, default model, base URL).
// A projection of the same provider facts that feed the internal ProviderSpec,
// so the two cannot drift.
export interface ProviderInfo {
  id: ProviderName; // typed identity (ADR-040)
  slug: string; // the slug; equal to id
  envVar: string;
  defaultModel: string;
  baseUrl: string;
  browserCallable: boolean; // ADR-035: host serves CORS for direct browser calls (coarse)
  // What the provider offers, from its stated capabilities; Catalogue is not listed.
  capabilities: readonly Capability[];
}

const PROVIDER_INFO: Record<ProviderName, ProviderInfo> = {
  ai21: {
    id: "ai21",
    slug: "ai21",
    envVar: "AI21_API_KEY",
    defaultModel: "jamba-1.5-large",
    baseUrl: "https://api.ai21.com",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion],
  },
  anthropic: {
    id: "anthropic",
    slug: "anthropic",
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-6",
    baseUrl: "https://api.anthropic.com",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling],
  },
  assemblyai: {
    id: "assemblyai",
    slug: "assemblyai",
    envVar: "ASSEMBLYAI_API_KEY",
    defaultModel: "best",
    baseUrl: "https://api.assemblyai.com",
    browserCallable: false,
    capabilities: [Capabilities.Transcription],
  },
  azure: {
    id: "azure",
    slug: "azure",
    envVar: "AZURE_OPENAI_API_KEY",
    defaultModel: "gpt-4o",
    baseUrl: "https://{resource}.openai.azure.com",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion],
  },
  bedrock: {
    id: "bedrock",
    slug: "bedrock",
    envVar: "AWS_ACCESS_KEY_ID",
    defaultModel: "anthropic.claude-sonnet-4-20250514-v1:0",
    baseUrl: "https://bedrock-runtime.{region}.amazonaws.com",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.VideoGeneration],
  },
  cerebras: {
    id: "cerebras",
    slug: "cerebras",
    envVar: "CEREBRAS_API_KEY",
    defaultModel: "gpt-oss-120b",
    baseUrl: "https://api.cerebras.ai",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling],
  },
  cohere: {
    id: "cohere",
    slug: "cohere",
    envVar: "COHERE_API_KEY",
    defaultModel: "command-r-plus",
    baseUrl: "https://api.cohere.com/compatibility",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion],
  },
  deepseek: {
    id: "deepseek",
    slug: "deepseek",
    envVar: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling],
  },
  doubao: {
    id: "doubao",
    slug: "doubao",
    envVar: "ARK_API_KEY",
    defaultModel: "doubao-1.5-pro-32k-250115",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion],
  },
  ernie: {
    id: "ernie",
    slug: "ernie",
    envVar: "QIANFAN_API_KEY",
    defaultModel: "ernie-4.0-8k",
    baseUrl: "https://qianfan.baidubce.com/v2",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion],
  },
  fireworks: {
    id: "fireworks",
    slug: "fireworks",
    envVar: "FIREWORKS_API_KEY",
    defaultModel: "accounts/fireworks/models/gpt-oss-120b",
    baseUrl: "https://api.fireworks.ai/inference",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling],
  },
  google: {
    id: "google",
    slug: "google",
    envVar: "GOOGLE_API_KEY",
    defaultModel: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com",
    browserCallable: true,
    capabilities: [Capabilities.ChatCompletion, Capabilities.ImageGeneration, Capabilities.ToolCalling, Capabilities.Reasoning, Capabilities.SpeechGeneration, Capabilities.MusicGeneration, Capabilities.VideoGeneration],
  },
  grok: {
    id: "grok",
    slug: "grok",
    envVar: "XAI_API_KEY",
    defaultModel: "grok-3-fast",
    baseUrl: "https://api.x.ai",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.ImageGeneration, Capabilities.ToolCalling, Capabilities.SpeechGeneration, Capabilities.VideoGeneration],
  },
  groq: {
    id: "groq",
    slug: "groq",
    envVar: "GROQ_API_KEY",
    defaultModel: "openai/gpt-oss-120b",
    baseUrl: "https://api.groq.com/openai",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling],
  },
  inworld: {
    id: "inworld",
    slug: "inworld",
    envVar: "INWORLD_API_KEY",
    defaultModel: "inworld-tts-2",
    baseUrl: "https://api.inworld.ai",
    browserCallable: false,
    capabilities: [Capabilities.SpeechGeneration],
  },
  jan: {
    id: "jan",
    slug: "jan",
    envVar: "JAN_API_KEY",
    defaultModel: "",
    baseUrl: "http://localhost:1337",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion],
  },
  llamacpp: {
    id: "llamacpp",
    slug: "llamacpp",
    envVar: "LLAMACPP_API_KEY",
    defaultModel: "",
    baseUrl: "http://localhost:8080",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion],
  },
  lmstudio: {
    id: "lmstudio",
    slug: "lmstudio",
    envVar: "LM_STUDIO_API_KEY",
    defaultModel: "",
    baseUrl: "http://localhost:1234",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion],
  },
  minimax: {
    id: "minimax",
    slug: "minimax",
    envVar: "MINIMAX_API_KEY",
    defaultModel: "MiniMax-Text-01",
    baseUrl: "https://api.minimax.chat",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.SpeechGeneration, Capabilities.MusicGeneration, Capabilities.VideoGeneration],
  },
  mistral: {
    id: "mistral",
    slug: "mistral",
    envVar: "MISTRAL_API_KEY",
    defaultModel: "mistral-large-latest",
    baseUrl: "https://api.mistral.ai",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling],
  },
  moonshot: {
    id: "moonshot",
    slug: "moonshot",
    envVar: "MOONSHOT_API_KEY",
    defaultModel: "kimi-k2.6",
    baseUrl: "https://api.moonshot.ai",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling],
  },
  ollama: {
    id: "ollama",
    slug: "ollama",
    envVar: "OLLAMA_API_KEY",
    defaultModel: "",
    baseUrl: "http://localhost:11434",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion],
  },
  openai: {
    id: "openai",
    slug: "openai",
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-2024-08-06",
    baseUrl: "https://api.openai.com",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.ImageGeneration, Capabilities.ToolCalling, Capabilities.Reasoning, Capabilities.SpeechGeneration, Capabilities.Transcription],
  },
  openrouter: {
    id: "openrouter",
    slug: "openrouter",
    envVar: "OPENROUTER_API_KEY",
    defaultModel: "openai/gpt-4o",
    baseUrl: "https://openrouter.ai/api",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.ImageGeneration, Capabilities.ToolCalling, Capabilities.SpeechGeneration, Capabilities.VideoGeneration],
  },
  perplexity: {
    id: "perplexity",
    slug: "perplexity",
    envVar: "PERPLEXITY_API_KEY",
    defaultModel: "sonar-pro",
    baseUrl: "https://api.perplexity.ai",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion],
  },
  pixverse: {
    id: "pixverse",
    slug: "pixverse",
    envVar: "PIXVERSE_API_KEY",
    defaultModel: "v4.5",
    baseUrl: "https://app-api.pixverse.ai",
    browserCallable: false,
    capabilities: [Capabilities.VideoGeneration],
  },
  qwen: {
    id: "qwen",
    slug: "qwen",
    envVar: "DASHSCOPE_API_KEY",
    defaultModel: "qwen-plus",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling, Capabilities.VideoGeneration],
  },
  recraft: {
    id: "recraft",
    slug: "recraft",
    envVar: "RECRAFT_API_TOKEN",
    defaultModel: "recraftv3",
    baseUrl: "https://external.api.recraft.ai",
    browserCallable: false,
    capabilities: [Capabilities.ImageGeneration],
  },
  sambanova: {
    id: "sambanova",
    slug: "sambanova",
    envVar: "SAMBANOVA_API_KEY",
    defaultModel: "Meta-Llama-3.3-70B-Instruct",
    baseUrl: "https://api.sambanova.ai",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion],
  },
  together: {
    id: "together",
    slug: "together",
    envVar: "TOGETHER_API_KEY",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    baseUrl: "https://api.together.xyz",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling, Capabilities.VideoGeneration],
  },
  vertex: {
    id: "vertex",
    slug: "vertex",
    envVar: "VERTEX_BEARER_TOKEN",
    defaultModel: "lyria-002",
    baseUrl: "https://{location}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/publishers/google/models",
    browserCallable: false,
    capabilities: [Capabilities.MusicGeneration, Capabilities.VideoGeneration],
  },
  vidu: {
    id: "vidu",
    slug: "vidu",
    envVar: "VIDU_API_KEY",
    defaultModel: "viduq3-pro",
    baseUrl: "https://api.vidu.com",
    browserCallable: false,
    capabilities: [Capabilities.VideoGeneration],
  },
  vllm: {
    id: "vllm",
    slug: "vllm",
    envVar: "VLLM_API_KEY",
    defaultModel: "",
    baseUrl: "http://localhost:8000",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion],
  },
  workersai: {
    id: "workersai",
    slug: "workersai",
    envVar: "CLOUDFLARE_API_TOKEN",
    defaultModel: "@cf/meta/llama-3.1-8b-instruct",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion],
  },
  yi: {
    id: "yi",
    slug: "yi",
    envVar: "YI_API_KEY",
    defaultModel: "yi-large",
    baseUrl: "https://api.01.ai",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion],
  },
  zhipu: {
    id: "zhipu",
    slug: "zhipu",
    envVar: "ZHIPU_API_KEY",
    defaultModel: "glm-4-plus",
    baseUrl: "https://open.bigmodel.cn/api/paas",
    browserCallable: false,
    capabilities: [Capabilities.ChatCompletion, Capabilities.VideoGeneration],
  },
};

// info returns the public metadata for a provider. Keyed by the typed
// identity, it is honestly total over ProviderName (ADR-040 PSR-001).
export function info(provider: ProviderName): ProviderInfo {
  return PROVIDER_INFO[provider];
}

// list returns the public metadata for every provider, sorted by slug.
export function list(): ProviderInfo[] {
  return Object.values(PROVIDER_INFO).sort((a, b) => a.slug.localeCompare(b.slug));
}

// parse is the single fallible slug -> ProviderName boundary (ADR-040
// PSR-003): undefined when slug names no known provider.
export function parse(slug: string): ProviderName | undefined {
  return Object.prototype.hasOwnProperty.call(PROVIDER_INFO, slug)
    ? (slug as ProviderName)
    : undefined;
}
