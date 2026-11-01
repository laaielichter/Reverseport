# Selected BEAM exports: completed-task measurements

Issue #6938. The analyst asks for every exported function with a small set of
exact names, preserving arities, original table/atom indexes and labels. Both
lanes export and validate the **complete** parent report, not only the answer.

Baseline `e09b06369d923e9cccedd91f6839ba643dfbd893`; selected delivery
`bcc3f7611` (full SHA and source-clean runtime identities in the JSON receipt).
The reader, format budgets and complete Evidence identity are unchanged.
Node 24.22.1, SDK client/core/server 2.3.1, npm 11.16.0; Linux x86-64. The
18-task cohort alternates three fresh complete/selected sessions per artifact.
Fresh HOME/client/server and disabled Node compile cache; OS caches unflushed.
This is a scripted client task, not an actual model investigation.

## Results

Medians, before → after. Seconds and kernel process-family MiB (includes file
cache), not parent-only RSS. Ranges and every receipt hash are in
[the 18-task JSON](erlang-beam-views.json).

| Real artifact | Whole-task estimated tokens |        Wall s |  Family CPU s | Family peak MiB |
| ------------- | --------------------------: | ------------: | ------------: | --------------: |
| erl_lint      |             76,907 → 58,090 | 6.773 → 6.870 | 5.581 → 5.312 |   667.0 → 630.9 |
| erl_parse     |             72,499 → 58,087 | 6.367 → 6.974 | 5.627 → 5.555 |   666.1 → 657.5 |
| pg2           |             57,733 → 58,018 | 6.365 → 7.576 | 5.295 → 5.615 |   648.2 → 626.9 |

For erl_lint the estimate drops 24.5%; erl_parse drops 19.9%. Small pg2 grows 0.5%
(285 tokens), so selected delivery does not benefit every input. Complete stays
the default. No stable general elapsed/CPU/memory improvement is established;
the small selected task has a higher wall/CPU median. Full parsing/retention and
cold client setup remain. Matching source-report, parent-ID and answer digests
agree across all six tasks for each artifact.

The projection counts one question, server instructions, all 221 input-tool
names/descriptions/schemas once, and every argument/text reply including export.
`tiktoken 0.14.0/cl100k_base` serialization estimates are not actual model usage.
Input directory cost grows 55,409→56,359tokens; the complete transport catalog
including output schemas grows 829,075→834,792tokens and is reported separately.
Protocol framing, host injection/history replay, output-schema presentation to
a model and inference quality are unmeasured. Reported context reduction is
specific to this declared client projection.

## SDK cached-catalog control

Six additional alternating fresh tasks use the SDK's cached catalog/default
validator without an explicit `toolDefinition`. They answer/export the same
question and pass the same independent oracle and cleanup checks. They are
separate from the 18-task primary cohort; do not pool their startup costs.

Median wall 19.764→19.375s (ranges 17.257–21.577 / 18.052–22.397);
family CPU 16.277→16.867s (ranges 15.287–16.562 / 16.139–17.070);
family peak 1024.2→1053.9MiB.
No general cached-client startup improvement is claimed. See
[all six control receipts](erlang-beam-sdk-cache.json).

## Correctness and resources

The unmodified Debian `erlang-base_27.3.4.1+dfsg-1+deb13u3_amd64.deb` supplies
actual OTP 27 compiler/stdlib modules: erl_lint 233,968 bytes (915 atoms, 119 imports,
112 lambdas), erl_parse 608,240 bytes (1,035 atoms), and pg2 1,152 bytes (4 atoms).
The package URL/SHA256, every selected artifact digest, source revision, driver
hash and runtime fingerprint are retained in the JSON records. The independent
[Python struct oracle](erlang-beam-oracle.py) checks every decoded table, chunk
range/payload digest and Code header, then the selected export answer. It reads
bytes only and deliberately qualifies these fixed OTP 27 layouts, not every
historical/compact format. No Erlang installation, emulator or target execution
was used. Default CLI and selected CLI on all three inputs also matched every
oracle fact and parent ID and published exactly the complete source Evidence.

Each of the 24 SDK tasks exited 0 with payload cleanup verified and no guard stop,
OOM or task-cap event. Aggregate CPUQuota 100%, payload affinity0–1,3 GiB early
stop/4 GiB hard limit, no swap, TasksMax 192. CPU/peak counters are observed after
the payload exits while the observer lives; final whole-scope counters remain
unavailable. Costs include SDK discovery/schema validation, runtime/dependency
hashing, assertions, source retention/export and cleanup. Sample acquisition,
oracle generation and tokenization occur outside timed tasks. Node, all compiled dist
files, selected entrypoints, 59 actual SDK files and driver files are hashed
before/after; the source revisions were clean when fingerprints were created.

Public regressions additionally exercise all five collections, duplicate names
and arities, selectors/fields/pages, missing versus empty tables, unresolved atom
names, unavailable retention, source deletion, offline bundles and refusal before
file reads. They establish those boundaries; real new-view qualification here is
OTP 27 on Linux, not every platform or provider.

## Reproducing the question

Build clean pinned checkouts with the repository's pinned toolchain and acquire
the public package linked in the JSON. Keep extracted files outside the repo.
Generate each oracle, for example:

```sh
python3 experiments/analysis-efficiency/erlang-beam-oracle.py \
  --input /samples/erl_lint.beam --output /runs/erl_lint-oracle.json \
  --name module --name exprs --name expr
node experiments/analysis-efficiency/erlang-beam-views.mjs \
  --runtime /built/rea --identity /runs/runtime-identity.json \
  --oracle /runs/erl_lint-oracle.json --output /runs/erl_lint-selected \
  --lane selected
```

A runtime fingerprint supplies `compiled_files` and `entrypoints` with relative
paths/SHA256, `driver_files` relative to this experiment directory, actual SDK
`dependency_files` with absolute paths/SHA256, and `node_sha256`. Source revision
and clean-state fields record preparation. Create fingerprints before timing;
the driver verifies them before and after each task. The publication records
fingerprint/receipt hashes and full commands; the original complete fingerprint
files, SDK transcripts, complete Evidence bundles and resource logs remain at
`/tmp/rea-perf-static-tool-audit-20261024/`. The local cohort controller is retained
there too. These local receipts are not shipped binaries or installed providers.

Wrap each invocation with `resource-run.py --observe-payload-exit`, setting the
pinned Node PATH/heap, process affinity and resource policy as in its recorded
command. Use a fresh output directory/session each time, alternate lanes three
times per artifact, and count with
[erlang-beam-costs.py](erlang-beam-costs.py). `--page-size` can qualify extra
retained-page calls; `--sdk-cache` selects the separate cached-catalog control.
The18 published primary tasks use the exact discovered toolDefinition/default
validator and 64-row pages, requiring two calls each including full-source export.

The initial exploratory baseline used earlier main `e2463372`; it is not mixed
into this table. Failed development checks remain in the local record: an
incorrect formatter path and copied service import, followed by exact complete
contract narrowing in old test consumers; corrected type/format/public checks
passed. These were not successful benchmark samples.
