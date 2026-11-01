# Selected source-to-bundle facts

Issue #6112. Baseline: `main@aa51e4343963fdd0b97ec2ebdc3c41579fd9cb38`.
Measured implementation: the production-file SHA-256 manifest in
[source-to-bundle.json](source-to-bundle.json). These are working-tree
measurements, not a claim that the baseline commit already contains the feature.
The original cohort predates the CLI error-envelope and review guard fixes,
pinned separately in the JSON. The CLI invalid-application output was restored
exactly. Post-guard SDK tasks verified both output profiles before the later
reference-file provenance fix. Final tasks preserve normalized comparison facts
while full Evidence IDs now commit the selected file origin. Historical paired
medians are not presented as new measurements of the later guard changes.

## Analyst question and correctness

For `src/createSlice.ts`, `src/createReducer.ts` and
`src/query/core/buildThunks.ts`, report source correspondence and candidate counts,
then inspect the exact supporting candidate signals for the two split files.
Keep the complete comparison available. This is static location correspondence;
it does not establish behavioral equivalence or removal.

Public corpus: [Redux Toolkit 2.2.7 npm tarball](https://registry.npmjs.org/@reduxjs/toolkit/-/toolkit-2.2.7.tgz),
1,184,767 bytes; SHA-256
`f2517c466b50424b661a27e48039f15db7783e5822f46b5c7d39f20104ac67a9`.
The published `src/` and three root `dist/` bundles/maps are copied byte-for-byte
into separate roots, retaining the `src/` and `dist/` prefixes. No target code or
package scripts execute. REA runs its own static analysis helpers.

An independent Python JSON/SHA-256/path oracle checks all 180 source-file hashes,
99 embedded source nodes and 210 candidate relations in every completed task.
All 99 embedded source strings differ from the published source bytes; path
correspondence must not become an exact-source or semantic-equivalence claim.
The complete report has 33 split and 147 unknown rows. The selected files have
3, 3 and 0 candidates respectively. Selected mapping/candidate identities,
original indices, signals, mapped flags and source coverage agree with the full
retained comparison. Global classification runs before selection.

## Completed-task costs

Linux, Node 24.18.0, one CPU, 4 GiB hard / 3 GiB early-stop process-family guard,
192-task ceiling and no swap. Six SDK tasks alternate complete/selected,
selected/complete, complete/selected. Each starts a fresh server with an isolated
HOME. OS page caches are warm/uncontrolled: these are process-cold observations,
not OS-cold measurements. All six exit successfully, release their processes and
record no OOM, resource stop or task-limit event.

Each task includes catalog discovery, application preparation, comparison and
full Evidence export. Selected tasks additionally query candidate signals via
`inspect_analysis_view`. Both cohorts use the existing explicit semantic-node
cap of one because the question only needs source/map correspondence. This is
not equivalent semantic-graph coverage; the omission metadata remains visible.

| Whole task                                | Existing full inline graph/report | File graph + selected mappings/candidates |
| ----------------------------------------- | --------------------------------: | ----------------------------------------: |
| Input catalog, cl100k estimate            |                            47,913 |                                    48,026 |
| All call arguments, estimate              |                            37,272 |                                       297 |
| All MCP text replies, estimate            |                            67,407 |                                     6,442 |
| Total estimated context                   |                           152,592 |                                    54,765 |
| Wall seconds, median                      |                            11.899 |                                    14.733 |
| Process-family CPU seconds, median        |                            11.551 |                                    14.377 |
| Kernel process-family peak MiB, median    |                             666.6 |                                     950.7 |
| Comparison reply bytes, text + structured |                           427,799 |                                    13,199 |
| Additional candidate reply bytes          |                                 0 |                                    19,393 |

Context estimates fall 64.1%, including the slightly larger catalog and extra
call. Tokenizer: `tiktoken==0.12.0`, `cl100k_base`; one name/description/input-schema
catalog plus every argument and MCP text reply. Output schemas, transport
framing, model prompts/reasoning and actual billed usage are not included.
There was no model invocation; these are not actual model token savings.

This workflow trades extra cold-client time/memory for substantially smaller
context. Comparison itself takes approximately 206–216 ms before and 249–262 ms
with file validation and selected delivery. The first candidate-view call takes
2.1–2.4 seconds. A separate calibration repeats the identical candidate query:
2,071 ms first, 72 ms second, with identical Evidence. This is consistent with
one-time SDK validator work; it is not a general speedup or a server-only profile.
No comparison cache was added: the measured matching computation is already
small, and a file cache would need additional freshness/identity rules.

Reference import is a separate one-time public CLI step: 4.757 s wall,
4.603 s CPU, 365.6 MiB peak. Add that same preparation cost to either first task;
download/extraction and compilation are excluded. An additional baseline with
default semantic coverage retains 22,090 semantic nodes and exports 42,870,148
bytes; explicit cap one retains one and exports 2,896,937 bytes. All comparison
facts agree after excluding expected Evidence lineage. Those single-run
observations demonstrate question-specific existing task selection, not a new
semantic-analysis optimization or equal-coverage performance claim.

## Existing output-schema selection

A second six-task cohort explicitly selects the existing
`REA_MCP_OUTPUT_SCHEMA_PROFILE=off` for **both** workflows, with baseline
`main@01788bac8`. REA still validates successful results against the canonical
contracts and returns complete structured content; clients do not receive output
schemas to compile. This is an explicit caller configuration, not a new default.
The independent oracle and selected/full fact checks pass in every run.

| Whole task, output profile off         | Full graph/report | Selected facts |
| -------------------------------------- | ----------------: | -------------: |
| Total estimated context                |           152,668 |         54,841 |
| Wall seconds, median                   |            11.597 |         10.890 |
| Process-family CPU seconds, median     |            11.244 |         10.569 |
| Kernel process-family peak MiB, median |             628.7 |          626.0 |
| Candidate query milliseconds           |        not needed |          18–21 |

The context reduction remains approximately 64%. Whole-task ranges overlap
(complete 10.899–12.215 s; selected 10.802–11.196 s), so the apparent median
improvement does not establish a stable speedup. Unlike the default full-output
cohort, this configured workflow avoids the extra cold SDK validator cost and
has similar task memory/time. Two initial pilot cases are excluded. All six
observed runs, explicit configuration and implementation hashes are retained in
[source-to-bundle-output-off.json](source-to-bundle-output-off.json).

## Existing CLI/code-composition control

The public CLI on the same saved application/reference produces complete Evidence
identical to MCP (205,231 output bytes). The measured CLI comparison step is
2.842 s wall, 2.670 s CPU, 357.4 MiB process-family peak. A separate Python
projection of the three rows already yields 22,108 bytes. A native agent can
redirect full JSON to a file and select facts in code, so raw SDK savings do not
establish savings over every native client. These byte sizes are not token counts;
actual native-agent context and external projection CPU are unmeasured.

The new CLI reference-file form preserves the normalized facts and records its
file origin. Its saved Evidence
can be queried by `inspect-analysis-view` using the same source-to-bundle
projector as MCP. The interface supplies reusable, authenticated facts and
relationships instead of requiring each caller to maintain an ad-hoc projection.

## Reproduce

Use pinned Node/npm, `npm ci` and `npm run build:cached` for baseline and feature
worktrees. Install dependencies once per lockfile; do not run npm through a shared
node_modules symlink. Run heavy steps serially with the checked-in resource guard.
Set absolute paths for `BASE_RUNTIME`, `FEATURE_RUNTIME` and `LAB`.

```sh
curl -fL 'https://registry.npmjs.org/@reduxjs/toolkit/-/toolkit-2.2.7.tgz' -o /tmp/toolkit.tgz
python3 experiments/analysis-efficiency/source-to-bundle-prepare.py /tmp/toolkit.tgz "$LAB"
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node "$BASE_RUNTIME/scripts/rea.mjs" import-reference-source "$LAB/reference" --json \
  > "$LAB/reference.json" 2> "$LAB/reference-import.log"
```

For each of the six ordered trials, use a new output directory; set `RUNTIME` to
the baseline for `MODE=complete`, feature for `MODE=selected`. Capture both stdout
and stderr in the adjacent `.log` so the resource receipt remains available.

```sh
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/source-to-bundle.mjs \
  --runtime "$RUNTIME" --corpus "$LAB" --reference "$LAB/reference.json" \
  --output "$LAB/paired-1-complete" --mode "$MODE" \
  > "$LAB/paired-1-complete.log" 2>&1
python3 experiments/analysis-efficiency/source-to-bundle-oracle.py \
  "$LAB/paired-1-complete" "$LAB/reference.json"
uv run --no-project --with tiktoken==0.12.0 python \
  experiments/analysis-efficiency/source-to-bundle-costs.py "$LAB"
```

Use a separate output name and `--mode selected --warm-continuation` for the
validator calibration; exclude it from paired medians. For the configured
cohort, add `--output-profile off`, use new `off-paired-*` directories and the
01788bac8 control, then run the cost reader with
`--pattern 'off-paired-*' --output "$LAB/costs-off.json"`. Retain the tarball,
reference, transcripts, bundles, independent proofs and guard receipts locally.
Never commit target binaries, dependency trees, credentials or generated builds.

## Review guards and regression controls

The file reader admits JSON assembly; a shared application guard additionally
reserves live heap headroom before schema validation clones data and computes the
root commitment. Evidence-file and historical-graph readers use the same owner,
with their original operation-specific diagnostics. Validation yields before
checking a pending cancellation, including validation failures. MCP computes its
selected view before yielding and committing any application source, comparison,
residual unknown or view to the session.

Seven shared headroom/Evidence-reader tests pass. A separate 65-test focused run
covers file cancellation, graph paths, actual SDK cancellation during validation
and comparison, and cross-source pages with candidate counts 2/1/2. The latter
checks original indices, totals and next offsets across boundaries and filters.
All three new guard regressions fail in a negative control with those gates
temporarily removed, then pass after restoration. Memory admission is an estimate;
the reported hard process-family ceilings come from the experiment guard.

Post-guard public-package SDK tasks, before the later provenance fix, retained all
180 source-file / 99 embedded-node / 210 relation oracle checks and byte-identical
complete comparison Evidence. Their receipts, source hashes and costs are under
`subsequent_review_guards` in the main JSON; they are excluded from paired medians.

## Reference-file provenance and cancellation attribution

The final file form records `parameters.reference_source` with `kind: file`, the
exact caller `requested_path` and the reader's absolute selected `path`. The
shared file owner supplies that path without a second interpretation; POSIX
`..` and symlink semantics remain intact. Identical graphs in different chosen
files have the same normalized facts/mapping IDs and distinct Evidence IDs.
Inline legacy Evidence remains identical. Actual public-package CLI file
Evidence equals MCP file Evidence for the same origin; relative CLI paths also
have maintained coverage.

Reader cancellation is reattributed to `compare_source_to_bundle`, preserving the
original cause. Six MCP/profile/guard tests and 29 selected CLI/shared-JSON
ownership tests pass. Removing provenance recording and cancellation attribution
makes three tests fail as expected. Additional Evidence-reader/file cancellation
checks pass. Final real-package tasks estimate 54,896 cl100k tokens in both output
profiles, preserve all independent oracle facts, and retain the new provenance;
these are additional verification runs, not new paired medians. The main JSON's
`subsequent_reference_provenance` records final source hashes and receipts.
