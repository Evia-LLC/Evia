# Ese editable character source

`ese.blend` contains the Blender 4.5 character, packed textures, facial morphs,
67-joint skeleton, and eight gesture clips. The app loads the exported
`public/character/ese/ese.glb`; the portal is implemented in
`src/character/portal.ts`.

The Blender file can be opened and edited directly. `build_ese.py` preserves the
generation process and requires the earlier project character source supplied
through its `--source` argument. It is not required to edit the packed file.

See `SOURCES.md` for the CC0 base model and project-authored additions, and
`validation.json` and `ese-rig-report.json` for export checks and the rig contract.

The homepage's requested AI-generated film is separate and remains unfinished.
