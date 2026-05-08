// Phase 3 slice 2a — wires Upload.run against the legacy free-function
// runtime. The codegen-emitted Upload.run method delegates to
// `uploadRun(this)` (see TS_BUILDER_SKIP_TERMINALS in codegen/generate.py).
//
// TS legacy `uploadFile(provider, data, name, options)` is bytes-based
// (the inverse of Go, where UploadFile takes a path). So in TS the Bytes
// branch is the wired path and Path is deferred — symmetric to how Go's
// slice 2a wired Path and deferred Bytes. Reading a path here would
// require a runtime-specific FS read (Bun.file / fs.readFile); deferred
// to a follow-up slice that picks the right Bun-vs-Node split.

import {
  uploadFile as legacyUploadFile,
  type UploadOptions,
} from "../upload.ts";
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
  if (hasPath) {
    throw new Error(
      "Upload: path() not yet wired (TS phase 3 follow-up); use bytes() for now",
    );
  }

  const provider: Provider = {
    name: b.client.provider.name as ProviderName,
    apiKey: b.client.provider.apiKey,
  };
  if (b.client.provider.baseUrl) provider.baseUrl = b.client.provider.baseUrl;

  const options: UploadOptions = {};
  if (b._middleware.length > 0) options.middleware = b._middleware;

  const name = b._filename || "upload";
  return await legacyUploadFile(provider, b._bytes, name, options);
}
