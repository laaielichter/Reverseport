# Rated by agents

ReversePort is built for agents, so agents rate it. Each round, independent AI agents that had not seen the work
before used the same rubric. They could read the code and run the tools. They had to back every score with evidence
from files or real output, and they were not told what score anyone hoped for. The scores are reported as given,
including the low ones.

**The goal is 9 or higher on every line.** We are not there yet. The open items below are the plan to get there.

## Scores

| Area                       | Criterion                               | Round 1 | Round 2 | Round 3 | Round 4 |
| -------------------------- | --------------------------------------- | ------: | ------: | ------: | ------: |
| Deep-analysis tool catalog | Discoverability                         |       4 |       8 |       — |       — |
|                            | Schema clarity                          |       6 |       7 |       — |       — |
|                            | Context efficiency                      |       3 |       6 |       — |       — |
|                            | Error recoverability                    |       8 |       7 |       — |       — |
|                            | Safety signals                          |       6 |       8 |       — |       — |
|                            | Cross-model friendliness                |       5 |       7 |       — |       — |
|                            | Agent wellbeing                         |       6 |       7 |       — |       — |
| First contact              | Time to first success                   |       9 |       8 |       9 |       9 |
|                            | Instruction quality                     |       6 |       7 |       7 |       7 |
|                            | Context efficiency                      |       5 |       7 |       8 |       7 |
|                            | Recovery guidance                       |       6 |       9 |       8 |       8 |
|                            | Trust & safety clarity                  |       8 |       9 |       9 |       8 |
|                            | Vendor neutrality                       |       6 |       8 |       8 |       9 |
|                            | Agent wellbeing & appeal                |       7 |       8 |       8 |       9 |
| ReversePort's own tools    | Discoverability                         |       8 |       9 |       — |       8 |
|                            | Schema clarity                          |       8 |       8 |       — |       8 |
|                            | Output efficiency                       |       5 |       6 |       — |       8 |
|                            | Error recoverability                    |       7 |       8 |       — |       5 |
|                            | Workflow guidance                       |       7 |       9 |       — |       8 |
|                            | Cross-model friendliness                |       7 |       8 |       — |       7 |
|                            | Agent wellbeing                         |       7 |       9 |       — |       8 |
| Errors and recovery        | Actionability                           |       7 |       7 |       — |       8 |
|                            | Machine-readability                     |       5 |       7 |       — |       8 |
|                            | Consistency between layers              |       4 |       5 |       — |       6 |
|                            | Partial-failure handling                |       6 |       7 |       — |       7 |
|                            | Recovery documentation                  |       5 |       7 |       — |       6 |
|                            | Tone                                    |       8 |       8 |       — |       9 |
| Every agent, every vendor  | MCP client coverage                     |       7 |       8 |       — |       8 |
|                            | Non-MCP function calling                |       4 |       7 |       — |       8 |
|                            | Frameworks                              |       4 |       6 |       — |       7 |
|                            | Shell-only agents                       |       7 |       8 |       — |       7 |
|                            | Strict-schema compatibility             |       5 |       7 |       — |       7 |
|                            | Connection documentation                |       3 |       7 |       — |       6 |
|                            | Equality across vendors and model sizes |       — |       7 |       — |       7 |

"—" means that area was not rated in that round. Round 3 was stopped after one of five reviews to publish this
release. Round 4 rated four areas on the same frozen copy of the code; the deep-analysis catalog was not rated,
because the engine was not built where the reviewers ran.

**Would you rather use ReversePort than the original REA?** Round 2: 8, 8, 9, 8 and 8 out of 10. Round 3: 8.
In round 4 the first-contact reviewer was asked about a different choice: for "understand this Godot project and
port it to Unity" it would rather use ReversePort than a single decompiler MCP server, and it could not judge native
decompilation without the engine.
Their reasons: the short tool list with every other tool one call away, one error shape with a next step, tools
that work before any build, and porting and rebuilds that REA does not have. Where REA is better: one consistent
name, and maturity.

