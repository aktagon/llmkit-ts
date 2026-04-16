// Dotted-path extraction for JSON response navigation.
// Mirrors Go's extractPath: supports "field", "field.sub", "arr[0].field".

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
