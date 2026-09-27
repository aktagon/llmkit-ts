// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers";

// Batch contract constants shared by every SDK (ADR-091).

/** Prefix + the request index is the id sent with each batch request. */
export const BATCH_REQUEST_ID_PREFIX = "req-";
/** finishReason of a batch slot whose request has no result line. */
export const BATCH_SLOT_MISSING = "missing";
/** finishReason of a failed batch slot when the provider gives no reason. */
export const BATCH_SLOT_ERROR = "error";

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
  errorFileIdPath: string;
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
  resultSuccessValues: string[];
  resultReasonPaths: string[];
  resultMessagePaths: string[];
  requestCountPaths: string[];
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
    resultSuccessValues: ["succeeded"],
    resultReasonPaths: ["result.type"],
    resultMessagePaths: ["result.error.error.message"],
    requestCountPaths: ["request_counts.processing", "request_counts.succeeded", "request_counts.errored", "request_counts.canceled", "request_counts.expired"],
    lifecycle: {
      createEndpoint: "/v1/messages/batches",
      responseIdPath: "id",
      pollingEndpoint: "",
      pollingStatusPath: "processing_status",
      pollingDoneValue: "ended",
      pollingErrorValues: [],
      resultEndpoint: "/v1/messages/batches/{id}/results",
      resultFileIdPath: "",
      errorFileIdPath: "",
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
    resultSuccessValues: [],
    resultReasonPaths: [],
    resultMessagePaths: [],
    requestCountPaths: [],
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
    resultStatusPath: "response.status_code",
    resultSuccessValues: ["200"],
    resultReasonPaths: ["error.code", "response.body.error.code"],
    resultMessagePaths: ["error.message", "response.body.error.message"],
    requestCountPaths: ["request_counts.total"],
    lifecycle: {
      createEndpoint: "/v1/batches",
      responseIdPath: "id",
      pollingEndpoint: "",
      pollingStatusPath: "status",
      pollingDoneValue: "completed",
      pollingErrorValues: ["failed", "expired", "cancelled"],
      resultEndpoint: "",
      resultFileIdPath: "output_file_id",
      errorFileIdPath: "error_file_id",
      fileContentEndpoint: "/v1/files/{id}/content",
    },
  },
};

export function batchConfig(provider: ProviderName): BatchDef | undefined {
  return BATCHES[provider];
}
