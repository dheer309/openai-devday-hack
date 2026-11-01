# Foldable AI

Turn a description, photo, or ChatGPT pet reference into a small paper companion: preview the printable 3D model and download an A4 net with numbered glue tabs and black facial details.

This repository currently contains the implementation brief and two parallel build prompts. Application code has not been implemented or physically tested yet.

## Start the two build sessions

1. Read [AGENTS.md](AGENTS.md), the shared scope and three-hour plan.
2. Give the first implementation session [Prompt 1: geometry and print](prompts/01-geometry-print.md).
3. Give the second implementation session [Prompt 2: app, AI, and integration](prompts/02-app-ai.md).
4. Both sessions use the frozen [interface contract](docs/interface-contract.md).

Track A owns `backend/`. Track B owns `frontend/`, this README, and integration. They work on separate branches and integrate by minute 40-60.

## Physical demo constraints

- Two people, three hours, one printer visit about 30 minutes away.
- Monochrome A4, numbered tabs, cut/crease lines, simple printed facial details.
- Baseline: a known cube net personalised by AI. Generated arbitrary meshes are optional and explicitly experimental until validated.
- Freeze print files by roughly minute 85. One person travels to print around minute 90 while the other continues software work.
- A completed physical example is required. Print spare copies and a fallback in the same visit if possible.

Implementation sessions will replace this paragraph with verified setup commands as services become available. See `AGENTS.md` for acceptance criteria and the print gate.
