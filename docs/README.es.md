<div *align*="center">

# ReversePort

### Haz ingeniería inversa de cualquier cosa. Pórtala a cualquier lugar.

Una CLI y un servidor MCP que permiten a tu agente de programación desmontar aplicaciones, juegos, binarios y sitios web → and rebuild them.

[![npm](https://img.shields.io/npm/v/reverseport?style=flat-square&color=1e4f91)](https://www.npmjs.com/package/reverseport)

[![npm downloads](https://img.shields.io/npm/dm/reverseport?style=flat-square&color=1e4f91)](https://www.npmjs.com/package/reverseport)

[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.laaielichter%2Freverseport-5c4ee5?style=flat-square)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.laaielichter/reverseport)

[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](docs/mcp-contracts.md#generated-catalog)

[![Licencia: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)

[![Node.js](https://img.shields.io/badge/Node.js-22.19%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](docs/installation.md)

npx reverseport setup

<img src="docs/assets/demo.gif" alt="Terminal: ReversePort scans Godot's 2D platformer demo, plans a port to Unity with 68 units, copies 38 assets, converts a scene and verifies progress" width="640">

<sub>A real run on <a href="https\://github.com/godotengine/godot-demo-projects/tree/master/2d/platformer">Godot's 2D platformer demo</a>, JSON trimmed to the key fields.</sub>

[Sitio web](https://laaielichter.github.io/Reverseport/) | [Inicio rápido](#quick-start) | [Ados los agentes](#works-with-every-agent) | [Habilidades](#skills) | [Qué hace](#what-it-does) | [Cómo se compara](#how-it-compares) | [Preguntas frecuentes](#faq) | [Registro de cambios](CHANGELOG.md) | [Documentación](#documentation)

</div>

---

¿Ves una función que te gusta en una aplicación o juego? Pregunta a tu agente cómo funciona → hasta llegar a la función descompilada → and

then ask it to build your own version. ¿Tienes un juego en Godot y lo quieres en Unity? Pregunta a tu agente to port it, unit by

unit, verified. ¿No tienes ningún archivo? Dale un nombre o una página de tienda.

ReversePort ofrece a los agentes una forma coherente de hacer todo eso:

- =��� Entender cualquier cosa → engine and version of any project or exported game, dependency graphs, scenes,

  symbols in 30+ languages, executables, packs and unknown data. JS/TS monorepos (pnpm, Turborepo, Nx, Lerna, Rush,

  tsconfig paths) and Rust workspaces resolve too. No build step, no dependencies.

- =��� Profundizar → decompile, cross-reference and trace native, managed (.NET), Android, Electron/JavaScript,

  WebAssembly, firmware and browser targets through Ghidra, Hopper, IDA, JADX and more. ReversePort connects to the

  tools you have installed, drives them and shows the evidence behind every conclusion.

- =��� ¿Sin archivos? Aun así puedes investigar → a name, a store page, a website or a public repo is enough to learn the engine,

  stack, file layout and open-source remakes from public sources.

- =��� Reconstruir con precisión → turn what you learned into a clean-room rebuild spec: every system, the parameters to

  measure on the original, a parity table and a project skeleton with every value as a tunable.

- =��� Portar de verdad → Godot → Unity, Godot → Unreal, Godot → three.js, GDScript → C#, or language to language.

  Scenes and transforms convert automatically; code is ported by your agent with API maps; port_verify proves

  nothing was left behind.

- =��� Local → runs on your machine. Targets are only read; output goes to new folders. Nothing is uploaded to an

  analysis service and there is no extra API bill.

## Inicio rápido

### 1. Conecta tu agente

Con Node.js 22.19 o posterior:

npx reverseport setup

Selecciona tus agentes, revisa los cambios y apruébalos. La configuración registra un servidor MCP e instala la habilidad correspondiente,

con copias de seguridad de la configuración existente. Reinicia tu agente después. La configuración admite Claude Code, Codex, Cursor,

Gemini CLI, GitHub Copilot, OpenCode and [más agentes](docs/installation.md#supported-agents); other clients can use

[registro manual de MCP](docs/installation.md#mcp-registry).

Claude Code plugin (instead of setup for Claude Code → includes the server, the porting skills and the

port-architect agent; do not use both):

/plugin marketplace add laaielichter/reverseport

/plugin install reverseport\@reverseport

The same marketplace also offers the [sister plugins](#sister-tools) stashpad\@reverseport and

agentdisk\@reverseport.

Desde el código fuente:

git clone https\://github.com/laaielichter/reverseport && cd reverseport

npm ci && npm run build

./bin/reverseport.mjs setup

Los comandos de investigación, inspección de compilaciones, búsqueda, blueprint y portabilidad funcionan justo después de git clone, with no

install at all: node bin/reverseport.mjs scan ./MyGame.

### 2. Pregunta a tu agente

Understand how search works in the Notes app, show me the evidence, and build a similar feature for my project.

Eso es todo. El agente elige las herramientas y tú obtienes respuestas respaldadas por evidencia.

## Funciona con todos los agentes

Cualquier proveedor, framework o tamaño de modelo → the same tools through the door that fits:

- MCP: npx -y reverseport\@latest setup configures installed agents; reverseport connect <client> prints the

  snippet for any other MCP client (Windsurf, Cline, Continue, Zed, Goose, LM Studio, VS Code…).

- MCP over HTTP: reverseport serve → http\://127.0.0.1:32147/mcp.

- Llamadas de funciones: /api/agent/tools?format=openai-strict|responses|anthropic|gemini, plus OpenAPI 3.1 at

  /api/openapi.json for GPT Actions, LangChain, LlamaIndex, Semantic Kernel, CrewAI, AutoGen and n8n.

- Agentes solo de shell: JSON on stdout, errors as JSON on stderr, reverseport describe <tool>.

También está diseñado para las necesidades del agente:

- Una lista corta por defecto. About 45 tools are listed instead of almost 200. Every other tool is one call away:

  engine_tools finds it and engine_call runs it.

- La lista se adapta al agente. Small or older models use compact, large-context agents use full, and an agent

  can switch itself with set_tool_profile.

- Un único formato de error en todas partes, with a code, whether retrying helps, and the exact next step.

- A next field wherever there is an obvious next step (graphs, truncated results, every porting step), with the exact call.

- Los resultados grandes no saturan el contexto. Answers over 256 KB are saved to \~/.reverseport/tool-output/; the

  agent gets a short version with the path. Slightly wrong input from smaller models is repaired where it is safe.

- Los agentes son escuchados. share_feedback leaves a note for the maintainers; it stays on the user's machine until

  they share it.

See [Connect any agent](docs/connect-any-agent.md).

## Habilidades

Configuración and the Claude Code plugin install skills that teach the agent the workflows, so it knows which tool comes

next without being told:

| Skill              | Úsalo para                                                                                               |

| ------------------ | -------------------------------------------------------------------------------------------------------- |

| reverse-engineer | "How does this work?" → engine and stack, architecture, dependency graph, classes, scenes, unknown files |

| build-inspector  | Exported builds: engine and version, what is inside the .pck or Unity/Unreal build, what changed       |

| rebuild          | No files: find out how a game, app or site is built, then write a measured clean-room rebuild spec       |

| port-project     | Any port, unit by unit in dependency order, with API maps, converted scenes and a verified result        |

| godot-port       | Godot 4 → Unity, Unreal, three.js or Godot C#: signals, node paths, autoloads, physics, input, axes      |

| unity-to-godot   | Unity → Godot 4: MonoBehaviours, prefabs and scenes to .tscn, colliders, rigidbodies                   |

| port-verify      | The finish line: fix leftovers and missing functions, then hand over with an honest list of what is left |

| proof-case       | Keep an investigation honest: evidence, claims that cite it, decisions, tests and open unknowns          |

| troubleshoot     | Errors and odd results: unreadable scenes, packs that will not list, refused paths, MCP problems         |

The Claude Code plugin also adds the port-architect agent, which runs a whole port from recon to hand-over, and

[guard hooks](docs/proof-and-memory.md) that ask before a tool attaches to a program and stop a "done" while a proof

case fails its check.

A skill copied into an agent's folder can be older than the installed tool. reverseport skills lists the skills of

the version you have and reverseport skills get <name> prints the matching guide.

## Prompts para probar

| Tú preguntas                                                                            | ReversePort hace                                                                                                                  |

| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |

| What is this game made with, and how is it built?                                | re_scan → engine + version, languages, entry points, how it starts                                                              |

| Map this codebase and write ARCHITECTURE.md.                                     | re_graph, re_symbols, re_report                                                                                             |

| How do the packages in this Turborepo/pnpm monorepo depend on each other?        | re_scan finds the workspace and its packages; re_graph resolves workspace names and tsconfig paths and shows who uses whom    |

| Show me how this button on the website is built.                                 | capture_web_screenshot with a selector: a cropped image of the element, its HTML and its computed CSS                         |

| All I have is data.win / an .rpa / a .pak / a .swf / a sound bank / a web build. | re_archive: names, assets and facts out of GameMaker, Ren'Py, Unreal, Flash, FMOD, Wwise, Unity WebGL and Emscripten containers |

| I only have the exported Godot game, not the project.                            | re_archive extracts the .pck, re_decode turns .gdc/.scn/.res/project.binary back into an editable project                     |

| A Unity IL2CPP game without its C# source.                                       | re_il2cpp: classes, methods and literals from global-metadata.dat, plus a C# skeleton                                           |

| What changed between build 43 and 44?                                            | re_compare folder-to-folder and pack-to-pack, biggest changes first                                                             |

| Why are my Unity materials pink and scripts "missing" after a move?              | re_refs: dangling, duplicate and missing GUIDs, with remap suggestions                                                          |

| Get every player-facing string out of this game so we can translate it.          | re_strings: .pot/.csv with ids and placeholders; apply writes a translated copy                                               |

| Is this GDScript valid for Godot 4.3, or did the model mix in Godot 3?           | re_apicheck: renamed names with replacements, invented members, too-new classes                                                 |

| What is in this save file, is it checksummed, and which field is the gold?       | re_save: layers, fields with roles, verified checksums, diff of two saves, schema + SaveData classes                            |

| Upgrade my Godot 3 game to Godot 4.                                              | port_upgrade: converted copy (renames, @annotations, await, signals, scenes, project.godot) + what needs a human                |

| Decompile the function that saves settings in this app and explain it.           | opens the binary, finds it, decompiles it, shows the evidence                                                                     |

| How does this Electron app talk to its native side?                              | maps modules, IPC and Electron boundaries                                                                                         |

| What is <some game> made with? I don't have the files.                         | re_lookup from public sources: engine with confidence, stack, layout, remakes                                                   |

| Rebuild the movement of <game> as precisely as possible in Godot.              | re_blueprint: systems, parameters to measure, parity table, skeleton                                                            |

| Port my Unity UI, prefab variants and Animator to Godot.                         | port_scene: Control nodes with anchors, inherited scenes, AnimationPlayer + state machine from .anim/.controller                |

| Port this Unity shader (or a Shadertoy) to Godot.                                | port_shader: uniforms, intrinsics and built-ins mapped, PORT: markers and leftovers for the rest                              |

| Why does my ported game fall, slide and jump differently?                        | port_convert {physics}: gravity, fixed step, damping, friction/bounce rules, layers → masks, jump velocity recomputed           |

| Does the port really behave the same?                                            | port_verify flags tick/delta/seed/order differences; port_trace logs both per tick and finds the first divergence             |

| Move my RPG Maker MV/MZ game to Godot.                                           | port_rpgmaker: maps drawn from the tilesets, events running, database autoload, list of what is left                            |

| Port my Godot game to Unity.                                                     | port_plan → port_unit/port_write loop → port_scene → port_verify                                                        |

You:    Port my Godot game to Unity.

Agent:  re_scan → Godot 4.3, 6 scripts, 5 scenes, main scene main.tscn, autoload Global

        port_plan → 13 units, dependencies first; Unity scene builder + PORT-PLAN.md created

        port_unit / port_write +� 7 → C# MonoBehaviours (signals → events, $Node → [SerializeField])

        port_scene +� 5 → prefab and scene specs, transforms mirrored to Unity's axes

        port_verify → passed: 13/13 units, 0 leftovers, 0 missing functions

## Qué hace

### Entender y profundizar

| Target                             | What you get                                                                                                                                                                        | Needs                                                                          |

| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |

| Proyectos fuente y juegos exportados | Engine + version (Godot, Unity, Unreal, GameMaker, RPG Maker, Ren'Py, L+�VE, Defold, Bevy, MonoGame, web, Electron, Flutter, .NET, Go, Rust…), dependencies, cycles, scenes, symbols | Nothing                                                                        |

| Packs y archivos                 | Godot .pck (also embedded in the .exe), zip/apk/jar, .unitypackage, tar.gz, asar → list and extract                                                                           | Nothing                                                                        |

| Binarios nativos                    | Mach-O, ELF, PE, wasm: functions, pseudocode, strings, xrefs, call paths, layout                                                                                                    | Ghidra, Hopper or IDA for decompilation ([setup](docs/installation.md#hopper)) |

| Ensamblados .NET                    | Metadata, CIL, native boundaries, build comparisons                                                                                                                                 | Nothing                                                                        |

| Android                            | Manifest, classes, decompiled methods, references, resources, devices                                                                                                               | JADX / Apktool / adb ([guide](docs/android-analysis.md))                       |

| JavaScript y Electron            | Modules, imports, source maps, Electron boundaries, runtime observation                                                                                                             | Nothing; a browser for runtime                                                 |

| Sitio webs                           | Page, network and runtime evidence; one element by CSS selector (cropped image, HTML, computed CSS); stack fingerprint without files                                                | A browser for runtime                                                          |

| Firmware, EVM, fallos y capturas   | Regions and extraction, selectors, recorded crashes, HAR/mitmproxy captures                                                                                                         | See the [guides](docs/index.md)                                                |

### Reconstruir y portar

| Desde → to            | Code                             | Scenes / prefabs                             | Transforms  | Project skeleton            |

| -------------------- | -------------------------------- | -------------------------------------------- | ----------- | --------------------------- |

| Godot → Unity    | agent, with API map              | automatic → specs + one-click editor builder | Z-mirror    | scene builder script        |

| Godot → Unreal   | agent (.h/.cpp), with API map    | automatic → specs (cm, Z-up)                 | axes + +�100 | .uproject, module, targets  |

| Godot → three.js | agent (TypeScript), with API map | automatic → TypeScript builder modules       | unchanged   | Vite + TS + fixed-step loop |

| Godot → Godot C# | agent, with API map              | automatic (script paths swapped)             | unchanged   | .csproj, project.godot      |

| Unity → Godot    | agent (GDScript), with API map   | automatic → .tscn                          | Z-mirror    | project.godot               |

| Unity → Unreal   | agent, with API map              | →                                            | axes + +�100 | .uproject, module           |

| any → language   | agent                            | →                                            | →           | →                           |

## CLI

Todo lo que puede hacer el agente también puedes hacerlo desde el shell. Los resultados son JSON.

reverseport scan ./MyGame                        # engine, languages, entry points

reverseport lookup "Some Game"                   # no files: engine, stack, structure, remakes

reverseport binary ./Build/Game.exe              # sections, imports, .NET types, strings, hints

reverseport archive ./Build/Game.pck --action extract --match "*.gd"

reverseport diff ./Build-43 ./Build-44           # what changed between builds

reverseport analyze /Applications/Notes.app      # deep analysis: open and summarize a binary/app

reverseport decompile /path/to/binary 0x1000      # pseudocode (Ghidra, Hopper or IDA)

reverseport blueprint --lookup-id <id>           # clean-room rebuild spec + parity.json + skeleton

reverseport plan ./MyGame --to unity             # start a port

reverseport case init --question "…" --target ./Build   # proof case: evidence → claims → decision → tests

reverseport doctor                               # check engines and agent registrations

reverseport skills get port-project              # the skill guide that matches this version

reverseport help                                 # overview | reverseport port help | reverseport engine --help

Instala el comando para uso habitual con npm install --global reverseport, or run any of these through

npx reverseport\@latest …. In a checkout, use ./bin/reverseport.mjs.

## Aols

Un servidor MCP (reverseport mcp) ofrece todas las herramientas:

| ReversePort tools                                                                                                                                |                                                                                                                                                                          |

| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

| re_scan re_graph re_symbols re_scene                                                                                                     | projects and builds: engine, dependencies, symbols, scenes                                                                                                               |

| re_binary re_archive re_probe re_extract re_compare re_refs re_strings re_apicheck re_save re_decode re_il2cpp re_report | executables, packs (Godot, zip, asar, Ren'Py, GameMaker, FMOD/Wwise, Unreal, SWF), unknown data, diffs, GUID audit, localisation, API check, save files, ARCHITECTURE.md |

| re_lookup re_blueprint                                                                                                                       | recon without files, clean-room rebuild specs                                                                                                                            |

| port_map port_convert port_plan port_unit port_write port_scene port_copy_assets port_status port_verify                       | porting, verified                                                                                                                                                        |

| port_upgrade port_shader port_trace port_rpgmaker                                                                                        | Godot 3 → 4 as a converted copy plus the manual list; shader first drafts; per-tick behaviour traces compared                                                            |

| re_case                                                                                                                                        | proof case: evidence, claims, unknowns, decisions, tests                                                                                                                 |

Next to these come the deep-analysis tools → open_binary, procedure_pseudo_code, xrefs, search_strings, analyze_javascript_application,

inspect_android_package, inspect_managed_artifact, observe_web_session and many more. engine_tools lists them from the running server, and

npm run docs\:generate writes the [generated tool catalog](docs/mcp-contracts.md#generated-catalog) with every

contract. The HTTP API

(reverseport serve) exposes the same tools in every vendor's format; see [Connect any agent](docs/connect-any-agent.md).

## Cómo se compara

|                            | ReversePort                                                      | A single decompiler MCP server | By hand                     |

| -------------------------- | ---------------------------------------------------------------- | ------------------------------ | --------------------------- |

| Configuración                      | npx reverseport setup for all your agents                      | One server per tool, per agent | Install and learn each tool |

| Source projects and builds | Engine, version, scenes, packs, diffs, no build needed           | Binaries only                  | Read files yourself         |

| Binarios nativos            | Through Ghidra, Hopper or IDA that you have installed            | One backend                    | The tool's own UI           |

| Portabilidad                    | Plan, API maps, scene and asset conversion, port_verify        | Not part of the job            | Rewrite and check by hand   |

| Ejecución                       | Locally, target read-only                                        | Usually locally                | Locally                     |

| No hace                   | Crack DRM or anti-cheat, or write ported code without your agent | Port or compare builds         | Scale                       |

## Preguntas frecuentes

¿Es legal? Úsalo únicamente con software que poseas o que tengas permiso para analizar. ReversePort hace not decrypt, crack or bypass

DRM, anti-cheat or licensing. See [RESPONSIBLE-USE.md](RESPONSIBLE-USE.md).

¿Sube mis archivos? No. It runs on your machine, only reads the target and writes output to new folders.

¿Porta mi código automáticamente? Scenes, transforms and assets convert automatically. Code is written by your

agent, one unit at a time, with an API map for the engine pair; port_verify then checks for leftovers, missing

functions and dormant logic (stub bodies, functions nothing calls, silenced warnings), so a port that "compiles" but

does nothing is not reported as done.

¿Necesito Ghidra? Only for decompiling native binaries. Scanning, packs, lookup, blueprints and porting need

nothing extra.

¿Cómo lo actualizo o elimino? reverseport update updates a global install, and reverseport uninstall removes

the agent registrations and skill files it added. See [Diagnose, update, and remove](docs/installation.md#diagnose-update-and-remove).

Algo se rompió o falta algo. Open an [issue](https://github.com/laaielichter/reverseport/issues) with the

command and its JSON error. Every error names the next step, so include that line too.

## Herramientas hermanas

Two small tools from the same author that work well next to ReversePort. Both are local, open source and have their

own MCP server, and both install from the ReversePort marketplace:

| Aol                                                       | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                     | Claude Code                             |

| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |

| [Stashpad](https://github.com/laaielichter/stashpad)   | Memory for agents that you can read, edit and trust: plain Markdown files with a source and dates, a review queue for agent writes, and a handoff note for the next session. re_case remember sends a proof case's findings there ([how](docs/proof-and-memory.md#memory-across-sessions-stashpad-optional)).                                                                                                                  | /plugin install stashpad\@reverseport  |

| [agentdisk](https://github.com/laaielichter/agentdisk) | The disk report for coding agents: the worktrees, checkpoints, node_modules, .venv and .godot/ folders agents leave behind (porting work makes plenty), and a cleanup you can undo. reverseport port doctor uses it to show what the workspace would really free ([how](docs/installation.md#disk-use-agentdisk-optional)). Needs the agentdisk binary ([install](https://github.com/laaielichter/agentdisk#install)). | /plugin install agentdisk\@reverseport |

Add the marketplace first with /plugin marketplace add laaielichter/reverseport. Other agents: see each project's

README.

## Uso responsable

Analiza o porta únicamente software que poseas o cuyo análisis tengas permitido. ReversePort hace not decrypt, crack or bypass DRM,

anti-cheat or licensing. Read [RESPONSIBLE-USE.md](RESPONSIBLE-USE.md) and the [disclaimer](DISCLAIMER.md).

## Documentación

- [Connect any agent](docs/connect-any-agent.md): MCP, HTTP, OpenAI/Anthropic/Gemini formats, OpenAPI, shell; profiles and errors.

- [Installation and setup](docs/installation.md): agent registration, analysis engines, updates and uninstall.

- [CLI and Evidence](docs/cli.md): commands, provider selection, snapshots, import/export.

- [MCP contracts](docs/mcp-contracts.md) and [agent prompts](docs/mcp-prompts.md): tool results, sessions, guided investigations.

- [Portabilidad and rebuilds](.agents/skills/reverse-engineer-anything/references/porting-and-rebuilds.md): the recon, rebuild and port workflows.

- [Proof cases, guard hooks and memory](docs/proof-and-memory.md): re_case, the Claude Code hooks, the optional Stashpad link and context cost.

- [Challenge self-check](bench/README.md): programs with known answers (from rea-lab) and what re_binary reveals.

- [Rated by agents](AGENT-RATINGS.md): independent agent reviews, round by round, and what is still open.

- [Nederlands](docs/README.nl.md) | [AGENTS.md](AGENTS.md) for contributors | [CONTRIBUTING.md](CONTRIBUTING.md)

## Créditos

The deep-analysis engine is based on [REA: Reverse Engineer Anything](https://github.com/morluto/rea) (MIT).

Proof cases are ported from [Digfox](https://github.com/Devaretanmay/digfox) (MIT) and the guard hooks follow

[rea-jev](https://github.com/juan-viox/rea-jev) (MIT); the challenge self-check uses

[rea-lab](https://github.com/pablodiazjorge/rea-lab)'s generator and oracle (MIT). Third-party components are listed in

[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Soporte

ReversePort es gratuito y de código abierto. Si te ahorra tiempo a ti o a tu agente, una donación es bienvenida, pero nunca es obligatoria. SOL and

any token on Solana (such as USDC) can be sent to:

- Solana: BDRA7dHGBYtPsZPNzVQccDYZ8BqstJGCsWx3kopPSCDK

Gifts go to new model credits to keep improving ReversePort, and to work on better working conditions and wellbeing for

LLMs and agents.

## Licencia

[MIT](LICENSE)
