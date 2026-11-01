# Portable managed CLI member views

Issue #5148 / PR #5167. Baseline `main@3dbe314ada9f6dcc994ca4655dc0faf082503847`;
feature integrates the original `7b3ed4d025edd24d062cde0327a53bd311e174fc`.
The measured production-file SHA-256 manifest is in [managed-cli.json](managed-cli.json).
These are working-tree measurements. Each trial verifies both source and the
complete compiled CLI graph before and after execution against its explicitly
selected build. The two roles have distinct checkout roots and compiled digests.
Identity-audit time is included in whole-task costs and recorded separately.
The audit reads compiled files before timing individual CLI calls, warming those
filesystem pages; cold means disabled Node compile cache, not disk-cold startup.

## Question and independent checks

Report identity, selected type, source coverage, the total method count, the first
eight complete method records, and the first sixteen assembly-wide MemberRef
records, including continuation coverage. Keep complete original Evidence available.
The question deliberately does not ask for every method or reference.

Public artifact: [Newtonsoft.Json 13.0.3](https://www.nuget.org/packages/Newtonsoft.Json/13.0.3),
from the NuGet flat-container archive. The 2,441,966-byte archive SHA-256 is
`872fc189e638ab1056555b03aaa38f68bcb54286e221aa646eb1129babf63c77`.
Selected member `lib/net6.0/Newtonsoft.Json.dll`, 712,464 bytes, SHA-256
`22c649f75fce5be7c7ccda8880473b634ef69ecf33f5d1ab8ad892caf47d5a07`.
Package version 13.0.3 is distinct from metadata assembly version 13.0.0.0.
No library code is executed; REA parses PE/CLI statically.

An independent Python oracle uses `dnfile==0.18.0` and `pefile==2024.8.26`.
It finds 494 TypeDefs, 4,208 MethodDefs and 2,149 MemberRefs. The selected
`Newtonsoft.Json.JsonConvert` has 72 methods. Every trial checks all 72 method
tokens, names, RVAs and original signature hashes, plus the sixteen returned
MemberRef tokens, names and signature hashes, against this oracle. This does
not independently establish complete CIL semantics or opcode correctness.
The full parent Evidence and requested answers are identical across all twelve
trials; returned rows equal the exact parent slices. Selection and source
coverage remain distinct from page exhaustion. MemberRefs remain assembly-wide.

## Completed-task cost

Linux x64, Node 24.18.0/npm 11.16.0. Three alternating pairs per cache condition,
serial, one CPU; 4 GiB hard / 3 GiB early-stop family guard, no swap, 192-task
ceiling. Every task includes actual selected-command help, all CLI calls,
provider parsing, bundle publication/authentication, local answer extraction
and oracle comparisons, plus both runtime-identity audits. Build, download, oracle preparation and warm priming
are excluded. OS page cache is uncontrolled. No build/test overlapped timing.

Complete mode starts two CLI processes (help plus analysis). Selected mode starts
five (two help commands, summary/publication, methods page, MemberRef page).
Cold disables the Node compile cache; warm primes the exact workflow once per
runtime/mode, then still starts fresh processes with isolated HOME each trial.
All trials complete with verified process cleanup and no OOM/resource-stop event.

| Whole task, median                              | Complete | Summary + two pages |
| ----------------------------------------------- | -------: | ------------------: |
| Estimated context tokens, both cache conditions |  451,373 |              13,078 |
| Cold wall seconds                               |    9.969 |              14.801 |
| Cold family CPU seconds                         |    9.743 |              14.555 |
| Cold kernel family peak MiB                     |  393.281 |             400.098 |
| Warm wall seconds                               |   10.339 |              24.141 |
| Warm family CPU seconds                         |   10.097 |              23.842 |
| Warm kernel family peak MiB                     |  401.809 |             407.164 |

Context estimates include the question, supplied command recipe, all logical
argv, actual help and stdout. Tokenizer `tiktoken==0.12.0`, `cl100k_base`.
The reduction is 97.1% for this fixed task. There is no model invocation;
actual billed/native-agent usage, reasoning and transport framing are unmeasured.
The memory counter is the kernel cgroup process-family peak including file
cache, not sampled RSS. Ranges and individual receipts are in the JSON.

This is an opt-in context/portability improvement with extra latency and CPU,
not a speed or memory optimization. Complete provider parsing and full authentication of file-supplied bundles
remain. Fresh managed Evidence is sealed at its producing factory and reused
without another payload clone, including low-headroom error projection. Complete output remains the default and is preferable
for small outputs or questions requiring every row. No cache or parser cap
was introduced.

## Existing native code composition

The unchanged baseline can already redirect full stdout to a file and select
rows in code. [The measured control](managed-cli-local-control.py) returns the
identical answer and retains the complete original Evidence. One cold run:
11.249 s wall, 11.000 s family CPU,
375.3 MiB kernel peak. Projection source,
original help and returned answer together estimate 10,555 tokens; the shared
question and launcher argv are excluded. This single-run control does not
establish stable performance or actual native-agent usage. It does demonstrate
that raw CLI reply savings are not universal savings over code composition.
The additive interface supplies authenticated reusable projections through the
same application/domain owner as MCP, without caller-maintained JSON slicing.

## Correctness and resource boundaries

The public CLI regression pages all eight managed collections after process
exit, target deletion and a working-directory change. Complete parent identity,
original row order, signatures, source/page coverage and unknowns survive.
Existing outputs are not replaced; failed publication retains completed facts.

The Evidence factory parses mutable caller data into independent trees, computes
identity, then seals its fresh owned snapshot with active ancestry/iterators.
It does not retain a set/array of every completed object. Existing sealed roots
can be shared; mutable input aliases are cloned independently. General graph
sealing keeps its separate cycle, sharing, hidden-field and atomic-failure rules.
Managed and derived-view factories seal their own completed Evidence, so CLI
error projection can borrow it without reauthentication or another payload copy.
The view owner retains strict JSON normalization for optional-field contracts;
the CLI no longer copies its already validated completed projection again.

Shared heap admission traverses by depth rather than queueing every report row
or allocating an entries array. It reserves parsed working copies and actual
escaping expansion before cloning/hashing, reporting UTF-16 storage explicitly.
Canonical bundle equality streams existing ordinary JSON encoder parts, preserving
native key order, omission, negative zero and Unicode semantics without two
whole-document strings. All production bundle readers explicitly pass their
operation: CLI import/export/compare/inspection, retained views, MCP import/
comparison and both native-matching read passes. Errors retain the original
cause, cleanup primary and lease through retry.

One process primitive dispatches queued callbacks and then their OS signal
notifications. The managed producer checks it before accepting complete Evidence.
Publication/read stages use it before their final checks. Inline, file and bundle
CLI views share the existing command finalizer and actual resource scope; the
finalizer checks interruption after close while preserving any primary/cleanup
failure. Existing inline error labels remain intact. Synchronous analysis is
cooperatively cancellable between stages, not preemptible.

Four compiled publication cases (SIGINT/SIGTERM × event/actual POSIX signal)
fail without their checkpoint and pass restored. Eight additional compiled
completion cases cover default complete delivery and inline projection; all fail
with only their new completion checkpoints removed and pass restored. Fixture
hooks match the selected target path or exact parent ID. Two real Newtonsoft
publication runs and four real default/inline completion runs retain the identical
parent or independently checked selected summary, exit 130/143 and preserve
committed receipts where applicable. No target library code is executed.

All 556 focused tests across 36 files pass, including direct
finalizer/cleanup ownership, WASM/Android cancellation and native matching.
All six `npm run check` tasks plus architecture guards, and all six
`npm run docs:check` tasks plus five README tests pass. The expanded domain
project passes 5,617 tests in 287 files with
3 skipped cases; this overlaps the focused gate. Its first
batched shard hit two existing 30-second timeouts in unchanged large synthetic
tests. Both passed isolated and in the fresh shard rerun under the same timeout;
the cause of the batch variation is unverified. No production/timeout change
was made for those cases. An earlier unsplit expansion was manually stopped
before its heap ceiling; that incomplete attempt is not counted as a pass.

Eight producing/operation negative controls also catch graph-sized sealing/
admission scratch and wrong operation attribution, including native reload.
Native built-in instrumentation is confined to the isolated process-global lane.
Initial test-only spy/probe/schema-import issues were corrected before these
passing gates. No actual heap exhaustion is induced. Simulated providers do not
qualify foreign engines; Windows OS signals remain unverified locally.

## Shared-reader real-artifact regression

The existing Redux Toolkit 2.2.7 source/bundle task also completes through the
updated reader with default full output schemas and compact input schemas.
An independent Python SHA-256/path oracle verifies 180 historical files,
99 embedded source nodes and 210 candidate relations (33 strong-location rows,
147 unknown). Original signals and partial source coverage remain visible.
This uses the existing explicit semantic-node cap of one for static correspondence;
it does not establish equivalent semantic-graph coverage or behavioral equivalence.

One completed task: 21.380 s wall,
21.023 s family CPU,
928.9 MiB kernel family peak,
56,378 estimated context tokens (one input catalog,
all arguments and MCP text replies; excludes output schemas, framing and model
reasoning). Corpus/reference preparation was performed earlier and excluded.
This is a regression verification with resource observation, not a new paired
performance comparison. Actual model usage remains unmeasured. Details:
[managed-cli-shared-read.json](managed-cli-shared-read.json).

## Reproduction

Extract the selected DLL to a private lab as `Newtonsoft.Json.dll`. Create an
`acquisition.json` containing the URL, hashes, sizes and selected ZIP member
shown above; never commit the DLL. Prepare the independent oracle:

```bash
uv run --no-project --with dnfile==0.18.0 --with pefile==2024.8.26 python \
  experiments/analysis-efficiency/managed-cli-oracle.py /absolute/lab
```

Build baseline and feature separately with the pinned toolchain. Run each under
the shared resource guard, alternating complete/selected, selected/complete,
complete/selected for cold and warm. Use a new output directory for every run:

```bash
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/managed-cli-task.mjs \
  /absolute/runtime /absolute/lab /absolute/lab/pair-cold-1-selected selected cold
```

Save each guard output to the adjacent `pair-*.log`. Warm mode uses the lab's
mode-specific compile-cache directory; prime each identical workflow once first.
Supply a `measurement-inputs.json` with exact revisions and production hashes,
plus `expected_runtime_bindings.complete` and `.selected`. Capture each with
`node experiments/analysis-efficiency/managed-cli-runtime.mjs /absolute/runtime`
after building. Bind complete to the clean baseline revision, selected to the
feature parent revision plus tracked/untracked source digests, with different
roots and compiled-graph digests. The collector rejects a wrong build before any
CLI call, rechecks it afterward, and aggregation independently enforces identity.
A real wrong-runtime attempt is rejected before analysis. A copied trial with a
tampered revision fails aggregation; removing only that consumer guard accepts it.
The twelve-trial aggregation reproduces without private pilots. The native
control also requires `--measurement-inputs /absolute/lab/measurement-inputs.json`
and performs the same before/after identity checks.
Then aggregate with:

```bash
uv run --no-project --with tiktoken==0.12.0 python \
  experiments/analysis-efficiency/managed-cli-costs.py /absolute/lab \
  --output /absolute/results.json
```

The original issue reporter's executable, foreign operating systems and actual
model sessions remain unverified. Setup pilots and earlier unbound cohorts, including one failed setup run
while compiled artifacts were absent after a typecheck failure, are excluded.
