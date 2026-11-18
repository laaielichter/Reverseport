---
name: build-inspector
description: Inspect exported game builds and release folders with ReversePort — which engine and version made them, what is inside the Godot .pck or Unity/Unreal build, extract your own project files back out, and see exactly what changed between two builds. Use for "what's in this build", "which version shipped", "compare build 43 and 44", or recovering assets from a build you made.
---

# Inspect and compare game builds

## Identify the build

```text
re_scan {path:"<build folder>"}
```

Engines recognised in builds: Godot (separate `.pck` or pack embedded in the executable), Unity (`UnityPlayer`,
`<Game>_Data`, Mono vs IL2CPP, Unity version), Unreal (`Content/Paks/*.pak`, IoStore), GameMaker (`data.win`),
Ren'Py (`.rpa`), RPG Maker, Electron (`app.asar`), LÖVE.

## Look inside

```text
re_archive {file:"Game.pck"}                         → entries, sizes, types, Godot version, pack format
re_archive {file:"Game.exe"}                         → same, when the pack is embedded in the executable
re_archive {file, action:"extract", match:"*.gd"}    → extract (MD5-checked) into the workspace or out
re_il2cpp {file:"…/Metadata/global-metadata.dat"}    → Unity IL2CPP: assemblies, classes, method names, literals, C# skeleton
re_decode {path:"<extracted pack folder>"}         → .gdc → .gd, .scn/.res → .tscn/.tres, project.binary → project.godot
re_archive {file:"data.win"}                         → GameMaker: game name/version, sprite/object/room names, textures + audio
re_archive {file:"archive.rpa"}                      → Ren'Py: scripts/images/audio (.rpyc = compiled AST, no source)
re_archive {file:"Master.bank"} / {file:"Init.bnk"}  → FMOD events + FSB5 samples / Wwise media (.wem) + object counts
re_archive {file:"Game.pak"}                         → Unreal: entries, compression, stored/Zlib extract; encrypted = listed only
re_archive {file:"Build/game.data.br"}              → Unity WebGL: data files, StreamingAssets, IL2CPP metadata; Emscripten .data via its loader .js
re_archive {file:"game.swf"}                         → Flash: stage, AS2/AS3, classes, symbols, images/sounds/ABC extract
re_archive {file:"<Game>_Data/data.unity3d"}             → Unity build: objects by class and name, scenes, C# scripts in use (+ counts)
re_archive {file:"<Game>_Data/sharedassets0.assets"}     → the same for one serialized file (level0, globalgamemanagers, …)
re_archive {file:"StreamingAssets/<x>.bundle", action:"extract"} → asset bundle: textures → PNG, meshes → OBJ, audio (FSB5), text, objects as JSON
re_binary  {file:"<Game>_Data/Managed/Assembly-CSharp.dll"}   → Unity Mono build: game classes and methods
re_binary  {file:"Game.exe"}                         → arch, imports (graphics API, Steam, FMOD/Wwise…), hints
```

Godot exports store imported resources (`.ctex`, `.scn`, `.res` under `.godot/imported/`) rather than the original
files; scripts may be compiled or encrypted. Encrypted packs are reported as such — use the project source instead.
Unity bundles (LZ4/LZMA) and serialized files unpack without Unity. Player builds strip type trees: names, scripts in
use, TextAssets, audio and textures still come out, other objects extract as raw bytes (bundles give JSON). ASTC and BC7
textures are written as `.astc`/`.dds`, crunched textures as raw bytes. Encrypted bundles and Unreal paks with an
encrypted index are listed only.

Only extract builds the user made or has the right to inspect. To recover a lost project, prefer backups and version
control; a build is a last resort and gives imported (not original) assets.

## Compare two builds

```text
re_compare {a:"<old build folder>", b:"<new build folder>"}   → added / removed / changed files (by size, then hash)
re_compare {a:"old/Game.pck", b:"new/Game.pck"}               → changed entries inside the packs (MD5)
re_compare {a:"old/Game.exe", b:"new/Game.exe"}               → imports, exports and sections that changed
re_compare {a:"old/…/global-metadata.dat", b:"new/…/global-metadata.dat"} → IL2CPP types, methods and string literals that changed
```

Report: what changed (grouped: scripts, scenes, textures, audio, engine binary), the biggest size changes, anything
removed that looks unintended, and whether the engine version changed.
