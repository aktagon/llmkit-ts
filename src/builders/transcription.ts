// Owns Transcription.submit translation + the TranscriptionHandle poll loop
// (ADR-048). Mirror of go/transcription.go + go/transcription_builder.go.
//
// The typed-builder `submit` method is the only public entry point for
// transcription submission; the internal transcriptionSubmit helper here holds
// the runtime (the upload hop, submit, and the poll loop).
//
// TranscriptionHandle is promoted from a plain interface (generated structs.ts)
// to a class here so the async-handle API can offer `.wait()` as a method —
// matching Go's `TranscriptionHandle.Wait` value-receiver shape, exactly as
// VideoHandle (ADR-034) does in video.ts. The class fields (id, provider)
// preserve the generated value shape, so cross-process callers can reconstruct
// a handle via `new TranscriptionHandle(id, provider)`.

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
import type { MediaRef, Part } from "../image.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { Provider } from "../types.ts";
import type {
  TranscriptionResponse,
  TranscriptSegment,
} from "../structs.ts";
import type { Transcription } from "./builders.ts";

// Default poll cadence for TranscriptionHandle.wait. AssemblyAI jobs run from
// seconds to minutes; the poll loop checks every pollIntervalMs until
// pollTimeoutMs elapses. Both are overridable per call (so tests can run fast);
// the generated-struct value carries no timers. Mirror of go/transcription.go
// transcriptionPollInterval / transcriptionPollTimeout.
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export interface TranscriptionWaitOptions {
  pollIntervalMs?: number;
  /**
   * pollTimeoutMs is the OVERALL poll-loop wall-clock backstop for wait() — NOT a
   * per-request HTTP timeout (S05). When it fires, wait() throws PollTimeoutError.
   * poll() never times out (one round-trip), so it ignores this.
   */
  pollTimeoutMs?: number;
  /**
   * signal aborts a blocking wait() / poll() early (S06). Maps 1:1 to Go's
   * context.Context — the poll loop rejects with the abort reason when signalled.
   */
  signal?: AbortSignal;
}

export class TranscriptionHandle {
  id: string;
  provider: Provider;

  constructor(id: string, provider: Provider) {
    this.id = id;
    this.provider = provider;
  }

  /**
   * Polls the provider until the transcription job reaches a terminal state,
   * then resolves with the finished TranscriptionResponse. A status=error job
   * rejects with an Error carrying the provider's error message (never a silent
   * empty success); the deadline backstop rejects with PollTimeoutError
   * (POLL-008). Now a thin loop over the shared job engine (ADR-062) — pollJob
   * owns the loop, deadline, and state machine. Mirror of go/transcription.go
   * TranscriptionHandle.Wait.
   */
  async wait(
    options: TranscriptionWaitOptions = {},
  ): Promise<TranscriptionResponse> {
    const adapter = newTranscriptionAdapter(this, options);
    return pollJob<TranscriptionResponse>(adapter, options.signal);
  }

  /**
   * poll performs exactly ONE provider round-trip and returns the normalized
   * JobStatus (ADR-063 POLL-001) — the non-blocking primitive for callers driving
   * their own poll loop. On a completed job JobStatus.result carries the finished
   * TranscriptionResponse; a failed job populates JobStatus.cause (the provider
   * error surfaces in cause.message, preserving the wait() error surface).
   * Safe on a reconstituted handle (ADR-014 cross-process resume; POLL-005).
   */
  async poll(
    options: TranscriptionWaitOptions = {},
  ): Promise<JobStatus<TranscriptionResponse>> {
    const adapter = newTranscriptionAdapter(this, options);
    return pollOnce<TranscriptionResponse>(adapter, options.signal);
  }
}

// TranscriptionJobAdapter binds async transcription to the job engine's seams.
// classify uses the config-backed default (status vs doneStatus / errorStatus);
// result decodes the finished transcript per wire shape (no second hop). Mirror of
// go/transcription.go transcriptionAdapter.
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

// newTranscriptionAdapter assembles the transcription adapter + its
// LifecycleConfig from today's transcription facts. The status-to-terminal mapping
// stays config (statusPath / doneStatus / errorStatus, STT-005); the provider
// error message rides on cfg.errorMessagePath so wait() still surfaces it (S02).
// Mirror of go/transcription.go newTranscriptionAdapter.
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

