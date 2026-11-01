# Prompt 1: geometry and print engine

**Scope update:** Read the current approved scope at the top of `AGENTS.md` first. The user chose OpenAI-only paid usage, multiple procedural shapes, exactly one A4 sheet, and Blender Export Paper Model as the established unfolding engine. Preserve v1 compatibility and implement the v2 contract. References below to a cube-only product or paid 3D providers are superseded.

You are Track A of a two-person, three-hour hackathon build in https://github.com/dheer309/openai-devday-hack. Implement the geometry and printing half of Foldable AI. Read root `AGENTS.md` and `docs/interface-contract.md` first; treat their decisions and API schema as the shared brief.

We need text/photo/ChatGPT-pet input to become a recognisable monochrome paper mascot. The printer is 30 minutes away, we have one printing visit, and a finished physical example is required. The dependable physical demo is a 40 mm box mascot with black facial details and a known cube net. Genuine image-to-3D is an optional second path after the print gate. Do not spend the deadline on an arbitrary-mesh unfolding algorithm.

Work on `build/geometry-print`. Own only `backend/**`. Track B owns the frontend and integration. Do not overwrite its files, alter the shared contract unilaterally, reset others' changes, or spawn agents without explicit human authorization.

Implement a Python FastAPI backend exposing `GET /health`, `POST /render`, and `GET /assets/{asset_id}/{filename}` exactly as specified. Use a deterministic cube mesh, one authored valid cube net, explicit seam pairing, glue tabs, numbered mates, and a physically sensible closing sequence. Produce a GLB for the app, vector A4 PDF, and SVG net preview from shared geometry and face-local artwork mappings. Draw the eyes/mouth/whiskers/markings procedurally. Keep the PDF monochrome with solid cut lines, dashed creases, readable labels, 10 mm margins, and a 20 mm scale check. The GLB and printed face artwork must match in orientation.

Commit `backend/examples/robot.design.json` immediately so the other track has a real fixture. Target a basic valid PDF in 15-25 minutes, full fixture render by minute 40, and final physical-example files by minute 85. Store assets for the whole session; return browser-facing `/api/assets/...` URLs. Report the exact start command, requirements, and service port.

Run focused checks for closed geometry, edge/seam lengths, one tab per seam, label pairs, face/tab collisions, page bounds, label legibility, and re-folded geometry. A success response requires these checks to pass. Inspect rendered PDF pages visually. Explicitly review the final closing step. A digital check must never be represented as a physical test.

Prepare a print batch with the personalised hero, a safe robot fallback, and spare copies if multiple sheets are allowed. Freeze that example before the printing trip. Keep everything printable on ordinary A4. If spare paper is available, provide a hand-copyable net to check closing order before travel.

Only after the baseline is integrated and print-ready, time-box a faceted-head or genuine generated-mesh experiment to 15 minutes. Use existing unfolding tools if suitable, verify their behaviour, and preserve the reliable baseline. An attractive mesh is not evidence of a buildable net.

Commit and push incremental work to your branch. Give the operator the commit/branch to integrate around minute 40-60 and again before the print freeze; do not message another chat without authorization. Finish with a concise report: implemented routes, run command, test results, print-file locations, closing instructions, and any remaining physical validation. Start implementing now; make routine decisions yourself.
