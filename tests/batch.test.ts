import { describe, test, expect } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";

describe("batch — Anthropic (InlineRequests)", () => {
  test("submit + wait returns parsed Responses", async () => {
    let createBody: Record<string, unknown> | undefined;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (req.method === "POST" && url.pathname === "/v1/messages/batches") {
          createBody = (await req.json()) as Record<string, unknown>;
          return new Response(
            JSON.stringify({ id: "batch_xyz", processing_status: "ended" }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (
          req.method === "GET" &&
          url.pathname === "/v1/messages/batches/batch_xyz"
        ) {
          return new Response(
            JSON.stringify({ id: "batch_xyz", processing_status: "ended" }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (
          req.method === "GET" &&
          url.pathname === "/v1/messages/batches/batch_xyz/results"
        ) {
          const lines = [
            JSON.stringify({
              custom_id: "req-0",
              result: {
                message: {
                  content: [{ type: "text", text: "alpha" }],
                  usage: { input_tokens: 1, output_tokens: 2 },
                },
              },
            }),
            JSON.stringify({
              custom_id: "req-1",
              result: {
                message: {
                  content: [{ type: "text", text: "beta" }],
                  usage: { input_tokens: 3, output_tokens: 4 },
                },
              },
            }),
          ].join("\n");
          return new Response(lines, {
            headers: { "content-type": "application/x-ndjson" },
          });
        }
        return new Response("unexpected", { status: 500 });
      },
    });
    try {
      const c = newClient(Providers.anthropic, "k");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const responses = await c.text.batch("ping1", "ping2");
      expect(responses.map((r) => r.text)).toEqual(["alpha", "beta"]);
      expect(responses[0]!.tokens.input).toBe(1);
      expect(responses[0]!.tokens.output).toBe(2);
      expect(responses[1]!.tokens.output).toBe(4);

      // request body has the `requests:[{custom_id, params}]` wrapper.
      const requests = createBody?.requests as Array<Record<string, unknown>>;
      expect(requests).toHaveLength(2);
      expect(requests[0]!.custom_id).toBe("req-0");
      expect(requests[0]!.params).toBeDefined();
    } finally {
      server.stop(true);
    }
  });
});

describe("batch — OpenAI (FileReferenceInput)", () => {
  test("uploads JSONL, polls status, fetches output file content", async () => {
    let pollCount = 0;
    let receivedJsonl = "";
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (req.method === "POST" && url.pathname === "/v1/files") {
          const form = await req.formData();
          const file = form.get("file") as File;
          receivedJsonl = await file.text();
          return new Response(JSON.stringify({ id: "file_in" }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (req.method === "POST" && url.pathname === "/v1/batches") {
          return new Response(
            JSON.stringify({ id: "batch_abc", status: "validating" }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (req.method === "GET" && url.pathname === "/v1/batches/batch_abc") {
          pollCount += 1;
          const status = pollCount >= 2 ? "completed" : "in_progress";
          return new Response(
            JSON.stringify({
              id: "batch_abc",
              status,
              output_file_id: status === "completed" ? "file_out" : null,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (
          req.method === "GET" &&
          url.pathname === "/v1/files/file_out/content"
        ) {
          const lines = [
            JSON.stringify({
              custom_id: "req-0",
              response: {
                body: {
                  choices: [{ message: { content: "alpha" } }],
                  usage: { prompt_tokens: 5, completion_tokens: 6 },
                },
              },
            }),
          ].join("\n");
          return new Response(lines, {
            headers: { "content-type": "application/x-ndjson" },
          });
        }
        return new Response("unexpected " + url.pathname, { status: 500 });
      },
    });
    try {
      const c = newClient(Providers.openai, "sk");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const handle = await c.text.submitBatch("hi");
      expect(handle.id).toBe("batch_abc");

      const responses = await handle.wait({ pollIntervalMs: 5 });
      expect(responses).toHaveLength(1);
      expect(responses[0]!.text).toBe("alpha");
      expect(responses[0]!.tokens.input).toBe(5);
      expect(responses[0]!.tokens.output).toBe(6);
      expect(receivedJsonl).toContain('"custom_id":"req-0"');
      expect(receivedJsonl).toContain('"url":"/v1/chat/completions"');
    } finally {
      server.stop(true);
    }
  });
});
