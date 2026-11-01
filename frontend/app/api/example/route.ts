import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import example from "@/examples/robot.design.json";
import { designSchema } from "@/lib/contracts";
import { ApiError, errorResponse, jsonResponse } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    let value: unknown = example;
    try {
      value = JSON.parse(await readFile(path.resolve(process.cwd(), "../backend/examples/robot.design.json"), "utf-8"));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw new ApiError(503, "INVALID_EXAMPLE", "Track A’s saved example could not be read. Check backend/examples/robot.design.json against DesignSpec v1.");
      }
    }
    const parsed = designSchema.safeParse(value);
    if (!parsed.success) throw new ApiError(503, "INVALID_EXAMPLE", "The saved example does not match DesignSpec v1. Check the committed fixture.");
    return jsonResponse({ design: parsed.data, source: "example" });
  } catch (error) { return errorResponse(error); }
}
