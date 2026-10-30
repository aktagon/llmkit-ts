// Code generated — DO NOT EDIT.


import type { ProviderName } from "./providers";

// Batch contract constants shared by every SDK (ADR-091).

/** Prefix + the request index is the id sent with each batch request. */
export const BATCH_REQUEST_ID_PREFIX = "req-";

/**
 * JobFailureCode says why an async job, or one batch item, failed
 * (ADR-099 CRF-016). JobFailure.code holds one.
 * - cancelled: The job, or the batch that held the item, was cancelled before the work ran.
 * - error: The provider reported a failure. Also the code of a failure status that has no entry in the provider's table.
 * - expired: The job, or the batch that held the item, reached the end of its time window before the work ran.
 * - missing: No result line came back for the batch item. It is a code, not a job state: a poll never returns it (ADR-063). JobFailure.Status is empty.
 * - timeout: The SDK's poll deadline passed while the provider still reported the job as running. The provider reported no failure, so JobFailure.Status is empty.
 */
export type JobFailureCode = "cancelled" | "error" | "expired" | "missing" | "timeout";

/** cause.code of a batch slot whose request has no result line (ADR-099 CRF-016a). */
export const BATCH_SLOT_MISSING: JobFailureCode = "missing";
/** cause.code of a failed batch slot whose failure status has no entry, or that gives none (ADR-099 CRF-016a). */
export const BATCH_SLOT_ERROR: JobFailureCode = "error";

export type BatchInputMode = "InlineRequests" | "FileReferenceInput";

export interface BatchLifecycle {
  createEndpoint: string;
  responseIdPath: string;
  pollingEndpoint: string;
  pollingStatusPath: string;
  pollingDoneValue: string;
  pollingErrorValues: string[];
  pollingFailureCodes: Readonly<Partial<Record<string, JobFailureCode>>>;
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
  resultFailureCodes: Readonly<Partial<Record<string, JobFailureCode>>>;
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
    resultFailureCodes: { "canceled": "cancelled", "errored": "error", "expired": "expired" },
    lifecycle: {
      createEndpoint: "/v1/messages/batches",
      responseIdPath: "id",
      pollingEndpoint: "",
      pollingStatusPath: "processing_status",
      pollingDoneValue: "ended",
      pollingErrorValues: [],
      pollingFailureCodes: {},
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
    resultFailureCodes: {},
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
    resultFailureCodes: { "batch_expired": "expired" },
    lifecycle: {
      createEndpoint: "/v1/batches",
      responseIdPath: "id",
      pollingEndpoint: "",
      pollingStatusPath: "status",
      pollingDoneValue: "completed",
      pollingErrorValues: ["failed", "expired", "cancelled"],
      pollingFailureCodes: { "cancelled": "cancelled", "expired": "expired", "failed": "error" },
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
