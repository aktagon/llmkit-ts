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
import { buildAuthHeaders } from "../request.ts";
import type { Part } from "../image.ts";
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
    const cfg = PROVIDERS[this.provider.name];
    if (!cfg) {
      throw new ValidationError("provider", `unknown: ${this.provider.name}`);
    }
    const tcCfg = transcriptionConfig(this.provider.name);
    if (!tcCfg) {
      throw new ValidationError(
        "provider",
        `${this.provider.name} does not support transcription`,
      );
    }

    const base = transcriptionBaseUrl(this.provider, cfg);
    const headers = buildAuthHeaders(this.provider, cfg);
    const pollUrl = base + tcCfg.pollEndpoint.replace("{id}", this.id);

    const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeout = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    const deadline = performance.now() + timeout;

    while (true) {
      if (performance.now() > deadline) {
        throw new APIError(
          0,
          `transcription poll: timed out waiting for ${this.id}`,
          false,
        );
      }
      const respText = await fetchText(pollUrl, headers);
      const raw = JSON.parse(respText) as Record<string, unknown>;
      const status = lookupHandleField(raw, tcCfg.statusPath);
      if (status === tcCfg.doneStatus) {
        return transcriptionResult(tcCfg, raw);
      }
      if (status === tcCfg.errorStatus) {
        let msg = lookupHandleField(raw, cfg.errorMessagePath);
        if (!msg) msg = "transcription failed";
        throw new APIError(0, `transcription failed: ${msg}`, false);
      }
      //
      await sleep(interval);
    }
  }
}









export async function transcriptionSubmit(
  b: Transcription,
  ...audioParts: Part[]
): Promise<TranscriptionHandle> {
  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
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

  const { url, bytes } = normalizeAudioPart(audioParts);

  const base = transcriptionBaseUrl(provider, cfg);
  const headers = buildAuthHeaders(provider, cfg);

  //
  //
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
): Promise<string> {
  const resp = await fetch(url, { headers });
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
