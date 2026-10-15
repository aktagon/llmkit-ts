// Bun rejects a transport failure (connection refused, DNS, TLS) with an
// error whose `path` holds the full request URL. A query-parameter API key
// (`?key=`) would leak through that property, so drop it before rethrowing.
// message, code and errno are kept.
export async function fetchRedacted(
  url: string | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err !== null && typeof err === "object" && "path" in err) {
      delete (err as { path?: unknown }).path;
    }
    throw err;
  }
}
