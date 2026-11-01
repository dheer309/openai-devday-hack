# Shared interface: freeze before parallel implementation

Both tracks implement this contract. This file is a specification; no service exists yet. A coordinated change must update both implementations together.

## Development layout

- `frontend/`: Next.js app, port 3000. Owns `POST /api/design`.
- `backend/`: FastAPI service, port 8000. Owns `GET /health`, `POST /render`, and `GET /assets/{asset_id}/{filename}`.
- Frontend rewrites `/api/render` to backend `/render`, `/api/geometry-health` to `/health`, and `/api/assets/:path*` to `/assets/:path*`. Do not proxy `/api/design` to the backend.
- Set backend origin via server-only `GEOMETRY_API_URL`, default `http://127.0.0.1:8000`.
- Geometry responses return browser-facing asset paths beginning `/api/assets/`.
- Credentials: frontend server reads `OPENAI_API_KEY` and `OPENAI_MODEL`. Genuine mesh generation credentials are optional and belong only to its server adapter. Track B documents whichever variables it adds.

## DesignSpec v1

```json
{
  "version": 1,
  "name": "Sleepy robot",
  "shape": "box",
  "edge_mm": 40,
  "face": {
    "eyes": "sleepy",
    "mouth": "smile",
    "whiskers": false,
    "markings": "freckles"
  }
}
```

Constraints:

- `version`: literal `1`.
- `name`: trimmed string, 1-48 characters; plain display text only.
- `shape`: literal `box` in the baseline. Unknown shapes return an error, never silent substitution.
- `edge_mm`: literal `40` in the baseline. A new supported size requires re-validating page fit and tab clearances.
- `face.eyes`: `round`, `sleepy`, or `happy`.
- `face.mouth`: `smile`, `neutral`, or `open`.
- `face.whiskers`: boolean.
- `face.markings`: `none`, `freckles`, or `forehead_patch`.
- Reject extra properties in request schemas. Do not interpret text as code or paths.
- All baseline face details appear on the front face. Other faces stay white; more artwork placement is optional after the baseline works.
- Both sides share the enum spelling and defaults. AI output is validated against this schema, with an explicit retry or actionable failure. Manual edits allow a user to correct the interpretation.

`DesignSpec` is the one source of truth. The backend owns the mapping from these feature values to face-local artwork. The frontend loads the returned GLB to show the same mapping.

## POST /api/design (frontend server)

```json
{
  "input_type": "text",
  "text": "a sleepy robot with freckles",
  "image_data_url": null
}
```

- `input_type`: `text`, `photo`, or `chatgpt_pet`.
- Text input requires nonempty `text`, maximum 2000 characters. Text may accompany image inputs as extra guidance.
- Image inputs require `image_data_url` containing a cropped/selected PNG, JPEG, or WebP image. Initial decoded-image limit: 5 MiB; enforce corresponding HTTP/body limits explicitly.
- For `chatgpt_pet`, the browser first selects one frame or accepts a screenshot. The backend AI route sees one character, not an animation sheet.
- Response: `{ "design": <DesignSpec>, "source": "ai" }`.
- Fixture mode is an explicit user action and returns `{ "design": <DesignSpec>, "source": "example" }`. Missing credentials never silently masquerade as an AI result.

## GET /health (geometry backend)

```json
{ "status": "ok", "contract_version": 1 }
```

## POST /render (geometry backend)

Request body: a `DesignSpec` object directly, without a wrapper.

Successful response:

```json
{
  "design": {
    "version": 1,
    "name": "Sleepy robot",
    "shape": "box",
    "edge_mm": 40,
    "face": {
      "eyes": "sleepy",
      "mouth": "smile",
      "whiskers": false,
      "markings": "freckles"
    }
  },
  "mode": "supported",
  "model_url": "/api/assets/<asset_id>/model.glb",
  "pdf_url": "/api/assets/<asset_id>/net.pdf",
  "preview_url": "/api/assets/<asset_id>/net.svg",
  "validation": {
    "status": "passed",
    "checks": [
      "closed_mesh",
      "seam_lengths",
      "seam_labels",
      "one_tab_per_seam",
      "no_overlaps",
      "page_bounds",
      "label_legibility",
      "refold_geometry"
    ]
  },
  "stats": {
    "panel_count": 6,
    "triangle_count": 12,
    "page_count": 1,
    "edge_mm": 40,
    "paper": "A4"
  }
}
```

`<asset_id>` is schematic, never a literal identifier. Backend returns real unique or content-addressed asset IDs. Panel count represents six physical square faces; GLB triangulation may use twelve triangles without adding diagonal crease lines to the PDF.

- This is synchronous for the fixed-shape baseline. Do not build an async job service until genuine mesh generation needs it.
- Before success, render and validate all assets. Never return `passed` just because the PDF file was written.
- On invalid geometry or layout, return an error with failed checks and no downloadable final PDF URL. A debug preview may be logged locally.
- Persist assets for the entire demo session in an ignored backend storage directory. Avoid temporary-file deletion after the HTTP response.
- Asset routes must validate IDs/filenames, prohibit path traversal, and send correct content types.
- Supported success implies software validation only. The UI must not claim a physical test occurred.

## Errors

Use a common response envelope for handled errors:

```json
{
  "error": {
    "code": "PRINT_VALIDATION_FAILED",
    "message": "The net does not fit within the A4 print area.",
    "details": ["page_bounds"]
  }
}
```

Suggested HTTP statuses: `400` malformed input, `413` upload too large, `422` unsupported design or print validation failure, `503` missing service configuration/unavailable service, `502` upstream AI failure. Never return credentials or raw provider error payloads to the browser.

## Printable conventions

- A4 portrait, 210 x 297 mm; 10 mm safe margins.
- Physical panels are 40 mm squares. Author one fixed valid net; add collision-checked tabs around seam edges only.
- Label joins consistently, e.g. `1A` and `1B`, with a clear instruction to glue the pair. Each cut seam has exactly two mating sides and one glue tab.
- Solid cut lines; dashed crease lines; 20 mm scale-check segment and actual-size print instruction.
- Include an authored assembly sequence with the final closing face identified.
- Face details and crease/cut strokes are separate layers/concepts. Face artwork cannot alter glue topology.
- Model and net share an explicit front/up convention. Track A documents this convention next to its geometry mapping and tests it.

## Integration acceptance fixture

Track A commits the example DesignSpec and can render it without API credentials. Track B uses that exact fixture until `/api/design` works, then sends the validated AI output unchanged to `/api/render`. The first joint check is: fixture -> returned GLB -> visible net -> PDF downloaded through the frontend proxy.

Extensions (new shapes or genuine generated models) require a versioned/additive contract. Preserve the baseline fields and behaviour. Do not reuse `mode: supported` for an unchecked generated model.
