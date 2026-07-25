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

import { PROVIDERS } from "../providers/providers.ts";
import type { ProviderSpec } from "../providers/providers.ts";
import {
  type TranscriptionDef,
  transcriptionConfig,
} from "../providers/transcription_gen.ts";
import { APIError, ValidationError } from "../errors.ts";
import {
  classifyByConfig,
  nonEmptyValues,
  PollBody,
  pollJob,
  pollOnce,
  type Classification,
  type JobAdapter,
  type JobStatus,
  type LifecycleConfig,
} from "../job.ts";
import { buildAuthHeaders } from "../request.ts";
import { firePost, firePre } from "../middleware.ts";
import type { Event, MiddlewareFn } from "../providers/middleware.ts";
import type { MediaRef, Part } from "../image.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { Provider } from "../types.ts";
import type {
  TranscriptionResponse,
  TranscriptSegment,
} from "../structs.ts";
import type { Transcription } from "./builders.ts";

//
//
//
//
//
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export interface TranscriptionWaitOptions {
  pollIntervalMs?: number;





  pollTimeoutMs?: number;




  signal?: AbortSignal;
}

export class TranscriptionHandle {
  id: string;
  provider: Provider;

  constructor(id: string, provider: Provider) {
    this.id = id;
    this.provider = provider;
  }










  async wait(
    options: TranscriptionWaitOptions = {},
  ): Promise<TranscriptionResponse> {
    const adapter = newTranscriptionAdapter(this, options);
    return pollJob<TranscriptionResponse>(adapter, options.signal);
  }









  async poll(
    options: TranscriptionWaitOptions = {},
  ): Promise<JobStatus<TranscriptionResponse>> {
    const adapter = newTranscriptionAdapter(this, options);
    return pollOnce<TranscriptionResponse>(adapter, options.signal);
  }
}

//
//
//
//
class TranscriptionJobAdapter implements JobAdapter<TranscriptionResponse> {
  constructor(
    private readonly lc: LifecycleConfig,
    private readonly headers: Record<string, string>,
    private readonly pollUrl: string,
    private readonly tcCfg: TranscriptionDef,
  ) {}

  config(): LifecycleConfig {
    return this.lc;
  }

  async poll(signal?: AbortSignal): Promise<PollBody> {
    const text = await fetchText(this.pollUrl, this.headers, signal);
    return new PollBody(JSON.parse(text) as Record<string, unknown>);
  }

  classify(body: PollBody): Classification {
    return classifyByConfig(this.lc, body);
  }

  async result(body: PollBody): Promise<TranscriptionResponse> {
    return transcriptionResult(this.tcCfg, body.raw);
  }
}

//
//
//
//
//
function newTranscriptionAdapter(
  handle: TranscriptionHandle,
  options: TranscriptionWaitOptions,
): TranscriptionJobAdapter {
  const cfg = PROVIDERS[handle.provider.name];
  if (!cfg) {
    throw new ValidationError("provider", `unknown: ${handle.provider.name}`);
  }
  const tcCfg = transcriptionConfig(handle.provider.name);
  if (!tcCfg) {
    throw new ValidationError(
      "provider",
      `${handle.provider.name} does not support transcription`,
    );
  }

  const base = transcriptionBaseUrl(handle.provider, cfg);
  const headers = buildAuthHeaders(handle.provider, cfg);
  const pollUrl = base + tcCfg.pollEndpoint.replace("{id}", handle.id);

  const lc: LifecycleConfig = {
    noun: "transcription",
    statusPath: tcCfg.statusPath,
    doneValues: nonEmptyValues(tcCfg.doneStatus),
    errorValues: nonEmptyValues(tcCfg.errorStatus),
    errorMessagePath: cfg.errorMessagePath,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs: options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
  };
  return new TranscriptionJobAdapter(lc, headers, pollUrl, tcCfg);
}









export async function transcriptionSubmit(
  b: Transcription,
  ...audioParts: Part[]
): Promise<TranscriptionHandle> {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
    headers: b.client.provider.headers,
  };
  if (b.client.provider.baseUrl) {
    provider.baseUrl = b.client.provider.baseUrl;
  }

  const cfg = PROVIDERS[provider.name];
  if (!cfg) {
    throw new ValidationError("provider", `unknown: ${provider.name}`);
  }
  const tcCfg = transcriptionConfig(provider.name);
  if (!tcCfg) {
    throw new ValidationError(
      "provider",
      `${provider.name} does not support transcription`,
    );
  }
  //
  //
  if (tcCfg.interaction === "sync") {
    throw new ValidationError(
      "interaction",
      `${provider.name} transcribes synchronously; use Transcribe, not Submit/Wait`,
    );
  }

  const { url, bytes } = normalizeAudioPart(audioParts);

  //
  //
  if (bytes && !tcCfg.uploadEndpoint) {
    throw new ValidationError(
      "parts",
      `${provider.name} does not accept audio bytes; pass a public audio URL`,
    );
  }

  const base = transcriptionBaseUrl(provider, cfg);
  const headers = buildAuthHeaders(provider, cfg);

  const baseEvent: Event = {
    op: "transcription",
    phase: "pre",
    provider: provider.name,
    model: b._model,
  };
  const veto = firePre(b._middleware as MiddlewareFn[], baseEvent);
  if (veto) throw veto;
  const start = performance.now();

  try {
    const id = await dispatchTranscriptionSubmit(
      base,
      tcCfg,
      headers,
      url,
      bytes,
    );
    firePost(b._middleware as MiddlewareFn[], {
      ...baseEvent,
      duration: performance.now() - start,
    });
    return new TranscriptionHandle(id, provider);
  } catch (err) {
    firePost(b._middleware as MiddlewareFn[], {
      ...baseEvent,
      err: err instanceof Error ? err : new Error(String(err)),
      duration: performance.now() - start,
    });
    throw err;
  }
}







