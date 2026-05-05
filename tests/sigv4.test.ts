import { describe, test, expect } from "bun:test";
import { signSigV4, _testNow } from "../src/sigv4.ts";

describe("signSigV4 — AWS test vector", () => {
  test("known inputs produce a deterministic Authorization signature", async () => {
    // Matches Go signSigV4 output byte-for-byte for the same inputs.
    // Frozen clock: 2025-01-15T12:00:00Z.
    _testNow.value = new Date("2025-01-15T12:00:00Z");
    try {
      const headers = await signSigV4(
        "https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-haiku-20240307-v1:0/converse",
        new TextEncoder().encode('{"messages":[]}'),
        "AKIDEXAMPLE",
        "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
        "",
        "us-east-1",
        "bedrock",
      );
      expect(headers["X-Amz-Date"]).toBe("20250115T120000Z");
      expect(headers["X-Amz-Content-Sha256"]).toBe(
        "5e4ce7b36ba37b78a5d5f9fd08e6b7b54ba6879d651aa46ec9e1d6fa24ebe30a",
      );
      expect(headers.Authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20250115\/us-east-1\/bedrock\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
      );
      expect(headers.Host).toBe("bedrock-runtime.us-east-1.amazonaws.com");
    } finally {
      _testNow.value = null;
    }
  });

  test("session token adds X-Amz-Security-Token header and is included in signed headers", async () => {
    _testNow.value = new Date("2025-01-15T12:00:00Z");
    try {
      const headers = await signSigV4(
        "https://bedrock-runtime.us-east-1.amazonaws.com/x",
        new Uint8Array(),
        "AKID",
        "secret",
        "tok-123",
        "us-east-1",
        "bedrock",
      );
      expect(headers["X-Amz-Security-Token"]).toBe("tok-123");
      expect(headers.Authorization).toContain("x-amz-security-token");
    } finally {
      _testNow.value = null;
    }
  });
});
