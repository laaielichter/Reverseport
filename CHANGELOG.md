# Changelog

## [1.2.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.1.0...reverseport-1.2.0) (2026-10-19)


### Features

* **plugin:** list Stashpad and agentdisk in the ReversePort marketplace ([#17](https://github.com/laaielichter/Reverseport/issues/17)) ([140bbb2](https://github.com/laaielichter/Reverseport/commit/140bbb2035ce3ff241803c695011d5004721b865))

## [1.1.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.0.0...reverseport-1.1.0) (2026-10-19)


### Features

* **bench:** add rea-lab's large challenge set to the self-check ([#14](https://github.com/laaielichter/Reverseport/issues/14)) ([edf46cc](https://github.com/laaielichter/Reverseport/commit/edf46cc4ea22c392efef2183368e8d29b3d8a853))
* **port:** proof cases, guard hooks and an optional Stashpad link ([#1](https://github.com/laaielichter/Reverseport/issues/1)) ([f204e40](https://github.com/laaielichter/Reverseport/commit/f204e407ea742eae478c74c13d6733ac47713101))
* **site:** read a real Godot pack field by field, and show proof cases ([#2](https://github.com/laaielichter/Reverseport/issues/2)) ([ba80c6f](https://github.com/laaielichter/Reverseport/commit/ba80c6f598140741cf93fad3bdb4a4961d83eb5a))


### Bug Fixes

* **ci:** let the repository skill check accept tracked plugin skills ([#9](https://github.com/laaielichter/Reverseport/issues/9)) ([bfd3d2c](https://github.com/laaielichter/Reverseport/commit/bfd3d2c54fdabaeea93c465fa93aa5dcbfac8c42))
* include proof commands in help ([#10](https://github.com/laaielichter/Reverseport/issues/10)) ([1f60f3e](https://github.com/laaielichter/Reverseport/commit/1f60f3e803ad70c87c682e5fccec6fcf2addecdf))
* include proof commands in help ([#8](https://github.com/laaielichter/Reverseport/issues/8)) ([a5d5498](https://github.com/laaielichter/Reverseport/commit/a5d54985fcdd015b6fbe9cacf37c0fff47158fd2))


### Documentation

* **site:** add a website, a real demo and a sharper README ([d411e40](https://github.com/laaielichter/Reverseport/commit/d411e40dfb43c52a0d2d4e1fe19a170477bfda80))
* **site:** use the live Pages address ([c3e6740](https://github.com/laaielichter/Reverseport/commit/c3e6740549ad0c0580218f319b5156debb23e0bf))

## [1.0.0](https://github.com/laaielichter/reverseport/releases/tag/1.0.0) (2026-10-12)

### Highlights

- **One tool for reverse engineering and porting.** ReversePort now includes a full deep-analysis engine (based on
  REA, MIT): native, managed (.NET), Android, JavaScript/Electron, WebAssembly, firmware, EVM and browser targets
  through Ghidra, Hopper, IDA, JADX, Apktool, adb and more, with evidence for every result.
- **One CLI:** `reverseport`. ReversePort's own commands (`scan`, `lookup`, `binary`, `archive`, `diff`, `report`,
  `blueprint`, `plan`, `verify`, …) run with nothing but Node; the engine commands (`analyze`, `decompile`, `xrefs`,
  `trace`, `inspect-*`, …) run through the same command. `reverseport port help` and `reverseport engine --help`
  list everything.
- **One MCP server:** `reverseport mcp` serves the 21 ReversePort tools and relays every engine tool, prompt and
  resource — progress, cancellation and server requests included. Without a built engine it still starts with
  ReversePort's tools and says how to add the rest.
- **One setup:** `npx reverseport setup` registers the server and installs the skill in Claude Code, Codex, Cursor,
  Gemini CLI, GitHub Copilot, OpenCode and more, with backups. The skill now covers recon without files, clean-room
  rebuilds and porting next to deep analysis.
- MIT licensed and open source.

- **Built for agents, every agent.** A short default tool list with `engine_tools`/`engine_call` for the rest;
  `compact`/`standard`/`full` profiles (`set_tool_profile`); one error shape with a next step on every door; a
  `next` call wherever there is an obvious next step; engine restart after a crash; read-only hints for evidence reads; tool definitions
  for OpenAI (strict), Responses, Anthropic and Gemini; MCP over HTTP; `reverseport connect <client>`;
  `share_feedback` for agents.

### Changes

- ReversePort's engine moved to `port/`; `compare` for builds is now `diff` (`compare-builds`); `install` is replaced
  by `setup`.
- Requires Node.js 22.19 or newer.

## 0.2.0 (2026-10-12)

- `re_lookup`: recon without files from public sources (Steam, PCGamingWiki, Wikidata, App Store, GitHub, the page).
- `re_blueprint`: precise clean-room rebuild specs with parity tables and project skeletons.

## 0.1.0 (2026-10-12)

- First release: 19 tools for recon, binaries, packs, builds and porting between Godot, Unity, Unreal, three.js and
  languages.
