import "server-only";
import { z } from "zod";
import { geometryFetch, geometryJson } from "@/lib/server/geometry";
import { ApiError, errorResponse, jsonResponse } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const response = await geometryFetch("/health", request);
    const parsed = z.object({ status: z.literal("ok"), contract_version: z.literal(1), supported_versions: z.array(z.number().int()).optional(), engine: z.string().optional(), engine_ready: z.boolean().optional() }).strict().safeParse(await geometryJson(response));
    if (!parsed.success) throw new ApiError(502, "GEOMETRY_CONTRACT_MISMATCH", "The geometry service is running but does not implement interface contract version 1.");
    if (parsed.data.engine_ready === false) throw new ApiError(503, "ENGINE_UNAVAILABLE", "The print engine has not finished starting. Check the application startup output and retry.");
    return jsonResponse(parsed.data);
  } catch (error) { return errorResponse(error); }
}
