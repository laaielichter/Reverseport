---
name: reverse-engineer-anything
description: Reverse engineer and port anything with ReversePort — native, managed, Android, Electron/JavaScript, packaged, firmware and browser targets with evidence (decompile, trace, compare versions), game projects and exported builds (engine, scenes, packs), recon from public sources without files, clean-room rebuild specs, and ports between Godot, Unity, Unreal, three.js and languages.
metadata:
  version: "40"
---

# ReversePort

Use ReversePort when a claim depends on a shipped binary or package, decompilation,
passive application runtime evidence, or comparison with
behavior not established by available source — and to identify, map, rebuild or
port a project, game or app. For a source project, start with `re_scan` and
`re_graph`; they need no analysis engine, so do not run readiness or provider
commands for them.

## Connect only when needed

Installing this skill supplies instructions; it does not register the ReversePort MCP
server, install analysis engines, or add tools to an already-running agent.

If ReversePort tools are available and their registration is not known to be stale,
proceed directly to the target. Do not run diagnostics or setup before every
investigation. Use the connected server's actual tool list and input schemas;
a skill installed from repository main may describe capabilities absent from
an older npm release. Keep complete inline Evidence when that server does not
advertise retained references.

If tools are absent, a call is blocked by the client, or a required provider is
unavailable, read [connection and recovery](references/connection-and-recovery.md).
Diagnose the observed blocker, continue useful supported work, and resume the
original task after repair. Client approval, shell PATH, registration and engine
availability have different remedies; avoid repeating setup for all of them.

Prefer an existing `reverseport` CLI. When none is installed and ReversePort package acquisition
is within the authorized scope, use `npx -y reverseport@latest` in its place.
Configuration repair starts with a read-only setup plan; show paths, backups and
skill replacement before applying authorized changes. Preserve existing approval
and target-execution boundaries. ReversePort setup never installs or upgrades unrelated
software, including Node.js, npm, Homebrew, Java, Ghidra, IDA, JADX, Binwalk or Unblob.

## Recon, rebuild and port

These tools run without an analysis engine or provider:

- Project folder or exported game build: `re_scan` (engine and version,
  languages, entry points), then `re_graph`, `re_symbols`, `re_scene`.
- Quick look at an executable, pack or unknown file: `re_binary`, `re_archive`
  (Godot `.pck` also inside an `.exe`, zip/apk/jar, tar.gz, asar), `re_probe`,
  `re_extract`. Two builds: `re_compare`. Write-up: `re_report`.
- Unity project with pink materials, "missing script" components or GUID
  trouble after moving files: `re_refs` (reports only; fix in Unity).
