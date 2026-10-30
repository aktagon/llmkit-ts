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
