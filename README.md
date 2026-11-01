# Foldable AI

Bring your ChatGPT pet into the real world: turn a description or reference image into an editable, monochrome **40 mm box mascot**. This is a stylised interpretation. The geometry service supplies the exact 3D model, paper net and A4 PDF.

## Track B: app and AI

This implementation lives on `build/app-ai`. Track A owns `backend/` on its own branch; this branch does not implement or replace that service. Merge the two branches when ready. The frozen [interface contract](docs/interface-contract.md) is unchanged.

### Run the app

Use Node.js 22 or newer and npm.

```sh
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open http://127.0.0.1:3000. Set these **server-only** variables in `frontend/.env.local`, then restart the app:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | An OpenAI project API key. Never use a `NEXT_PUBLIC_` variable. |
| `OPENAI_MODEL` | A model available to that project supporting image inputs and Structured Outputs. `gpt-5-mini` was available in the development account; select the model appropriate for your account. |
| `GEOMETRY_API_URL` | Geometry service origin. Defaults to `http://127.0.0.1:8000`. No path suffix. |

Credentials are optional for the saved example and manual editing. Without credentials, AI interpretation displays a setup message. Without the geometry service, the editor remains usable, and 3D/net/PDF remain unavailable with an explicit retry. There are no fabricated preview assets or successful print statuses.

Production build/run, still local:

```sh
cd frontend
npm run build
npm start
```

### Use the studio

1. Start with the clearly labelled saved robot design, type a description, or upload a PNG/JPEG/WebP up to 5 MiB. Photos and ChatGPT pet references use the same interpretation route.
2. For a sprite sheet, choose **Sprite sheet**, set its rows/columns, and click one frame. Only the selected local crop is sent to OpenAI. For uneven sheets, upload a cropped screenshot.
3. Interpret the reference with AI, then correct the name, eyes, mouth, whiskers or outline markings manually.
4. Build the printable model. The viewer loads the backend GLB; the net comes from its SVG. Editing invalidates the previous result immediately.
5. Download enables only for the current design after all eight print checks pass and its model and net load successfully.

Uploads stay in browser memory until you ask for interpretation. The server sends the description and selected image to OpenAI with response storage disabled. No account, gallery or ChatGPT sign-in integration is provided. The key never reaches the client.

## Integrate Track A

Start the backend using **Track A’s own start command** on port 8000. Its module path and dependencies are not assumed here. No backend commit is integrated yet.

| App route | Backend route / responsibility |
| --- | --- |
| `POST /api/design` | Frontend server → OpenAI Responses API; strict DesignSpec output |
| `GET /api/example` | Reads `backend/examples/robot.design.json` when available, otherwise the committed contract example in `frontend/examples/` |
| `GET /api/config` | Configuration booleans only; no credentials |
| `GET /api/geometry-health` | `GET /health` |
| `POST /api/render` | `POST /render`, DesignSpec directly, unchanged |
| `GET /api/assets/:assetId/:filename` | `GET /assets/:assetId/:filename`; allowlisted GLB/SVG/PDF only |

The server validates the response against the contract, checks that its design matches the request, requires all eight validation checks, and requires all assets to share one identifier. Backend validation errors retain their actionable messages. Failed requests never produce a downloadable result. Upload bodies are streamed with a 7 MiB total limit and 5 MiB decoded-image limit.

Once the backend is running beside the app:

```sh
cd frontend
npm run check:integration
```

This checks the **real** health/fixture/render/asset path and saves the returned GLB/SVG/PDF in ignored `work/integration/`. It never substitutes a mock service. It fails clearly while Track A is unavailable.

## Verify before printing

```sh
cd frontend
npm run typecheck
npm test
npm run build
```

Browser checks after merging Track A: load the saved example, rotate the returned GLB, inspect the net, interpret text and an uploaded image, select a sprite frame, manually edit a feature and confirm the old download disables, rebuild, and download the PDF. Test a failed validation and a stopped geometry service as well.

Inspect the actual downloaded PDF and printer preview: **A4 portrait, single-sided, black on white, 100% / actual size**, with headers and footers off. Check for clipping and measure the labelled 20 mm scale segment. Print two hero copies and the robot fallback if permitted. Use the backend’s numbered seam pairs and closing order. Do not call the design physically tested until someone has cut, folded and assembled it.

The backend, real PDF/print-preview inspection, print batch and physical assembly remain Track A/operator integration work. No printer-ready sample is claimed by this frontend-only branch.

## References

The implementation follows the official [OpenAI image-input guidance](https://developers.openai.com/api/docs/guides/images-vision) and [Structured Outputs guidance](https://developers.openai.com/api/docs/guides/structured-outputs). Project scope, ownership and physical-demo requirements remain in [AGENTS.md](AGENTS.md), [Prompt 1](prompts/01-geometry-print.md) and [Prompt 2](prompts/02-app-ai.md).
