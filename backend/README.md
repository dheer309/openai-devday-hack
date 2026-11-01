# Geometry and print service

Procedural low-poly mascots, matching monochrome artwork, GLB preview, and a validated single-page A4 PDF/SVG. Unfolding, glue-tab geometry and packing come from the vendored **Blender Export Paper Model 1.4.2** engine. Python validates the result independently before serving exports. No API key or paid inference service is needed in this service.

## Run

Tested on Windows x64 with Python 3.13 and bpy 5.2.3 LTS. From this directory:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-blender.txt
.\.venv\Scripts\python.exe -m uvicorn foldable.app:app --host 127.0.0.1 --port 8000
```

The bpy wheel is large (approximately 340 MB on Windows). Alternatively install a compatible Blender 5.x runtime and set `BLENDER_BIN` to its executable; then only `requirements.txt` is needed in the service environment. `BLENDER_PYTHON` can select a separate interpreter with bpy installed. Environment variables are read from the process; `.env` files are not automatically loaded. See `.env.example`.

Use **one Uvicorn worker**: rendering is serialised with a process-local lock. Another simultaneous uncached render gets HTTP 503 `RENDER_BUSY`. Outputs are cached in `backend/storage` (or `FOLDABLE_STORAGE`) for the session. Keep this service local for the hackathon. Typical fixture exports measured about 4-5 seconds locally; no remote AI generation occurs here. A difficult request can try three layouts/scales with a 35-second worker timeout per attempt; clients should allow 120 seconds or retry safely using the same design.

## Integrate

- `GET /health`: supported contract versions and runtime availability.
- `GET /examples`: four real fixture specifications.
- `GET /design-schema`: version-2 Pydantic schema.
- `POST /render`: version-1 cube or version-2 variable shape.
- `GET /assets/{id}/model.glb`, `net.pdf`, `net.svg`: complete validated assets. `/api/assets/...` aliases also work directly.
- `GET /docs`: interactive API documentation.

```powershell
$design = Get-Content examples/cat.design.json -Raw
Invoke-RestMethod http://127.0.0.1:8000/render -Method Post -ContentType application/json -Body $design
```

Frontend rewrites `/api/render` to `/render`, `/api/geometry-health` to `/health`, and `/api/assets/...` to `/assets/...`. Browser asset URLs in responses begin `/api/assets/`. Use the returned GLB directly; it contains the exact exported geometry in metres and the matching facial artwork. Source geometry and paper measurements use millimetres. Axes are +X right, +Y up, +Z toward the face.

**Existing v1 frontend remains compatible.** To expose shape variation, Track B must add the v2 schema/response union and allow variable stats. v2 supports `box`, `rounded`, `diamond`, `crystal`, proportions 0.75-1.3, optional `pointed` ears, and requested largest size 40-65 mm. Pointed ears are part of a convex shell and form a stylised silhouette. OpenAI should select this structured specification from text or a selected photo/pet frame. It should not generate vertices or the net. See `../docs/interface-contract.md` for the exact request. Make nested properties required when adapting the schema for OpenAI strict Structured Outputs.

Some allowed shape/proportion combinations are unprintable; a 422 with failed checks is intentional. Correct the design rather than silently switching it to a cube. Only v2 may reduce model size to fit; actual size and scale are returned, and tab size is preserved. Names currently require printable Western European text because the PDF uses standard fonts.

## Export without the app

For the standing TV-faced robot demo (two boxes plus optional flat arms, antenna and base), run:

```powershell
.\.venv\Scripts\python.exe -m foldable.standing_pet --output work/standing-bsod
```

This produces `standing-bsod-duplex-a4.pdf`, front/back SVGs and a GLB of the two assembled boxes. Print the two PDF pages on one A4 sheet, duplex, flip on the long edge, actual size. The front is clean; numbered joins are on the mirrored inside. Check the registration crosses on a physical proof before cutting. It uses the existing Blender unfolding engine, 14 numbered tab joins, and 6 mm tabs. The assembled boxes are 54 mm tall; the antenna adds height. This is a standalone demo template inspired by the built-in BSOD pet; it is not an extension to the DesignSpec API. Optional flat parts are supplied on the print sheet and are not included in the box-only GLB. Legs are printed detail on the body, keeping a flat standing bottom. Glue the body's top to the underside of the head, then add the optional parts. Physical assembly remains untested.

```powershell
.\.venv\Scripts\python.exe -m foldable.cli examples/robot.design.json --output work/robot
.\.venv\Scripts\python.exe -m foldable.cli examples/cat.design.json --output work/cat
```

Each output folder contains `net.pdf`, `net.svg`, `model.glb`, `design.json`, `result.json` and `validation.json`. The validation record explicitly says `physically_tested: false`. Generated files are ignored by Git. The fixture specification is committed so every export can be reproduced.

## Printing and assembly

Print the robot fallback and cat hero, with spare copies in the same visit. Each model uses exactly one A4 sheet. The robot has 6 panels and 7 glued joins; the cat and pebble each have 20 panels and 11 joins; the crystal has 18 panels and 13 joins. All four tested fixtures fit at their requested size with approximately 6 mm tabs and one connected piece.

1. Use A4 portrait, single-sided, **Actual size / 100%**. Disable fit-to-page and headers. Check the printed calibration line measures 20 mm.
2. Cut only the solid outer outline, retaining tabs. Facial artwork and the small assembled preview are not cut lines. Score dashed lines gently with a ruler and blunt tool.
3. Dry-fold before applying glue. Printed surfaces face outward; dashed folds bend away from the printed side. Tabs tuck inside and meet the edge carrying the same number.
4. Begin at the facial area, then work around the sides. Numbers identify matching joins; they are not a mandatory assembly order. Use thin glue and let a few joins set at a time.
5. Leave a rear opening large enough to press tabs from inside. Dry-fit the final closure, glue its tabs, tuck them inside and press from outside with a blunt tool if needed. Close the rear last. On the robot, the large blank rear square is the easiest closing face.

These are digitally checked templates, not physically tested builds. Paper stiffness, cutting accuracy, glue and access during final closure still matter. Use the cube as the simplest first physical test. Bring scissors, ruler, glue stick or fast-setting craft glue, and a blunt scoring tool. Do not assume any model-to-net engine guarantees human assembly.

## Checks

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest tests -q
```

Tests run the actual Blender worker for all four fixtures and reopen the PDFs and GLBs. They check watertight geometry, winding, scale, one A4 page, label pairs, artwork transformations and GLB UV orientation, HTTP assets, v1 compatibility, invalid designs, runtime errors, and rejection of deliberately corrupted layouts. Runtime print validation also checks seam congruence, one tab per cut edge, overlaps, page bounds, minimum edge/tab size, receiving-face tab fit and assembly complexity.

On a restricted Windows runner where pytest cannot access its temporary/cache directories, use `-p no:cacheprovider -p no:tmpdir`; tests do not need those plugins. Rendering tests keep inspectable outputs under ignored `storage/test-*`.

## License

The combined backend is GPL-3.0-or-later because it incorporates Export Paper Model. See `LICENSE` and `THIRD_PARTY.md` for the pinned upstream source and attribution. This does not assign a license to the independently maintained frontend.
