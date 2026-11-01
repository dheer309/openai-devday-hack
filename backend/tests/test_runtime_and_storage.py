from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import foldable.app as api
from foldable import service
from foldable.models import DESIGN_ADAPTER, PrintError


def test_health_checks_the_configured_blender_python(monkeypatch):
    monkeypatch.setenv("FOLDABLE_ENGINE", "blender")
    monkeypatch.delenv("BLENDER_BIN", raising=False)
    monkeypatch.setenv("BLENDER_PYTHON", "/configured/python")
    calls = []

    def probe(command, **options):
        calls.append(command)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(api.subprocess, "run", probe)
    response = TestClient(api.app).get("/health")
    assert response.json()["engine_ready"] is True
    assert calls[0][0] == "/configured/python"
    assert "bpy" in calls[0][-1]


def test_health_reports_missing_configured_runtime(monkeypatch):
    monkeypatch.setenv("FOLDABLE_ENGINE", "blender")
    monkeypatch.delenv("BLENDER_BIN", raising=False)
    monkeypatch.setenv("BLENDER_PYTHON", "/missing/python")

    def missing(*args, **kwargs):
        raise FileNotFoundError()

    monkeypatch.setattr(api.subprocess, "run", missing)
    assert TestClient(api.app).get("/health").json()["engine_ready"] is False


@pytest.mark.parametrize("diagnostic_writable", [True, False])
def test_failed_render_cleans_staging_and_releases_the_lock(monkeypatch, tmp_path, diagnostic_writable):
    monkeypatch.setattr(service, "STORAGE", tmp_path)

    if not diagnostic_writable:
        def unwritable(*args, **kwargs):
            raise PermissionError()
        monkeypatch.setattr(service.shutil, "copyfile", unwritable)

    def failed(design, staging):
        (staging / "engine.log").write_text("Runtime diagnostic", encoding="utf-8")
        raise PrintError("Unable to render.", ["engine_unavailable"])

    monkeypatch.setattr(service, "solve", failed)
    design = DESIGN_ADAPTER.validate_python({"version": 2, "name": "Cleanup check"})
    with pytest.raises(PrintError):
        service.render_design(design)
    assert list(tmp_path.glob("_pending-*")) == []
    assert list(tmp_path.glob("*/result.json")) == []
    if diagnostic_writable:
        assert (tmp_path / "last-engine-error.log").read_text() == "Runtime diagnostic"
    assert service.LOCK.acquire(blocking=False)
    service.LOCK.release()
