// Code generated — DO NOT EDIT.

//
//
//
//
//
//

import type { Capability, SafetySetting, Tool } from "../types.ts";
import type { Part } from "../image.ts";
import type { AudioData, File, ImageData, ImageResponse, LiveResult, MediaRef, Message, ModelInfo, MusicResponse, Response, SpeechResponse, ToolCall, ToolResult, TranscriptSegment, TranscriptionResponse, VideoData, VideoResponse } from "../structs.ts";
import type { MiddlewareFn } from "../providers/middleware.ts";
import { batchConfig } from "../providers/batch.ts";
import { cachingConfig } from "../providers/caching.ts";
import { imageGenConfig } from "../providers/image_gen.ts";
import type { ProviderName } from "../providers/providers.ts";
import { fileUploadConfig } from "../providers/upload.ts";
import { BatchHandle } from "./batch.ts";
import { VideoHandle } from "./video.ts";
import { TranscriptionHandle } from "./transcription.ts";

//
//
export type { AudioData, File, ImageData, ImageResponse, LiveResult, MediaRef, Message, ModelInfo, MusicResponse, Response, SpeechResponse, ToolCall, ToolResult, TranscriptSegment, TranscriptionResponse, VideoData, VideoResponse, SafetySetting, Tool, Part, MiddlewareFn };
export { BatchHandle, VideoHandle, TranscriptionHandle };

export interface ProviderConfig {
  name: string;
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
}

function clone<T extends object>(b: T): T {
  return Object.assign(Object.create(Object.getPrototypeOf(b)), b) as T;
}

import { saveHistory, loadHistory } from "../wire.ts";
import { agentMessages, agentPrompt, agentReset } from "./agent.ts";
import { textBatch } from "./batch.ts";
import { imageGenerate } from "./image.ts";
import { musicGenerate } from "./music.ts";
import { speechGenerate } from "./speech.ts";
import { textStream } from "./stream.ts";
import { textPrompt } from "./text.ts";
import { transcriptionSubmit, transcriptionTranscribe } from "./transcription.ts";
import { uploadRun } from "./upload.ts";
import { videoSubmit } from "./video.ts";
import type { AgentState } from "./agent.ts";
import type { TextStream } from "./stream.ts";

import { Models, Providers } from "./catalogue.ts";

export class Client {
  provider: ProviderConfig;
  //
  //
  //
 _middleware: MiddlewareFn[] = [];
  text: Text;
  image: Image;
  music: Music;
  speech: Speech;
  transcription: Transcription;
  video: Video;
  agent: Agent;
  upload: Upload;
  models: Models;
  providers: Providers;

  constructor(name: ProviderName, apiKey: string) {
    this.provider = { name, apiKey };
    this.text = new Text(this);
    this.image = new Image(this);
    this.music = new Music(this);
    this.speech = new Speech(this);
    this.transcription = new Transcription(this);
    this.video = new Video(this);
    this.agent = new Agent(this);
    this.upload = new Upload(this);
    this.models = new Models(this);
    this.providers = new Providers(this);
  }


  addHeader(name: string, value: string): this { (this.provider.headers ??= {})[name] = value; return this; }


  baseURL(url: string): this { this.provider.baseUrl = url; return this; }








  supports(cap: Capability): boolean {
    const name = this.provider.name as ProviderName;
    switch (cap) {
      case "caching":
        return cachingConfig(name) !== undefined;
      case "batching":
        return batchConfig(name) !== undefined;
      case "file_upload":
        return fileUploadConfig(name) !== undefined;
      case "image_generation":
        return imageGenConfig(name) !== undefined;
      default:
        return true;
    }
  }
}

export function newClient(name: ProviderName, apiKey: string): Client {
  return new Client(name, apiKey);
}

