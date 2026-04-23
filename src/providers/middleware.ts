// Code generated — DO NOT EDIT.


export interface Usage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export type MiddlewarePhase = "pre" | "post";

export type MiddlewareOp =
  | "llm_request"
  | "tool_call"
  | "cache_create"
  | "upload"
  | "batch_submit";

export interface Event {
  //
  op: MiddlewareOp;
  //
  phase: MiddlewarePhase;
  //
  provider: string;
  //
  model: string;
  //
  tool?: string;
  //
  args?: Record<string, unknown>;
  //
  result?: string;
  //
  usage?: Usage;
  //
  err?: Error;
  //
  duration?: number;
}

//
export type Context = unknown;

//
//
export type MiddlewareFn = (ctx: Context, e: Event) => Error | null;
