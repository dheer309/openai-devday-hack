# Third-party engine

The backend reuses **Export Paper Model** by Adam Dominec and contributors:

- Repository: https://github.com/addam/Export-Paper-Model-from-Blender
- Pinned revision: `d688dcd147b27c43fe15e086f2872d0a24b218bf`
- Add-on version: 1.4.2; requires Blender 5.0 or later.
- License declared by its Blender extension manifest: GPL-3.0-or-later.
- Original files are under `foldable/vendor/export_paper_model/`, unmodified.
- Full GPL text is provided in `LICENSE`. The combined backend is distributed under GPL-3.0-or-later; the separate frontend is not assigned a license by this document.

The established engine determines the unfolding, tabs, and packing. Our adapter supplies procedural shapes, reads the exact resulting panel geometry, validates assembly constraints, projects monochrome artwork, and writes the final presentation. These checks do not certify that a physical model has been assembled.

Neither the discarded custom unfolding prototype nor Papercraft Pro is used in the final backend.
