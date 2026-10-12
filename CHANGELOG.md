# Changelog

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
