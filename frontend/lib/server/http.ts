export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: string[] = []) {
    super(message);
  }
}

export function errorResponse(error: unknown): Response {
  const known = error instanceof ApiError ? error : new ApiError(
    500, "INTERNAL_ERROR", "Something went wrong. Please retry.",
  );
  return Response.json({ error: { code: known.code, message: known.message, details: known.details } }, {
    status: known.status, headers: { "Cache-Control": "no-store" },
  });
}

/** Enforce limits while reading, including chunked bodies without Content-Length. */
export async function readLimitedBody(source: Request | Response, maxBytes: number): Promise<Uint8Array> {
  const declared = source.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The upload is too large. Use an image of 5 MiB or less.");
  }
  if (!source.body) throw new ApiError(400, "INVALID_JSON", "Send a JSON request body.");
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The upload is too large. Use an image of 5 MiB or less.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return joined;
}

export async function readJson(request: Request, limit: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ApiError(400, "INVALID_CONTENT_TYPE", "Send the request as application/json.");
  }
  const bytes = await readLimitedBody(request, limit);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, "INVALID_JSON", "The request is not valid JSON."); }
}

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
