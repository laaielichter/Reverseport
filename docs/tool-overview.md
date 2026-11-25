# Tools

One MCP server (`reverseport mcp`) serves every tool:

| ReversePort tools                                                                                                          |                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `re_scan` `re_graph` `re_symbols` `re_scene` `re_report`                                                                   | projects and builds: engine, dependencies, symbols, scenes, ARCHITECTURE.md                                                                                                                                                                     |
| `re_binary`                                                                                                                | executables at a glance: sections, imports, strings; detected packers, installers and compilers with evidence; capabilities from imports; PE version info, manifest, icons and Rich header; ELF build-id; Mach-O signature; wasm function names |
| `re_archive` `re_extract`                                                                                                  | packs and archives (Godot, Unity, zip/apk/ipa, asar, Ren'Py, GameMaker, FMOD/Wwise, Unreal `.pak`, SWF); Android manifest and iOS `Info.plist` summaries; carve bytes out                                                                       |
| `re_decode`                                                                                                                | Godot exports back to an editable project, imported resources back to PNG/WAV/OGG/MP3/CSV; Ren'Py `.rpyc` → `.rpy`; GameMaker GML bytecode → `.gml`                                                                                             |
| `re_il2cpp` `re_unreal`                                                                                                    | Unity IL2CPP metadata; Unreal `.uasset`/`.umap` tables, IoStore `.utoc` lists, `.locres`, GVAS saves                                                                                                                                            |
| `re_probe` `re_struct`                                                                                                     | unknown data: hex, entropy and embedded files of one file; the layout of a format from 2 to 32 sample files, with a Kaitai `.ksy` draft                                                                                                         |
| `re_save`                                                                                                                  | save files: layers, fields with roles, checksums, diff of two saves; Apple property lists and Steam VDF/ACF                                                                                                                                     |
| `re_compare` `re_refs` `re_strings` `re_apicheck`                                                                          | build diffs, Unity GUID audit, localisation, Godot API check                                                                                                                                                                                    |
| `re_lookup` `re_blueprint`                                                                                                 | recon without files, clean-room rebuild specs                                                                                                                                                                                                   |
| `port_map` `port_convert` `port_plan` `port_unit` `port_write` `port_scene` `port_copy_assets` `port_status` `port_verify` | porting, verified                                                                                                                                                                                                                               |
| `port_upgrade` `port_shader` `port_draft` `port_trace` `port_rpgmaker`                                                     | Godot 3 → 4 as a converted copy plus the manual list; shader and GDScript → C# first drafts; per-tick behaviour traces compared; RPG Maker MV/MZ → Godot                                                                                        |
| `re_case`                                                                                                                  | proof case: evidence, claims, unknowns, decisions, tests                                                                                                                                                                                        |
| `share_feedback`                                                                                                           | optional note for the maintainers; it stays on your computer until you share it                                                                                                                                                                 |

That is 36 ReversePort tools. With `set_tool_profile` and `run_batch` an agent sees 38 without the deep-analysis
engine and 60 with it in the standard profile; the [profile table](connect-any-agent.md) has the numbers for every
profile.

Every result passes the [injection shield](injection-shield.md): text in the target that reads like instructions to
an AI agent gets an `untrusted` note, and nothing is removed.

Per format: [Godot packs and exports](godot-pck.md), [Ren'Py](renpy.md), [GameMaker](gamemaker.md),
[Unreal](unreal.md), [Android and iOS](android-ios.md), [unknown formats from samples](re-struct.md).

Next to these come the deep-analysis tools — `open_binary`, `procedure_pseudo_code`, `xrefs`, `search_strings`,
`analyze_javascript_application`, `inspect_android_package`, `inspect_managed_artifact`, `observe_web_session` and
many more. `engine_tools` lists them from the running server, and `npm run docs:generate` writes the
[generated tool catalog](reference/mcp-contracts.md#generated-catalog) with every contract. The HTTP API
(`reverseport serve`) exposes the same tools in every vendor's format; see [Connect any agent](connect-any-agent.md).
