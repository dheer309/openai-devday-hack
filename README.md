# Foldable AI

Turn a description or reference image into a stylised paper character. The app interprets the reference with OpenAI, builds the actual low-poly geometry, shows its matching 3D model and paper net, and downloads a validated one-page A4 PDF.

## Run everything

Requirements: Node.js 22+ and either Python 3 or [uv](https://docs.astral.sh/uv/). From the repository root:

```sh
npm run dev
```

On the first run, this installs the locked web dependencies, reuses or prepares Python 3.11, and installs the backend and Blender runtime. The Blender download is substantial; subsequent starts reuse the installation. The launcher starts both services, checks that the geometry engine is ready, and serves the web app at **http://127.0.0.1:3000**. Press Ctrl+C to stop both services.

For AI interpretation, put your own credentials in `frontend/.env.local` (the launcher creates this file from `.env.example` if missing), then restart:

```dotenv
OPENAI_API_KEY=your-project-key
OPENAI_MODEL=gpt-5-mini
```

The key stays on the server and is ignored by Git. Choose a vision-capable Structured Outputs model available to your OpenAI project. AI uses the OpenAI Responses API with response storage disabled. **Design manually** creates real printable models without an API key; it does not substitute a saved example.

For the production build and both services:

```sh
npm start
```

This performs setup, builds the web app, and serves it with the geometry backend. To install dependencies without starting the app, use `npm run setup`. `PORT` and `GEOMETRY_PORT` default to 3000 and 8000. The combined launcher wires the frontend to its backend automatically.

## Create a character

- **Image:** upload PNG, JPEG or WebP up to 5 MiB. Optional guidance can accompany the image. For an animation sheet, use Image options to select one frame; the full sheet is not sent as one character.
- **Text:** describe the character and create its design with AI.
- **Design manually:** name and choose a shape, then create a model without AI.

Adjust shape, dimensions, proportions, ears and facial features under **Adjust features**. Updating any design invalidates the previous printable result. The backend supports box, rounded, diamond and crystal silhouettes; every shape uses real procedural geometry. This is a constrained interpretation rather than arbitrary photo-to-mesh reconstruction.

The viewer loads the backend GLB, and the paper-net view loads its SVG. There are no preloaded example results or simulated success states. Download unlocks only after the current design passes all required geometry, tab, page and assembly checks and its model/net have loaded. A failed layout gives an actionable error; it is never silently replaced with a cube.

The backend may reduce a version-2 design uniformly to fit A4 while preserving usable glue tabs. The result reports the actual size and scale. Some extreme combinations are intentionally rejected if they cannot be assembled comfortably.

## Printing

Print the downloaded PDF on A4 portrait, single-sided, black on white, at **100% / Actual size**, with headers/footers off. Verify that its 20 mm calibration segment measures correctly before cutting. Solid lines are cuts, dashed lines are folds, and matching numbers identify glue seams. Leave the rear opening until the final closure. Detailed instructions are included on the PDF and in [backend/README.md](backend/README.md).

Software checks establish geometry and page layout. Physical cutting, glue access, printer scaling and assembly still need a human check; no physical test is claimed by this repository.

## Verify

```sh
npm run typecheck
npm test
npm run build
```

`npm test` runs the frontend contract/input/proxy checks and the real backend geometry/export tests. Backend tests use Blender sequentially and reopen GLB/PDF outputs. Builds use two workers; the backend handles one uncached rendering job at a time and caches complete validated exports.

With the app running, check a complete live text-to-export request:

```sh
npm run check:integration -- --text "A sleepy cat named Pip with little whiskers"
```

Or validate a supplied specification:

```sh
npm run check:integration -- --design ../backend/examples/cat.design.json
```

The check downloads the actual GLB, SVG and PDF through the frontend proxy into ignored `work/integration/`. Committed example specifications are test fixtures, not preloaded app demos.

## Service layout

- `frontend/`: Next.js/TypeScript app and server-only OpenAI adapter.
- `backend/`: FastAPI, deterministic geometry, Blender Export Paper Model adapter, independent print validation and exporters.
- `POST /api/design`: interprets text or one reference image into the version-2 design schema.
- `GET /api/geometry-health`, `POST /api/render`, `GET /api/assets/:id/:filename`: frontend proxy routes to the local backend.
- Backend: `GET /health`, `GET /design-schema`, `POST /render`, `GET /assets/:id/:filename`.
- Version-1 cube designs remain compatible; version 2 enables variable shapes and dimensions. See [the interface contract](docs/interface-contract.md).

Advanced backend settings are documented in `backend/.env.example`. A compatible external Blender executable can be selected with `BLENDER_BIN`, or a separate bpy interpreter with `BLENDER_PYTHON`; otherwise the launcher installs the pinned bpy runtime. The backend stores session exports in ignored `backend/storage/` (override with `FOLDABLE_STORAGE`). Its separate-service commands are in [backend/README.md](backend/README.md).

## ChatGPT account pets

The application accepts character images, including exported ChatGPT pet images. It does not claim that an OpenAI API key or ChatGPT sign-in grants access to a visitor's pet library. No supported pet-library endpoint/permission was established for a standalone website. There is no fake account connection or shared snapshot of another user's pets. See [official sign-in guidance](https://developers.openai.com/siwc/quickstart).

## Attribution

The backend incorporates Blender Export Paper Model 1.4.2 and is distributed under GPL-3.0-or-later. Preserve [backend/LICENSE](backend/LICENSE) and [backend/THIRD_PARTY.md](backend/THIRD_PARTY.md). This does not assign that license to the independently maintained frontend.
