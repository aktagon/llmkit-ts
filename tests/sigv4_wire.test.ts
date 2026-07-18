// SigV4 canonical-request wire driver (CR-002): sign the two production-shaped
// Bedrock requests with an injected clock and assert the canonical request,
// string-to-sign, and Authorization header byte-identically against the shared
// golden at codegen/testdata/wire/sigv4/v1/<fixture>.json. The golden is
// minted from botocore (external authority — see the PROVENANCE.md beside the
// goldens), and the same fixed inputs are hard-coded in every SDK's driver;
// the cross-SDK comparator cross-checks the per-SDK artifacts.

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { signSigV4Parts } from "../src/sigv4.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The frozen signing clock shared by every SDK driver: 2026-07-18T00:00:00Z.
const SIGV4_WIRE_NOW = new Date("2026-07-18T00:00:00Z");

const ACCESS_KEY = "AKIDEXAMPLE";
const SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";  // AWS docs example creds #gitleaks:allow
const SESSION_TOKEN = "IQoJb3JpZ2luX2VjEXAMPLETOKEN";  // AWS docs example creds #gitleaks:allow

function goldenPath(fixture: string): string {
  return resolve(
    REPO_ROOT,
    "codegen",
    "testdata",
    "wire",
    "sigv4",
    "v1",
    `${fixture}.json`,
  );
}

function artifactPath(fixture: string): string {
  return resolve(REPO_ROOT, "target", "wire", "sigv4", fixture, "ts.json");
}

function assertSigV4WireGolden(
  fixture: string,
  parts: {
    canonicalRequest: string;
    stringToSign: string;
    authorization: string;
  },
): void {
  const artifact = {
    canonicalRequest: parts.canonicalRequest,
    stringToSign: parts.stringToSign,
    authorization: parts.authorization,
  };
  const out = artifactPath(fixture);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(artifact, null, 2));

  const golden = JSON.parse(readFileSync(goldenPath(fixture), "utf8"));
  expect(artifact.canonicalRequest).toBe(golden.canonicalRequest);
  expect(artifact.stringToSign).toBe(golden.stringToSign);
  expect(artifact.authorization).toBe(golden.authorization);
}

describe("SigV4 — canonical-request wire parity", () => {
  // Mirrors executeRequest's SigV4 arm for the Bedrock Converse chat path:
  // POST, Content-Type signed, session token present, model id ':' literal in
  // the path.
  test("chat POST matches shared golden", async () => {
    const parts = await signSigV4Parts(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-haiku-20240307-v1:0/converse",
      new TextEncoder().encode(
        '{"messages":[{"role":"user","content":[{"text":"Hello, Bedrock"}]}]}',
      ),
      ACCESS_KEY,
      SECRET_KEY,
      SESSION_TOKEN,
      "us-east-1",
      "bedrock",
      "POST",
      "application/json",
      SIGV4_WIRE_NOW,
    );
    assertSigV4WireGolden("sigv4-chat-post", parts);
  });

  // Mirrors sigV4Get for the Bedrock async-invoke poll: GET, empty body
  // (empty-string SHA-256 payload hash), no Content-Type, no session token,
  // and the invocation ARN percent-encoded as ONE path segment ('/' -> %2F,
  // ':' literal) so the signed path equals the wire path.
  test("poll GET matches shared golden", async () => {
    const parts = await signSigV4Parts(
      "https://bedrock-runtime.us-west-2.amazonaws.com/async-invoke/arn:aws:bedrock:us-west-2:123456789012:async-invoke%2Fabc123xyz",
      new Uint8Array(),
      ACCESS_KEY,
      SECRET_KEY,
      "",
      "us-west-2",
      "bedrock",
      "GET",
      "",
      SIGV4_WIRE_NOW,
    );
    assertSigV4WireGolden("sigv4-poll-get", parts);
  });
});
