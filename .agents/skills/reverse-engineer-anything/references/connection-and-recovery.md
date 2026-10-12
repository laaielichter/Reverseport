# Connection and task recovery

Read this guide only for an observed connection, command, approval or provider
blocker. Keep the user's target and question in view. Explain what prevented the
operation and the next useful step; after repair, continue the investigation.

Commands below use an installed `reverseport`. If none is available, use the package
invocation in `SKILL.md` when acquiring ReversePort is authorized. Follow the connected
server's schemas and the installed CLI's help rather than assuming repository
main and an older release expose the same arguments.

## Choose the remedy from the observed failure

| Observation                                                                    | Meaning and next step                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No ReversePort tools in the active session                                     | Inspect registration with `reverseport doctor --client <client-id> --json` (IDs below). A skill installation alone does not register MCP.                                                                                                                                                                             |
| Missing, malformed or stale registration                                       | Prepare a scoped setup plan; apply only authorized changes with backups.                                                                                                                                                                                                                                              |
| Aligned registration, but no connected tools                                   | Restart/reconnect the client. Doctor checks registration; it cannot establish the current agent's connection. Inspect the client's launch error if reconnection fails.                                                                                                                                                |
| `MCP tool call requires approval, but approval policy is never`                | Codex rejected the call before ReversePort executed it. Do not install an engine or repeat setup to solve this client-policy decision. See the approval section below.                                                                                                                                                |
| ReversePort returns `provider_unavailable` or an unavailable tool entry        | Read that operation's provider diagnostics or `binary_session.result.tool_availability`. Expand each group's tool names and inherit the shared client requirements unless overridden. Use the operation's availability, reason, and remediation; a complete tool catalog does not imply every operation is available. |
| Only `re_*`, `port_*` and `share_feedback` are listed, or `ENGINE_UNAVAILABLE` | The deep-analysis engine is not built or is turned off; the error message says which. ReversePort's own tools keep working, so continue with them. Ask the user before installing: `npx -y reverseport@latest setup`, or `npm ci && npm run build` in a checkout, then restart the client.                            |
| `The deep-analysis engine stopped (…)` or `exited during this call`            | Call the engine tool again once: the server restarts the engine. If it keeps stopping, run `reverseport doctor` and report what it shows.                                                                                                                                                                             |
| A tool you expect is not in the list                                           | The default list is short on purpose. `engine_tools {query}` finds it; `engine_call {tool, arguments}` calls it. `REVERSEPORT_TOOLS=all` lists every tool.                                                                                                                                                            |
| `reverseport` is missing in a child shell, or Node is incompatible             | Inspect the actual shell PATH and launcher/runtime. A prefix installation may be absent from a login shell's PATH; this does not establish a broken MCP registration.                                                                                                                                                 |

If the client cannot launch its shell/sandbox helper or read the installed skill,
inspect its launch diagnostic. For example, Codex can refuse helper aliases when
CODEX_HOME is under `/tmp`; use an authorized profile outside the OS temporary
directory. ReversePort setup cannot repair the client's executor. Preserve the sandbox
instead of silently disabling it to make an analysis command work.

Static JavaScript and ordinary ZIP inventory need neither Hopper nor Ghidra.
HAR inspection is offline and does not require a live browser. Native
decompilation, Android analysis and firmware extraction have their own
bring-your-own prerequisites. Use supported inventory/static evidence when it
answers part of the question, and name the unavailable evidence separately.
Do not substitute another target. Label observations from ordinary shell tools
as such; only actual ReversePort output supplies ReversePort Evidence.

## Repair registration when needed

For any client (example: Codex; use your client's ID):

```bash
reverseport doctor --client codex --json
reverseport setup --client codex --dry-run --json
```

Use the current supported client's ID: `claude_code`, `claude_desktop`, `codex`,
`cursor`, `gemini_cli`, `windsurf`, `devin`, `opencode`, `antigravity`,
`copilot_cli`, `commandcode`, `qwen_code`, `vscode`, `grok_build`, `omp`, `pi`,
`hermes`, `dsh`, or `grok_bot`. If unknown, inspect `doctor --json` before choosing a
scope. `grok_bot` uses a chat registration step rather than local `mcp.json`.
For unsupported clients, use version-pinned manual stdio registration or CLI.

Show the plan's exact paths, backups, changes and bundled-skill replacement.
Obtain approval for writes when that concrete scope is not already authorized,
then apply the same scope with `reverseport setup --client codex --yes`. Add
`--install-hopper` only when separately needed and explicitly approved. Do not
install or upgrade unrelated prerequisites. Restart/reconnect, verify tools
actually appear, and resume the original task. If they remain absent, inspect
the launch failure rather than looping through setup.

## Codex tool approval is separate from ReversePort readiness

ReversePort tools have no permission-grant handshake. Codex can still require approval
because an operation creates owned resources, launches a helper or has cleanup
effects. An advertised tool or successful doctor result does not override that
client policy. `workspace-write` alone does not resolve an MCP approval
rejection, and `approval_policy = "never"` does not mean every MCP tool is
preapproved.

When interactive approval is available, use the client's approval flow for the
requested operation. In an unattended run, continue through an authorized CLI
workflow if the execution environment permits it, or report the blocked
operation and the approval needed to proceed. Do not retry the same rejected
call, silently broaden approvals, or rewrite MCP effects as read-only.

For an operator who explicitly wants to preapprove named operations in a
disposable Codex profile, current Codex supports per-tool configuration. For
example, opening and closing an analysis session can be scoped independently:

```toml
[mcp_servers.rea.tools.open_binary]
approval_mode = "approve"

[mcp_servers.rea.tools.close_binary]
approval_mode = "approve"
```

Use the actual server ID and only the operations whose effects were approved;
this example does not approve inspection, extraction or runtime execution.
Show the proposed config edit and preserve unrelated entries and backups before
writing. Managed policy can constrain client settings. Consult the
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
for the installed client's supported settings. This is an optional recovery
choice, not a prerequisite for every ReversePort task.

## Continue through an installed CLI

Check the command environment only if the launcher fails:

```bash
command -v reverseport
command -v node
node --version
reverseport --version
```

Use the public launcher at its known installation path with a supported existing
Node on PATH when the child shell loses a prefix installation. Avoid internal
`dist/cli.js` entrypoints or global toolchain changes. MCP may have its own valid
launcher even when a shell cannot resolve `reverseport`.

For a user-supplied JavaScript tree or ASAR, select output files in the authorized
workspace and save complete Evidence before reading a view:

```bash
reverseport analyze-javascript-application /absolute/path/to/app --json > app-evidence.json
jq -c '{source: {kind: "inline", evidence: .}, view: {kind: "summary"}}' app-evidence.json > app-view.json
reverseport inspect-analysis-view app-view.json
```

These commands do not register MCP or install an analysis engine. CLI JavaScript
JSON is complete and can be very large; redirect it rather than loading it into
context. Use an existing JSON processor if `jq` is absent, without installing
one just for this recipe. Inspect a module page or item using the same inline
source and the [JavaScript recipes](javascript-applications.md). Preserve graph
coverage, limitations and unknowns. Native CLI analysis still requires its
selected engine, and all CLI operations retain the host's execution permissions.