//
export function ai21(apiKey: string): Client { return new Client("ai21", apiKey); }
export function anthropic(apiKey: string): Client { return new Client("anthropic", apiKey); }
export function assemblyai(apiKey: string): Client { return new Client("assemblyai", apiKey); }
export function azure(apiKey: string): Client { return new Client("azure", apiKey); }
export function bedrock(apiKey: string): Client { return new Client("bedrock", apiKey); }
export function cerebras(apiKey: string): Client { return new Client("cerebras", apiKey); }
export function cohere(apiKey: string): Client { return new Client("cohere", apiKey); }
export function deepseek(apiKey: string): Client { return new Client("deepseek", apiKey); }
export function doubao(apiKey: string): Client { return new Client("doubao", apiKey); }
export function ernie(apiKey: string): Client { return new Client("ernie", apiKey); }
export function fireworks(apiKey: string): Client { return new Client("fireworks", apiKey); }
export function google(apiKey: string): Client { return new Client("google", apiKey); }
export function grok(apiKey: string): Client { return new Client("grok", apiKey); }
export function groq(apiKey: string): Client { return new Client("groq", apiKey); }
export function inworld(apiKey: string): Client { return new Client("inworld", apiKey); }
export function jan(apiKey: string): Client { return new Client("jan", apiKey); }
export function llamacpp(apiKey: string): Client { return new Client("llamacpp", apiKey); }
export function lmstudio(apiKey: string): Client { return new Client("lmstudio", apiKey); }
export function minimax(apiKey: string): Client { return new Client("minimax", apiKey); }
export function mistral(apiKey: string): Client { return new Client("mistral", apiKey); }
export function moonshot(apiKey: string): Client { return new Client("moonshot", apiKey); }
export function ollama(apiKey: string): Client { return new Client("ollama", apiKey); }
export function openai(apiKey: string): Client { return new Client("openai", apiKey); }
export function openrouter(apiKey: string): Client { return new Client("openrouter", apiKey); }
export function perplexity(apiKey: string): Client { return new Client("perplexity", apiKey); }
export function pixverse(apiKey: string): Client { return new Client("pixverse", apiKey); }
export function qwen(apiKey: string): Client { return new Client("qwen", apiKey); }
export function recraft(apiKey: string): Client { return new Client("recraft", apiKey); }
export function sambanova(apiKey: string): Client { return new Client("sambanova", apiKey); }
export function together(apiKey: string): Client { return new Client("together", apiKey); }
export function vertex(apiKey: string): Client { return new Client("vertex", apiKey); }
export function vidu(apiKey: string): Client { return new Client("vidu", apiKey); }
export function vllm(apiKey: string): Client { return new Client("vllm", apiKey); }
export function workersai(apiKey: string): Client { return new Client("workersai", apiKey); }
export function yi(apiKey: string): Client { return new Client("yi", apiKey); }
export function zhipu(apiKey: string): Client { return new Client("zhipu", apiKey); }

//

export class Text {
 client: Client;
 _middleware: MiddlewareFn[] = [];
 _caching: boolean = false;
 _files: File[] = [];
 _frequencyPenalty?: number;
 _history: Message[] = [];
 _parts: Part[] = [];
 _maxTokens?: number;
 _model: string = "";
 _presencePenalty?: number;
 _protocol: string = "";
 _raw: boolean = false;
 _reasoningEffort: string = "";
 _safetySettings: SafetySetting[] = [];
 _schema: string = "";
 _seed?: number;
 _stopSequences: string[] = [];
 _system: string = "";
 _temperature?: number;
 _thinkingBudget?: number;
 _topK?: number;
 _topP?: number;

  constructor(client: Client) { this.client = client; }

  addMiddleware(...fns: MiddlewareFn[]): Text { const out = clone(this); out._middleware = [...out._middleware, ...fns]; return out; }
  caching(): Text { const out = clone(this); out._caching = true; return out; }
  file(id: string): Text { const out = clone(this); out._files = [...out._files, { id, uri: "", name: "", mimeType: "" }]; return out; }  // ordered
  frequencyPenalty(v: number): Text { const out = clone(this); out._frequencyPenalty = v; return out; }
  history(...msgs: Message[]): Text { const out = clone(this); out._history = msgs; return out; }
  image(mime: string, data: Uint8Array): Text { const out = clone(this); out._parts = [...out._parts, { image: { mimeType: mime, bytes: data } }]; return out; }  // ordered
  maxTokens(n: number): Text { const out = clone(this); out._maxTokens = n; return out; }
  model(name: string): Text { const out = clone(this); out._model = name; return out; }
  presencePenalty(v: number): Text { const out = clone(this); out._presencePenalty = v; return out; }
  protocol(name: string): Text { const out = clone(this); out._protocol = name; return out; }
  raw(): Text { const out = clone(this); out._raw = true; return out; }
  reasoningEffort(level: string): Text { const out = clone(this); out._reasoningEffort = level; return out; }
  safetySettings(s: SafetySetting[]): Text { const out = clone(this); out._safetySettings = s; return out; }
  schema(s: string): Text { const out = clone(this); out._schema = s; return out; }
  seed(n: number): Text { const out = clone(this); out._seed = n; return out; }
  stopSequences(...seqs: string[]): Text { const out = clone(this); out._stopSequences = seqs; return out; }
  system(s: string): Text { const out = clone(this); out._system = s; return out; }
  temperature(t: number): Text { const out = clone(this); out._temperature = t; return out; }
  text(s: string): Text { const out = clone(this); out._parts = [...out._parts, { text: s }]; return out; }  // ordered
  thinkingBudget(n: number): Text { const out = clone(this); out._thinkingBudget = n; return out; }
  topK(n: number): Text { const out = clone(this); out._topK = n; return out; }
  topP(v: number): Text { const out = clone(this); out._topP = v; return out; }
  async prompt(msg: string): Promise<Response> {
    return textPrompt(this, msg);
  }
  stream(msg: string): TextStream {
    return textStream(this, msg);
  }
  async batch(...prompts: string[]): Promise<BatchHandle> {
    return textBatch(this, ...prompts);
  }
}

