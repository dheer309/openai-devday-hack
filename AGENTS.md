# Foldable AI: implementation instructions

## Current approved scope (supersedes the older cube-only sections below)

The user has explicitly revised the scope during implementation:

- Paid API usage is OpenAI only. Do not introduce Tripo/Meshy or another paid provider.
- Text or a photo/pet reference becomes a structured design specification. Deterministic geometry code builds a stylised low-poly model from supported shapes and proportions. No arbitrary-photo reconstruction claim.
- Models must vary: `box`, `rounded`, `diamond`, and `crystal`, with proportion controls and optional pointed ears. The cube is a compatibility fixture and fallback, not the entire product.
- Exactly one A4 sheet per model, black outlines only. Multiple paper pieces on the sheet are allowed.
- The latest user request prioritises speed and authorises replacing Blender. Use the validated lightweight local unfolding engine by default. Keep Blender Export Paper Model as an explicit optional engine; the normal startup must not download or require Blender.
- Prioritise human assembly: target 6 mm tabs; reject tabs under 4.5 mm, overly short edges, overlaps, missing mates, excessive joins/pieces, and layouts that do not fit. Software validation does not establish physical usability.
- Preserve the existing version-1 cube request/response for Track B. Add version 2 as specified in `docs/interface-contract.md`; keep synchronous `/render` because local procedural geometry does not need a remote generation job.
- User authorized updating this brief and the shared contract on `build/geometry-print`. Track A still owns backend implementation; no frontend source changes in this branch.
- The backend combines GPL-3.0-or-later Export Paper Model source and is distributed under that license with attribution and pinned upstream revision. See `backend/LICENSE` and `backend/THIRD_PARTY.md`.

These decisions take precedence over references to a cube-only release, Tripo, or an unverified alternative engine in the historical plan below.

## Mission and deadline

Build a working hackathon product in three hours with two people: turn text, a photo, or a ChatGPT pet reference into a small paper character. Show the printable 3D model, then export a numbered A4 PDF with glue tabs and black outline details.

The printer is about 30 minutes away. Assume a 60-minute round trip and one printing visit. A physically assembled example is a required deliverable. Reserve the last 30 minutes for assembly and rehearsal. Plan to send one person to print around minute 90 while the other continues integration.

The repository starts empty. This document is the agreed project brief, not evidence that anything is already implemented or tested. The three-hour clock starts when implementation starts; the times below are elapsed targets.

## Product decisions already made

- Black ink on white paper only. Print eyes, mouth, whiskers, and distinctive outline markings. No colour mode, shaded renders on paper, or AI texture-generation pass.
- Inputs: text, a normal image, or one selected frame/screenshot of a ChatGPT pet. These share one design and rendering pipeline.
- Baseline: an AI-personalised box-shaped mascot using one fixed, mathematically valid cube net. Its physical dimensions and topology are deliberately constrained. Label it a stylised interpretation.
- Use a 40 mm cube edge as the initial target, subject to validating the complete net plus tabs inside the print area. Do not shrink a failing layout silently.
- The baseline creates real 3D geometry procedurally. It is not arbitrary image-to-3D reconstruction. Do not claim otherwise in the UI or pitch.
- Genuine generated 3D meshes are a stretch goal after the baseline passes the print gate. An unvalidated generated mesh must never replace the supported print path silently.
- One completed physical pet is the minimum; a second example is desirable. Print spare copies and a fallback in the same visit if possible.
- Every sample and preloaded result must be a real output of the pipeline. Clearly identify saved examples; never simulate live generation.

## Definition of done

1. A user can enter text or upload an image and obtain an editable mascot design.
2. A ChatGPT pet image can use the same upload flow; a downloaded sprite sheet can supply a user-selected frame.
3. The app displays the exact geometry and facial artwork used by the exporter.
4. Download produces a single-sided A4 PDF at explicit physical dimensions, containing cut lines, crease lines, glue tabs, readable mating labels, a line legend, assembly order, and a scale-check mark.
5. The exporter validates geometry, seam pairing, tab clearance, and page bounds before labelling an output print-ready. A validation error blocks the final download and provides an actionable message.
6. The entire flow works with a saved design if credentials or network access fail. Label this mode explicitly; do not pretend AI ran.
7. At least one physical model has been cut, folded, and assembled before judging.

## Ownership: two implementation tracks

