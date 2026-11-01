# Geometry and print service

The default engine unfolds supported procedural low-poly solids locally using NumPy, SciPy and Shapely. It builds rigid face transforms, chooses a spanning tree, assigns collision-checked glue tabs, and fits the result on one A4 sheet. An independent validator checks every result before GLB, SVG and PDF assets are served. No Blender, GPU, paid 3D provider or inference credential is required by the default geometry service.

## Run

Prefer the root application's setup/start commands. To run the backend separately with Python 3.11 or newer:

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn foldable.app:app --host 127.0.0.1 --port 8000
```

On Windows, use `.venv\Scripts\python.exe` instead. Environment variables are read from the process. `FOLDABLE_STORAGE` optionally chooses a persistent asset directory; the default is `backend/storage`.

Use one Uvicorn worker. Uncached rendering is serialized with a process-local lock; a simultaneous request returns `503 RENDER_BUSY`. Validated outputs are cached by source code, engine and design. Failed staging directories are removed, with the latest available worker diagnostic retained in `last-engine-error.log`.

## API and supported designs

- `GET /health`: runtime availability and supported versions.
- `POST /render`: v1 fixed cube or v2 box, rounded, diamond or crystal solid with proportions, optional pointed ears and requested largest size 40–65 mm.
- `GET /assets/{id}/model.glb`, `net.pdf`, `net.svg`: validated assets. Returned browser-facing paths use `/api/assets/...` for the frontend proxy.
- `GET /design-schema`, `/docs`: schema and API reference.
- `GET /examples`: reproducible test specifications; these are not substituted for a live user design.

Models are stylised procedural interpretations. Unsupported or unbuildable parameters return an actionable `422`; the service never replaces them with a cube. V2 may reduce physical size uniformly while preserving usable tabs, returning the actual size and applied scale. GLB coordinates are metres; paper coordinates are millimetres. +X is right, +Y up and +Z toward the face. GLB artwork and vector paper artwork share the same face mapping.

## Printing and assembly

Print A4 portrait, single-sided, at Actual size / 100%. Check the calibration segment measures 20 mm. Cut solid outlines, retaining tabs, and gently score dashed folds. Printed surfaces face outward. Glue matching numbered joins inside, starting around the face, leaving a rear opening for access and closing the rear last. Numbers identify mates rather than a compulsory order.

Software checks do not establish physical assembly. Paper stiffness, cutting and gluing accuracy still matter.

## Tests

```sh
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests -q
```

Tests generate and reopen real PDF/GLB outputs, check all supported profiles including diamond, reject corrupted layouts, verify artwork orientation, and cover API/runtime/storage behavior. Generated files stay in ignored storage directories.

## Optional Blender engine

The vendored Blender Export Paper Model 1.4.2 engine remains available for explicit comparison. Set `FOLDABLE_ENGINE=blender`, then either configure `BLENDER_BIN` to a compatible Blender 5.x executable or install `requirements-blender.txt`. That optional file selects bpy 5.0.1 for Python 3.11, or bpy 5.2.3 for Python 3.13; bpy 5.0.1 also requires NumPy <2. Default startup does not install this large dependency. Blender jobs retain their own timeout and never silently replace the default engine.

## License

The backend retains GPL-3.0-or-later vendored code for its optional Blender engine. See `LICENSE` and `THIRD_PARTY.md` for attribution. This does not assign a license to the separately maintained frontend.
