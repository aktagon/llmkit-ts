//
//

export function extractPath(data: unknown, path: string): string {
  const raw = extractRaw(data, path);
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return raw;
  return String(raw);
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

export function extractFloatPath(data: unknown, path: string): number {
  const raw = extractRaw(data, path);
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseFloat(raw);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

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

//
//
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

//
//
//
function isEmptyWireValue(value: unknown): boolean {
  if (typeof value === "string") return value === "";
  if (typeof value === "number") return value === 0;
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
