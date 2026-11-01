import "server-only";
import { geometryFetch } from "@/lib/server/geometry";
import { ApiError, errorResponse } from "@/lib/server/http";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = {
  "model.glb": "model/gltf-binary", "net.pdf": "application/pdf", "net.svg": "image/svg+xml",
};

export async function GET(request: Request, context: { params: Promise<{ assetId: string; filename: string }> }): Promise<Response> {
  try {
    const { assetId, filename } = await context.params;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(assetId) || !Object.hasOwn(contentTypes, filename)) {
      throw new ApiError(400, "INVALID_ASSET", "Choose an asset returned by the geometry service.");
    }
    const response = await geometryFetch(`/assets/${assetId}/${filename}`, request);
    const headers: Record<string, string> = {
      "Content-Type": contentTypes[filename],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    };
    if (filename === "net.pdf") headers["Content-Disposition"] = 'attachment; filename="foldable-mascot-a4.pdf"';
    return new Response(response.body, { status: 200, headers });
  } catch (error) { return errorResponse(error); }
}
