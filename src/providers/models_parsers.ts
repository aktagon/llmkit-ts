// Code generated — DO NOT EDIT.

//
//
//
//

export interface ParsedModelRecord {
  id: string;
  displayName?: string;
  description?: string;
  created?: number;
  contextWindow?: number;
  maxOutput?: number;
  raw: unknown;
}

export interface ParsedModelsPage {
  records: ParsedModelRecord[];
  nextCursor: string;
}


export function parseAnthropicModelsResponse(body: string): ParsedModelsPage {
  const envelope = JSON.parse(body) as {
    data?: Array<Record<string, unknown>>;
    has_more?: boolean;
    last_id?: string;
  };
  const data = envelope.data ?? [];
  const records: ParsedModelRecord[] = data.map((wire) => {
    const maxOut =
      (wire.max_output_tokens as number | undefined) ??
      (wire.max_tokens as number | undefined) ??
      0;
    const createdAt = wire.created_at as string | undefined;
    const created = createdAt ? Math.floor(new Date(createdAt).getTime() / 1000) || undefined : undefined;
    return {
      id: String(wire.id ?? ""),
      displayName: wire.display_name as string | undefined,
      contextWindow: wire.max_input_tokens as number | undefined,
      maxOutput: maxOut || undefined,
      created,
      raw: wire,
    };
  });
  const nextCursor = envelope.has_more && envelope.last_id ? envelope.last_id : "";
  return { records, nextCursor };
}



export function parseOpenAICohortModelsResponse(body: string): ParsedModelsPage {
  const envelope = JSON.parse(body) as { data?: Array<Record<string, unknown>> };
  const data = envelope.data ?? [];
  const records: ParsedModelRecord[] = data.map((wire) => ({
    id: String(wire.id ?? ""),
    created: wire.created as number | undefined,
    raw: wire,
  }));
  return { records, nextCursor: "" };
}



export function parseGoogleModelsResponse(body: string): ParsedModelsPage {
  const envelope = JSON.parse(body) as {
    models?: Array<Record<string, unknown>>;
    nextPageToken?: string;
  };
  const data = envelope.models ?? [];
  const records: ParsedModelRecord[] = data.map((wire) => {
    let id = String(wire.name ?? "");
    const prefix = "models/";
    if (id.startsWith(prefix)) id = id.slice(prefix.length);
    return {
      id,
      displayName: wire.displayName as string | undefined,
      description: wire.description as string | undefined,
      contextWindow: wire.inputTokenLimit as number | undefined,
      maxOutput: wire.outputTokenLimit as number | undefined,
      raw: wire,
    };
  });
  return { records, nextCursor: envelope.nextPageToken ?? "" };
}
