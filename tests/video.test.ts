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