//

export class Image {
 client: Client;
 _middleware: MiddlewareFn[] = [];
 _aspectRatio: string = "";
 _background: string = "";
 _count?: number;
 _parts: Part[] = [];
 _imageSize: string = "";
 _includeText: boolean = false;
 _mask?: MediaRef;
 _model: string = "";
 _outputFormat: string = "";
 _quality: string = "";
 _raw: boolean = false;
 _safetyFilter: string = "";
 _safetySettings: SafetySetting[] = [];
 _extraFields?: Record<string, unknown> | undefined;

  constructor(client: Client) { this.client = client; }

  addMiddleware(...fns: MiddlewareFn[]): Image { const out = clone(this); out._middleware = [...out._middleware, ...fns]; return out; }
  aspectRatio(r: string): Image { const out = clone(this); out._aspectRatio = r; return out; }
  background(s: string): Image { const out = clone(this); out._background = s; return out; }
  count(n: number): Image { const out = clone(this); out._count = n; return out; }
  image(mime: string, data: Uint8Array): Image { const out = clone(this); out._parts = [...out._parts, { image: { mimeType: mime, bytes: data } }]; return out; }  // ordered
  imageSize(s: string): Image { const out = clone(this); out._imageSize = s; return out; }
  includeText(): Image { const out = clone(this); out._includeText = true; return out; }
  mask(mime: string, data: Uint8Array): Image { const out = clone(this); out._mask = { mimeType: mime, bytes: data }; return out; }
  model(name: string): Image { const out = clone(this); out._model = name; return out; }
  outputFormat(s: string): Image { const out = clone(this); out._outputFormat = s; return out; }
  quality(s: string): Image { const out = clone(this); out._quality = s; return out; }
  raw(): Image { const out = clone(this); out._raw = true; return out; }
  safetyFilter(s: string): Image { const out = clone(this); out._safetyFilter = s; return out; }
  safetySettings(s: SafetySetting[]): Image { const out = clone(this); out._safetySettings = s; return out; }
  text(s: string): Image { const out = clone(this); out._parts = [...out._parts, { text: s }]; return out; }  // ordered
  extraFields(extras: Record<string, unknown>): Image { const out = clone(this); out._extraFields = { ...(this._extraFields ?? {}), ...extras }; return out; }
  async generate(msg: string): Promise<ImageResponse> {
    return imageGenerate(this, msg);
  }
}

//

export class Music {
 client: Client;
 _middleware: MiddlewareFn[] = [];
 _parts: Part[] = [];
 _model: string = "";
 _raw: boolean = false;

  constructor(client: Client) { this.client = client; }

  addMiddleware(...fns: MiddlewareFn[]): Music { const out = clone(this); out._middleware = [...out._middleware, ...fns]; return out; }
  lyrics(s: string): Music { const out = clone(this); out._parts = [...out._parts, { lyrics: s }]; return out; }  // ordered
  model(name: string): Music { const out = clone(this); out._model = name; return out; }
  raw(): Music { const out = clone(this); out._raw = true; return out; }
  text(s: string): Music { const out = clone(this); out._parts = [...out._parts, { text: s }]; return out; }  // ordered
  async generate(msg: string): Promise<MusicResponse> {
    return musicGenerate(this, msg);
  }
}

//

export class Speech {
 client: Client;
 _model: string = "";
 _voice: string = "";

  constructor(client: Client) { this.client = client; }

  model(name: string): Speech { const out = clone(this); out._model = name; return out; }
  voice(id: string): Speech { const out = clone(this); out._voice = id; return out; }
  async generate(msg: string): Promise<SpeechResponse> {
    return speechGenerate(this, msg);
  }
}

//

export class Transcription {
 client: Client;
 _model: string = "";

  constructor(client: Client) { this.client = client; }

  model(name: string): Transcription { const out = clone(this); out._model = name; return out; }
  async submit(...audioParts: Part[]): Promise<TranscriptionHandle> {
    return transcriptionSubmit(this, ...audioParts);
  }
  async transcribe(...audioParts: Part[]): Promise<TranscriptionResponse> {
    return transcriptionTranscribe(this, ...audioParts);
  }
}

//

export class Video {
 client: Client;
 _middleware: MiddlewareFn[] = [];
 _parts: Part[] = [];
 _model: string = "";
 _outputURI: string = "";
 _raw: boolean = false;

  constructor(client: Client) { this.client = client; }

