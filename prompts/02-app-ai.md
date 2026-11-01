# Prompt 2: app, AI interpretation, and integration

You are Track B of a two-person, three-hour hackathon build in https://github.com/dheer309/openai-devday-hack. Implement the product and AI half of Foldable AI and own end-to-end integration. Read root `AGENTS.md` and `docs/interface-contract.md` first; their scope, file ownership, timeline, and API contract are already agreed.

The headline demo is "Bring your ChatGPT pet into the real world." A user enters text or uploads a photo/pet image, sees the exact printable 3D mascot, previews its paper net, and downloads a numbered A4 PDF. Everything printed is black outline detail on white paper. The physical demo uses a reliable 40 mm box mascot. Be honest that this supported mode is an AI-personalised stylised interpretation. Genuine generated 3D shapes are optional after a working print path.

Work on `build/app-ai`. Own `frontend/**`, root `README.md`, and `.gitignore`; leave `backend/**` to Track A. Do not change the contract unilaterally, overwrite others' work, or spawn agents without human authorization.

Create a Next.js/TypeScript app. Prefer the relevant installed frontend design skill and a small, polished interface: input, a large readable 3D preview, net preview, validation status, simple feature controls, and a prominent PDF download. No accounts, billing, gallery backend, colour picker, or fake connection buttons. Put a saved example on the initial screen, clearly labelled, and keep the flow usable when external services fail.

Implement server-only `POST /api/design`. Read current official OpenAI image-input/structured-output guidance, use existing authorized credential tooling if available, and read the key/model from server environment variables. Do not ask the user to paste secrets into chat. Parse text or one reference image into the constrained DesignSpec: eye style, mouth, whiskers, and markings. Validate the output schema and provide manual corrections. The model does not generate mesh vertices or net geometry. If credentials are missing, make the missing setup clear and retain explicit example mode.

Support ordinary image upload and a "ChatGPT pet" choice. Accept a screenshot/clean character image. For a sprite sheet, let the user select/crop a frame; do not send the full sheet as a single character. Do not assume a public ChatGPT-pet account API exists. Do not spend time generating new pet art.

Load Track A's returned GLB with a lightweight Three.js viewer; do not maintain an independent approximation of the printable model. Implement the precise geometry proxy routes from the shared contract. Render the returned net preview, show validation failures, and only enable the final PDF download after successful validation. Handle real progress, errors, retry, and saved examples honestly.

Use the committed robot fixture while the geometry service is being built. Target app shell plus viewer in 20 minutes, AI/design controls by minute 40, and real fixture-to-backend-to-PDF integration by minute 60. Fetch and integrate Track A's pushed branch around minute 40-60; preserve its ownership. Coordinate the final print batch by minute 85, with one person departing around minute 90 for the 60-minute printing round trip.

Write `.env.example` files and concise setup commands in README. Ignore secrets and generated artifacts. Run typecheck/build and one actual browser flow covering example, upload/text, 3D result, net, validation, and PDF download. Inspect the PDF and print preview before the trip. Do not report a physical test until the operators assemble it.

After the baseline works, optional generated-3D support may be added only with the backend owner's agreement. Preserve the working supported mode and clearly label experimental outputs. Avoid late deployment work; a reliable local demo is acceptable.

Commit and push incremental work. Finish with the start commands, tested end-to-end behaviour, integrated backend commit, required environment names, printer-ready example status, and remaining limitations. Start implementing now; make routine choices yourself.
