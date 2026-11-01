# Default MCP input catalog cost

Continues [#5861](https://github.com/morluto/rea/issues/5861). Baseline is
`705058f3e2df82503f1c601fc464aea7cbb626b8`. The candidate selects the existing
compact input presentation when the setting is omitted. Explicit `full` and
`compact` choices, all 213 tools, descriptions, output contracts, canonical
validation, provider behavior and complete Evidence remain available.

This is a change to the default advertisement. Callers requiring full field
guidance and nested validation declarations can set
`REA_MCP_INPUT_SCHEMA_PROFILE=full`. Compact drops nested annotation prose and
reduces structurally oversized/deep schemas; it is not an equivalent complete
input declaration. The canonical server validator still admits or rejects the
same inputs. No new profile, tool-selection API, cache or discovery protocol is
introduced. Output schemas retain their existing default.

## Completed SDK tasks

The [receipt](mcp-input-catalog.json) pins sources, publisher URLs/digests,
individual calls and resource observations. The unchanged Alpine v3.21 x86_64
releases are ripgrep 14.1.1-r0 (3,416,168 bytes) and Zellij 0.40.0-r0
(17,151,864 bytes). Neither binary was executed. The independent
[oracle](mcp-input-catalog-oracle.py) reads ELF section headers, decompresses
`.dep-v0` with Python zlib, and derives original package indices and dependency
edges from the embedded JSON, independently of REA.

Each [production stdio SDK task](mcp-input-catalog.mjs) discovers and validates
the complete advertised input catalog, requests exact serde package fields,
reads the same retained page twice, probes a negative offset, exports complete
Evidence, compares every package and edge with the oracle, and closes the
transport. RPCs bind the exact advertised named tool definition. Tool metadata
outside input schemas and complete parent Evidence are equal before/after.
The real negative input is refused in every task.

Three fresh-process pairs per artifact alternate order (before/after,
after/before, before/after). Both runtimes use Node 24.18.0, npm 11.16.0 and
MCP SDK 2.3.1 on Linux x86_64. Node compile caching is disabled; OS caches are
not flushed and unrelated host load is uncontrolled. Artifact acquisition,
builds and oracle preparation are outside the measured analysis task.

| Artifact | Default before/after | Whole-task estimated tokens | Wall median seconds | CPU median seconds | Family peak median MiB |
| -------- | -------------------- | --------------------------: | ------------------: | -----------------: | ---------------------: |
| ripgrep  | full                 |                     204,358 |               7.379 |              7.159 |                  804.3 |
| ripgrep  | compact              |                      51,801 |               7.274 |              7.036 |                  815.5 |
| Zellij   | full                 |                     204,278 |               7.373 |              7.162 |                  839.0 |
| Zellij   | compact              |                      51,721 |               7.374 |              7.131 |                  827.0 |

The input-facing catalog alone changes from 200,425 to 47,868 estimated tokens
(76.1% lower). Each whole task includes the catalog once, all five calls'
arguments and text replies: about 74.7% lower. These are offline
`tiktoken==0.12.0` / `cl100k_base` estimates, not model usage. The raw SDK catalog
including output schemas changes from 903,377 to 750,623 estimated tokens;
clients exposing that entire representation have a smaller proportional gain.
JSON-RPC envelopes and client-specific conversion/replay are unmeasured here.

Wall ranges overlap (ripgrep 7.27–7.68 vs 7.07–7.27 seconds; Zellij 7.17–7.48 vs
7.07–7.38). No general elapsed, CPU or memory improvement is established.
Fresh processes include first-use cost and two same-session historical reads;
the latter are not fresh live-state observations.

## Actual model tasks and the limit of the claim

Six real Codex CLI 0.161.0 tasks used fresh isolated profiles, the complete
catalog, no enabled-tool filter, and requested `gpt-6.1-sol` / medium reasoning.
The resolved server-side model identity is unknown. Each profile completed a
direct ripgrep package question, a broad Zellij metadata question, and an
intentional invalid-offset question. Artifact bytes were unchanged and owned
profiles were removed. Answers match independent package/index/count/digest
facts, cite actual returned Evidence or its parent, preserve embedded-metadata
limitations, and accurately report the negative cases without retrying.

| Question       | Actual input tokens full → compact | Calls full → compact | Guarded wall seconds full → compact |
| -------------- | ---------------------------------: | -------------------: | ----------------------------------: |
| Direct package |                  169,419 → 173,274 |                2 → 2 |                     33.854 → 31.448 |
| Broad metadata |                  126,522 → 166,082 |                1 → 2 |                     28.434 → 34.989 |
| Invalid offset |                  167,283 → 140,530 |                1 → 1 |                     32.983 → 29.641 |

These are one pair per question on the baseline runtime's explicit full/compact
variants, not repeated model-performance cohorts. Compact used an extra call
for the broad question. **Actual Codex token, latency or task-quality gains are
not established.** Recorded client usage includes cached input; it does not
identify the exact rendered catalog contribution. The change addresses the
default declaration cost for clients carrying the complete catalog; it does not
promise identical savings for clients performing tool search or other schema
conversion. Explicit full remains useful when the additional guidance avoids
extra calls.

All analysis/model runs use one CPU, 4 GiB family hard / 3 GiB early memory
limits, no swap and 192 tasks. CPU and memory.peak are kernel cgroup counters
observed at payload exit, including the controller and charged page cache.
All accepted tasks have authenticated payload-exit observations, successful
exit and cleanup, and zero observed high/max/OOM/PID-limit events. Final
whole-scope counters are unavailable after the transient scope disappears.

The first SDK harness attempt used an incorrect retained-source argument and
was correctly refused. It is retained as a failed attempt and excluded from
accepted comparisons; the harness was corrected before the repeated cohorts.

## Reproduction

Generate an oracle with Python 3 and the pinned extracted binary:

```bash
python3 experiments/analysis-efficiency/mcp-input-catalog-oracle.py /absolute/ripgrep /absolute/oracle.json
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/mcp-input-catalog.mjs \
  --runtime /absolute/runtime --artifact /absolute/ripgrep \
  --oracle /absolute/oracle.json --output /absolute/new-output \
  > /absolute/new-output.log 2>&1

# In an analysis environment with tiktoken==0.12.0 installed:
python3 experiments/analysis-efficiency/mcp-input-catalog-costs.py \
  --output /absolute/costs.json /absolute/new-output
```

Repeat against baseline/candidate runtimes with the setting omitted. Explicit
`--profile full` and `--profile compact` verify caller overrides. The existing
`agent-trial.py` runs the recorded model question files and explicit provider
settings; authentication/profile files and raw binaries are never committed.
Use [the cost script](mcp-input-catalog-costs.py) with the pinned tokenizer to
account for complete SDK tasks and separately recorded model usage.

Keep the sibling log: accounting requires its authenticated resource receipt.
Its name appends `.log` to the entire case-directory basename, including dots.
A real `reproduce.sdk.1` Zellij task and its accounting completed successfully;
reprocessing every original record with this path fix leaves all costs equal.
This additional check is not part of the original performance cohorts.

## Latest-main integration and validation

Rebased onto `25e1a24a3ed3671a0148757555f18d16c29d936a`. A separate real Zellij
pair on that candidate, explicit full versus omitted/default, passed all facts,
full parent Evidence and negative checks. Catalog input estimates remain
200,425 versus 47,868 tokens; these integration runs do not replace or extend
the earlier repeated cohorts. Explicit full on the candidate also reproduced
the pre-change full catalog exactly.

The initial ten-file local run passed 88 tests, skipped one and failed two: a
live-identity assertion still expected the old default digest, and the complete
canonical-schema suite timed out at 30 seconds. The assertion now checks the
default compact identity. Both affected suites passed all 26 tests with serial
files and unchanged deadlines; the timeout's cause is not established. After
rebasing, 32 profile/identity/production-doctor tests passed. Static checks
passed on both bases. Documentation checks caught a new README link absent from
translated link inventories (including a duplicate-link attempt); the
introduction now names the existing guide without changing the link inventory.
Final documentation and CI results qualify the PR.

## Review follow-up: ownership of catalog identity

The former `CATALOG_IDENTITY` meant the full advertisement, while two consumers
treated it as the default live identity. The owner now exports explicit
`FULL_CATALOG_IDENTITY` and `DEFAULT_CATALOG_IDENTITY`; the ambiguous export is
removed. Canonical build/packaging consumers use full identity, default
diagnostics use default identity, and custom/explicit profiles keep their own
identity. Readiness captures and validates `binary_session` from the actual
server rather than assuming a profile. Claude's verifier derives its expected
identity using the shared input/output profile parsers.

Nine related test files passed 106 tests with two skips. Static and
documentation gates passed again. Actual readiness tasks passed with default,
explicit full, and compact input/output-off settings. The final real Zellij SDK
task reproduced the earlier complete parent and advertised catalog exactly.

Real Claude Code 2.1.296 with the loopback fixture discovered all 213 schemas
and returned `binary_session` for both profiles. It persisted the 55,471-byte
result, preventing the verifier's existing inline-only recognizer from
continuing. The untouched baseline reproduces the same failure (55,473-byte
result) after preparing its matching packaged skill. This is not a passing
end-to-end Claude analysis claim; the unrelated recognizer is left unchanged.
The actual persisted native responses were independently parsed with the named
production output contract: both selected catalog identities match, and the
completed readiness reports record the same digests. Receipts retain the
baseline/candidate failures, cleanup and this narrower successful check.

First-head CI found three remaining tests that assumed a full default
advertisement. The ZIP retained-inventory, browser-endpoint and literal-seed
cases now exercise full and compact: full retains its strict declaration and
guidance assertions; both keep canonical refusal and valid workflow checks.
Four affected files passed all 27 tests serially on main
`6d356b84344659085f2b912857b5e27fe0160c9b`; static/documentation gates passed.
An earlier parallel-file attempt was stopped at the 3 GiB early boundary before
OOM and is incomplete. Serial execution stayed below the same boundary without
raising the 4 GiB family limit. No performance cohort includes these test runs.

Additional CI cases now select full presentation when testing nested schemas
or literal advertised examples. Default source-comparison and JavaScript-fact
workflows still exercise canonical invalid-input refusal. After regenerating
the ignored catalog metadata, four files passed 31 tests; the full-catalog
ordering case hit its 20-second child deadline. That case passed alone in a
fresh process with the same deadline (14.85-second test duration). All five
files have passing checks; the combined run did not pass and its timeout cause
is not established. Family peaks were 2.43 GiB for the combined run and 1.0 GiB
for the standalone run, within unchanged limits. These validation attempts are
separate from the performance cohorts.

The next CI portable aggregate passed 15,703 tests and skipped 29, with one
remaining Godot inventory advertisement assertion failing. That workflow now
runs under both full and compact, preserving canonical invalid-field refusal
and retained facts after source removal. Its three local tests passed within
the same resource limits, including encrypted-directory unknown coverage.

A further review found that CLI status relied on an implicit default catalog,
so explicit full input advertised a different identity through CLI and MCP.
CLI status now derives input/output presentation from parsed configuration;
configuration retains the output profile too. Runtime identity requires an
explicit catalog from each caller. Two suites passed 25 tests, including real
production stdio, `capabilities` and `providers` comparisons for default, full,
compact and both output-off combinations. This target-free verification is
separate from real artifact measurements and does not qualify native engines.

Rebased again onto `8e3bf56e1` after upstream browser Evidence schema changes.
A separate completed real Zellij SDK task preserved its complete parent and
every catalog field except output schemas; whole-task estimate remains 51,721
tokens. Fourteen production CLI/MCP profile/lifecycle tests passed. Two
absolute-path tests also passed: full advertisement conformance explicitly
selects full, while actual relative-path refusals keep the default compact
presentation. This fixes the remaining nested-path assertion found by CI.
These integration checks do not replace the original performance cohorts.

A later unchanged-head CI retry passed the earlier Ghidra Java-cleanup failure
but exposed a full-schema assumption in call-direction coverage. That workflow
now tests full and compact with actual canonical invalid-input refusals. A
fresh-process audit also found a browser scenario cross-field assertion; it
keeps default valid calls and typed refusals while checking full producer
constraints separately. Five isolated suites passed 14 tests across call paths,
ADB start, browser scenarios, source selection and managed analysis. The first
browser attempt failed and remains recorded; no performance cohort changed.

The subsequent [startup audit](mcp-startup.md) extends this harness with
source/bundle bindings and a post-materialization directory check. Its new
measurements are a separate cohort; reproduce this report at its recorded
revision when comparing the original timing and model-session receipts.
