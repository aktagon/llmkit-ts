import { ontologyCapabilities } from "./catalogue.ts";
import { APIError } from "./errors.ts";
import { Capabilities } from "./types.ts";

// lookupModel finds modelId in one capability's compiled catalogue (ADR-102
// MPT-001, G4). It never throws: an unlisted model returns undefined and
// listed false. The caller then sends the request with the fields the caller
// set and skips every per-model check; config checks still run. Every media
// operation looks its model up here. Mirrors go/model_lookup.go.
export function lookupModel<M extends { modelId: string }>(
  models: readonly M[],
  modelId: string,
): { model: M | undefined; listed: boolean } {
  const model = models.find((m) => m.modelId === modelId);
  return { model, listed: model !== undefined };
}

// fallbackMime is the MIME a reply without its own MIME is labelled with: the
// listed model's outputMime, or for an unlisted model the config's first
// listed model's. Every model of one config states the same MIME, so the
//
// video and speech (CQ-MUS-015, CQ-VID-021, CQ-SPK-019).
export function fallbackMime<M extends { outputMime: string }>(
  models: readonly M[],
  model: M | undefined,
): string {
  return (model ?? models[0])?.outputMime ?? "";
}

// chatModelListed is the catalogue lookup for chat, stream, agent and batch
// (ADR-102 MPT-002): true when the compiled catalogue lists modelId as a chat
// model of provider. It never throws; the chat send path runs no per-model
// check, so the answer only marks the middleware event. Mirrors
// go/model_lookup.go.
export function chatModelListed(provider: string, modelId: string): boolean {
  return ontologyCapabilities[provider]?.[modelId]?.includes(Capabilities.ChatCompletion) ?? false;
}

// statedFalseBlocks reports whether a listed model's support fact rejects
// option before send (ADR-102 MPT-006 G6, MPT-007). Only a stated false
// blocks, and only on a config whose provider silently ignores the option
// (ignored is the config's ignoresUnsupported). Elsewhere the request is sent
// and the provider answers; an unknown fact (undefined) never blocks
// (decision 009). Mirrors go/model_lookup.go.
export function statedFalseBlocks(
  ignored: readonly string[],
  option: string,
  support: boolean | undefined,
): boolean {
  return support === false && ignored.includes(option);
}

// catalogueHint names the stated facts of a listed model that a request
// contradicts (ADR-102 MPT-008), for example "catalogue:
// heygen/heygen-video-1 lists no last frame, at most 15 seconds". The facts
// keep the order the caller gives; every SDK uses the same order. No facts
// give no hint. Mirrors go/model_lookup.go.
export function catalogueHint(modelId: string, facts: readonly string[]): string {
  return facts.length === 0 ? "" : `catalogue: ${modelId} lists ${facts.join(", ")}`;
}

// withHint returns err with hint attached when err is an APIError with
// status 400 or 422; any other error or status, and an empty hint, return
// err unchanged (ADR-102 MPT-008; owner, 2026-11-01). Callers attach it
// before the post middleware event, so middleware sees the error the caller
// gets. The hinted error is a new APIError whose cause is err, with err's
// stack. Mirrors go/model_lookup.go.
export function withHint(err: unknown, hint: string): unknown {
  if (!hint || !(err instanceof APIError) || (err.statusCode !== 400 && err.statusCode !== 422)) {
    return err;
  }
  const hinted = new APIError(err.statusCode, err.message, err.retryable, hint);
  hinted.cause = err;
  hinted.stack = err.stack;
  return hinted;
}

// offList reports whether value is set and outside a model's non-empty list.
// An empty list states no fixed set, so no value is off it.
export function offList(list: readonly string[], value: string | undefined): boolean {
  return !!value && list.length > 0 && !list.includes(value);
}
