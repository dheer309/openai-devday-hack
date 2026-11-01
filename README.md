# Foldable AI

Turn a description or reference image into a paper character. AI plans an assembly of coloured parts and face artwork. The local geometry engine builds the same assembly for the 3D preview and exports a separate paper net for each part.

## Run

Install Node.js 22+ and Python 3 (or uv), then run:

```sh
npm run dev
```

The launcher prepares dependencies and starts the app at http://127.0.0.1:3000. Add an OpenAI API key and a vision-capable model to `frontend/.env.local` for AI interpretation; the key stays on the server. The launcher creates this file from `frontend/.env.example` on the first run.

```dotenv
OPENAI_API_KEY=your-project-key
OPENAI_MODEL=gpt-5-mini
```

Use `PORT` and `GEOMETRY_PORT` to change the default ports. `npm start` builds and serves the production app. `npm run typecheck`, `npm test` and `npm run build` verify the implementation.

## Create and print

Upload a single image or choose a frame from a sprite sheet, or describe a character in text. The AI plans up to eight rectangular box parts, their positions, colours and front-face artwork; the engine builds and checks each part's net. This is a constrained assembly, not arbitrary image-to-3D reconstruction. The preview loads the actual exported 3D assembly and nets.

Print the PDF on A4 at 100% / actual size, double-sided with **flip on long edge**. Each part uses one front/back page pair: the outside has colour artwork and cut/fold lines; the inside has seam labels. Check the registration marks against a light before cutting; printer alignment varies. Software checks do not replace physically assembling a print.

Older version-1 and version-2 designs remain available through the render API and use their original single-sided export. The app can still make a simple legacy design without AI.

## Architecture

`POST /api/design` uses OpenAI to plan a version-3 assembly. `POST /api/render` sends the design to the Python geometry service, which exports the GLB, SVG preview and PDF. The renderer supports box parts between 20 and 40 mm per dimension; artwork uses coloured rectangles and ellipses on the front face. Output is deterministic for the same design. See [the interface contract](docs/interface-contract.md) for legacy formats.

The local ChatGPT/Codex Pets plugin can export a pet image, but an OpenAI API key does not grant this standalone app access to a user's pet library. Upload an exported image as a reference.

The backend incorporates Blender Export Paper Model 1.4.2 and is distributed under GPL-3.0-or-later. See [backend/LICENSE](backend/LICENSE) and [backend/THIRD_PARTY.md](backend/THIRD_PARTY.md).
