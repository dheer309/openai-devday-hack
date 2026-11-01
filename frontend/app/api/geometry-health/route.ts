import "server-only";
import { z } from "zod";
import { geometryFetch, geometryJson } from "@/lib/server/geometry";
import { ApiError, errorResponse, jsonResponse } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const response = await geometryFetch("/health", request);
    const parsed = z.object({ status: z.literal("ok"), contract_version: z.literal(1) }).strict().safeParse(await geometryJson(response));
    if (!parsed.success) throw new ApiError(502, "GEOMETRY_CONTRACT_MISMATCH", "The geometry service is running but does not implement interface contract version 1.");
    return jsonResponse(parsed.data);
  } catch (error) { return errorResponse(error); }
}
