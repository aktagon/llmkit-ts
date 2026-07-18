// Code generated — DO NOT EDIT.


import type { MiddlewareOp } from "./middleware.ts";

//
//
//

export const TELEMETRY_SEMCONV_VERSION = "1.29.0";
export const TELEMETRY_TRACES_PATH = "/v1/traces";
export const TELEMETRY_ENDPOINT_REQUIRED = true;
export const TELEMETRY_CAPTURE_CONTENT_DEFAULT = false;

//
export const OTEL_ATTR_OP = "gen_ai.operation.name"; // Event.op
export const OTEL_ATTR_PROVIDER = "gen_ai.system"; // Event.provider
export const OTEL_ATTR_MODEL = "gen_ai.request.model"; // Event.model
export const OTEL_ATTR_ERR_TYPE = "error.type"; // Event.errType

//
export const OTEL_USAGE_INPUT = "gen_ai.usage.input_tokens";
export const OTEL_USAGE_OUTPUT = "gen_ai.usage.output_tokens";

//
//
export const TELEMETRY_OPERATION_NAME: Partial<Record<MiddlewareOp, string>> = {
  llm_request: "chat",
  tool_call: "execute_tool",
};
