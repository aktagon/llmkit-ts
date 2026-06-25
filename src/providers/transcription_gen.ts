// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers.ts";

//
//
export type TranscriptionWireShape = "TranscriptionAssemblyAI";

export interface TranscriptionDef {
  wireShape: TranscriptionWireShape;
  submitEndpoint: string;
  pollEndpoint: string; // template with {id}
  uploadEndpoint: string; // local-bytes upload hop; "" = url-only
  submitHandleField: string; // dotted path to the handle id
  statusPath: string; // dotted path to the poll status string
  doneStatus: string; // status value marking terminal success
  errorStatus: string; // status value marking terminal failure
}

const TRANSCRIPTION_GEN: Partial<Record<ProviderName, TranscriptionDef>> = {
  assemblyai: {
    wireShape: "TranscriptionAssemblyAI",
    submitEndpoint: "/v2/transcript",
    pollEndpoint: "/v2/transcript/{id}",
    uploadEndpoint: "/v2/upload",
    submitHandleField: "id",
    statusPath: "status",
    doneStatus: "completed",
    errorStatus: "error",
  },
};

export function transcriptionConfig(provider: ProviderName): TranscriptionDef | undefined {
  return TRANSCRIPTION_GEN[provider];
}
