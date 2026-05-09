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
  return await runUpload(provider, b._bytes, name, options);
}
