import "server-only";
import { z } from "zod";
import { ApiError, readLimitedBody } from "./http";

export function geometryOrigin(): string {
  try {
    const url = new URL(process.env.GEOMETRY_API_URL?.trim() || "http://127.0.0.1:8000");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid origin");
    return url.origin;
  } catch {
    throw new ApiError(503, "GEOMETRY_CONFIGURATION_REQUIRED", "Set GEOMETRY_API_URL to the geometry service origin, then restart the app.");
  }
}

const geometryErrorSchema = z.object({ error: z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  message: z.string().min(1).max(500),
  details: z.array(z.string().max(160)).max(32).default([]),
}) });

export async function geometryFetch(path: string, request: Request, init: RequestInit = {}): Promise<Response> {
  const origin = geometryOrigin();
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
    });
  } catch {
    throw new ApiError(503, "GEOMETRY_UNAVAILABLE", "The geometry service is unavailable. Start Track A’s backend on port 8000, or check GEOMETRY_API_URL, then retry.");
  }
  if (!response.ok) {
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(await readLimitedBody(response, 32 * 1024))); }
    catch { /* Do not expose unstructured upstream responses. */ }
    const parsed = geometryErrorSchema.safeParse(value);
    if (parsed.success) {
      const status = [400, 404, 413, 422, 503].includes(response.status) ? response.status : 502;
      throw new ApiError(status, parsed.data.error.code, parsed.data.error.message, parsed.data.error.details);
    }
    throw new ApiError(response.status === 404 ? 404 : 502, "GEOMETRY_ERROR",
      response.status === 404 ? "This asset is no longer available. Render the mascot again." : "The geometry service could not complete this request. Check the backend and retry.");
  }
  return response;
}

export async function geometryJson(response: Response): Promise<unknown> {
  try { return JSON.parse(new TextDecoder().decode(await readLimitedBody(response, 256 * 1024))); }
  catch { throw new ApiError(502, "INVALID_GEOMETRY_RESPONSE", "The geometry service returned an invalid response. Check the shared interface contract."); }
}
