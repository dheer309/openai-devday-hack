# Third-party engine

The optional Blender engine reuses **Export Paper Model** by Adam Dominec and contributors:

- Repository: https://github.com/addam/Export-Paper-Model-from-Blender
- Pinned revision: `d688dcd147b27c43fe15e086f2872d0a24b218bf`
- Add-on version: 1.4.2; requires Blender 5.0 or later.
- License declared by its Blender extension manifest: GPL-3.0-or-later.
- Original files are under `foldable/vendor/export_paper_model/`, unmodified.
- Full GPL text is provided in `LICENSE`. The combined backend is distributed under GPL-3.0-or-later; the separate frontend is not assigned a license by this document.

When explicitly selected, the established Blender engine determines unfolding, tabs and packing. The default local engine uses its own rigid panel search and collision-checked glue tabs. Both feed the independent validation and shared monochrome GLB/PDF/SVG exporter. Software checks do not certify physical assembly.

Papercraft Pro is not used. The lightweight local unfolding path was authorized during final integration to avoid a large Blender dependency in the default application.