  addMiddleware(...fns: MiddlewareFn[]): Video { const out = clone(this); out._middleware = [...out._middleware, ...fns]; return out; }
  image(mime: string, data: Uint8Array): Video { const out = clone(this); out._parts = [...out._parts, { image: { mimeType: mime, bytes: data } }]; return out; }  // ordered
  model(name: string): Video { const out = clone(this); out._model = name; return out; }
  outputURI(uri: string): Video { const out = clone(this); out._outputURI = uri; return out; }
  raw(): Video { const out = clone(this); out._raw = true; return out; }
  text(s: string): Video { const out = clone(this); out._parts = [...out._parts, { text: s }]; return out; }  // ordered
  async submit(msg: string): Promise<VideoHandle> {
    return videoSubmit(this, msg);
  }
}

//

export class Agent {
 client: Client;
 _middleware: MiddlewareFn[] = [];
 _tools: Tool[] = [];
 _caching: boolean = false;
 _frequencyPenalty?: number;
 _history: Message[] = [];
 _maxTokens?: number;
 _maxToolIterations?: number;
 _model: string = "";
 _presencePenalty?: number;
 _raw: boolean = false;
 _reasoningEffort: string = "";
 _safetySettings: SafetySetting[] = [];
 _seed?: number;
 _stopSequences: string[] = [];
 _system: string = "";
 _temperature?: number;
 _thinkingBudget?: number;
 _topK?: number;
 _topP?: number;
 _state?: AgentState;

  constructor(client: Client) { this.client = client; }

  addMiddleware(...fns: MiddlewareFn[]): Agent { const out = clone(this); out._middleware = [...out._middleware, ...fns]; out._state = undefined; return out; }
  addTool(t: Tool): Agent { const out = clone(this); out._tools = [...out._tools, t]; out._state = undefined; return out; }
  caching(): Agent { const out = clone(this); out._caching = true; out._state = undefined; return out; }
  frequencyPenalty(v: number): Agent { const out = clone(this); out._frequencyPenalty = v; out._state = undefined; return out; }
  history(...msgs: Message[]): Agent { const out = clone(this); out._history = msgs; out._state = undefined; return out; }
  maxTokens(n: number): Agent { const out = clone(this); out._maxTokens = n; out._state = undefined; return out; }
  maxToolIterations(n: number): Agent { const out = clone(this); out._maxToolIterations = n; out._state = undefined; return out; }
  model(name: string): Agent { const out = clone(this); out._model = name; out._state = undefined; return out; }
  presencePenalty(v: number): Agent { const out = clone(this); out._presencePenalty = v; out._state = undefined; return out; }
  raw(): Agent { const out = clone(this); out._raw = true; out._state = undefined; return out; }
  reasoningEffort(level: string): Agent { const out = clone(this); out._reasoningEffort = level; out._state = undefined; return out; }
  safetySettings(s: SafetySetting[]): Agent { const out = clone(this); out._safetySettings = s; out._state = undefined; return out; }
  seed(n: number): Agent { const out = clone(this); out._seed = n; out._state = undefined; return out; }
  stopSequences(...seqs: string[]): Agent { const out = clone(this); out._stopSequences = seqs; out._state = undefined; return out; }
  system(s: string): Agent { const out = clone(this); out._system = s; out._state = undefined; return out; }
  temperature(t: number): Agent { const out = clone(this); out._temperature = t; out._state = undefined; return out; }
  thinkingBudget(n: number): Agent { const out = clone(this); out._thinkingBudget = n; out._state = undefined; return out; }
  topK(n: number): Agent { const out = clone(this); out._topK = n; out._state = undefined; return out; }
  topP(v: number): Agent { const out = clone(this); out._topP = v; out._state = undefined; return out; }
  get messages(): readonly Message[] { return agentMessages(this); }

  save(): string { return saveHistory(this.messages); }

  load(data: string): Agent {
    const out = clone(this);
    out._history = loadHistory(data);
    out._state = undefined;
    return out;
  }
  async prompt(msg: string): Promise<Response> {
    return agentPrompt(this, msg);
  }
  reset(): void {
    return agentReset(this);
  }
}

//

export class Upload {
 client: Client;
 _middleware: MiddlewareFn[] = [];
 _bytes: Uint8Array = new Uint8Array(0);
 _filename: string = "";
 _mimeType: string = "";
 _path: string = "";

  constructor(client: Client) { this.client = client; }

  addMiddleware(...fns: MiddlewareFn[]): Upload { const out = clone(this); out._middleware = [...out._middleware, ...fns]; return out; }
  bytes(data: Uint8Array): Upload { const out = clone(this); out._bytes = data; return out; }
  filename(name: string): Upload { const out = clone(this); out._filename = name; return out; }
  mimeType(mime: string): Upload { const out = clone(this); out._mimeType = mime; return out; }
  path(p: string): Upload { const out = clone(this); out._path = p; return out; }
  async run(): Promise<File> {
    return uploadRun(this);
  }
}

