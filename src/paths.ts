// Dotted-path extraction for JSON response navigation.
// Mirrors Go's extractPath: supports "field", "field.sub", "arr[0].field".

export function extractPath(data: unknown, path: string): string {
  const raw = extractRaw(data, path);
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return raw;
  return String(raw);
}

// optIntPath is extractIntPath's honest form (ADR-081 AVAIL-001): undefined
// when the provider declares no location for this dimension (empty path) or
// the location is absent from the body, and the value — which may be a genuine
// zero — when the provider reported one.
//
// This is where the ambiguity used to be manufactured. extractIntPath answers
// "unreported" and "reported as zero" with the same 0, and every Usage
// dimension flowed through it, so the lie was created once and copied
// everywhere.
export function optIntPath(data: unknown, path: string): number | undefined {
  if (!path) return undefined;
  const raw = extractRaw(data, path);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

// optFloatPath is optIntPath for the fractional ADR-027 cost field.
export function optFloatPath(data: unknown, path: string): number | undefined {
  if (!path) return undefined;
  const raw = extractRaw(data, path);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseFloat(raw);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

export function extractIntPath(data: unknown, path: string): number {
  const raw = extractRaw(data, path);
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}


// setWirePath places `value` at a dot-notation path with array index support
// ("choices[0].message.content"), creating intermediate objects and array
// elements as it descends. It is the navigate-or-create inverse of extractRaw
// and walks the identical generated path strings (ADR-076 SYM-005). ANY segment
// may be indexed, not just the first: Google's response text path is
// candidates[0].content.parts[0].text — two array levels created in a single
// descent.
//
// An empty path (the provider declares no location for this field) or an empty
// value is a no-op: there is nothing to write, and materializing a zero would
// invent a field the provider never sent.
export function setWirePath(
  data: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  if (!path || isEmptyWireValue(value)) return;
  const parts = path.split(".");
  let current = data;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const last = i === parts.length - 1;
    const match = part.match(/^([^[]+)\[(\d+)\]$/);
    if (!match) {
      if (last) {
        current[part] = value;
        return;
      }
      current = childObject(current, part);
      continue;
    }
    const field = match[1]!;
    const idx = parseInt(match[2]!, 10);
    let items = current[field];
    if (!Array.isArray(items)) {
      items = [];
      current[field] = items;
    }
    const arr = items as unknown[];
    while (arr.length <= idx) arr.push(null);
    if (last) {
      arr[idx] = value;
      return;
    }
    const elem = arr[idx];
    if (typeof elem === "object" && elem !== null && !Array.isArray(elem)) {
      current = elem as Record<string, unknown>;
    } else {
      const created: Record<string, unknown> = {};
      arr[idx] = created;
      current = created;
    }
  }
}

// childObject returns m[field] as an object, creating it when absent or
// mistyped — the create half of extractRaw's member lookup.
function childObject(
  m: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const child = m[field];
  if (typeof child === "object" && child !== null && !Array.isArray(child)) {
    return child as Record<string, unknown>;
  }
  const created: Record<string, unknown> = {};
  m[field] = created;
  return created;
}

// isEmptyWireValue reports whether `value` is the zero of its canonical type.
// Empty values are skipped rather than written, so the encoder never claims a
// provider reported zero tokens when the canonical Response simply had none.
// undefined is the one case encodeResponse must not write: the field was NOT
// REPORTED, and materializing a value there would invent one the provider never
// sent. A reported ZERO is written, and that is the change ADR-081 forces here
// — the old rule dropped every zero because the type could not tell the two
// apart, so an explicit `cached_tokens: 0` round-tripped to a body that omitted
// the field.
function isEmptyWireValue(value: unknown): boolean {
  if (typeof value === "string") return value === "";
  return value === undefined || value === null;
}

function extractRaw(data: unknown, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = data;
  for (const part of path.split(".")) {
    const match = part.match(/^([^[]+)\[(\d+)\]$/);
    if (match) {
      const field = match[1]!;
      const idx = parseInt(match[2]!, 10);
      current = (current as Record<string, unknown>)?.[field];
      if (!Array.isArray(current)) return undefined;
      current = current[idx];
    } else {
      current = (current as Record<string, unknown>)?.[part];
    }
    if (current === undefined || current === null) return current;
  }
  return current;
}
