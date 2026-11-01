import "server-only";
import { designSchema, renderResultSchema, sameDesign } from "@/lib/contracts";
import { geometryFetch, geometryJson } from "@/lib/server/geometry";
import { ApiError, errorResponse, jsonResponse, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 130;

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = designSchema.safeParse(await readJson(request, 8 * 1024));
    if (!parsed.success) throw new ApiError(422, "UNSUPPORTED_DESIGN", "Correct the mascot features before rendering. Choose a supported shape, size, and proportions.",
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`));
    const response = await geometryFetch("/render", request, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
    });
    const rendered = renderResultSchema.safeParse(await geometryJson(response));
    if (!rendered.success) throw new ApiError(502, "INVALID_GEOMETRY_RESPONSE", "The geometry service did not return a fully validated A4 result. Download is blocked until all print checks pass.",
      rendered.error.issues.map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`));
    if (!sameDesign(parsed.data, rendered.data.design)) throw new ApiError(502, "DESIGN_MISMATCH", "The rendered design differs from your current mascot. Retry after checking the backend contract.");
    return jsonResponse(rendered.data);
  } catch (error) { return errorResponse(error); }
}
