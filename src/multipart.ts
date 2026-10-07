// encodeMultipart builds a multipart/form-data body by hand (BUG-079). A
// runtime's FormData + Blob does not send the caller's MIME type verbatim:
// Bun's Blob rewrites "text/plain" to "text/plain;charset=utf-8". Building the
// bytes here makes every file part's Content-Type exactly the caller's string,
// on every runtime. Internal: not exported from the package barrel.

export type MultipartField =
  | { name: string; value: string }
  | { name: string; filename: string; contentType: string; bytes: Uint8Array };

// escapeQuotes mirrors Go's mime/multipart escapeQuotes and also drops CR and
// LF, as the Python and Zig encoders do, so a quote or newline in a field name
// or filename cannot break out of the Content-Disposition header.
function escapeQuotes(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, "");
}

function randomBoundary(): string {
  const buf = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function encodeMultipart(fields: MultipartField[]): {
  body: Uint8Array;
  contentType: string;
} {
  const boundary = randomBoundary();
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const f of fields) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuotes(f.name)}"`;
    if ("bytes" in f) {
      head += `; filename="${escapeQuotes(f.filename)}"\r\nContent-Type: ${f.contentType}\r\n\r\n`;
      chunks.push(enc.encode(head), f.bytes, enc.encode("\r\n"));
    } else {
      chunks.push(enc.encode(`${head}\r\n\r\n${f.value}\r\n`));
    }
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    body.set(c, off);
    off += c.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
