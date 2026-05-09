//
//
//
//
//
//
//
//
//
//
//

import { uploadFile as runUpload, type UploadOptions } from "../upload.ts";
import type { ProviderName } from "../providers/providers.ts";
import type { File as LLMFile, Provider } from "../types.ts";
import type { Upload } from "./builders.ts";

export async function uploadRun(b: Upload): Promise<LLMFile> {
  const hasBytes = b._bytes.length > 0;
  const hasPath = b._path !== "";

  if (!hasBytes && !hasPath) {
    throw new Error("Upload: exactly one of bytes() or path() must be set");
  }
  if (hasBytes && hasPath) {
    throw new Error("Upload: bytes() and path() are mutually exclusive");
  }

  let data: Uint8Array;
  let name: string;

  if (hasPath) {
    data = await readFileFromPath(b._path);
    name = b._filename || basename(b._path);
  } else {
    if (!b._filename) {
      throw new Error("Upload: filename() is required when bytes() is set");
    }
    data = b._bytes;
    name = b._filename;
  }

  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
  };
  if (b.client.provider.baseUrl) provider.baseUrl = b.client.provider.baseUrl;

  const options: UploadOptions = {};
  if (b._middleware.length > 0) options.middleware = b._middleware;

  return await runUpload(provider, data, name, options);
}

async function readFileFromPath(path: string): Promise<Uint8Array> {
  //
  const bunGlobal = (
    globalThis as unknown as {
      Bun?: { file: (p: string) => { bytes: () => Promise<Uint8Array> } };
    }
  ).Bun;
  if (bunGlobal && typeof bunGlobal.file === "function") {
    return await bunGlobal.file(path).bytes();
  }
  //
  try {
    const fs = await import("node:fs/promises");
    const buf = await fs.readFile(path);
    return new Uint8Array(buf);
  } catch (err) {
    throw new Error(
      `Upload: cannot read path ${JSON.stringify(path)} — runtime has no filesystem (use bytes() instead). ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}
