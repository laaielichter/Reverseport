# Prompts to try

| You ask                                                                            | ReversePort does                                                                                                                  |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| _What is this game made with, and how is it built?_                                | `re_scan` → engine + version, languages, entry points, how it starts                                                              |
| _I only have the exported Godot game, not the project._                            | `re_archive` extracts the .pck, `re_decode` turns .gdc/.scn/.res/project.binary back into an editable project                     |
| _A Unity IL2CPP game without its C# source._                                       | `re_il2cpp`: classes, methods and literals from global-metadata.dat, plus a C# skeleton                                           |
| _Get the art, models and audio out of my Unity build._                             | `re_archive` on data.unity3d, .assets or a bundle: PNG, FSB5 audio, text, scripts in use; OBJ and JSON where type trees exist     |
| _What changed between build 43 and 44?_                                            | `re_compare` folder-to-folder, pack-to-pack and .NET types and methods, biggest changes first                                     |
| _Keep this investigation honest — I need to show why._                             | `re_case`: evidence → claims that cite it → unknowns → decision → tests → report                                                  |
| _Map this codebase and write ARCHITECTURE.md._                                     | `re_graph`, `re_symbols`, `re_report`                                                                                             |
| _How do the packages in this Turborepo/pnpm monorepo depend on each other?_        | `re_scan` finds the workspace and its packages; `re_graph` resolves workspace names and tsconfig paths and shows who uses whom    |
| _Show me how this button on the website is built._                                 | `capture_web_screenshot` with a `selector`: a cropped image of the element, its HTML and its computed CSS                         |
| _All I have is data.win / an .rpa / a .pak / a .swf / a sound bank / a web build._ | `re_archive`: names, assets and facts out of GameMaker, Ren'Py, Unreal, Flash, FMOD, Wwise, Unity WebGL and Emscripten containers |
| _Why are my Unity materials pink and scripts "missing" after a move?_              | `re_refs`: dangling, duplicate and missing GUIDs, with remap suggestions                                                          |
| _Get every player-facing string out of this game so we can translate it._          | `re_strings`: .pot/.csv with ids and placeholders; `apply` writes a translated copy                                               |
| _Is this GDScript valid for Godot 4.3, or did the model mix in Godot 3?_           | `re_apicheck`: renamed names with replacements, invented members, too-new classes                                                 |
| _What is in this save file, is it checksummed, and which field is the gold?_       | `re_save`: layers, fields with roles, verified checksums, diff of two saves, schema + SaveData classes                            |
| _Upgrade my Godot 3 game to Godot 4._                                              | `port_upgrade`: converted copy (renames, @annotations, await, signals, scenes, project.godot) + what needs a human                |
| _Decompile the function that saves settings in this app and explain it._           | opens the binary in your Ghidra, Hopper or IDA, finds it, decompiles it, shows the evidence                                       |
| _How does this Electron app talk to its native side?_                              | maps modules, IPC and Electron boundaries                                                                                         |
| _What is `<some game>` made with? I don't have the files._                         | `re_lookup` from public sources: engine with confidence, stack, layout, remakes                                                   |
| _Rebuild the movement of `<game>` as precisely as possible in Godot._              | `re_blueprint`: systems, parameters to measure, parity table, skeleton                                                            |
| _Port my Unity UI, prefab variants and Animator to Godot._                         | `port_scene`: Control nodes with anchors, inherited scenes, AnimationPlayer + state machine from .anim/.controller                |
| _Port this Unity shader (or a Shadertoy) to Godot._                                | `port_shader`: uniforms, intrinsics and built-ins mapped, `PORT:` markers and leftovers for the rest                              |
| _Why does my ported game fall, slide and jump differently?_                        | `port_convert {physics}`: gravity, fixed step, damping, friction/bounce rules, layers → masks, jump velocity recomputed           |
| _Does the port really behave the same?_                                            | `port_verify` flags tick/delta/seed/order differences; `port_trace` logs both per tick and finds the first divergence             |
| _Move my RPG Maker MV/MZ game to Godot._                                           | `port_rpgmaker`: maps drawn from the tilesets, events running, database autoload, list of what is left                            |
| _Port my Godot game to Unity._                                                     | `port_plan` → `port_unit`/`port_write` loop → `port_scene` → `port_verify`                                                        |

```text
You:    Port my Godot game to Unity.
Agent:  re_scan → Godot 4.3, 6 scripts, 5 scenes, main scene main.tscn, autoload Global
        port_plan → 13 units, dependencies first; Unity scene builder + PORT-PLAN.md created
        port_unit / port_write × 7 → C# MonoBehaviours (signals → events, $Node → [SerializeField])
        port_scene × 5 → prefab and scene specs, transforms mirrored to Unity's axes
        port_verify → passed: 13/13 units, 0 leftovers, 0 missing functions
```