Do not spawn additional agents unless the human operator explicitly requests them. The two prompts in `prompts/` are intended for the two separately operated implementation sessions.

### Track A: geometry and print engine

Own `backend/**` and `backend/tests/**`. Implement the contract in `docs/interface-contract.md`. Do not edit `frontend/**`.

Deliverables:

- Python FastAPI service with health, render, and asset routes.
- A fixed cube mesh and known cube net with explicitly authored tab placement and assembly sequence. There is no need to integrate a general mesh unfolder for this baseline.
- GLB containing the mesh and simple monochrome face artwork; matching PDF and SVG preview derived from the same design, dimensions, face mapping, and net data.
- Print validation and a committed fixture at `backend/examples/robot.design.json`.
- Clear backend start command and meaningful tests.
- A generated print batch in ignored `work/print-batch/` containing the hero example, a safe robot, and spare copies. Do not commit derived files unless explicitly needed as sample fixtures.

Keep artwork on face-local coordinates and apply the face-to-net transform during export. Shared mapping must prevent rotated, mirrored, or misplaced faces. Glue numbers should sit on tabs or outside the character artwork where practical. Use filled black pupils only where useful; large filled regions and gradients are out of scope.

Validation must check: closed consistent cube geometry; zero-length edges; congruent seam pairs; exactly one tab for every seam; matching labels; no positive-area face/tab collisions, allowing intended shared borders; no off-page content; legible labels; and re-folded corner positions within numerical tolerance. Verify assembly order manually as well: the final face must be reachable. A digital refold is a geometry check, not a physical assembly test.

Suggested implementation: NumPy plus trimesh for GLB, ReportLab for vector PDF, and a polygon library if needed for intersection checks. Keep dependencies small and use deterministic code. A tiny raster artwork atlas generated with Pillow is acceptable; AI bitmap generation is unnecessary. The PDF facial details should remain vector where practical.

If time remains after the print gate, evaluate a 20-face faceted head OR one genuine generated mesh. Time-box that investigation to 15 minutes. Importing, repairing, simplifying, unfolding, and checking an arbitrary mesh is a separate problem. Existing unfold tooling is a candidate, not a proven integration.

### Track B: app, AI interpretation, and integration

Own `frontend/**`, `.gitignore`, and the root `README.md`. Do not edit `backend/**`. The contract is frozen initially; coordinate any necessary change before either track changes its implementation.

Deliverables:

- Next.js, TypeScript, and a restrained UI with input, 3D preview, net preview, validation state, and PDF download.
- A server-only `/api/design` route using a vision-capable OpenAI model for image inputs and schema-validated output. Read current official documentation before implementation; use a model available to the project's account and configure it via an environment variable.
- Map input to a constrained mascot specification: eyes, mouth, whiskers, and outline marks. Do not ask a language model to output arbitrary mesh vertices, a printable net, or exact cut geometry.
- Inputs for text and image, with a clear ChatGPT pet upload choice. For sprite sheets, provide manual frame selection/cropping and a screenshot fallback; never send the entire animation sheet to the 3D generator as one object.
- Browser 3D preview via Three.js / React Three Fiber or a simpler GLB viewer. Inspect the generated GLB; do not build a separate approximate mascot mesh in the frontend.
- Server proxy/rewrites for geometry endpoints and a real end-to-end request.
- Honest loading and error states, retry, saved-example mode, and a one-command-per-service local run guide.
- Integration ownership: bring Track A's backend into the working app early, and coordinate the final print batch.

Keep API keys server-side. Do not add signup, accounts, billing, a gallery backend, direct ChatGPT account login, or a polished deployment flow before the core works locally.

## ChatGPT pet scope

The demo story is: "Bring your ChatGPT pet into the real world."

For the baseline, the user supplies a downloaded sheet, selected frame, or screenshot. We have not established a public API allowing a standalone site to fetch arbitrary users' ChatGPT pets. Do not show a working-looking "Connect ChatGPT" button without a real integration.

The local ChatGPT/Codex Pets plugin can list and download eligible pets in its host environment. That access is not automatically available to this web application. If the operator supplies an exported asset, process it as an ordinary image.

## Optional genuine AI-to-3D path

Only start after a valid baseline PDF exists. Preserve the supported procedural mode.

