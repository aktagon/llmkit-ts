// Cross-SDK catalogue request-URL conformance (ADR-067 Fix B / CAT-006) — the
// TS driver. The REQUEST-side sibling of response_wire.test.ts (which locks the
// /models PARSE seam): for a fixed (provider, cursor), every SDK's
// catalogue-list path must assemble a byte-identical {method, url, headers}.
//
// The driver calls the SAME URL/header-assembly seam the paginate loop uses
// (buildCatalogueUrl + appendCursor + buildCatalogueHeaders). The cursorParam
// comes from the generated catalogueByProvider config, NOT from inputs.json —
// so this exercises the generated config. This driver drops
// target/wire/catalogue/<case>/ts.json for codegen/test_cross_sdk_catalogue.py,
// which compares it to the golden codegen/testdata/wire/catalogue/v1/<case>.json.

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { catalogueByProvider } from "../src/catalogue.ts";
import {
  appendCursor,
  buildCatalogueHeaders,
  buildCatalogueUrl,
} from "../src/models.ts";
import { PROVIDERS } from "../src/providers/providers.ts";
import type { ProviderName } from "../src/providers/providers.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CATALOGUE_DIR = resolve(REPO_ROOT, "codegen", "testdata", "wire", "catalogue", "v1");

interface CatalogueInputs {
  apiKey: string;
  cases: Record<string, { provider: string; cursor: string }>;
}

function goldenPath(caseName: string): string {
  return resolve(CATALOGUE_DIR, `${caseName}.json`);
}

function artifactPath(caseName: string): string {
  return resolve(REPO_ROOT, "target", "wire", "catalogue", caseName, "ts.json");
}

describe("catalogue wire — cross-SDK request-URL conformance (ADR-067 Fix B)", () => {
  const inputs = JSON.parse(readFileSync(resolve(CATALOGUE_DIR, "inputs.json"), "utf8")) as CatalogueInputs;

  for (const [caseName, spec] of Object.entries(inputs.cases)) {
    test(`${caseName} matches shared golden`, () => {
      const name = spec.provider as ProviderName;
      const provider = { name, apiKey: inputs.apiKey };
      const pcfg = PROVIDERS[name];
      const cfg = catalogueByProvider[name];
      if (!cfg) throw new Error(`no catalogue config for ${name}`);

      const url = appendCursor(
        buildCatalogueUrl(provider, pcfg, cfg.endpoint),
        cfg.cursorParam,
        spec.cursor,
      );
      const headers = buildCatalogueHeaders(provider, pcfg);
      const artifact = { method: "GET", url, headers };

      const out = artifactPath(caseName);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(artifact, null, 2));

      const golden = JSON.parse(readFileSync(goldenPath(caseName), "utf8"));
      expect(artifact).toEqual(golden);
    });
  }
});
