import importlib.util
import json
import os
from pathlib import Path
import re

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

from .models import Design, DesignV2, PrintError
from .service import render_design, STORAGE, ROOT

app = FastAPI(title="Foldable AI geometry and print service", version="2.0.0")


def error(status, code, message, details=None):
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details or []}})


@app.exception_handler(RequestValidationError)
async def invalid_input(request, exc):
    details = [".".join(str(v) for v in e["loc"]) + ": " + e["msg"] for e in exc.errors()[:8]]
    return error(422, "INVALID_DESIGN", "The design does not match a supported shape specification.", details)


@app.exception_handler(PrintError)
async def invalid_print(request, exc):
    status = 503 if any(v in exc.details for v in ("engine_unavailable", "render_busy")) else 422
    return error(status, "ENGINE_UNAVAILABLE" if "engine_unavailable" in exc.details else
                 "RENDER_BUSY" if "render_busy" in exc.details else "PRINT_VALIDATION_FAILED", exc.message, exc.details)


@app.middleware("http")
async def request_limit(request: Request, call_next):
    try:
        length = int(request.headers.get("content-length", "0"))
    except ValueError:
        return error(400, "INVALID_REQUEST", "Invalid content length.")
    if length > 32 * 1024:
        return error(413, "REQUEST_TOO_LARGE", "Send a design specification, not an image, to the geometry service.")
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/health")
def health():
    executable = os.environ.get("BLENDER_BIN")
    ready = Path(executable).is_file() if executable else importlib.util.find_spec("bpy") is not None
    return {"status": "ok", "contract_version": 1, "supported_versions": [1, 2],
            "engine": "Export Paper Model 1.4.2", "engine_ready": ready}


@app.get("/design-schema")
def schema():
    return DesignV2.model_json_schema()


@app.get("/examples")
def examples():
    return [json.loads(p.read_text()) for p in sorted((ROOT / "examples").glob("*.design.json"))]


@app.post("/render")
def render(design: Design):
    return render_design(design)


@app.get("/assets/{asset_id}/{filename}")
@app.get("/api/assets/{asset_id}/{filename}", include_in_schema=False)
def asset(asset_id: str, filename: str):
    content_types = {"model.glb": "model/gltf-binary", "net.pdf": "application/pdf", "net.svg": "image/svg+xml"}
    if not re.fullmatch(r"[a-f0-9]{24}", asset_id) or filename not in content_types:
        return error(404, "ASSET_NOT_FOUND", "This asset does not exist.")
    folder = STORAGE / asset_id
    if not (folder / "result.json").is_file() or not (folder / filename).is_file():
        return error(404, "ASSET_NOT_FOUND", "This asset does not exist. Render the model first.")
    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
    if filename == "net.pdf":
        headers["Content-Disposition"] = 'attachment; filename="foldable-a4.pdf"'
    return FileResponse(folder / filename, media_type=content_types[filename], headers=headers)