- Evaluate a current Tripo P-series API through its v3 endpoint, or another provider for which credentials already work. Verify current official docs and account access instead of copying older tutorials.
- Tripo documents typical generation of 10-120 seconds, not a guaranteed latency. Benchmark the actual reference, record elapsed time, and allow graceful timeout/retry.
- Disable both texture and PBR generation for a geometry-only request; PBR may otherwise force textures on. Facial linework is a separate surface-mapping task.
- Provider face-budget minima are around 48-50 for the documented P-series, and quality recommendations are higher. Do not assume a clean, recognisable 20-face result is available directly.
- Validate and repair imported geometry before unfolding. Preserve planar faces, seam lengths, and artwork mapping. Reject unsupported results explicitly.
- A generated 3D preview without a validated printable net is experimental. Label it accordingly and keep the supported export available.
- Do not train or install a local GPU model during the three-hour build.

## Timeline and gates

| Elapsed | Track A | Track B | Gate |
| --- | --- | --- | --- |
| 0-15 min | Cube, known net, initial vector PDF | App shell, fixture input, 3D viewer | Both use the existing contract |
| 15-40 min | GLB, artwork, tabs, seam labels | Text/photo interpretation, manual edit controls | Fixture works through each track |
| 40-60 min | Geometry/page tests, refold check | Real backend integration, download | Valid end-to-end baseline |
| 60-85 min | Finalise hero and fallback print files | Pet frame selection, errors, saved example | Print gate; freeze physical geometry |
| Around 90 min | One person leaves with print batch | Other person continues software polish | Check printer availability before travel |
| 90-150 min | Printing trip; start assembly on site if practical | Fix integration, prepare demo | Do not change the frozen printed example |
| 150-180 min | Both finish assembly and rehearse | Both finish assembly and rehearse | Physical artifact ready |

If the printer becomes available sooner, print earlier. If time slips, cut optional features before cutting travel or assembly time. Avoid late dependency changes or hosting migrations.

## Print gate and handling

- A4 portrait: 210 x 297 mm; start with a 10 mm safe margin on all sides.
- Single-sided, black on white. Print at actual size / 100%, with browser headers/footers off. Use the exported PDF rather than printing the application screen.
- Include a labelled 20 mm scale-check segment. Inspect the printer preview for clipping before submitting.
- Start with roughly 6 mm tabs, subject to collision and accessibility validation. Reject tiny tabs instead of quietly producing them.
- Use distinct solid cuts and dashed creases plus a clear legend. For the supported convex cube, one crease convention is enough.
- A candidate sample can be hand-copied onto spare paper now to test tab direction and closing order. This does not validate printer scaling.
- Print two hero copies and the known-safe robot fallback in the same visit if multiple sheets are permitted. If only one sheet is allowed, prioritise the supported cube.
- Bring scissors, a ruler or scoring aid, glue stick or quick-setting adhesive, and spare paper. Assemble at the print location if that reduces risk.
- Document the final closing step; leave the appropriate face open until the end.

## Collaboration and repository rules

- Read this file and `docs/interface-contract.md` before implementation.
- Each track uses its own branch (`build/geometry-print` and `build/app-ai`) and commits early. Track B owns integration. Merge a working backend into the app checkout around minute 40-60, then integrate again before the print freeze.
- Preserve the other track's files. Do not reset, force-push, or discard others' changes.
- Keep secrets and generated assets out of Git. Add `.env.example` files with variable names only. Do not put API keys in logs or the browser bundle.
- Report concrete blockers promptly in the operator's current chat. Do not message another chat without the human's authorization.
- Run focused geometry tests for Track A and typecheck/build plus one real user-flow check for Track B. Do not spend the deadline on broad test infrastructure.
- Mark unsupported modes and saved outputs honestly. Do not call the product physically tested until someone has assembled an exported print.

## Reference sources

- OpenAI image input: https://developers.openai.com/api/docs/guides/images-vision
- ChatGPT pets: https://learn.chatgpt.com/docs/pets
- Tripo current request/task flow: https://developers.tripo3d.ai/en/docs/quick-start
- Tripo P-series parameters: https://developers.tripo3d.ai/en/docs/generation-image-to-model/p
- Blender Paper Model: https://addam.github.io/Export-Paper-Model-from-Blender/
- Papercraft Pro candidate: https://github.com/Liatach/papercraft-pro (GPL-3.0-or-later; evaluate fit before incorporating)
