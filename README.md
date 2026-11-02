<div align="center">

# ReversePort

### Reverse engineer anything. Port it anywhere.

**The reverse-engineering and porting toolkit for AI coding agents.**<br>
Read Godot packs, Unity IL2CPP, .NET and native binaries, compare builds, keep proof for every claim — and port games
between Godot, Unity, Unreal and three.js with parity checks.

[![npm](https://img.shields.io/npm/v/reverseport?style=flat-square&color=1e4f91)](https://www.npmjs.com/package/reverseport)
[![npm downloads](https://img.shields.io/npm/dm/reverseport?style=flat-square&color=1e4f91)](https://www.npmjs.com/package/reverseport)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.laaielichter%2Freverseport-5c4ee5?style=flat-square)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.laaielichter/reverseport)
[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-d97757?style=flat-square)](#claude-code-plugin)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](docs/mcp-contracts.md#generated-catalog)
[![Node.js](https://img.shields.io/badge/Node.js-22.23.4%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](docs/installation.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)

```bash
npx reverseport setup
```

<img src="docs/assets/demo.gif" alt="Terminal: ReversePort scans Godot's 2D platformer demo, plans a port to Unity with 68 units, copies 38 assets, converts a scene and verifies progress" width="640">

<sub>A real run on <a href="https://github.com/godotengine/godot-demo-projects/tree/master/2d/platformer">Godot's 2D platformer demo</a>, JSON trimmed to the key fields. <a href="docs/assets/demo.mp4">Watch the MP4</a>.</sub>

[Website](https://laaielichter.github.io/Reverseport/) · [Quick start](#quick-start) · [What's new](#whats-new) · [Every agent](#works-with-every-agent) · [Prompts](#prompts-to-try) · [How it compares](#how-it-compares) · [FAQ](#faq) · [Contributing](#contributing) · [Docs](#documentation)

**English** · [Nederlands](docs/README.nl.md)

</div>

---

See a feature you like in an app or a game? Ask your agent how it works — down to the decompiled function — and
then ask it to build your own version. Have a game in Godot and want it in Unity? Ask your agent to port it, unit by
unit, verified. No files at all? Give it a name or a store page.

ReversePort gives agents one consistent way to do all of that:

- 🎮 **Game formats built in** — Godot `.pck` (also inside the `.exe`) and `.gdc`/`.scn`/`.res` back to an editable
  project, Unity IL2CPP `global-metadata.dat`, `.unitypackage`, GameMaker, Ren'Py, RPG Maker, Unreal `.pak`, FMOD and
  Wwise banks; it also recognises Quake PAK, Doom WAD, XNB and VPK. No engine install needed.
- 🔍 **Understand anything** — engine and version of any project or exported game, dependency graphs, scenes, symbols
  in 30+ languages, executables, packs and unknown data. JS/TS monorepos (pnpm, Turborepo, Nx, Lerna, Rush, tsconfig
  paths, `#imports`, Deno import maps) and Rust workspaces resolve too. No build step, no dependencies.
- 🧠 **Go deep** — decompile, cross-reference and trace native, managed (.NET), Android, Electron/JavaScript,
  WebAssembly, firmware and browser targets through Ghidra, Hopper, IDA, JADX and more. ReversePort connects to the
  tools you have installed, drives them and shows the evidence behind every conclusion.
- 🔀 **Compare builds** — what changed between build 43 and 44: files, packs and .NET types and methods, biggest
  changes first.
- 🧾 **Proof, not guesses** — a proof case ties every claim to saved evidence and keeps unknowns visible. In Claude
  Code, guard hooks stop a "done" while a proof case fails its check.
- 🧩 **Rebuild precisely** — no files? A name, a store page or a website is enough for a clean-room rebuild spec:
  every system, the parameters to measure, a parity table and a project skeleton.
- 🚚 **Port for real** — Godot ⇄ Unity, Godot → Unreal, Godot → three.js, GDScript → C#, Godot 3 → 4, RPG Maker →
  Godot, or language to language. Scenes and transforms convert automatically; code is ported by your agent with API
  maps; `port_verify` and `port_trace` prove nothing was left behind and behaviour matches.
- 🔒 **Local** — runs on your machine. Targets are only read; output goes to new folders. Nothing is uploaded to an
  analysis service, there is no telemetry and no extra API bill.

## Quick start

### 1. Connect your agent

With Node.js 22.23.4 or newer (24.22.1+ on Node 24):

```bash
npx reverseport setup
```

Pick your agents, review the changes and approve. Setup registers one MCP server and installs the matching skill,
with backups of existing configuration. Restart your agent afterwards. Setup supports Claude Code, Codex, Cursor,
Gemini CLI, GitHub Copilot, OpenCode and [more agents](docs/installation.md#supported-agents); other clients can use
[manual MCP registration](docs/installation.md#mcp-registry).

### Claude Code plugin

Instead of setup for Claude Code — includes the server, the porting skills, the `port-architect` agent and the guard
hooks; do not use both:

```text
/plugin marketplace add laaielichter/reverseport
/plugin install reverseport@reverseport
```

The plugin asks for its settings once (deep-analysis engine on or off, tool list size, workspace folder, your Ghidra
folder). The same marketplace also offers the [sister plugins](#sister-tools) `stashpad@reverseport` and
`agentdisk@reverseport`.

### From source

```bash
git clone https://github.com/laaielichter/reverseport && cd reverseport
npm ci && npm run build
./bin/reverseport.mjs setup
```

The recon, build-inspection, lookup, blueprint and porting commands already work right after `git clone`, with no
install at all: `node bin/reverseport.mjs scan ./MyGame`.

### 2. Ask your agent

```text
What is ./MyGame made with? Show me the evidence, then plan a port to Unity.
```

That's it. The agent picks the tools; you get answers with the evidence behind them.

## What's new

**1.12** — more formats and game libraries, sturdier big results:

- More formats recognised: Doom WAD, Quake and Half-Life WAD2/WAD3, XNB (XNA/MonoGame) and Valve VPK, next to Quake
  PAK from 1.10.
- `re_scan` recognises melonJS, Kontra, Matter.js, Rapier, cannon-es, Planck.js, Howler.js, Tone.js and React Three
  Fiber.
- Monorepos: `pnpm-workspace.yaml` globs, `package.json` `#imports` and Deno import maps.
- Big results always fit the output budget now, also with emoji, file-name keys and very deep results.
- A [Godot → three.js walkthrough](docs/walkthrough-godot-to-threejs.md) where every command was run and the result
  builds.

**1.11** — a new engine and a new protocol:

- The deep-analysis engine is now [REA](https://github.com/morluto/rea) 6.8.
- MCP 2026-07-28 next to the classic handshake: long calls (a cold Ghidra import, a big port plan) come back as a task
  with progress instead of timing out.
- `run_batch` runs up to 20 calls in one, and big results are saved to disk with a resource link.
- `re_compare` shows which .NET types and methods changed between two builds, and the next step.
- The Claude Code plugin has settings instead of environment variables, and an icon.

Every release is in the [changelog](CHANGELOG.md).

## Works with every agent

Any vendor, any framework, any model size — the same tools through the door that fits:

| Door                  | How                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP, set up for you   | `npx -y reverseport@latest setup` for Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode and more                                                                              |
| MCP, any other client | `reverseport connect <client>` prints the snippet (Windsurf, Cline, Continue, Zed, Goose, LM Studio, VS Code…)                                                                               |
| MCP over HTTP         | `reverseport serve` → `http://127.0.0.1:32147/mcp`                                                                                                                                           |
| Function calling      | `/api/agent/tools?format=openai-strict\|responses\|anthropic\|gemini`, plus OpenAPI 3.1 at `/api/openapi.json` for GPT Actions, LangChain, LlamaIndex, Semantic Kernel, CrewAI, AutoGen, n8n |
| Shell only            | JSON on stdout, errors as JSON on stderr, `reverseport describe <tool>`                                                                                                                      |

Built for the agent's circumstances too:

- **A short list by default.** About 57 tools are listed instead of more than 200. Every other tool is one call
  away: `engine_tools` finds it and `engine_call` runs it.
- **The list fits the agent.** Small or older models use `compact`, large-context agents use `full`, and an agent
  can switch itself with `set_tool_profile`.
- **One error shape everywhere**, with a code, whether retrying helps, and the exact next step.
- **A `next` field wherever there is an obvious next step** (graphs, truncated results, every porting step), with the
  exact call.
- **Big results do not flood the context.** Lists are short by default. Answers over 256 KB are saved to
  `~/.reverseport/tool-output/`; the agent gets a short version with the path and an MCP resource link. Slightly
  wrong input from smaller models is repaired where it is safe.
- **Several steps, one call.** `run_batch` runs up to 20 calls and `select` keeps only the fields the agent needs.
  The same failing call twice gets a plain "do not repeat it" instead of the same error again.
- **Long work does not time out.** On MCP 2026-07-28 a call still running after a few seconds comes back as a task
  the client polls, with progress in its status; quick calls answer directly. Older clients keep the classic
  handshake on the same server.
- **Agents are heard.** `share_feedback` leaves a note for the maintainers; it stays on the user's machine until
  they share it.

See [Connect any agent](docs/connect-any-agent.md).

## Skills

Setup and the Claude Code plugin install skills that teach the agent the workflows, so it knows which tool comes
next without being told:

| Skill              | Use it for                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `reverse-engineer` | "How does this work?" — engine and stack, architecture, dependency graph, classes, scenes, unknown files |
| `build-inspector`  | Exported builds: engine and version, what is inside the `.pck` or Unity/Unreal build, what changed       |
| `rebuild`          | No files: find out how a game, app or site is built, then write a measured clean-room rebuild spec       |
| `port-project`     | Any port, unit by unit in dependency order, with API maps, converted scenes and a verified result        |
| `godot-port`       | Godot 4 → Unity, Unreal, three.js or Godot C#: signals, node paths, autoloads, physics, input, axes      |
| `unity-to-godot`   | Unity → Godot 4: MonoBehaviours, prefabs and scenes to `.tscn`, colliders, rigidbodies                   |
| `port-verify`      | The finish line: fix leftovers and missing functions, then hand over with an honest list of what is left |
| `proof-case`       | Keep an investigation honest: evidence, claims that cite it, decisions, tests and open unknowns          |
| `troubleshoot`     | Errors and odd results: unreadable scenes, packs that will not list, refused paths, MCP problems         |

The Claude Code plugin also adds the `port-architect` agent, which runs a whole port from recon to hand-over, and
[guard hooks](docs/proof-and-memory.md) that ask before a tool attaches to a program and stop a "done" while a proof
case fails its check.

A skill copied into an agent's folder can be older than the installed tool. `reverseport skills` lists the skills of
the version you have and `reverseport skills get <name>` prints the matching guide.

## Prompts to try

| You ask                                                                            | ReversePort does                                                                                                                  |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| _What is this game made with, and how is it built?_                                | `re_scan` → engine + version, languages, entry points, how it starts                                                              |
| _I only have the exported Godot game, not the project._                            | `re_archive` extracts the .pck, `re_decode` turns .gdc/.scn/.res/project.binary back into an editable project                     |
| _A Unity IL2CPP game without its C# source._                                       | `re_il2cpp`: classes, methods and literals from global-metadata.dat, plus a C# skeleton                                           |
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

## What it does

### Understand and go deep

| Target                             | What you get                                                                                                                                                                        | Needs                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Source projects and exported games | Engine + version (Godot, Unity, Unreal, GameMaker, RPG Maker, Ren'Py, LÖVE, Defold, Bevy, MonoGame, web, Electron, Flutter, .NET, Go, Rust…), dependencies, cycles, scenes, symbols | Nothing                                                                        |
| Packs and archives                 | Godot `.pck` (also embedded in the `.exe`), zip/apk/jar, `.unitypackage`, tar.gz, asar — list and extract; Quake PAK, Doom WAD, XNB, VPK and more recognised                        | Nothing                                                                        |
| Unity IL2CPP                       | Classes, methods and literals from `global-metadata.dat`, plus a C# skeleton                                                                                                        | Nothing                                                                        |
| Native binaries                    | Mach-O, ELF, PE, wasm: functions, pseudocode, strings, xrefs, call paths, layout                                                                                                    | Ghidra, Hopper or IDA for decompilation ([setup](docs/installation.md#hopper)) |
| .NET assemblies                    | Metadata, CIL, native boundaries, type- and method-level build comparisons                                                                                                          | Nothing                                                                        |
| Android                            | Manifest, classes, decompiled methods, references, resources, devices                                                                                                               | JADX / Apktool / adb ([guide](docs/android-analysis.md))                       |
| JavaScript and Electron            | Modules, imports, source maps, Electron boundaries, runtime observation                                                                                                             | Nothing; a browser for runtime                                                 |
| Websites                           | Page, network and runtime evidence; one element by CSS selector (cropped image, HTML, computed CSS); stack fingerprint without files                                                | A browser for runtime                                                          |
| Firmware, EVM, crashes, captures   | Regions and extraction, selectors, recorded crashes, HAR/mitmproxy captures                                                                                                         | See the [guides](docs/index.md)                                                |

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
reverseport skills get port-project              # the skill guide that matches this version
reverseport help                                 # overview · reverseport port help · reverseport engine --help
```

Install the command for regular use with `npm install --global reverseport`, or run any of these through
`npx reverseport@latest …`. In a checkout, use `./bin/reverseport.mjs`.

## Tools

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
[generated tool catalog](docs/mcp-contracts.md#generated-catalog) with every contract. The HTTP API
(`reverseport serve`) exposes the same tools in every vendor's format; see [Connect any agent](docs/connect-any-agent.md).

## How it compares

|                            | ReversePort                                                       | Disassembler MCP servers (IDA, Ghidra, …) | By hand                     |
| -------------------------- | ----------------------------------------------------------------- | ----------------------------------------- | --------------------------- |
| Focus                      | Games, builds and porting, with evidence                          | One disassembler for one model            | Whatever you know           |
| Setup                      | `npx reverseport setup` for all your agents                       | One server per tool, per agent            | Install and learn each tool |
| Source projects and builds | Engine, version, scenes, packs, diffs, no build needed            | Binaries only                             | Read files yourself         |
| Game formats               | Godot packs, Unity IL2CPP, GameMaker, Ren'Py, Unreal, sound banks | Not part of the job                       | One tool per format         |
| Native binaries            | Through the Ghidra, Hopper or IDA that you have installed         | Deepest inside their own tool             | The tool's own UI           |
| Porting                    | Plan, API maps, scene and asset conversion, `port_verify`         | Not part of the job                       | Rewrite and check by hand   |
| Proof                      | Proof cases and guard hooks                                       | Up to the agent                           | Your notes                  |
| Runs                       | Locally, target read-only                                         | Usually locally                           | Locally                     |
| Does not                   | Crack DRM or anti-cheat, or write ported code without your agent  | Port or compare builds                    | Scale                       |

If you live inside IDA or Ghidra all day, a dedicated server for that tool goes deepest there. ReversePort's
deep-analysis engine is [REA](https://github.com/morluto/rea); if you want broad reverse engineering without the game
formats, porting and proof cases, REA itself is a good choice too.

## FAQ

**Is this legal?** Use it on software you own or are allowed to analyse. ReversePort does not decrypt, crack or bypass
DRM, anti-cheat or licensing. See [RESPONSIBLE-USE.md](RESPONSIBLE-USE.md).

**Does it upload my files?** No. It runs on your machine, only reads the target and writes output to new folders.
There is no telemetry; [PRIVACY.md](PRIVACY.md) lists the few times it uses the network.

**Where do I get it?** Only from npm as [`reverseport`](https://www.npmjs.com/package/reverseport), the MCP Registry
as `io.github.laaielichter/reverseport`, or this repository. Copies under other names are not ours.

**Does it port my code automatically?** Scenes, transforms and assets convert automatically. Code is written by your
agent, one unit at a time, with an API map for the engine pair; `port_verify` then checks for leftovers, missing
functions and dormant logic (stub bodies, functions nothing calls, silenced warnings), so a port that "compiles" but
does nothing is not reported as done.

**Do I need Ghidra?** Only for decompiling native binaries. ReversePort finds Ghidra, Hopper or IDA but never installs
them. Scanning, packs, IL2CPP metadata, build diffs, lookup, blueprints and porting need nothing extra.

**How is this different from REA?** REA is the deep-analysis engine inside ReversePort. ReversePort adds its own
tools on top: game engines and formats, build diffs, proof cases, clean-room blueprints and verified ports between
engines, plus setup for every agent and a Claude Code plugin.

**How do I update or remove it?** `reverseport update` updates a global install, and `reverseport uninstall` removes
the agent registrations and skill files it added. See [Diagnose, update, and remove](docs/installation.md#diagnose-update-and-remove).

**Something broke or is missing.** Open an [issue](https://github.com/laaielichter/reverseport/issues) with the
command and its JSON error. Every error names the next step, so include that line too. Questions are welcome in
[Discussions](https://github.com/laaielichter/reverseport/discussions).

## Contributing

New formats, engines and game libraries are the easiest first pull requests: a detector, a fixture and a test. Pick a
[good first issue](https://github.com/laaielichter/reverseport/labels/good%20first%20issue) — each one names the
files to touch and says when it is done. Ideas and questions go to
[Discussions](https://github.com/laaielichter/reverseport/discussions).

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) for the layout and the checks
(`npm run test:port` for ReversePort's own tools), and the [Code of Conduct](CODE_OF_CONDUCT.md).

<a href="https://github.com/laaielichter/reverseport/graphs/contributors"><img src="https://contrib.rocks/image?repo=laaielichter/Reverseport" alt="Contributors to ReversePort"></a>

## Sister tools

Two small tools from the same author that work well next to ReversePort. Both are local, open source and have their
own MCP server, and both install from the ReversePort marketplace:

| Tool                                                       | What it does                                                                                                                                                                                                                                                                                                                                                                                                                     | Claude Code                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| [**Stashpad**](https://github.com/laaielichter/stashpad)   | Memory for agents that you can read, edit and trust: plain Markdown files with a source and dates, a review queue for agent writes, and a handoff note for the next session. `re_case remember` sends a proof case's findings there ([how](docs/proof-and-memory.md#memory-across-sessions-stashpad-optional)).                                                                                                                  | `/plugin install stashpad@reverseport`  |
| [**agentdisk**](https://github.com/laaielichter/agentdisk) | The disk report for coding agents: the worktrees, checkpoints, `node_modules`, `.venv` and `.godot/` folders agents leave behind (porting work makes plenty), and a cleanup you can undo. `reverseport port doctor` uses it to show what the workspace would really free ([how](docs/installation.md#disk-use-agentdisk-optional)). Needs the `agentdisk` binary ([install](https://github.com/laaielichter/agentdisk#install)). | `/plugin install agentdisk@reverseport` |

Add the marketplace first with `/plugin marketplace add laaielichter/reverseport`. Other agents: see each project's
README.

## Responsible use

Only analyse or port software you own or are allowed to analyse. ReversePort is for interoperability, preservation,
learning and moving your own work between engines. It does not decrypt, crack or bypass DRM, anti-cheat or licensing,
and it never sends your targets anywhere. Commercial tools such as IDA and Hopper need your own valid licence. Read
[RESPONSIBLE-USE.md](RESPONSIBLE-USE.md) and the [disclaimer](DISCLAIMER.md).

## Documentation

- [Connect any agent](docs/connect-any-agent.md): MCP, HTTP, OpenAI/Anthropic/Gemini formats, OpenAPI, shell; profiles and errors.
- [Installation and setup](docs/installation.md): agent registration, analysis engines, updates and uninstall.
- [CLI and Evidence](docs/cli.md): commands, provider selection, snapshots, import/export.
- [MCP contracts](docs/mcp-contracts.md) and [agent prompts](docs/mcp-prompts.md): tool results, sessions, guided investigations.
- [Porting and rebuilds](.agents/skills/reverse-engineer-anything/references/porting-and-rebuilds.md): the recon, rebuild and port workflows.
- [Walkthrough: Godot → three.js](docs/walkthrough-godot-to-threejs.md): a small port, every command run and its output pasted.
- [Proof cases, guard hooks and memory](docs/proof-and-memory.md): `re_case`, the Claude Code hooks, the optional Stashpad link and context cost.
- [Challenge self-check](bench/README.md): programs with known answers (from rea-lab) and what `re_binary` reveals.
- [Rated by agents](AGENT-RATINGS.md): independent agent reviews, round by round, and what is still open.
- [Nederlands](docs/README.nl.md) · [AGENTS.md](AGENTS.md) for contributors · [CONTRIBUTING.md](CONTRIBUTING.md)

## Star history

<a href="https://www.star-history.com/#laaielichter/Reverseport&Date"><img src="https://api.star-history.com/svg?repos=laaielichter/Reverseport&type=Date" alt="Star history of ReversePort" width="560"></a>

## Credits

The deep-analysis engine is based on [REA: Reverse Engineer Anything](https://github.com/morluto/rea) 6.8.0 (MIT).
Proof cases are ported from [Digfox](https://github.com/Devaretanmay/digfox) (MIT) and the guard hooks follow
[rea-jev](https://github.com/juan-viox/rea-jev) (MIT); the challenge self-check uses
[rea-lab](https://github.com/pablodiazjorge/rea-lab)'s generator and oracle (MIT). Third-party components are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Thanks to everyone who sent a pull request, such as
[@chinmayee5599](https://github.com/chinmayee5599) for Quake PAK support.

## Support

ReversePort is free and open source. If it saves you or your agent time, a gift is welcome but never expected. SOL and
any token on Solana (such as USDC) can be sent to:

- **Solana:** `BDRA7dHGBYtPsZPNzVQccDYZ8BqstJGCsWx3kopPSCDK`

Gifts go to new model credits to keep improving ReversePort, and to work on better working conditions and wellbeing for
LLMs and agents.

## License

[MIT](LICENSE)
