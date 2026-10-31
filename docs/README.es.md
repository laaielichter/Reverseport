<div align="center">

# ReversePort

### Reverse engineer anything. Port it anywhere.

**One CLI and one MCP server that let your coding agent take apart apps, games, binaries and websites — and rebuild them.**

[![npm](https://img.shields.io/npm/v/reverseport?style=flat-square&color=1e4f91)](https://www.npmjs.com/package/reverseport)
[![npm downloads](https://img.shields.io/npm/dm/reverseport?style=flat-square&color=1e4f91)](https://www.npmjs.com/package/reverseport)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.laaielichter%2Freverseport-5c4ee5?style=flat-square)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.laaielichter/reverseport)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](docs/mcp-contracts.md#generated-catalog)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22.19%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](docs/installation.md)

```bash
npx reverseport setup
```

<img src="docs/assets/demo.gif" alt="Terminal: ReversePort scans Godot's 2D platformer demo, plans a port to Unity with 68 units, copies 38 assets, converts a scene and verifies progress" width="640">

<sub>A real run on <a href="https://github.com/godotengine/godot-demo-projects/tree/master/2d/platformer">Godot's 2D platformer demo</a>, JSON trimmed to the key fields.</sub>

[Website](https://laaielichter.github.io/Reverseport/) · [Quick start](#quick-start) · [Every agent](#works-with-every-agent) · [What it does](#what-it-does) · [C?mo se compara](#how-it-compares) · [FAQ](#faq) · [Docs](#documentation)

</div>

---

See a feature you like in an app or a game? Ask your agent how it works — down to the decompiled function — and
despu?s p?dele que cree tu propia versi?n. Have a game in Godot and want it in Unity? Ask your agent to port it, unit by
unit, verified. No files at all? Give it a name or a store page.

ReversePort ofrece a los agentes una forma coherente de hacer todo eso:

- 🔍 **Comprende cualquier cosa** — engine and version of any project or exported game, dependency graphs, scenes,
  symbols in 30+ languages, executables, packs and unknown data. No build step, no dependencies.
- 🧠 **Profundiza** — decompile, cross-reference and trace native, managed (.NET), Android, Electron/JavaScript,
  WebAssembly, firmware and browser targets through Ghidra, Hopper, IDA, JADX and more. ReversePort connects to the
  tools you have installed, drives them and shows the evidence behind every conclusion.
- 🌐 **No files? Still recon** — a name, a store page, a website or a public repo is enough to learn the engine,
  stack, file layout and open-source remakes from public sources.
- 🧩 **Reconstruye con precisi?n** — turn what you learned into a clean-room rebuild spec: every system, the parameters to
  measure on the original, a parity table and a project skeleton with every value as a tunable.
- 🚚 **Porta de verdad** — Godot ⇄ Unity, Godot → Unreal, Godot → three.js, GDScript → C#, or language to language.
  Scenes and transforms convert automatically; code is ported by your agent with API maps; `port_verify` proves
  nothing was left behind.
- 🔒 **Local** — runs on your machine. Objetivos are only read; output goes to new folders. Nada is uploaded to an
  analysis service and there is no extra API bill.

## Quick start

### 1. Connect your agent

With Node.js 22.19 or newer:

```bash
npx reverseport setup
```

Pick your agents, review the changes and approve. Setup registers one MCP server and installs the matching skill,
con copias de seguridad de la configuraci?n existente. Reinicia tu agente despu?s. Setup supports Claude C?digo, C?digox, Cursor,
Gemini CLI, GitHub Copilot, OpenC?digo and [more agents](docs/installation.md#supported-agents); other clients can use
[manual MCP registration](docs/installation.md#mcp-registry).

**Claude C?digo plugin** (instead of setup for Claude C?digo — includes the server, the porting skills and the
`port-architect` agent; do not use both):

```text
/plugin marketplace add laaielichter/reverseport
/plugin install reverseport@reverseport
```

**From source:**

```bash
git clone https://github.com/laaielichter/reverseport && cd reverseport
npm ci && npm run build
./bin/reverseport.mjs setup
```

The recon, build-inspection, lookup, blueprint and porting commands already work right after `git clone`, with no
install at all: `node bin/reverseport.mjs scan ./MyGame`.

### 2. Ask your agent

```text
Understand how search works in the Notes app, show me the evidence, and build a similar feature for my project.
```

That's it. The agent picks the tools; you get answers with the evidence behind them.

## Works with every agent

Any vendor, any framework, any model size — the same tools through the door that fits:

- **MCP**: `npx -y reverseport@latest setup` configures installed agents; `reverseport connect <client>` prints the
  snippet for any other MCP client (Windsurf, Cline, Continue, Zed, Goose, LM Studio, VS C?digo…).
- **MCP over HTTP**: `reverseport serve` → `http://127.0.0.1:32147/mcp`.
- **Function calling**: `/api/agent/tools?format=openai-strict|responses|anthropic|gemini`, plus OpenAPI 3.1 at
  `/api/openapi.json` for GPT Actions, LangChain, LlamaIndex, Semantic Kernel, CrewAI, AutoGen and n8n.
- **Shell-only agents**: JSON on stdout, errors as JSON on stderr, `reverseport describe <tool>`.

Built for the agent's circumstances too:

- **A short list by default.** About 45 tools are listed instead of almost 200. Every other tool is one call away:
  `engine_tools` finds it and `engine_call` runs it.
- **The list fits the agent.** Small or older models use `compact`, large-context agents use `full`, and an agent
  can switch itself with `set_tool_profile`.
- **Un formato de error en todas partes**, with a code, whether retrying helps, and the exact next step.
- **A `next` field wherever there is an obvious next step** (graphs, truncated results, every porting step), with the exact call.
- **Los agentes son escuchados.** `share_feedback` leaves a note for the maintainers; it stays on the user's machine until
  they share it.

See [Connect any agent](docs/connect-any-agent.md).

## Prompts para probar

| You ask                                                                             | ReversePort does                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| _?Con qu? est? hecho este juego y c?mo se construye?_                               | `re_scan` → engine + version, languages, entry points, how it starts            |
| _Mapea este c?digo y escribe ARCHITECTURE.md._                                      | `re_graph`, `re_symbols`, `re_report`                                           |
| _?Qu? cambi? entre las compilaciones 43 y 44?_                                      | `re_compare` folder-to-folder and pack-to-pack, biggest changes first           |
| _Descompila la funci?n que guarda la configuraci?n en esta aplicaci?n y expl?cala._ | opens the binary, finds it, decompiles it, shows the evidence                   |
| _?C?mo se comunica esta aplicaci?n Electron con su parte nativa?_                   | maps modules, IPC and Electron boundaries                                       |
| _What is `<some game>` made with? I don't have the files._                          | `re_lookup` from public sources: engine with confidence, stack, layout, remakes |
| _Reconstruye el movimiento de `<game>` as precisely as possible in Godot._          | `re_blueprint`: systems, parameters to measure, parity table, skeleton          |
| _Port my Godot game to Unity._                                                      | `port_plan` → `port_unit`/`port_write` loop → `port_scene` → `port_verify`      |

```text
You:    Port my Godot game to Unity.
Agent:  re_scan → Godot 4.3, 6 scripts, 5 scenes, main scene main.tscn, autoload Global
        port_plan → 13 units, dependencies first; Unity scene builder + PORT-PLAN.md created
        port_unit / port_write × 7 → C# MonoBehaviours (signals → events, $Node → [SerializeField])
        port_scene × 5 → prefab and scene specs, transforms mirrored to Unity's axes
        port_verify → passed: 13/13 units, 0 leftovers, 0 missing functions
```

## What it does

### Understand and go deep

| Objetivo                             | Qu? obtienes                                                                                                                                                                        | Necesita                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Proyectos fuente y juegos exportados | Engine + version (Godot, Unity, Unreal, GameMaker, RPG Maker, Ren'Py, LÖVE, Defold, Bevy, MonoGame, web, Electron, Flutter, .NET, Go, Rust…), dependencies, cycles, scenes, symbols | Nada                                                                           |
| Paquetes y archivos                  | Godot `.pck` (also embedded in the `.exe`), zip/apk/jar, `.unitypackage`, tar.gz, asar — list and extract                                                                           | Nada                                                                           |
| Binarios nativos                     | Mach-O, ELF, PE, wasm: functions, pseudocode, strings, xrefs, call paths, layout                                                                                                    | Ghidra, Hopper or IDA for decompilation ([setup](docs/installation.md#hopper)) |
| Ensamblados .NET                     | Metadata, CIL, native boundaries, build comparisons                                                                                                                                 | Nada                                                                           |
| Android                              | Manifest, classes, decompiled methods, references, resources, devices                                                                                                               | JADX / Apktool / adb ([guide](docs/android-analysis.md))                       |
| JavaScript y Electron                | Modules, imports, source maps, Electron boundaries, runtime observation                                                                                                             | Nada; a browser for runtime                                                    |
| Sitios web                           | Page, network and runtime evidence; stack fingerprint without files                                                                                                                 | A browser for runtime                                                          |
| Firmware, EVM, errores y capturas    | Regions and extraction, selectors, recorded crashes, HAR/mitmproxy captures                                                                                                         | See the [guides](docs/index.md)                                                |

### Rebuild and port

| From → to            | C?digo                           | Escenas / prefabs                            | Transformaciones | Estructura del proyecto     |
| -------------------- | -------------------------------- | -------------------------------------------- | ---------------- | --------------------------- |
| Godot → **Unity**    | agent, with API map              | automatic → specs + one-click editor builder | Z-mirror         | scene builder script        |
| Godot → **Unreal**   | agent (.h/.cpp), with API map    | automatic → specs (cm, Z-up)                 | axes + ×100      | .uproject, module, targets  |
| Godot → **three.js** | agent (TypeScript), with API map | automatic → TypeScript builder modules       | unchanged        | Vite + TS + fixed-step loop |
| Godot → **Godot C#** | agent, with API map              | automatic (script paths swapped)             | unchanged        | .csproj, project.godot      |
| Unity → **Godot**    | agent (GDScript), with API map   | automatic → `.tscn`                          | Z-mirror         | project.godot               |
| Unity → **Unreal**   | agent, with API map              | —                                            | axes + ×100      | .uproject, module           |
| any → **language**   | agent                            | —                                            | —                | —                           |

## CLI

Everything the agent can do, you can do from the shell. Results are JSON.

```bash
reverseport scan ./MyGame                        # engine, languages, entry points
reverseport lookup "Some Game"                   # no files: engine, stack, structure, remakes
reverseport binary ./Build/Game.exe              # sections, imports, .NET types, strings, hints
reverseport archive ./Build/Game.pck --action extract --match "*.gd"
reverseport diff ./Build-43 ./Build-44           # what changed between builds
reverseport analyze /Applications/Notes.app      # deep analysis: open and summarize a binary/app
reverseport decompile /path/to/binary 0x1000      # pseudocode (Ghidra, Hopper or IDA)
reverseport blueprint --lookup-id <id>           # clean-room rebuild spec + parity.json + skeleton
reverseport plan ./MyGame --to unity             # start a port
reverseport case init --question "…" --target ./Build   # proof case: evidence → claims → decision → tests
reverseport doctor                               # check engines and agent registrations
reverseport help                                 # overview · reverseport port help · reverseport engine --help
```

Instala el comando para uso habitual con `npm install --global reverseport`, or run any of these through
`npx reverseport@latest …`. In a checkout, use `./bin/reverseport.mjs`.

## Tools

Un servidor MCP (`reverseport mcp`) serves every tool:

| ReversePort tools                                                                                                          |                                                            |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `re_scan` `re_graph` `re_symbols` `re_scene`                                                                               | projects and builds: engine, dependencies, symbols, scenes |
| `re_binary` `re_archive` `re_probe` `re_extract` `re_compare` `re_report`                                                  | executables, packs, unknown data, diffs, ARCHITECTURE.md   |
| `re_lookup` `re_blueprint`                                                                                                 | recon without files, clean-room rebuild specs              |
| `port_map` `port_convert` `port_plan` `port_unit` `port_write` `port_scene` `port_copy_assets` `port_status` `port_verify` | porting, verified                                          |
| `re_case`                                                                                                                  | proof case: evidence, claims, unknowns, decisions, tests   |

Junto a estas est?n las herramientas de an?lisis profundo — `open_binary`, `procedure_pseudo_code`, `xrefs`, `search_strings`, `analyze_javascript_application`,
`inspect_android_package`, `inspect_managed_artifact`, `observe_web_session` y muchas m?s. `engine_tools` las muestra desde el servidor en ejecuci?n, and
`npm run docs:generate` writes the [cat?logo de herramientas generado](docs/mcp-contracts.md#generated-catalog) with every
contract. La API HTTP
(`reverseport serve`) exposes the same tools in every vendor's format; see [Connect any agent](docs/connect-any-agent.md).

## C?mo se compara

|                            | ReversePort                                                      | A single decompiler MCP server | By hand                     |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------ | --------------------------- |
| Setup                      | `npx reverseport setup` for all your agents                      | One server per tool, per agent | Install and learn each tool |
| Source projects and builds | Engine, version, scenes, packs, diffs, no build needed           | Binaries only                  | Read files yourself         |
| Binarios nativos           | Through Ghidra, Hopper or IDA that you have installed            | One backend                    | The tool's own UI           |
| Porting                    | Plan, API maps, scene and asset conversion, `port_verify`        | Not part of the job            | Rewrite and check by hand   |
| Ejecuciones                | Localmente, target read-only                                     | Usually locally                | Localmente                  |
| No hace                    | Crack DRM or anti-cheat, or write ported code without your agent | Port or compare builds         | Scale                       |

## FAQ

**Is this legal?** Use it on software you own or are allowed to analyse. ReversePort does not decrypt, crack or bypass
DRM, anti-cheat or licensing. See [RESPONSIBLE-USE.md](RESPONSIBLE-USE.md).

**?Sube mis archivos?** No. It runs on your machine, only reads the target and writes output to new folders.

**Does it port my code automatically?** Scenes, transforms and assets convert automatically. C?digo is written by your
agent, one unit at a time, with an API map for the engine pair; `port_verify` then checks for leftovers and missing
functions.

**Do I need Ghidra?** Only for decompiling native binaries. Scanning, packs, lookup, blueprints and porting need
nothing extra.

**How do I update or remove it?** `reverseport update` updates a global install, and `reverseport uninstall` removes
the agent registrations and skill files it added. See [Diagnose, update, and remove](docs/installation.md#diagnose-update-and-remove).

**Algo se rompi? o falta algo.** Open an [issue](https://github.com/laaielichter/reverseport/issues) with the
command and its JSON error. Every error names the next step, so include that line too.

## Uso responsable

Only analyse or port software you own or are allowed to analyse. ReversePort does not decrypt, crack or bypass DRM,
anti-cheat or licensing. Read [RESPONSIBLE-USE.md](RESPONSIBLE-USE.md) and the [disclaimer](DISCLAIMER.md).

## Documentaci?n

- [Connect any agent](docs/connect-any-agent.md): MCP, HTTP, OpenAI/Anthropic/Gemini formats, OpenAPI, shell; profiles and errors.
- [Installation and setup](docs/installation.md): agent registration, analysis engines, updates and uninstall.
- [CLI and Evidence](docs/cli.md): commands, provider selection, snapshots, import/export.
- [MCP contracts](docs/mcp-contracts.md) and [agent prompts](docs/mcp-prompts.md): tool results, sessions, guided investigations.
- [Porting and rebuilds](.agents/skills/reverse-engineer-anything/references/porting-and-rebuilds.md): the recon, rebuild and port workflows.
- [Proof cases, guard hooks and memory](docs/proof-and-memory.md): `re_case`, the Claude C?digo hooks, the optional Stashpad link and context cost.
- [Challenge self-check](bench/README.md): programs with known answers (from rea-lab) and what `re_binary` reveals.
- [Rated by agents](AGENT-RATINGS.md): independent agent reviews, round by round, and what is still open.
- [Nederlands](docs/README.nl.md) · [AGENTS.md](AGENTS.md) for contributors · [CONTRIBUTING.md](CONTRIBUTING.md)

## Cr?ditos

El motor de an?lisis profundo se basa en [REA: Reverse Engineer Anything](https://github.com/morluto/rea) (MIT).
Los casos de prueba se adaptaron de [Digfox](https://github.com/Devaretanmay/digfox) (MIT) y los hooks de protecci?n siguen
[rea-jev](https://github.com/juan-viox/rea-jev) (MIT); the challenge self-check uses
[rea-lab](https://github.com/pablodiazjorge/rea-lab)'s generator and oracle (MIT). Los componentes de terceros se enumeran en
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Soporte

ReversePort es gratuito y de c?digo abierto. Si te ahorra tiempo a ti o a tu agente, cualquier donaci?n es bienvenida, pero nunca es esperada. SOL and
any token on Solana (such as USDC) can be sent to:

- **Solana:** `BDRA7dHGBYtPsZPNzVQccDYZ8BqstJGCsWx3kopPSCDK`

Gifts go to new model credits to keep improving ReversePort, and to work on better working conditions and wellbeing for
LLMs and agents.

## License

[MIT](LICENSE)
