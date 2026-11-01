import hashlib
import json
import os
from pathlib import Path
import shutil
import threading
import time
import uuid

import numpy as np

from .engine import solve, validate, engine_name
from .export import export_all
from .models import DesignV1, PrintError

ROOT = Path(__file__).resolve().parents[1]
STORAGE = Path(os.environ.get("FOLDABLE_STORAGE", str(ROOT / "storage"))).resolve()
LOCK = threading.Lock()
CODE_HASH = hashlib.sha256(b''.join(p.read_bytes() for p in sorted(Path(__file__).parent.glob('*.py')))).hexdigest()[:16]


def render_design(design):
    encoded = json.dumps(design.model_dump(), sort_keys=True, separators=(',', ':'))
    asset_id = hashlib.sha256((CODE_HASH + engine_name() + encoded).encode()).hexdigest()[:24]
    folder = STORAGE / asset_id
    manifest = folder / "result.json"
    if manifest.is_file() and all((folder / name).is_file() for name in ("model.glb", "net.pdf", "net.svg")):
        return json.loads(manifest.read_text())
    if not LOCK.acquire(blocking=False):
        raise PrintError("Another model is rendering. Retry in a few seconds.", ["render_busy"])
    staging = None
    try:
        STORAGE.mkdir(parents=True, exist_ok=True)
        staging = STORAGE / ("_pending-" + uuid.uuid4().hex)
        staging.mkdir()
        started = time.monotonic()
        net = solve(design, staging)
        checks = validate(net)
        export_all(design, net, staging)
        stats = {"panel_count": len(net.solid.panels), "triangle_count": len(net.solid.triangles()),
                 "page_count": 1, "paper": "A4"}
        if isinstance(design, DesignV1):
            stats["edge_mm"] = 40
        else:
            stats.update({"size_mm": round(float(np.ptp(net.solid.vertices, axis=0).max()), 2),
                          "requested_size_mm": design.size_mm,
                          "scale_applied": net.scale,
                          "glue_join_count": len(net.seams), "piece_count": net.island_count,
                          "minimum_tab_depth_mm": round(min(s.depth_mm for s in net.seams), 2)})
        result = {"design": design.model_dump(), "mode": "supported",
                  "model_url": f"/api/assets/{asset_id}/model.glb",
                  "pdf_url": f"/api/assets/{asset_id}/net.pdf",
                  "preview_url": f"/api/assets/{asset_id}/net.svg",
                  "validation": {"status": "passed", "checks": checks}, "stats": stats}
        # Retain exact v1 envelope for the existing strict frontend validator.
        if not isinstance(design, DesignV1):
            result["engine"] = engine_name()
            result["interpretation"] = "procedural_low_poly"
        (staging / "result.json").write_text(json.dumps(result, indent=2))
        (staging / "design.json").write_text(json.dumps(design.model_dump(), indent=2))
        (staging / "validation.json").write_text(json.dumps({"checks": checks, "elapsed_seconds": round(time.monotonic()-started, 3),
            "physically_tested": False, "engine": "Export Paper Model 1.4.2",
            "panels": {str(i): p.points.tolist() for i, p in net.placed.items()},
            "tabs": [{"number": s.number, "depth_mm": s.depth_mm, "points": s.tab.tolist()} for s in net.seams]}, indent=2))
        if folder.exists():
            raise PrintError("A render with this identifier already exists. Retry after checking storage.", ["storage_conflict"])
        staging.rename(folder)
        return result
    finally:
        # Failed jobs are never publishable assets and must not accumulate.
        try:
            if staging is not None and staging.exists():
                engine_log = staging / "engine.log"
                if engine_log.is_file():
                    try:
                        shutil.copyfile(engine_log, STORAGE / "last-engine-error.log")
                    except OSError:
                        pass  # A diagnostic write must not hide the original error.
                shutil.rmtree(staging, ignore_errors=True)
        finally:
            LOCK.release()