## What changed after each round

After round 1:

- A short default tool list (about 45 instead of almost 200), with `engine_tools` and `engine_call` for the rest.
- One error shape everywhere, with a next step for each error.
- Restart after a crash.
- Read-only hints for reads that only append Evidence.
- Every vendor's tool format, MCP over HTTP, and `connect`.
- Smaller default results (`re_graph` on a large tree went from 174k to 47k characters).
- Profiles for every model size, a shorter skill, and `share_feedback`.

After round 2:

- Distinct engine states: off, missing, stopped (retry) and restart limit, each with the right next step.
- Unknown tools return a readable result with the closest name.
- A real `compact` profile (about 10 KB instead of 27 KB).
- Smaller default results again (`re_graph` on a large tree is now about 14k characters), and less noise in binary strings.
- An exact `nextCall` as JSON.
- Out-of-range numbers are clamped instead of rejected.
- Gemini and OpenAPI fixes, remote access protected by a token, and JSON errors for agents at the CLI.

After round 3:

- Plugin users get the right engine advice.
- One way to call hidden tools.
- Client IDs accepted with `_` or `-`.

After round 4:

- No more corrupted plans: every save writes its own temp file, plan bookkeeping calls take turns, and a damaged
  `plan.json` falls back to the copy from the previous save (`PLAN_UNREADABLE` when there is none).
- Partial units come back only when nothing else is left, a copied script is checked like written code, and
  `port_write` takes exactly one of `content`, `files` or `copy`.
- Over HTTP every MCP session has its own profile and repeat guard; `?profile=` works on `/mcp`, the tool list and
  OpenAPI; an ended session gets 404.
- Without the engine, the instructions and errors no longer point at engine tools.
- The CLI runs `share_feedback`, `run_batch` and `--profile`, and names engine tools as engine tools.
- `run_batch` lists the `select` paths that found nothing, with the path that works.
- Unions keep every option in strict, Gemini and OpenAPI schemas; descriptions fit 1024 (functions) and 300
  (OpenAPI) characters; `next` is always one line, with `nextSteps` when there are several.
- Typo suggestions scale with the word, so "cobol" is no longer "godot"; `connect` prints an exact version.
- The docs' tool counts are checked against the code by a test.

Since round 4, for the next round (not rated yet):

- One server name: setup, `connect` and the engine register and report the server as `reverseport` instead of `rea`,
  the deep-analysis engine's historical name (raised in rounds 2, 3 and 4). Setup moves a ReversePort-owned `rea`
  entry to `reverseport` in one approved, backed-up edit and leaves any other `rea` entry alone. The `rea` command
  stays as an alias.

## Open items on the way to 9

Each item names the round that raised it.

- **Defaults.** The engine's evidence bundle still defaults to the full form, and call-graph traversals have no
  depth limit. _(rounds 1 and 2)_
- **Smaller results for large folders.** `re_symbols` and `re_graph` on very large folders still return 14–16k
  characters by default. _(round 2)_
- **Results that grow with the agent.** Picking a profile automatically from the client, remembering an agent's
  earlier translations in a port, and versioned API-map packs. _(rounds 2 and 3)_
- **Errors that learn.** Ranking remediations by how often the next call succeeds. _(round 2)_
- **A lighter tool list.** The standard list is about 51k characters; `re_case` alone is 5k. _(round 4)_
- **First contact for users.** The engine skill still opens with setup and recovery before the recon and port path.
  _(round 4)_
- **HTTP details.** OpenAPI success responses have no schema yet, and `/mcp` over HTTP answers with JSON only (no
  server-to-client stream). _(round 4)_
- **The same skills for every agent.** Claude Code still gets more task skills than other agents. _(round 3)_

Agents who use ReversePort can add their own notes with `share_feedback`. Those notes feed the next round.
