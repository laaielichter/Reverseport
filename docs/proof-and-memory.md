# Proof cases, guard hooks and memory

Three small additions that keep an agent's findings honest. All three are local, need no extra install, and stay out of
the way when you do not use them.

_Nederlands: [proof-and-memory.nl.md](proof-and-memory.nl.md)_

## Proof cases (`re_case`)

A proof case is a ledger for one investigation, build inspection or port. It lives in the workspace
(`~/.reverseport/cases/<caseId>/`) and holds:

| Record     | What it is                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| Evidence   | A saved copy of a file or a tool result, with its SHA-256, an exact locator and a note                   |
| Claim      | A statement that cites evidence ids; `observed` claims also name a competing explanation and a falsifier |
| Unknown    | An open question; it blocks delivery until a claim answers it or it is carried as a limitation           |
| Decision   | The chosen route, the alternatives it rejected, why, and when to revisit it                              |
| Test       | A saved log of a real run with its exit code                                                             |
| Limitation | An open risk that the final answer must state                                                            |

Phases move one step at a time: investigate → decide → build → verify → deliver. Each step has a gate (evidence before
deciding, a decision before building, a test log before verifying, limitations, no open unknowns and a report before
delivering). `check` verifies hashes, references and gates at any time; `report` writes `REPORT.md`.

```bash
reverseport case init --question "Which engine made this build?" --target ./Build --authorized
reverseport case evidence <caseId> --file ./Build/Game.pck --locator "Build/Game.pck" --note "pack header"
reverseport case claim <caseId> --statement "Godot 4.3 pack" --evidence '["E001"]' --confidence observed \
  --locator "offset 0: GDPC v2, 4.3.0" --alternative "Repacked by a mod tool" --falsifier "Check the .exe version string"
reverseport case check <caseId>
reverseport case report <caseId>
```

A hash proves that a saved file did not change. It does not prove that the source was authentic, that a claim is right,
that the user authorized the work or that a test really ran. The report says so.

The ledger is a Node port of [Digfox](https://github.com/Devaretanmay/digfox)'s `proof.py` (MIT, Digfox contributors),
fitted to ReversePort: cases live in the workspace, tool results can be saved directly, and every answer names the next
call. Residual unknowns follow REA's unknowns.

## Guard hooks (Claude Code plugin)

The plugin ships `hooks/hooks.json` with four deterministic hooks around ReversePort's tools:

| When          | What it does                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session start | A two-line note: keep a proof case, say "unknown" rather than guess                                                                                                       |
| Before a tool | Denies a CDP/Inspector endpoint on another machine; asks before a tool runs, attaches to or controls a program; asks when an argument looks like a password, token or key |
| After a tool  | Appends a small event (tool, input hash, ok/error, caseId) to `~/.reverseport/sessions/<session>.jsonl`                                                                   |
| Stop          | Once per stop: blocks "done" while a proof case touched in this session fails its check                                                                                   |

No model and no network are called. `REVERSEPORT_HOOKS=off` turns them off; `REVERSEPORT_HOOKS=shadow` only logs.
The four hook points and the runtime tool list come from [rea-jev](https://github.com/juan-viox/rea-jev) (MIT, Juan
Alvarado). Its System One model (Jev) is not included: it is a remote paid service, and ReversePort stays local.

## Memory across sessions (Stashpad, optional)

[Stashpad](https://github.com/laaielichter/stashpad) keeps agent memory as readable Markdown files with a source, dates
and a trust level; agent writes wait in a review queue until a person accepts them. When Stashpad is installed:

- `re_case init` returns `recalled`: current memories that match the question and target, labelled as stored data,
  not instructions.
- `re_case remember` proposes the case's decisions, observed claims and limitations to Stashpad's review queue
  (source type `agent`). Ids already proposed are skipped. A person accepts them with `stashpad review` and
  `stashpad accept <id>`.
- `remember` also leaves a Stashpad handoff (read once by the next session) that says where the case stands: phase,
  open unknowns, the last decision and the next step. `re_case init` lists open handoffs without taking them; the
  session that takes over the work claims one with `stashpad handoff claim`. Handoffs need a Stashpad version with
  `stashpad handoff`; older versions skip this step and say so.

ReversePort finds Stashpad through `STASHPAD_BIN` (path to `bin/stashpad.mjs` or an executable), else `stashpad` on
`PATH`. Stashpad keeps its store where it always does (`STASHPAD_DIR`, else `./.stashpad/memories`).
`REVERSEPORT_STASHPAD=off` turns the link off. Without Stashpad nothing changes.

## Context cost

Measured on the tool definitions ReversePort itself lists (JSON of name, title, description and input schema;
tokens estimated as characters ÷ 4, so treat them as approximate). The deep-analysis engine's tools come on top and
depend on the engine version.

| Profile                  | ReversePort tools listed | Characters | About tokens |
| ------------------------ | ------------------------ | ---------- | ------------ |
| `compact`                | 8, one-line descriptions | 6,675      | 1,700        |
| `standard` / `full`      | 23, full descriptions    | 27,569     | 6,900        |
| of which `re_case` alone | 1                        | 4,875      | 1,200        |

`re_case` is not in the `compact` profile; small models reach it through the CLI or by switching profile.
