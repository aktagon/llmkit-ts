import { describe, test, expect } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";

describe("Upload.run — OpenAI", () => {
  test("multipart POST to /v1/files with purpose, returns File", async () => {
    let receivedPath = "";
    let receivedAuth = "";
    let receivedFileName = "";
    let receivedPurpose = "";
    let receivedFileBytes = new Uint8Array();

    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        receivedPath = url.pathname;
        receivedAuth = req.headers.get("authorization") ?? "";
        const form = await req.formData();
        const file = form.get("file") as File;
        receivedFileName = file.name;
        receivedFileBytes = new Uint8Array(await file.arrayBuffer());
        receivedPurpose = String(form.get("purpose") ?? "");
        return new Response(
          JSON.stringify({ id: "file_abc", filename: receivedFileName }),
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    try {
      const data = new Uint8Array([1, 2, 3, 4]);
      const c = newClient(Providers.openai, "sk-test");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const file = await c.upload.bytes(data).filename("hello.bin").run();
      expect(file.id).toBe("file_abc");
      expect(file.name).toBe("hello.bin");
      expect(receivedPath).toBe("/v1/files");
      expect(receivedAuth).toBe("Bearer sk-test");
      expect(receivedFileName).toBe("hello.bin");
      expect(receivedPurpose).toBe("assistants");
      expect(Array.from(receivedFileBytes)).toEqual([1, 2, 3, 4]);
    } finally {
      server.stop(true);
    }
  });
});
