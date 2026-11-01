# Omitted GGUF string validation

[Issue #5774](https://github.com/morluto/rea/issues/5774) follows the existing
real-model and completed-task audit in [#5603](https://github.com/morluto/rea/pull/5603).
The [coverage reconciliation](coverage-review-20261021.md) explains why neither
model inspection nor IL2CPP, firmware extraction or IDA should be described as
wholly unaudited. This experiment changes only one model producer hot path.

## Owner and preserved semantics

GGUF arrays retain eight preview values. Previously, each omitted string still
constructed a fatal UTF-8 decoder and materialized discarded text. `GgufHeader`
now validates an omitted value of at most one existing 65,536-byte chunk with
Node's `isUtf8`. Longer values retain the streaming fatal decoder, including
multi-byte characters split across chunks. Retained values use their original
decoder, preserving BOMs and exact text.

Every admitted byte is still read, hashed and validated. Header bounds,
representation admission, cancellation checks, array-loop fairness, source
offsets, partial-progress semantics, preview omission and complete retained
Evidence are unchanged. There is no cache, new contract, selector or default.
CLI and MCP share this producer through the existing application workflow.

## Corpus and correctness

The [curated receipts](model-utf8-validation.json) pin source commits, runtime
file tables, driver/resource sources, immutable public URLs, artifact digests,
complete report/answer fingerprints and all final samples. Baseline is main
`264862bf2e3612c9cb6fcfb861843cbba4e1893f`; measured candidate code is
`c2550343173c5abd8f34e925eac1bcc12b7ee6a2`. Later documentation/integration
commits do not relabel that cohort. That measured local commit predates the
rebase: its production file is byte-identical to published
`2f091ccc734d7bd945bd61432d41cf5ba68be12b`, with both source hashes recorded.

| Artifact                                         |      Bytes | Metadata / tensors | Independent reader |
| ------------------------------------------------ | ---------: | -----------------: | ------------------ |
| ggml-org stories15M Q4_0 GGUF                    | 19,077,344 |            20 / 57 | gguf 0.19.0        |
| ggml-org stories260K GGUF                        |  1,185,376 |            19 / 48 | gguf 0.19.0        |
| hf-internal-testing tiny-random-bert safetensors |    520,212 |            2 / 100 | safetensors 0.8.0  |

Official independent readers match all exposed metadata values/array previews
and counts, tensor names, types, shapes and parameter counts. GGUF reader
offsets/lengths match every tensor; safetensors reader geometry and independent
Python JSON offsets match its file ranges. Python byte hashing checks every
header digest. No weights are executed or loaded into a model framework.
The main GGUF has 32,000 vocabulary entries; the smaller GGUF and safetensors
are controls, not evidence for larger vocabularies or other GGUF versions.

## Completed public tasks

Linux x64, Node 24.18.0/npm 11.16.0. Three alternating baseline/candidate,
candidate/baseline, baseline/candidate pairs per artifact run serially. Each
fresh production stdio MCP task discovers all 212 tools, directly selects two
metadata records, retrieves two exact tensors from retained Evidence, repeats
both calls, exports complete Evidence, validates answers and closes the
transport. OS caches are unflushed; the controller reads inputs for hashing.
Fresh process does not mean cold disk or cold model-engine analysis.

Medians of three whole tasks per side, including SDK/catalog/schema validation,
all five calls, source checks, export and teardown:

| Artifact    | Wall seconds, before → after | Family CPU seconds, before → after | Peak family MiB, before → after |
| ----------- | ---------------------------: | ---------------------------------: | ------------------------------: |
| stories15M  |                6.667 → 6.567 |                      6.498 → 6.386 |                   771.0 → 816.3 |
| stories260K |                6.565 → 6.566 |                      6.324 → 6.338 |                   743.9 → 744.9 |
| tiny BERT   |                6.667 → 6.569 |                      6.461 → 6.388 |                   741.6 → 741.3 |

The primary task's observed wall reduction is about 1.5%, but the unchanged
safetensors control has similar variation. No stable whole-task speedup is
established. Main-model peak memory rises: ranges 769.3–799.0 → 813.6–818.9
MiB; its cause is unmeasured. No peak-memory improvement is claimed.

Separate fresh-process provider cohorts perform one first inspection and six
repeated inspections, comparing the complete report after every operation:

| Artifact    | First / repeat median ms, before | First / repeat median ms, after |
| ----------- | -------------------------------: | ------------------------------: |
| stories15M  |                   154.03 / 53.58 |                  121.41 / 37.19 |
| stories260K |                     33.63 / 8.77 |                    30.51 / 8.17 |
| tiny BERT   |                     27.65 / 8.11 |                    28.01 / 8.08 |

For stories15M this is about 21% faster first inspection and 31% faster repeated
inspection. Median CPU for the seven-inspection process is 0.855 → 0.729 s;
peak family memory is 75.6 → 77.9 MiB. Phase gains do not include discovery
or substitute for the complete-task results above.

One catalog plus all named request/reply JSON chunks estimates median
895,583 / 895,421 / 893,755 `cl100k_base` tokens for the three artifacts in
both implementations, using tiktoken 0.12.0. This includes serialized output
schemas, not merely named input schemas. It is an SDK serialization proxy;
actual model usage, repeated host injection, negotiation and framing are
unmeasured. No token saving is claimed.

All 18 public tasks and 18 provider processes completed under one CPU, 4 GiB
hard / 3 GiB early-stop family memory, no swap and 192 tasks. Payload exit,
counters and owned cleanup are verified; no limit/OOM events occurred. Kernel
cgroup peak includes file cache. Terminal whole-scope counters after scope
removal remain unknown. Raw inputs, exports, profiles and transcripts stay
outside Git.

## Reproduction and validation boundaries

Build the baseline and the same baseline with the published GGUF source file
using the pinned toolchain; this reconstructs the measured local candidate.
Capture a complete
baseline normalized report from existing CLI/MCP Evidence using the same
absolute input path. Run `model-utf8-validation.mjs` with absolute `--runtime`,
`--artifact`, `--expected` and a new `--output` directory under `resource-run.py
--observe-payload-exit`. Add `--phase` for the seven-inspection provider probe.
The driver validates advertised named schemas through the actual SDK and
compares full exported parents, preview facts and tensor selections. A failing
receipt or cleanup invalidates a task; it is not silently retried as success.

Five new producer regressions cover empty omitted strings, exact-chunk strings,
split multi-byte characters, both byte orders, retained BOMs and rejection of
short/long malformed omitted values. Existing malformed-header, admission,
cancellation, partial-progress and public CLI/MCP tests remain required.
An initial new-test assertion incorrectly hashed alignment padding; the
corrected oracle uses the actual declared header, matching existing semantics.
The first test launcher refused built projects; the exact built-project gate
was then used. Neither attempt is a passing check. The initial resource-wrapper
copy failed source-hash lookup before launching a build; corrected guarded
builds qualified before measurement.

Integrated onto main `71b696582`: all 68 tests pass again, and three real public
CLI complete reports plus three production SDK tasks match the original
normalized reports. Typecheck, lint/module boundaries, formatting, metadata,
runtime build, docs checks (five tests) and separate architecture guards pass.
`npm run check` does **not** pass: Knip reports an unlisted `g++` invocation in
the Windows test added by main's #5772. An independent main source checkout,
with matching compiled worker artifacts and an uncached Knip run, reproduces
only that finding. It is outside this change and is left unchanged. Initial
control attempts lacked resolvable worker artifacts and are not clean controls.
Development builds/checks used separate 6/8 GiB hard guards; runtime experiments
retain their 4 GiB limit. No guard stop or OOM occurred.

Greptile identified a receipt defect in the phase driver, not the model parser:
failed inspections/assertions were not recorded before cleanup, and a close
failure could suppress publication. Each attempted phase now records its cost
and primary failure before cleanup. Phase and MCP paths share one atomic receipt
publisher; cleanup failures are independent facts and cannot replace the primary
failure. Three new fault-injection tests fail on the original driver and pass
after the correction; all 11 existing shared receipt tests pass. These stand-ins
qualify failure accounting only. Real stories15M MCP and seven-inspection phase
reruns also pass with verified counters/cleanup. The original 36 paired samples
keep their measured driver hash; the receipt records the post-review driver and
publication-owner hashes separately. No timing cohort is relabeled.
