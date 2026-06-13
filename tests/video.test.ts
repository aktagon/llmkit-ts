import { describe, test, expect } from "bun:test";
import { newClient } from "../src/builders/index.ts";
import { Providers } from "../src/providers/providers.ts";
import { APIError, ValidationError } from "../src/llmkit.ts";

const grokVideoModel = "grok-imagine-video";

// Shrink the poll interval for tests via the wait() option.
const FAST_WAIT = { pollIntervalMs: 1 };

// grokVideoServer serves the Grok submit + poll endpoints. The poll returns
// `pending` for the first pendingPolls calls, then the supplied done body.
function grokVideoServer(
  pendingPolls: number,
  doneBody: Record<string, unknown>,
  onSubmit?: (body: Record<string, unknown>, auth: string) => void,
) {
  let polls = 0;
  return Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization") ?? "";
      if (
        req.method === "POST" &&
        url.pathname.endsWith("/v1/videos/generations")
      ) {
        const body = (await req.json()) as Record<string, unknown>;
        onSubmit?.(body, auth);
        return new Response(JSON.stringify({ request_id: "vid-123" }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (req.method === "GET" && url.pathname === "/v1/videos/vid-123") {
        polls += 1;
        if (polls <= pendingPolls) {
          return new Response(JSON.stringify({ status: "pending" }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify(doneBody), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected " + url.pathname, { status: 500 });
    },
  });
}

describe("Video.submit + wait — Grok (VideoGrok)", () => {
  test("happy path: pending -> done, url delivery, no bytes", async () => {
    let receivedBody: Record<string, unknown> | undefined;
    let receivedAuth = "";
    const done = {
      status: "done",
      video: { url: "https://vidgen.x.ai/abc/video.mp4", duration: 8 },
      model: grokVideoModel,
    };
    const server = grokVideoServer(2, done, (body, auth) => {
      receivedBody = body;
      receivedAuth = auth;
    });
    try {
      const c = newClient(Providers.grok, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;

      const handle = await c.video
        .model(grokVideoModel)
        .submit("a drone shot over the alps, 8s");
      expect(handle.id).toBe("vid-123");
      expect(receivedAuth).toBe("Bearer test-token");
      expect(receivedBody!.model).toBe(grokVideoModel);
      expect(receivedBody!.prompt).toBe("a drone shot over the alps, 8s");

      const resp = await handle.wait(FAST_WAIT);
      expect(resp.videos).toHaveLength(1);
      expect(resp.videos[0]!.url).toBe("https://vidgen.x.ai/abc/video.mp4");
      expect(resp.videos[0]!.mimeType).toBe("video/mp4");
      expect(resp.videos[0]!.durationSeconds).toBe(8);
      expect(resp.videos[0]!.bytes).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("text() chain method (parts accumulator) with empty submit msg", async () => {
    const done = {
      status: "done",
      video: { url: "https://vidgen.x.ai/t.mp4" },
    };
    const server = grokVideoServer(0, done);
    try {
      const c = newClient(Providers.grok, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const handle = await c.video
        .model(grokVideoModel)
        .text("a calm lake at dawn")
        .submit("");
      const resp = await handle.wait(FAST_WAIT);
      expect(resp.videos).toHaveLength(1);
    } finally {
      server.stop(true);
    }
  });

  test("raw() captures the parsed poll body on the response", async () => {
    const done = {
      status: "done",
      video: { url: "https://vidgen.x.ai/x.mp4" },
    };
    const server = grokVideoServer(0, done);
    try {
      const c = newClient(Providers.grok, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const handle = await c.video
        .model(grokVideoModel)
        .raw()
        .submit("a sunrise timelapse");
      expect(handle.raw).toBe(true);
      const resp = await handle.wait(FAST_WAIT);
      expect(resp.raw).toBeDefined();
      expect((resp.raw as { status: string }).status).toBe("done");
    } finally {
      server.stop(true);
    }
  });

  test("failed job throws with the provider error.message", async () => {
    const done = {
      status: "failed",
      error: {
        code: "invalid_argument",
        message: "prompt blocked by moderation",
      },
    };
    const server = grokVideoServer(0, done);
    try {
      const c = newClient(Providers.grok, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const handle = await c.video
        .model(grokVideoModel)
        .submit("blocked prompt");
      let err: unknown;
      try {
        await handle.wait(FAST_WAIT);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(APIError);
      expect((err as Error).message).toContain("prompt blocked by moderation");
    } finally {
      server.stop(true);
    }
  });
});

const zhipuVideoModel = "cogvideox-3";

// zhipuVideoServer serves the Zhipu CogVideoX submit + async-result endpoints.
// Submit returns the poll handle as the top-level `id` (Zhipu's own
// `request_id` is present but is NOT the poll key); the async-result poll
// returns `task_status: PROCESSING` until the supplied done body.
function zhipuVideoServer(
  pendingPolls: number,
  doneBody: Record<string, unknown>,
  onSubmit?: (body: Record<string, unknown>, auth: string) => void,
) {
  let polls = 0;
  return Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization") ?? "";
      if (
        req.method === "POST" &&
        url.pathname.endsWith("/v4/videos/generations")
      ) {
        const body = (await req.json()) as Record<string, unknown>;
        onSubmit?.(body, auth);
        return new Response(
          JSON.stringify({
            id: "zhipu-vid-1",
            request_id: "rq-xyz",
            task_status: "PROCESSING",
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (req.method === "GET" && url.pathname === "/v4/async-result/zhipu-vid-1") {
        polls += 1;
        if (polls <= pendingPolls) {
          return new Response(JSON.stringify({ task_status: "PROCESSING" }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify(doneBody), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected " + url.pathname, { status: 500 });
    },
  });
}

describe("Video.submit + wait — Zhipu (VideoZhipu)", () => {
  test("happy path: id handle, /v4/async-result poll, video_result url delivery", async () => {
    let receivedBody: Record<string, unknown> | undefined;
    const done = {
      task_status: "SUCCESS",
      video_result: [
        {
          url: "https://cogvideo.bigmodel.cn/abc/v.mp4",
          cover_image_url: "https://cogvideo.bigmodel.cn/abc/c.jpg",
        },
      ],
      model: zhipuVideoModel,
    };
    const server = zhipuVideoServer(2, done, (body) => {
      receivedBody = body;
    });
    try {
      const c = newClient(Providers.zhipu, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;

      const handle = await c.video
        .model(zhipuVideoModel)
        .submit("a drone shot over the alps");
      expect(handle.id).toBe("zhipu-vid-1");
      expect(receivedBody!.model).toBe(zhipuVideoModel);

      const resp = await handle.wait(FAST_WAIT);
      expect(resp.videos).toHaveLength(1);
      expect(resp.videos[0]!.url).toBe("https://cogvideo.bigmodel.cn/abc/v.mp4");
      expect(resp.videos[0]!.mimeType).toBe("video/mp4");
      expect(resp.videos[0]!.bytes).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("FAIL task_status throws", async () => {
    const server = zhipuVideoServer(0, { task_status: "FAIL" });
    try {
      const c = newClient(Providers.zhipu, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const handle = await c.video.model(zhipuVideoModel).submit("blocked");
      let err: unknown;
      try {
        await handle.wait(FAST_WAIT);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(APIError);
    } finally {
      server.stop(true);
    }
  });
});

const togetherVideoModel = "minimax/video-01-director";

// togetherVideoServer serves the Together submit + poll endpoints. Submit
// returns the poll handle as the top-level `id` with status=queued; the poll
// GET /v2/videos/{id} returns status=in_progress until the supplied done body.
function togetherVideoServer(
  pendingPolls: number,
  doneBody: Record<string, unknown>,
  onSubmit?: (body: Record<string, unknown>, auth: string) => void,
) {
  let polls = 0;
  return Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization") ?? "";
      if (req.method === "POST" && url.pathname.endsWith("/v2/videos")) {
        const body = (await req.json()) as Record<string, unknown>;
        onSubmit?.(body, auth);
        return new Response(
          JSON.stringify({ id: "together-vid-1", status: "queued" }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (req.method === "GET" && url.pathname === "/v2/videos/together-vid-1") {
        polls += 1;
        if (polls <= pendingPolls) {
          return new Response(JSON.stringify({ status: "in_progress" }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify(doneBody), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected " + url.pathname, { status: 500 });
    },
  });
}

describe("Video.submit + wait — Together (VideoTogether)", () => {
  test("happy path: id handle, /v2/videos poll, outputs.video_url url delivery", async () => {
    let receivedBody: Record<string, unknown> | undefined;
    const done = {
      status: "completed",
      outputs: { video_url: "https://api.together.xyz/files/v.mp4" },
      model: togetherVideoModel,
    };
    const server = togetherVideoServer(2, done, (body) => {
      receivedBody = body;
    });
    try {
      const c = newClient(Providers.together, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;

      const handle = await c.video
        .model(togetherVideoModel)
        .submit("a drone shot over the alps");
      expect(handle.id).toBe("together-vid-1");
      expect(receivedBody!.model).toBe(togetherVideoModel);

      const resp = await handle.wait(FAST_WAIT);
      expect(resp.videos).toHaveLength(1);
      expect(resp.videos[0]!.url).toBe("https://api.together.xyz/files/v.mp4");
      expect(resp.videos[0]!.mimeType).toBe("video/mp4");
      expect(resp.videos[0]!.bytes).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("cancelled status throws", async () => {
    const server = togetherVideoServer(0, { status: "cancelled" });
    try {
      const c = newClient(Providers.together, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const handle = await c.video.model(togetherVideoModel).submit("blocked");
      let err: unknown;
      try {
        await handle.wait(FAST_WAIT);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(APIError);
    } finally {
      server.stop(true);
    }
  });
});

const qwenVideoModel = "wan2.2-t2v-plus";

// qwenVideoServer serves the DashScope (Qwen) submit + poll endpoints. Submit
// returns the poll handle as output.task_id (the dotted-path handle) with
// output.task_status=PENDING; the poll GET /api/v1/tasks/{id} returns
// output.task_status=RUNNING until the supplied done body. onSubmit receives
// the parsed body plus the captured X-DashScope-Async header value.
function qwenVideoServer(
  pendingPolls: number,
  doneBody: Record<string, unknown>,
  onSubmit?: (body: Record<string, unknown>, asyncHeader: string) => void,
) {
  let polls = 0;
  return Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname.endsWith("/video-synthesis")) {
        const body = (await req.json()) as Record<string, unknown>;
        onSubmit?.(body, req.headers.get("x-dashscope-async") ?? "");
        return new Response(
          JSON.stringify({
            output: { task_id: "qwen-vid-1", task_status: "PENDING" },
            request_id: "req-1",
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (
        req.method === "GET" &&
        url.pathname === "/api/v1/tasks/qwen-vid-1"
      ) {
        polls += 1;
        if (polls <= pendingPolls) {
          return new Response(
            JSON.stringify({ output: { task_status: "RUNNING" } }),
            { headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify(doneBody), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected " + url.pathname, { status: 500 });
    },
  });
}

describe("Video.submit + wait — Qwen (VideoQwen)", () => {
  test("nested body + async header, output.task_id handle, output.video_url url delivery", async () => {
    let receivedBody: Record<string, unknown> | undefined;
    let receivedAsyncHeader = "";
    const done = {
      output: {
        task_status: "SUCCEEDED",
        video_url: "https://dashscope-result.oss-cn.aliyuncs.com/v.mp4",
      },
    };
    const server = qwenVideoServer(2, done, (body, asyncHeader) => {
      receivedBody = body;
      receivedAsyncHeader = asyncHeader;
    });
    try {
      const c = newClient(Providers.qwen, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;

      const handle = await c.video
        .model(qwenVideoModel)
        .submit("a drone shot over the alps");
      expect(handle.id).toBe("qwen-vid-1");
      // Nested submit body: prompt under input, no top-level prompt.
      expect(receivedBody!.model).toBe(qwenVideoModel);
      expect(receivedBody!.input).toEqual({
        prompt: "a drone shot over the alps",
      });
      expect(receivedBody!.prompt).toBeUndefined();
      expect(receivedAsyncHeader).toBe("enable");

      const resp = await handle.wait(FAST_WAIT);
      expect(resp.videos).toHaveLength(1);
      expect(resp.videos[0]!.url).toBe(
        "https://dashscope-result.oss-cn.aliyuncs.com/v.mp4",
      );
      expect(resp.videos[0]!.mimeType).toBe("video/mp4");
      expect(resp.videos[0]!.bytes).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("FAILED status throws", async () => {
    const server = qwenVideoServer(0, { output: { task_status: "FAILED" } });
    try {
      const c = newClient(Providers.qwen, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const handle = await c.video.model(qwenVideoModel).submit("blocked");
      let err: unknown;
      try {
        await handle.wait(FAST_WAIT);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(APIError);
    } finally {
      server.stop(true);
    }
  });
});

const minimaxVideoModel = "MiniMax-Hailuo-2.3";

// minimaxVideoServer serves the MiniMax two-hop flow: submit -> {task_id};
// query poll returns Processing until {status:Success, file_id}; the
// file-retrieve hop returns the download URL. file_id is served as a JSON
// number (minimax encodes it as an integer).
function minimaxVideoServer(
  pendingPolls: number,
  downloadURL: string,
  failStatus: boolean,
) {
  let polls = 0;
  return Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname.endsWith("/v1/video_generation")) {
        return new Response(
          JSON.stringify({ task_id: "mmtask-1", base_resp: { status_code: 0 } }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (req.method === "GET" && url.pathname === "/v1/query/video_generation") {
        if (failStatus) {
          return new Response(JSON.stringify({ status: "Fail" }), {
            headers: { "content-type": "application/json" },
          });
        }
        polls += 1;
        if (polls <= pendingPolls) {
          return new Response(JSON.stringify({ status: "Processing" }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ status: "Success", file_id: 99887766 }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (req.method === "GET" && url.pathname === "/v1/files/retrieve") {
        return new Response(
          JSON.stringify({ file: { download_url: downloadURL } }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response("unexpected " + url.pathname, { status: 500 });
    },
  });
}

describe("Video.submit + wait — MiniMax (VideoMinimax, two-hop)", () => {
  test("submit -> poll Success+file_id -> file-retrieve download_url", async () => {
    const server = minimaxVideoServer(
      2,
      "https://files.minimax.io/abc/v.mp4",
      false,
    );
    try {
      const c = newClient(Providers.minimax, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`; // override wins (Option D)

      const handle = await c.video
        .model(minimaxVideoModel)
        .submit("a drone shot over the alps");
      expect(handle.id).toBe("mmtask-1");

      const resp = await handle.wait(FAST_WAIT);
      expect(resp.videos).toHaveLength(1);
      expect(resp.videos[0]!.url).toBe("https://files.minimax.io/abc/v.mp4");
      expect(resp.videos[0]!.bytes).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("Fail status throws", async () => {
    const server = minimaxVideoServer(0, "", true);
    try {
      const c = newClient(Providers.minimax, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const handle = await c.video.model(minimaxVideoModel).submit("blocked");
      let err: unknown;
      try {
        await handle.wait(FAST_WAIT);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(APIError);
    } finally {
      server.stop(true);
    }
  });
});

const veoVideoModel = "veo-3.1-generate-preview";

// veoVideoServer serves the Google Veo LRO flow: submit ->
// {name:"models/.../operations/op-1"}; operation poll returns {done:false} for
// the first pendingPolls calls, then a done op whose response carries the
// Files-API video.uri (download delivery). The download hop GETs that uri and
// returns raw mp4 bytes. Every hop must carry the ?key= query-param auth
// (Google is the first video provider that is NOT bearer-header). The download
// uri is served with a pre-existing ?alt=media query so the test also
// witnesses the ?->& auth-append branch. When failOp is set the done op
// carries an error. onAuth receives the ?key= value seen on every request.
function veoVideoServer(
  pendingPolls: number,
  videoBytes: Uint8Array,
  failOp: boolean,
  onSubmit?: (body: Record<string, unknown>) => void,
  onAuth?: (key: string) => void,
) {
  let polls = 0;
  let baseUrl = "";
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      onAuth?.(url.searchParams.get("key") ?? "");
      if (
        req.method === "POST" &&
        url.pathname.endsWith("/veo-3.1-generate-preview:predictLongRunning")
      ) {
        const body = (await req.json()) as Record<string, unknown>;
        onSubmit?.(body);
        return new Response(
          JSON.stringify({
            name: "models/veo-3.1-generate-preview/operations/op-1",
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (req.method === "GET" && url.pathname.endsWith("/operations/op-1")) {
        if (failOp) {
          return new Response(
            JSON.stringify({
              done: true,
              error: { code: 3, message: "prompt blocked by safety filter" },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        polls += 1;
        if (polls <= pendingPolls) {
          return new Response(JSON.stringify({ done: false }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            done: true,
            response: {
              generateVideoResponse: {
                generatedSamples: [
                  {
                    video: {
                      uri: `${baseUrl}/v1beta/files/vid-file:download?alt=media`,
                    },
                  },
                ],
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (
        req.method === "GET" &&
        url.pathname.endsWith("/files/vid-file:download")
      ) {
        if (url.searchParams.get("alt") !== "media") {
          throw new Error("pre-existing alt=media did not survive auth append");
        }
        return new Response(videoBytes, {
          headers: { "content-type": "video/mp4" },
        });
      }
      return new Response("unexpected " + url.pathname, { status: 500 });
    },
  });
  baseUrl = `http://localhost:${server.port}`;
  return server;
}

describe("Video.submit + wait — Veo (VideoVeo, download delivery)", () => {
  test("LRO poll -> done -> download bytes, url cleared, ?key= on every hop", async () => {
    const wantBytes = new TextEncoder().encode(
      "\x00\x00\x00\x18ftypmp42 fake mp4 payload",
    );
    let submitBody: Record<string, unknown> | undefined;
    const seenKeys: string[] = [];
    const server = veoVideoServer(
      2,
      wantBytes,
      false,
      (body) => {
        submitBody = body;
      },
      (key) => {
        seenKeys.push(key);
      },
    );
    try {
      const c = newClient(Providers.google, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;

      const handle = await c.video
        .model(veoVideoModel)
        .submit("a drone shot over the alps at sunrise");
      expect(handle.id).toBe(
        "models/veo-3.1-generate-preview/operations/op-1",
      );
      // Veo submit body has instances[0].prompt and NO model field.
      expect(submitBody!.model).toBeUndefined();
      const instances = submitBody!.instances as Array<{ prompt: string }>;
      expect(instances).toHaveLength(1);
      expect(instances[0]!.prompt).toBe(
        "a drone shot over the alps at sunrise",
      );

      const resp = await handle.wait(FAST_WAIT);
      expect(resp.videos).toHaveLength(1);
      expect(new TextDecoder().decode(resp.videos[0]!.bytes)).toBe(
        new TextDecoder().decode(wantBytes),
      );
      // Source-XOR: download delivery clears url after fetching bytes.
      expect(resp.videos[0]!.url).toBe("");
      expect(resp.videos[0]!.mimeType).toBe("video/mp4");
      // ?key=test-token on submit, every poll, and the download hop.
      expect(seenKeys.every((k) => k === "test-token")).toBe(true);
      expect(seenKeys.length).toBeGreaterThanOrEqual(4);
    } finally {
      server.stop(true);
    }
  });

  test("done op with error throws the operation message", async () => {
    const server = veoVideoServer(0, new Uint8Array(), true);
    try {
      const c = newClient(Providers.google, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const handle = await c.video.model(veoVideoModel).submit("blocked");
      let err: unknown;
      try {
        await handle.wait(FAST_WAIT);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).message).toContain(
        "prompt blocked by safety filter",
      );
    } finally {
      server.stop(true);
    }
  });
});

const vertexOperationName =
  "projects/test-project/locations/us-central1/operations/op-1";

// vertexVideoServer serves the Vertex Veo predictLongRunning +
// fetchPredictOperation endpoints. Vertex is the FIRST POST-poll provider
// (every other provider GETs the poll): the operation is fetched with a POST to
// {model}:fetchPredictOperation carrying {operationName}. Delivery is download
// with NO fetch hop — the bytes arrive inline as base64 in the poll body
// (response.videos[0].bytesBase64Encoded). The poll returns done=false for the
// first pendingPolls calls, then either the finished video (videoBytes) or,
// when failOp is set, a done op carrying an error. When omitBytes is set the
// done op carries a video with no decodable bytes.
function vertexVideoServer(
  pendingPolls: number,
  videoBytes: Uint8Array,
  failOp: boolean,
  omitBytes: boolean,
  onSubmit?: (body: Record<string, unknown>, auth: string) => void,
  onPoll?: (body: Record<string, unknown>, auth: string) => void,
) {
  let polls = 0;
  return Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization") ?? "";
      if (
        req.method === "POST" &&
        url.pathname.endsWith(
          "/veo-3.1-generate-preview:predictLongRunning",
        )
      ) {
        const body = (await req.json()) as Record<string, unknown>;
        onSubmit?.(body, auth);
        return new Response(JSON.stringify({ name: vertexOperationName }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (
        req.method === "POST" &&
        url.pathname.endsWith(
          "/veo-3.1-generate-preview:fetchPredictOperation",
        )
      ) {
        const body = (await req.json()) as Record<string, unknown>;
        onPoll?.(body, auth);
        if (failOp) {
          return new Response(
            JSON.stringify({
              done: true,
              error: { code: 3, message: "prompt blocked by safety filter" },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        polls += 1;
        if (polls <= pendingPolls) {
          return new Response(JSON.stringify({ done: false }), {
            headers: { "content-type": "application/json" },
          });
        }
        const video: Record<string, unknown> = { mimeType: "video/mp4" };
        if (!omitBytes) {
          video.bytesBase64Encoded = Buffer.from(videoBytes).toString(
            "base64",
          );
        }
        return new Response(
          JSON.stringify({
            done: true,
            response: { videos: [video] },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response("unexpected " + url.pathname, { status: 500 });
    },
  });
}

describe("Video.submit + wait — Vertex Veo (VideoVertexVeo, inline-base64 download)", () => {
  test("POST poll -> done -> inline base64 bytes, url empty, handle carries model", async () => {
    const wantBytes = new TextEncoder().encode(
      "\x00\x00\x00\x18ftypmp42 fake vertex mp4 payload",
    );
    let submitBody: Record<string, unknown> | undefined;
    let submitAuth = "";
    let pollBody: Record<string, unknown> | undefined;
    let pollAuth = "";
    const server = vertexVideoServer(
      2,
      wantBytes,
      false,
      false,
      (body, auth) => {
        submitBody = body;
        submitAuth = auth;
      },
      (body, auth) => {
        pollBody = body;
        pollAuth = auth;
      },
    );
    try {
      const c = newClient(Providers.vertex, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;

      const handle = await c.video
        .model(veoVideoModel)
        .submit("a drone shot over the alps at sunrise");
      expect(handle.id).toBe(vertexOperationName);
      // The handle carries the model so wait() can template the
      // fetchPredictOperation poll URL.
      expect(handle.model).toBe(veoVideoModel);
      // Bearer auth; submit body has instances[0].prompt and NO model field.
      expect(submitAuth).toBe("Bearer test-token");
      expect(submitBody!.model).toBeUndefined();
      const instances = submitBody!.instances as Array<{ prompt: string }>;
      expect(instances).toHaveLength(1);
      expect(instances[0]!.prompt).toBe(
        "a drone shot over the alps at sunrise",
      );

      const resp = await handle.wait(FAST_WAIT);
      // POST poll carrying {operationName} and bearer auth.
      expect(pollAuth).toBe("Bearer test-token");
      expect(pollBody!.operationName).toBe(vertexOperationName);
      expect(resp.videos).toHaveLength(1);
      expect(new TextDecoder().decode(resp.videos[0]!.bytes)).toBe(
        new TextDecoder().decode(wantBytes),
      );
      // Download delivery (inline) leaves url empty (source-XOR, VID-004).
      expect(resp.videos[0]!.url).toBeUndefined();
      expect(resp.videos[0]!.mimeType).toBe("video/mp4");
    } finally {
      server.stop(true);
    }
  });

  test("done op with error throws the operation message", async () => {
    const server = vertexVideoServer(0, new Uint8Array(), true, false);
    try {
      const c = newClient(Providers.vertex, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const handle = await c.video.model(veoVideoModel).submit("blocked prompt");
      let err: unknown;
      try {
        await handle.wait(FAST_WAIT);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).message).toContain(
        "prompt blocked by safety filter",
      );
    } finally {
      server.stop(true);
    }
  });

  test("done op carrying no video bytes throws the no-bytes guard", async () => {
    const server = vertexVideoServer(0, new Uint8Array(), false, true);
    try {
      const c = newClient(Providers.vertex, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const handle = await c.video
        .model(veoVideoModel)
        .submit("a quiet harbour at dawn");
      let err: unknown;
      try {
        await handle.wait(FAST_WAIT);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).message).toContain("no video bytes");
    } finally {
      server.stop(true);
    }
  });
});

const novaReelModel = "amazon.nova-reel-v1:0";
const novaReelARN =
  "arn:aws:bedrock:us-east-1:123456789012:async-invoke/abc123def456";
const novaReelOutputURI = "s3://my-bucket/out/";

// bedrockVideoServer serves the Nova Reel start-async-invoke + get-async-invoke
// endpoints. Bedrock is the FIRST SigV4-signed video provider (every other is a
// bearer header) and the FIRST output-uri delivery (the provider writes the mp4
// to the caller's S3 bucket; the SDK never downloads). Submit returns the poll
// handle as the top-level `invocationArn`; the poll returns status=InProgress
// until the supplied done body. When failMsg is non-empty the poll returns a
// Failed status carrying it. Every request must carry a SigV4 Authorization
// header; the submit body is captured for shape assertions.
function bedrockVideoServer(
  pendingPolls: number,
  doneBody: Record<string, unknown>,
  failMsg: string,
  onSubmit?: (body: Record<string, unknown>, auth: string) => void,
  onPollPath?: (path: string, auth: string) => void,
) {
  let polls = 0;
  return Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization") ?? "";
      if (req.method === "POST" && url.pathname.endsWith("/async-invoke")) {
        const body = (await req.json()) as Record<string, unknown>;
        onSubmit?.(body, auth);
        return new Response(JSON.stringify({ invocationArn: novaReelARN }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (req.method === "GET" && url.pathname.includes("/async-invoke/")) {
        onPollPath?.(url.pathname, auth);
        if (failMsg) {
          return new Response(
            JSON.stringify({ status: "Failed", failureMessage: failMsg }),
            { headers: { "content-type": "application/json" } },
          );
        }
        polls += 1;
        if (polls <= pendingPolls) {
          return new Response(JSON.stringify({ status: "InProgress" }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify(doneBody), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected " + url.pathname, { status: 500 });
    },
  });
}

describe("Video.submit + wait — Bedrock Nova Reel (VideoBedrock, output-uri)", () => {
  test("submit (SigV4, modelId in body) -> InProgress -> Completed, url=S3 URI, no bytes", async () => {
    let submitBody: Record<string, unknown> | undefined;
    let submitAuth = "";
    let pollAuth = "";
    let seenPollPath = "";
    const done = {
      status: "Completed",
      outputDataConfig: {
        s3OutputDataConfig: { s3Uri: novaReelOutputURI },
      },
    };
    const server = bedrockVideoServer(
      2,
      done,
      "",
      (body, auth) => {
        submitBody = body;
        submitAuth = auth;
      },
      (path, auth) => {
        seenPollPath = path;
        pollAuth = auth;
      },
    );
    try {
      const c = newClient(Providers.bedrock, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;

      const handle = await c.video
        .model(novaReelModel)
        .outputURI(novaReelOutputURI)
        .submit("a drone shot over the alps, 6s");
      expect(handle.id).toBe(novaReelARN);
      // SigV4-signed submit, modelId in the BODY, prompt nested, caller S3 URI.
      expect(submitAuth.startsWith("AWS4-HMAC-SHA256")).toBe(true);
      expect(submitBody!.modelId).toBe(novaReelModel);
      const modelInput = submitBody!.modelInput as {
        taskType: string;
        textToVideoParams: { text: string };
      };
      expect(modelInput.taskType).toBe("TEXT_VIDEO");
      expect(modelInput.textToVideoParams.text).toBe(
        "a drone shot over the alps, 6s",
      );
      const odc = submitBody!.outputDataConfig as {
        s3OutputDataConfig: { s3Uri: string };
      };
      expect(odc.s3OutputDataConfig.s3Uri).toBe(novaReelOutputURI);

      const resp = await handle.wait(FAST_WAIT);
      // SigV4-signed poll, and the ARN round-trips as ONE path segment: the
      // ':' stays literal and the '/' is %2F-encoded on the wire (Bun's
      // url.pathname preserves %2F), so decoding restores the full ARN.
      expect(pollAuth.startsWith("AWS4-HMAC-SHA256")).toBe(true);
      expect(decodeURIComponent(seenPollPath)).toContain(novaReelARN);
      expect(resp.videos).toHaveLength(1);
      expect(resp.videos[0]!.url).toBe(novaReelOutputURI);
      expect(resp.videos[0]!.mimeType).toBe("video/mp4");
      expect(resp.videos[0]!.bytes).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("VID-005: omitting the output URI rejects pre-flight with field output_uri", async () => {
    const c = newClient(Providers.bedrock, "test-token");
    c.provider.baseUrl = "http://unused";
    let err: unknown;
    try {
      await c.video.model(novaReelModel).submit("a drone shot over the alps");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("output_uri");
  });

  test("Failed status surfaces the failureMessage", async () => {
    const failMsg = "S3 bucket not writable by the service role";
    const server = bedrockVideoServer(0, {}, failMsg);
    try {
      const c = newClient(Providers.bedrock, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const handle = await c.video
        .model(novaReelModel)
        .outputURI(novaReelOutputURI)
        .submit("a drone shot over the alps");
      let err: unknown;
      try {
        await handle.wait(FAST_WAIT);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).message).toContain(failMsg);
    } finally {
      server.stop(true);
    }
  });

  test("Completed but no output s3 uri throws (mirrors Veo done+no-uri guard)", async () => {
    const server = bedrockVideoServer(0, { status: "Completed" }, "");
    try {
      const c = newClient(Providers.bedrock, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      const handle = await c.video
        .model(novaReelModel)
        .outputURI(novaReelOutputURI)
        .submit("a drone shot");
      let err: unknown;
      try {
        await handle.wait(FAST_WAIT);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).message).toContain("no output s3 uri");
    } finally {
      server.stop(true);
    }
  });
});

describe("Video.submit — pre-flight validation", () => {
  test("requires model", async () => {
    const c = newClient(Providers.grok, "test-token");
    let err: unknown;
    try {
      await c.video.submit("no model set");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("model");
  });

  test("rejects unknown model", async () => {
    const c = newClient(Providers.grok, "test-token");
    c.provider.baseUrl = "http://unused";
    let err: unknown;
    try {
      await c.video.model("grok-imagine-nope").submit("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("model");
  });

  test("rejects provider without video support", async () => {
    const c = newClient(Providers.anthropic, "test-token");
    c.provider.baseUrl = "http://unused";
    let err: unknown;
    try {
      await c.video.model(grokVideoModel).submit("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("provider");
  });

  test("rejects lyrics parts", async () => {
    const c = newClient(Providers.grok, "test-token");
    c.provider.baseUrl = "http://unused";
    let err: unknown;
    try {
      // Reach the shared Part accumulator directly so a lyrics part can hit
      // the runtime and be rejected there.
      const builder: any = c.video.model(grokVideoModel);
      builder._parts = [{ lyrics: "la la la" }];
      await builder.submit("");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toContain("lyrics");
  });

  test("rejects image parts (image-to-video not yet wired)", async () => {
    const c = newClient(Providers.grok, "test-token");
    c.provider.baseUrl = "http://unused";
    let err: unknown;
    try {
      const builder: any = c.video.model(grokVideoModel);
      builder._parts = [
        { image: { mimeType: "image/png", bytes: new Uint8Array([0x89]) } },
      ];
      await builder.submit("");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toContain("image-to-video");
  });

  test("rejects when neither parts accumulator nor submit msg is set", async () => {
    const c = newClient(Providers.grok, "test-token");
    c.provider.baseUrl = "http://unused";
    let err: unknown;
    try {
      await c.video.model(grokVideoModel).submit("");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe("prompt");
  });
});

describe("Video.submit — middleware", () => {
  test("fires pre+post in order around submit", async () => {
    const done = {
      status: "done",
      video: { url: "https://vidgen.x.ai/m.mp4" },
    };
    const server = grokVideoServer(0, done);
    try {
      const ops: string[] = [];
      const phases: string[] = [];
      const mw = (_ctx: unknown, ev: { op: string; phase: string }) => {
        ops.push(ev.op);
        phases.push(ev.phase);
        return null;
      };
      const c = newClient(Providers.grok, "test-token");
      c.provider.baseUrl = `http://localhost:${server.port}`;
      await c.video.model(grokVideoModel).addMiddleware(mw).submit("drone shot");
      expect(ops).toEqual(["video_generation", "video_generation"]);
      expect(phases).toEqual(["pre", "post"]);
    } finally {
      server.stop(true);
    }
  });
});