async function dispatchTranscriptionSubmit(
  base: string,
  tcCfg: TranscriptionDef,
  headers: Record<string, string>,
  audioUrl: string,
  bytes: Uint8Array | undefined,
): Promise<string> {
  //
  //
  let audioURL = audioUrl;
  if (bytes) {
    const uploadHeaders = {
      ...headers,
      "content-type": "application/octet-stream",
    };
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    const uploadResp = await fetch(base + tcCfg.uploadEndpoint, {
      method: "POST",
      headers: uploadHeaders,
      body: buf,
    });
    const uploadText = await uploadResp.text();
    if (!uploadResp.ok) {
      throw new APIError(
        uploadResp.status,
        uploadText,
        uploadResp.status === 429 || uploadResp.status >= 500,
      );
    }
    const up = JSON.parse(uploadText) as Record<string, unknown>;
    audioURL = lookupHandleField(up, "upload_url");
    if (!audioURL) {
      throw new APIError(
        0,
        "transcription upload: response carried no upload_url",
        false,
      );
    }
  }

  const submitText = await postJson(
    base + tcCfg.submitEndpoint,
    { audio_url: audioURL },
    headers,
  );
  const raw = JSON.parse(submitText) as Record<string, unknown>;
  const id = lookupHandleField(raw, tcCfg.submitHandleField);
  if (!id) {
    throw new APIError(
      0,
      `transcription submit: empty handle field ${tcCfg.submitHandleField}`,
      false,
    );
  }
  return id;
}









export async function transcriptionTranscribe(
  b: Transcription,
  ...audioParts: Part[]
): Promise<TranscriptionResponse> {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
    headers: b.client.provider.headers,
  };
  if (b.client.provider.baseUrl) {
    provider.baseUrl = b.client.provider.baseUrl;
  }

  const cfg = PROVIDERS[provider.name];
  if (!cfg) {
    throw new ValidationError("provider", `unknown: ${provider.name}`);
  }
  const tcCfg = transcriptionConfig(provider.name);
  if (!tcCfg) {
    throw new ValidationError(
      "provider",
      `${provider.name} does not support transcription`,
    );
  }
  //
  if (tcCfg.interaction !== "sync") {
    throw new ValidationError(
      "interaction",
      `${provider.name} transcribes asynchronously; use Submit/Wait, not Transcribe`,
    );
  }
  if (!b._model) {
    throw new ValidationError(
      "model",
      "required for synchronous transcription",
    );
  }
  const ref = normalizeAudioBytesPart(audioParts);

  const base = transcriptionBaseUrl(provider, cfg);
  const headers = buildAuthHeaders(provider, cfg);

  //
  //
  //
  const form = new FormData();
  form.append("model", b._model);
  form.append("response_format", "verbose_json");
  const mimeType = ref.mimeType || "application/octet-stream";
  const filename = "audio." + audioExtForMime(ref.mimeType);
  form.append("file", new Blob([ref.bytes], { type: mimeType }), filename);

  const baseEvent: Event = {
    op: "transcription",
    phase: "pre",
    provider: provider.name,
    model: b._model,
  };
  const veto = firePre(b._middleware as MiddlewareFn[], baseEvent);
  if (veto) throw veto;
  const start = performance.now();

  try {
    const resp = await fetch(base + tcCfg.submitEndpoint, {
      method: "POST",
      headers,
      body: form,
    });
    const respText = await resp.text();
    if (!resp.ok) {
      throw new APIError(
        resp.status,
        respText,
        resp.status === 429 || resp.status >= 500,
      );
    }
    const raw = JSON.parse(respText) as Record<string, unknown>;
    const result = transcriptionResultFromOpenAI(raw);
    firePost(b._middleware as MiddlewareFn[], {
      ...baseEvent,
      usage: result.usage,
      duration: performance.now() - start,
    });
    return result;
  } catch (err) {
    firePost(b._middleware as MiddlewareFn[], {
      ...baseEvent,
      err: err instanceof Error ? err : new Error(String(err)),
      duration: performance.now() - start,
    });
    throw err;
  }
}

