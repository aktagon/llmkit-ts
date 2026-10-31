// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";
import type { JobFailureCode } from "./batch.ts";

// Transcription wire-shape discriminators. Each selects the
// submit-body build + result-extraction transform.
export type TranscriptionWireShape = "TranscriptionAssemblyAI" | "TranscriptionOpenAI";

export interface TranscriptionDef {
  wireShape: TranscriptionWireShape;
  interaction: string; // "sync" | "async"
  requestEncoding: string; // "json" | "multipart"
  submitEndpoint: string;
  pollEndpoint: string; // template with {id}; async only
  uploadEndpoint: string; // local-bytes upload hop; "" = url-only / inline-bytes
  submitHandleField: string; // dotted path to the handle id; async only
  statusPath: string; // dotted path to the poll status string; async only
  doneStatus: string; // status value marking terminal success; async only
  errorStatus: string; // status value marking terminal failure; async only
  failureCodes: Readonly<Partial<Record<string, JobFailureCode>>>; // failure status -> code; async only
}

const TRANSCRIPTION_GEN: Partial<Record<ProviderName, TranscriptionDef>> = {
  assemblyai: {
    wireShape: "TranscriptionAssemblyAI",
    interaction: "async",
    requestEncoding: "json",
    submitEndpoint: "/v2/transcript",
    pollEndpoint: "/v2/transcript/{id}",
    uploadEndpoint: "/v2/upload",
    submitHandleField: "id",
    statusPath: "status",
    doneStatus: "completed",
    errorStatus: "error",
    failureCodes: { "error": "error" },
  },
  openai: {
    wireShape: "TranscriptionOpenAI",
    interaction: "sync",
    requestEncoding: "multipart",
    submitEndpoint: "/v1/audio/transcriptions",
    pollEndpoint: "",
    uploadEndpoint: "",
    submitHandleField: "",
    statusPath: "",
    doneStatus: "",
    errorStatus: "",
    failureCodes: {},
  },
};

export function transcriptionConfig(provider: ProviderName): TranscriptionDef | undefined {
  return TRANSCRIPTION_GEN[provider];
}
