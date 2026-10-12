---
name: troubleshoot
description: Fix ReversePort errors and odd results — unreadable scenes, packs that will not list, missing dependencies in the graph, refused output folders, unsafe paths, big files, MCP connection problems. Use when a ReversePort tool returns an error or a result looks wrong.
---

# Troubleshooting ReversePort

| Error / symptom                                    | Cause                                                            | Fix                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `NOT_FOUND`, `NOT_A_FILE`, `NOT_A_FOLDER`          | Wrong path or kind                                               | Absolute paths are safest; `re_scan` wants a folder, `re_binary`/`re_archive`/`re_probe` a file.              |
| `BAD_FORMAT` on a Unity scene                      | Binary serialization                                             | Unity: Project Settings → Editor → Asset Serialization = Force Text, then save.                               |
| `UNSUPPORTED_SCENE` on .scn/.res                   | Godot binary resource                                            | Open in Godot, Save As .tscn/.tres.                                                                           |
| `NOT_A_PCK`                                        | No GDPC header, trailer or `pck` section                         | The pack may be next to the executable (`*.pck`), or the build is not Godot (`re_scan` the folder).           |
| `encryptedDirectory: true`                         | Encrypted Godot export                                           | Not supported by design. Use the project source.                                                              |
| `UNSUPPORTED_ARCHIVE` (Unity bundle, Unreal pak)   | Identified only                                                  | Port from the project source instead.                                                                         |
| Graph misses an edge                               | Dynamic loads (`load(path_var)`, reflection, string-built paths) | Read the code; add the dependency to your notes. Type references need class names of 3+ characters.           |
| `OUTPUT_NOT_EMPTY`                                 | The output folder has files ReversePort did not create           | Choose a new folder; ReversePort never overwrites foreign files.                                              |
| `UNSAFE_PATH`                                      | A path tried to leave the output/extraction folder               | Use paths relative to the output project, without `..`.                                                       |
| `INVALID_ARGUMENT … Unknown argument`              | Typo in an argument name                                         | The message lists the allowed names.                                                                          |
| Large results truncated                            | Limits keep answers readable                                     | Use `match`, `limit`, `offset`, or point at a subfolder.                                                      |
| MCP server not visible                             | Client not restarted / Node < 22.19 / not registered             | `reverseport doctor`, `reverseport setup`, then restart the agent app.                                        |
| Only `re_*`/`port_*` tools are listed              | The deep-analysis engine is not built                            | From npm: `npx -y reverseport@latest setup`. Git checkout: `npm ci && npm run build`, then restart the agent. |
| Only ReversePort tools listed (Claude Code plugin) | The plugin does not include the engine                           | Ask the user to start Claude Code with `REVERSEPORT_ENGINE_FETCH=npx`; do not also run setup.                 |
| Decompile/xref tools report a missing provider     | Ghidra, Hopper or IDA not configured                             | `reverseport doctor`, then follow docs/installation.md (provider setup).                                      |

Workspace: `~/.reverseport` (plans in `ports/`, extracted files in `extracted/`, reports in `reports/`); set
`REVERSEPORT_HOME` to move it.
