// AWS Signature Version 4 signing. Web Crypto only — no Node-specific imports.
//
// @pre URL is parseable; secretKey non-empty.
// @post returns headers with Authorization, X-Amz-Date, X-Amz-Content-Sha256,
//   Host, and (when sessionToken is provided) X-Amz-Security-Token. The
//   Authorization signature is byte-identical to Go's signSigV4 in
//   go/sigv4.go for the same inputs.
// @invariant no mutation of the URL string.

const ALGORITHM = "AWS4-HMAC-SHA256";

// Test seam — production code never sets this. Tests freeze the clock by
// assigning a Date; resetting to null re-enables real time.
export const _testNow: { value: Date | null } = { value: null };

export async function signSigV4(
  url: string,
  body: Uint8Array,
  accessKey: string,
  secretKey: string,
  sessionToken: string,
  region: string,
  service: string,
  // HTTP verb to canonicalize. Defaults to POST so the chat path (always POST)
  // stays byte-identical; the Bedrock video poll signs a GET (mirrors Go's
  // doSigV4Get, which signs with req.Method).
  method: string = "POST",
): Promise<Record<string, string>> {
  const now = _testNow.value ?? new Date();
  const datestamp = formatDatestamp(now);
  const amzdate = formatAmzDate(now);

  const parsed = new URL(url);
  const host = parsed.host;
  const path = parsed.pathname || "/";
  const query = parsed.search.startsWith("?")
    ? parsed.search.slice(1)
    : parsed.search;

  const payloadHash = await sha256Hex(body);

  const headers: Record<string, string> = {
    Host: host,
    "X-Amz-Date": amzdate,
    "X-Amz-Content-Sha256": payloadHash,
  };
  if (sessionToken) {
    headers["X-Amz-Security-Token"] = sessionToken;
  }

  const { signedHeaders, canonicalHeaders } = buildCanonicalHeaders(
    headers,
    host,
  );
  const canonicalRequest = [
    method,
    path,
    canonicalQueryString(query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${datestamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzdate,
    credentialScope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");

  const signingKey = await deriveSigningKey(
    secretKey,
    datestamp,
    region,
    service,
  );
  const signature = bytesToHex(
    new Uint8Array(
      await hmac(signingKey, new TextEncoder().encode(stringToSign)),
    ),
  );

  headers.Authorization =
    `${ALGORITHM} Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

function formatDatestamp(d: Date): string {
  const yyyy = d.getUTCFullYear().toString();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function formatAmzDate(d: Date): string {
  const yyyy = d.getUTCFullYear().toString();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const HH = String(d.getUTCHours()).padStart(2, "0");
  const MM = String(d.getUTCMinutes()).padStart(2, "0");
  const SS = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${HH}${MM}${SS}Z`;
}

function canonicalQueryString(query: string): string {
  if (!query) return "";
  const pairs: Array<[string, string]> = [];
  for (const segment of query.split("&")) {
    const eq = segment.indexOf("=");
    if (eq === -1) {
      pairs.push([segment, ""]);
    } else {
      pairs.push([segment.slice(0, eq), segment.slice(eq + 1)]);
    }
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function buildCanonicalHeaders(
  headers: Record<string, string>,
  host: string,
): { signedHeaders: string; canonicalHeaders: string } {
  const selected: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (
      lower === "host" ||
      lower === "content-type" ||
      lower.startsWith("x-amz-")
    ) {
      selected[lower] = v.trim();
    }
  }
  if (!("host" in selected)) selected.host = host;

  const keys = Object.keys(selected).sort();
  const canonical = keys.map((k) => `${k}:${selected[k]}\n`).join("");
  return { signedHeaders: keys.join(";"), canonicalHeaders: canonical };
}

async function deriveSigningKey(
  secretKey: string,
  datestamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const kDate = await hmac(
    enc.encode("AWS4" + secretKey),
    enc.encode(datestamp),
  );
  const kRegion = await hmac(kDate, enc.encode(region));
  const kService = await hmac(kRegion, enc.encode(service));
  return hmac(kService, enc.encode("aws4_request"));
}

async function hmac(
  key: ArrayBuffer | Uint8Array,
  data: Uint8Array,
): Promise<ArrayBuffer> {
  const keyBuf = key instanceof Uint8Array ? toArrayBuffer(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, toArrayBuffer(data));
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return bytesToHex(new Uint8Array(hash));
}

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(u.byteLength);
  new Uint8Array(buf).set(u);
  return buf;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