/**
 * transcriptionSubmit submits an asynchronous speech-to-text job and returns a
 * TranscriptionHandle immediately. Poll the handle with wait(). Pre-flight
 * validation rejects an input that is not exactly one audio Part before any
 * HTTP call (STT-003). For an audioBytes part the runtime performs the upload
 * hop (POST the raw bytes, read upload_url) before submitting (STT-005).
 * Mirror of go/transcription.go submitTranscription + the Submit terminal.
 */
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
  // A synchronous provider has no job handle; Submit/Wait is the wrong terminal
  // for it (ADR-051 OAA-003). Name the supported one.
  if (tcCfg.interaction === "sync") {
    throw new ValidationError(
      "interaction",
      `${provider.name} transcribes synchronously; use Transcribe, not Submit/Wait`,
    );
  }

  const { url, bytes } = normalizeAudioPart(audioParts);

  const base = transcriptionBaseUrl(provider, cfg);
  const headers = buildAuthHeaders(provider, cfg);

  // Upload hop (STT-005): a bytes part is uploaded first to obtain a URL the
  // submit body can reference. URL parts skip this entirely.
  let audioURL = url;
  if (bytes) {
    if (!tcCfg.uploadEndpoint) {
      throw new ValidationError(
        "parts",
        `${provider.name} does not accept audio bytes; pass a public audio URL`,
      );
    }
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
  return new TranscriptionHandle(id, provider);
}

/**
 * transcriptionTranscribe runs a SYNCHRONOUS speech-to-text request (ADR-051):
 * one multipart/form-data POST returns the transcript directly, no job handle.
 * Pre-flight rejects a non-sync provider (naming Submit/Wait), a missing model,
 * a remote audio URL (OpenAI ingests inline bytes only — the inverse of
 * AssemblyAI, OAA-005), and a non-single-audio-bytes input. Mirror of
 * go/transcription.go transcribeSync + the Transcribe terminal.
 */
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
  // An async provider has no synchronous terminal; Submit/Wait is its surface.
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

  // Build the multipart body in FIXED field order (model, response_format,
  // file) so all four SDKs emit the same canonical descriptor. fetch sets the
  // multipart Content-Type + boundary from the FormData (do NOT set it here).
  const form = new FormData();
  form.append("model", b._model);
  form.append("response_format", "verbose_json");
  const mimeType = ref.mimeType || "application/octet-stream";
  const filename = "audio." + audioExtForMime(ref.mimeType);
  form.append("file", new Blob([ref.bytes], { type: mimeType }), filename);

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
  return transcriptionResultFromOpenAI(raw);
}

// transcriptionResultFromOpenAI extracts the transcript text and (when present)
// segment timings from a synchronous OpenAI response. verbose_json offsets are
// SECONDS (float) -> integer milliseconds (x1000, rounded, OAA-006). Models
// without segments[] (gpt-4o-*-transcribe) -> empty segments, not an error.
// Usage stays zero pending a live-verified envelope (OAA-007).
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
    usage: {
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
      reasoning: 0,
      cost: 0,
    },
  };
}

// normalizeAudioBytesPart enforces the single-audio-part rule for the sync path
// (OAA-005): exactly one inline-bytes audio Part. A remote URL is rejected
// (OpenAI ingests no URL — inverse of AssemblyAI). Mirror of go normalizeAudioBytesPart.
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

// audioExtForMime maps an audio IANA media type to the file extension OpenAI
// uses to detect the format. Mirror of go audioExtForMime.
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

// transcriptionResult extracts the finished transcript per wire shape. Only the
// result decode is wire-shape-keyed (STT-005); the submit/poll/status facts are
// config. Mirror of go/transcription.go transcriptionResult.
function transcriptionResult(
  tcCfg: TranscriptionDef,
  raw: Record<string, unknown>,
): TranscriptionResponse {
  switch (tcCfg.wireShape) {
    case "TranscriptionAssemblyAI":
      return transcriptionResultFromAssemblyAI(raw);
    case "TranscriptionOpenAI":
      // OpenAI is synchronous (Transcribe); it is never polled, so the async
      // poll-result path is unreachable for it. Defensive throw.
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

// transcriptionResultFromAssemblyAI extracts the transcript text and word-level
// timing segments from a completed AssemblyAI transcript object. start/end are
// integer milliseconds; speaker is present only on diarized transcripts. Usage
// stays zero — AssemblyAI bills by audio duration, not tokens (ADR-048 OQ-2).
// Mirror of go/transcription.go transcriptionResultFromAssemblyAI.
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
    usage: {
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
      reasoning: 0,
      cost: 0,
    },
  };
}

// normalizeAudioPart enforces the single-audio-part rule (STT-003) and returns
// the audio source: a URL XOR raw bytes. A request with a non-audio part, or
// with anything other than exactly one audio part, is rejected pre-flight.
// Mirror of go/transcription.go normalizeAudioPart.
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

// transcriptionBaseUrl resolves the base for the transcription API: an explicit
// per-client override wins (tests point it at a mock; users at a proxy), else
// the provider's chat base. Submit/poll/upload endpoints are always relative
// paths joined to this base. Mirror of go/transcription.go transcriptionBaseURL.
function transcriptionBaseUrl(provider: Provider, cfg: ProviderSpec): string {
  return provider.baseUrl || cfg.baseUrl;
}

// lookupHandleField descends a dotted path (e.g. "id", "status", "error")
// through the decoded response, returning the leaf string or "".
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