//
//
//
//
//
function transcriptionResultFromOpenAI(
  raw: Record<string, unknown>,
): TranscriptionResponse {
  const text = typeof raw.text === "string" ? raw.text : "";
  const segs = Array.isArray(raw.segments) ? raw.segments : [];
  const segments: TranscriptSegment[] = [];
  for (const s of segs) {
    if (!s || typeof s !== "object") continue;
    const m = s as Record<string, unknown>;
    segments.push({
      text: typeof m.text === "string" ? m.text : "",
      start: typeof m.start === "number" ? Math.round(m.start * 1000) : 0,
      end: typeof m.end === "number" ? Math.round(m.end * 1000) : 0,
    });
  }
  return {
    text,
    segments,
    usage: {},
  };
}

//
//
//
function normalizeAudioBytesPart(parts: Part[]): MediaRef {
  let ref: MediaRef | undefined;
  let audioCount = 0;
  parts.forEach((part, i) => {
    if ("audioBytes" in part) {
      audioCount++;
      ref = part.audioBytes;
    } else if ("audio" in part) {
      throw new ValidationError(
        `parts[${i}]`,
        "synchronous transcription accepts inline audio bytes only (audioBytes); a remote audio URL is not supported",
      );
    } else if ("text" in part || "image" in part || "lyrics" in part) {
      throw new ValidationError(
        `parts[${i}]`,
        "transcription accepts only audio parts (audioBytes)",
      );
    } else {
      throw new ValidationError(`parts[${i}]`, "empty part");
    }
  });
  if (audioCount !== 1 || !ref) {
    throw new ValidationError(
      "parts",
      "transcription requires exactly one audio part",
    );
  }
  return ref;
}

//
//
function audioExtForMime(mime: string): string {
  switch (mime) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a":
      return "m4a";
    case "audio/webm":
      return "webm";
    case "audio/ogg":
    case "audio/opus":
      return "ogg";
    case "audio/flac":
      return "flac";
    default:
      return "bin";
  }
}

//
//
//
function transcriptionResult(
  tcCfg: TranscriptionDef,
  raw: Record<string, unknown>,
): TranscriptionResponse {
  switch (tcCfg.wireShape) {
    case "TranscriptionAssemblyAI":
      return transcriptionResultFromAssemblyAI(raw);
    case "TranscriptionOpenAI":
      //
      //
      throw new APIError(
        0,
        "transcription: TranscriptionOpenAI is synchronous and has no poll-result extraction",
        false,
      );
    default: {
      const _exhaustive: never = tcCfg.wireShape;
      throw new APIError(
        0,
        `transcription: unsupported wire shape ${String(_exhaustive)}`,
        false,
      );
    }
  }
}

//
//
//
//
//
function transcriptionResultFromAssemblyAI(
  raw: Record<string, unknown>,
): TranscriptionResponse {
  const text = typeof raw.text === "string" ? raw.text : "";
  const words = Array.isArray(raw.words) ? raw.words : [];
  const segments: TranscriptSegment[] = [];
  for (const w of words) {
    if (!w || typeof w !== "object") continue;
    const m = w as Record<string, unknown>;
    const seg: TranscriptSegment = {
      text: typeof m.text === "string" ? m.text : "",
      start: typeof m.start === "number" ? Math.trunc(m.start) : 0,
      end: typeof m.end === "number" ? Math.trunc(m.end) : 0,
    };
    if (typeof m.speaker === "string" && m.speaker) {
      seg.speaker = m.speaker;
    }
    segments.push(seg);
  }
  return {
    text,
    segments,
    usage: {},
  };
}

//
//
//
//
function normalizeAudioPart(parts: Part[]): {
  url: string;
  bytes?: Uint8Array;
} {
  let url = "";
  let bytes: Uint8Array | undefined;
  let audioCount = 0;
  parts.forEach((part, i) => {
    if ("audio" in part) {
      audioCount++;
      url = part.audio;
    } else if ("audioBytes" in part) {
      audioCount++;
      bytes = part.audioBytes.bytes;
    } else if ("text" in part || "image" in part || "lyrics" in part) {
      throw new ValidationError(
        `parts[${i}]`,
        "transcription accepts only audio parts (audio / audioBytes)",
      );
    } else {
      throw new ValidationError(`parts[${i}]`, "empty part");
    }
  });
  if (audioCount !== 1) {
    throw new ValidationError(
      "parts",
      "transcription requires exactly one audio part",
    );
  }
  return { url, bytes };
}

//
//
//
//
function transcriptionBaseUrl(provider: Provider, cfg: ProviderSpec): string {
  return provider.baseUrl || cfg.baseUrl;
}

//
//
function lookupHandleField(
  raw: Record<string, unknown>,
  path: string,
): string {
  if (!path) return "";
  let cur: unknown = raw;
  for (const seg of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return "";
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (typeof cur === "string") return cur;
  if (typeof cur === "number") return String(Math.trunc(cur));
  return "";
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<string> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new APIError(
      resp.status,
      text,
      resp.status === 429 || resp.status >= 500,
    );
  }
  return text;
}

async function fetchText(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<string> {
  const resp = await fetch(url, { headers, signal });
  const text = await resp.text();
  if (!resp.ok) {
    throw new APIError(
      resp.status,
      text,
      resp.status === 429 || resp.status >= 500,
    );
  }
  return text;
}
