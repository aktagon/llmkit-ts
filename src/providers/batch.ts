// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers";

export type BatchInputMode = "InlineRequests" | "FileReferenceInput";

export interface BatchLifecycle {
  createEndpoint: string;
  responseIdPath: string;
  pollingEndpoint: string;
  pollingStatusPath: string;
  pollingDoneValue: string;
  pollingErrorValues: string[];
  resultEndpoint: string;
  resultFileIdPath: string;
  fileContentEndpoint: string;
}

export interface BatchDef {
  inputMode: BatchInputMode;
  inputField: string;
  filePurpose: string;
  requestWrapper: string;
  completionWindow: string;
  endpointPath: string;
  itemBodyField: string;
  resultBodyPath: string;
  resultKeyPath: string;
  resultStatusPath: string;
  resultErrorPath: string;
  lifecycle: BatchLifecycle | null;
}

const BATCHES: Partial<Record<ProviderName, BatchDef>> = {
  anthropic: {
    inputMode: "InlineRequests",
    inputField: "",
    filePurpose: "",
    requestWrapper: "requests",
    completionWindow: "",
    endpointPath: "",
    itemBodyField: "params",
    resultBodyPath: "result.message",
    resultKeyPath: "custom_id",
    resultStatusPath: "result.type",
    resultErrorPath: "result.error.error.message",
    lifecycle: {
      createEndpoint: "/v1/messages/batches",
      responseIdPath: "id",
      pollingEndpoint: "",
      pollingStatusPath: "processing_status",
      pollingDoneValue: "ended",
      pollingErrorValues: [],
      resultEndpoint: "/v1/messages/batches/{id}/results",
      resultFileIdPath: "",
      fileContentEndpoint: "",
    },
  },
  google: {
    inputMode: "InlineRequests",
    inputField: "",
    filePurpose: "",
    requestWrapper: "requests",
    completionWindow: "",
    endpointPath: "",
    itemBodyField: "",
    resultBodyPath: "",
    resultKeyPath: "",
    resultStatusPath: "",
    resultErrorPath: "",
    lifecycle: null,
  },
  openai: {
    inputMode: "FileReferenceInput",
    inputField: "input_file_id",
    filePurpose: "batch",
    requestWrapper: "",
    completionWindow: "24h",
    endpointPath: "/v1/chat/completions",
    itemBodyField: "",
    resultBodyPath: "response.body",
    resultKeyPath: "custom_id",
    resultStatusPath: "",
    resultErrorPath: "error.message",
    lifecycle: {
      createEndpoint: "/v1/batches",
      responseIdPath: "id",
      pollingEndpoint: "",
      pollingStatusPath: "status",
      pollingDoneValue: "completed",
      pollingErrorValues: ["failed", "expired", "cancelled"],
      resultEndpoint: "",
      resultFileIdPath: "output_file_id",
      fileContentEndpoint: "/v1/files/{id}/content",
    },
  },
};

export function batchConfig(provider: ProviderName): BatchDef | undefined {
  return BATCHES[provider];
}