- Localisation: `re_strings` extracts user-facing text (Godot, Unity, RPG
  Maker, Ren'Py, i18n JSON) to .pot/.csv with stable ids; `action:"apply"`
  writes a translated copy and checks placeholders. Never edit strings by hand.
- Godot code you or a model wrote: `re_apicheck {path, engine:"godot@4.3"}`
  before opening Godot. Fix every renamed-* with its replacement and every
  unknown-* with a real API; never invent members.
- No files, only a name, store page, website or public repository: `re_lookup`,
  then `re_blueprint` for a clean-room rebuild spec measured against the original.
- Port between engines or languages: `port_map` → `port_plan` → `port_unit` /
  `port_write` (scenes: `port_scene`, assets: `port_copy_assets`) →
  `port_verify` until it passes. Convert every transform with `port_convert`.

Read [porting and rebuilds](references/porting-and-rebuilds.md) before a port or
a rebuild. Use the deep-analysis routes below when an answer lives in compiled
code.

## Route the target first

Choose the first tool from the target the user supplied. Use `open_binary` for
active-target native or archive workflows; target-free tools take their own
explicit path or endpoint and do not need it.

- ASAR or extracted JavaScript/Electron tree:
  `analyze_javascript_application`.
- Archive or pack members (zip/apk/jar/asar, Godot .pck): `re_archive` to list
  or extract. IPA/MSIX/AppX/DMG, or when you need Evidence IDs and integrity
  findings: `open_binary` with the local path, then `inspect_artifact`.
- Android APK code, classes, methods, or incoming references:
  `inspect_android_package`, then focused Android tools when advertised.
  Archive member inventory still uses the archive route above.
- Managed PE/CLI assembly: `inspect_managed_artifact`.
- User-owned browser page already open: `list_browser_targets`.
- User-owned Electron runtime already open: `list_electron_targets`.
- Native executable, library, or analysis database: `open_binary`, then
  use focused analysis tools directly; call `binary_overview` when metadata or
  inventory context is useful and available from the selected provider.

Firmware, NativeAOT, HAR/mitmproxy captures, WebAssembly, EVM bytecode, Go
metadata, ELF layout, recorded crashes, PE resources and IDA: see
[specialised targets](references/native-and-artifacts.md#specialised-targets).

If the user says only "my app" without a name, path, or target already selected
for this task, ask which app before searching for artifacts. Paths in unrelated
saved reports and nearby test fixtures do not select the user's target. Resolve
an actual human-readable app name to one clear installed artifact when possible;
ask when matches are ambiguous. Never choose an example app on the user's behalf.

Call only tools that are listed or that `engine_tools` returns (call those with
`engine_call`). When a tool is unavailable or refuses, `binary_session {}` →
`result.tool_availability` gives the reason and the fix; `tools/list` has the
canonical schemas.

## Work summary-first

Start with the default result and use its inline Evidence and graph context.
For a JavaScript application or ELF layout whose size is unknown or large,
call `analyze_javascript_application` or `inspect_binary_layout` with
`"detail": "summary"`, then inspect the retained `parent_evidence_id` with
`inspect_analysis_view`.
Page module identities and select the returned `node_id` before requesting an
item; a single file path can represent several graph roles. Do not repeat an
identical analysis or rejected call without a changed input or resolved blocker.
Recheck session state when a lifecycle change makes that status useful.
Make a focused follow-up only when the
returned result leaves a specific question unanswered.

If MCP reports `resource_constraint` with `details.resource: "transport"`, call
`inspect_analysis_view` with its reported same-session Evidence reference for a
summary, one section/module, or a stable page. Use `trace_application_feature`
once a seed is known, or call `export_evidence_bundle` to write the complete
session to a selected path. The analysis remains complete in the ledger; avoid
repeating it merely to request the same oversized response. Complete CLI JSON
output also streams without a single MCP frame.

When the retained parent ID is unknown, use `get_evidence_bundle` with
`detail: "summary"` and exact filters for operation, target SHA-256,
analysis-profile digest or canonical procedure address. Select its returned
Evidence ID for the next view instead of requesting the complete bundle.
`retention: "complete-record"` means the whole record is stored; native
value-flow truncation and unknown metadata remain separate. For an exported
portable bundle, use `reverseport inspect-evidence-bundle` with JSON containing `path`,
`detail: "summary"` and the same `filters`. Reading that file still requires
validating its full contents within the local memory budget.

A client can also truncate a successful tool result without a ReversePort transport
error. Treat that preview as incomplete; use the retained parent ID for smaller
views or export when the full record is needed. Do not parse the preview as
canonical JSON or repeat the producer. For JavaScript, read the
[module-view and trace recipes](references/javascript-applications.md) before
drilling into a large graph; a broad bidirectional trace can expand unrelated
containment relationships even after summary analysis.

Every conclusion must distinguish observations, inferences, and unknowns. Cite
Evidence IDs, preserve limitations and incomplete coverage, and never imply
that static analysis observed execution. Runtime requests execute the declared
target and lifecycle; do not broaden the target or action beyond those fields.

Within the user's requested investigation, call available analysis tools
directly. ReversePort does not require permission grants or per-call approval flags.
The agent client can independently require approval. Follow the declared request
scope and the host's actual access requirements; use the recovery guide for an
observed client-policy rejection.

## Plan broader investigations

For requests that span multiple features or subsystems, use a staged workflow:

1. Turn the request into a checklist of questions and the evidence each answer
   needs. Resolve target identity and constraints from the conversation and
   workspace before asking for information again.
2. Inspect the current ReversePort session, artifact identity, saved analysis database,
   bookmarks, and prior evidence. Reuse matching state; do not open duplicate
   sessions or repeat identical analysis.
3. Start with the smallest useful overview or inventory. Follow each question
   from its entry point through relevant data and state changes to its result.
   Batch related operations around a specific hypothesis, then expand only when
   the returned evidence leaves a concrete gap.
4. Inspect relevant packaged resources and configuration alongside code when
   they affect the question. Use format-aware inventory and parsers; do not
   infer behavior from filenames, strings, or layout alone.
5. Corroborate a conclusion with the evidence type it requires. Use runtime
   observation only when static evidence cannot answer the question and the
   required host runtime and OS access are available. For JavaScript behavior,
   run probes against the actual app through the available browser, Electron,
   or process capture workflow.
6. Decompose work into independent questions. When parallel workers are
   available and the questions do not depend on one another, assign distinct
   scopes, point workers to existing evidence, and ask them to return sources,
   conclusions, and unresolved gaps. Otherwise, work sequentially.
7. Keep a concise finding ledger linking each conclusion to Evidence IDs,
   confidence/evidence type, search boundary, and remaining unknowns. Update
   the shared index or investigation report so later passes can reuse results.

Before finishing, revisit the original checklist. Mark each question as
answered, partially answered, or unresolved based on its evidence; keep
bounded negative searches bounded, and do not describe a broad investigation
as complete while required questions remain open.

## Read only the relevant guide

- Native binaries, managed assemblies, archives, and extraction:
  [references/native-and-artifacts.md](references/native-and-artifacts.md)
- ASARs, extracted JavaScript, feature tracing, and version comparison:
  [references/javascript-applications.md](references/javascript-applications.md)
- Android APK declarations, classes, methods, and static references:
  [references/android-applications.md](references/android-applications.md)
- Passive browser/Electron observation and static/runtime reconciliation:
  [references/runtime-observation.md](references/runtime-observation.md)
- Evidence paging, comparisons, residual unknowns, and verification:
  [references/evidence-workflows.md](references/evidence-workflows.md)
- Game projects and builds, recon without files, clean-room rebuilds and ports:
  [references/porting-and-rebuilds.md](references/porting-and-rebuilds.md)

## Finish the task

Explain findings in plain language and tie them to returned evidence. When the
user asks to build something, use normal coding tools and separate observed
behavior from design choices. Close an opened native session with
`close_binary` when the investigation is complete.
