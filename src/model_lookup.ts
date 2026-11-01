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
// config's first model stands for the config.
export function fallbackMime<M extends { outputMime: string }>(
  models: readonly M[],
  model: M | undefined,
): string {
  return (model ?? models[0])?.outputMime ?? "";
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
