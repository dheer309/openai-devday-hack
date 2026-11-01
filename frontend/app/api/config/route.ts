import "server-only";
import { geometryOrigin } from "@/lib/server/geometry";
import { jsonResponse } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let geometryConfigured = false;
  try { geometryConfigured = Boolean(geometryOrigin()); } catch { /* Configuration status only. */ }
  return jsonResponse({
    ai_configured: Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_MODEL?.trim()),
    geometry_configured: geometryConfigured,
  });
}
