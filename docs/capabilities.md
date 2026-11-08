# What it does

### Understand and go deep

| Target                             | What you get                                                                                                                                                                        | Needs                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Source projects and exported games | Engine + version (Godot, Unity, Unreal, GameMaker, RPG Maker, Ren'Py, LÖVE, Defold, Bevy, MonoGame, web, Electron, Flutter, .NET, Go, Rust…), dependencies, cycles, scenes, symbols | Nothing                                                                                   |
| Packs and archives                 | Godot `.pck` (also embedded in the `.exe`), zip/apk/jar, `.unitypackage`, tar.gz, asar — list and extract; Quake PAK, Doom WAD, XNB, VPK and more recognised                        | Nothing                                                                                   |
| Unity IL2CPP                       | Classes, methods and literals from `global-metadata.dat`, plus a C# skeleton                                                                                                        | Nothing                                                                                   |
| Unity builds and asset bundles     | Every object by class and name, scenes, C# scripts in use; textures → PNG, meshes → OBJ, audio, text, JSON (UnityFS LZ4/LZMA)                                                       | Nothing                                                                                   |
| Native binaries                    | Mach-O, ELF, PE, wasm: functions, pseudocode, strings, xrefs, call paths, layout                                                                                                    | Ghidra, Hopper or IDA for decompilation ([setup](getting-started/installation.md#hopper)) |
| .NET assemblies                    | Metadata, CIL, native boundaries, type- and method-level build comparisons                                                                                                          | Nothing                                                                                   |
| Android                            | Manifest, classes, decompiled methods, references, resources, devices                                                                                                               | JADX / Apktool / adb ([guide](guides/android/android-analysis.md))                        |
| JavaScript and Electron            | Modules, imports, source maps, Electron boundaries, runtime observation                                                                                                             | Nothing; a browser for runtime                                                            |
| Websites                           | Page, network and runtime evidence; one element by CSS selector (cropped image, HTML, computed CSS); stack fingerprint without files                                                | A browser for runtime                                                                     |
| Firmware, EVM, crashes, captures   | Regions and extraction, selectors, recorded crashes, HAR/mitmproxy captures                                                                                                         | See the [guides](index.md)                                                                |

### Rebuild and port

| From → to             | Code                             | Scenes / prefabs                             | Transforms  | Project skeleton                   |
| --------------------- | -------------------------------- | -------------------------------------------- | ----------- | ---------------------------------- |
| Godot → **Unity**     | agent, with API map              | automatic → specs + one-click editor builder | Z-mirror    | scene builder script               |
| Godot → **Unreal**    | agent (.h/.cpp), with API map    | automatic → specs (cm, Z-up)                 | axes + ×100 | .uproject, module, targets         |
| Godot → **three.js**  | agent (TypeScript), with API map | automatic → TypeScript builder modules       | unchanged   | Vite + TS + fixed-step loop        |
| Godot → **Godot C#**  | agent, with API map              | automatic (script paths swapped)             | unchanged   | .csproj, project.godot             |
| Godot 3 → **4**       | converted copy                   | converted                                    | unchanged   | project.godot                      |
| Unity → **Godot**     | agent (GDScript), with API map   | automatic → `.tscn`                          | Z-mirror    | project.godot                      |
| Unity → **Unreal**    | agent, with API map              | —                                            | axes + ×100 | .uproject, module                  |
| RPG Maker → **Godot** | events run by an interpreter     | maps drawn from the tilesets                 | —           | Godot 4 project, database autoload |
| any → **language**    | agent                            | —                                            | —           | —                                  |
