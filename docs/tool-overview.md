# Tools

One MCP server (`reverseport mcp`) serves every tool:

| ReversePort tools                                                                                                                                |                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `re_scan` `re_graph` `re_symbols` `re_scene`                                                                                                     | projects and builds: engine, dependencies, symbols, scenes                                                                                                               |
| `re_binary` `re_archive` `re_probe` `re_extract` `re_compare` `re_refs` `re_strings` `re_apicheck` `re_save` `re_decode` `re_il2cpp` `re_report` | executables, packs (Godot, zip, asar, Ren'Py, GameMaker, FMOD/Wwise, Unreal, SWF), unknown data, diffs, GUID audit, localisation, API check, save files, ARCHITECTURE.md |
| `re_lookup` `re_blueprint`                                                                                                                       | recon without files, clean-room rebuild specs                                                                                                                            |
| `port_map` `port_convert` `port_plan` `port_unit` `port_write` `port_scene` `port_copy_assets` `port_status` `port_verify`                       | porting, verified                                                                                                                                                        |
| `port_upgrade` `port_shader` `port_trace` `port_rpgmaker`                                                                                        | Godot 3 → 4 as a converted copy plus the manual list; shader first drafts; per-tick behaviour traces compared                                                            |
| `re_case`                                                                                                                                        | proof case: evidence, claims, unknowns, decisions, tests                                                                                                                 |

Next to these come the deep-analysis tools — `open_binary`, `procedure_pseudo_code`, `xrefs`, `search_strings`,
`analyze_javascript_application`, `inspect_android_package`, `inspect_managed_artifact`, `observe_web_session` and
many more. `engine_tools` lists them from the running server, and `npm run docs:generate` writes the
[generated tool catalog](mcp-contracts.md#generated-catalog) with every contract. The HTTP API
(`reverseport serve`) exposes the same tools in every vendor's format; see [Connect any agent](connect-any-agent.md).
