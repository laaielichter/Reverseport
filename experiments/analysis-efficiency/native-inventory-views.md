# Native inventory summaries and retained rows

Continues [#4249](https://github.com/morluto/rea/issues/4249). The analyst
question is to report observed row counts and the first four address/value
pairs from procedures, names, strings, and literal `main` procedure/string
searches. Complete delivery reads every row even when only those facts are
needed. A real jq name inventory exceeds the existing 10 MiB MCP result budget.

## Change and preserved semantics

The five existing tools accept opt-in `detail: "summary"`. Their original
complete Evidence is retained before a summary is returned. Delivery detail
does not enter provider parameters or the original Evidence identity. Default
complete requests keep their existing response. Oversized complete inventory
replies gain an actionable retained-page continuation after recording succeeds.

`inspect_analysis_view` projects `native-inventory` rows with offsets, limits
and selected fields. Parent Evidence ID and original `source_index` identify
duplicate-address alternatives; original order is preserved. Address is always
retained, and selecting a string's value also retains its string/decoding
qualifications. Counts describe retained provider observations. Exhausting a
page does not establish complete code/string discovery. Unknown source artifact
identity stays unknown rather than acquiring an invented path.

CLI and MCP use the shared application/domain projector. Its source-format
validation is reused only after successful representation-preserving validation
of an authenticated immutable JSON snapshot. Two weak sets distinguish names
and the stricter strings format. They retain no second parsed inventory or live
provider state; entries disappear with their source arrays. Mutable, foreign,
malformed or transformed values do not acquire this proof. A parent change
rebinds provenance rather than reusing an earlier view envelope.

This reduces delivery after the provider has produced its full inventory. It
does not reduce Ghidra discovery, eliminate the retained full inventory, or
establish a universal CPU/memory improvement. The catalog becomes larger and
summary-plus-page requires more RPCs than a small complete reply.

## Real inputs, controls and oracle

Read-only Linux x86-64 targets, without target execution:

| Target |     Bytes | SHA-256                                                            | Provenance                                                                                                     |
| ------ | --------: | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `true` |    35,664 | `c79bf44242829108e323378531f4ac839513ca1fba45efd6583643526e1e9fd2` | Installed Debian coreutils 9.1-1                                                                               |
| jq     | 2,267,912 | `b1c22172dd303f3be49e935aa56aa48a8b7a46e0bc838b4997d3bb451495870f` | [Official jq 1.8.2 asset](https://github.com/jqlang/jq/releases/tag/jq-1.8.2), release API size/digest matched |

Baseline runtime is main `58d6043303e722115f1da18b9505c24abeeab423`.
The candidate runtime is frozen from that base plus this implementation before
measurement. Runtime file manifests, the exact patch, driver revisions, original
Evidence, transcripts, errors and resource observations are retained outside
Git. The curated [receipt](native-inventory-views.json) pins the recordings.
Later rebases do not relabel these timings as measurements of a different base.

Node 24.18.0/npm 11.16.0, MCP SDK 2.3.1, Ghidra 12.1.4 and Eclipse Adoptium
21.0.12.1+1-LTS. Each pair uses a fresh MCP server and Ghidra analysis, followed
by a warm repetition in that session. OS caches are unflushed. Java heap is
768 MiB and one active processor; Node heaps are 2 GiB. The family guard uses
one logical CPU, 4 GiB hard/3 GiB early-stop memory, no swap, and 192 tasks.
Heavy jobs are serial. Kernel peaks include file cache, controller verification
and receipt work, rather than isolated provider heap. Payload-exit observations
verify owned process cleanup; final whole-scope counters remain unavailable.

The live named SDK contracts validate replies. Both modes discover the full
catalog, open the same target, complete the question twice, export original
Evidence and close. Summary mode requests four rows only for nonempty results.
Complete mode includes acknowledged export recovery and local JSON projection
when `list_names` exceeds transport capacity. Its errors, export calls, bytes
read and local projection output remain in costs. Model generation of that
local program and filesystem-tool schemas are unmeasured.

The small pair preserves every field of every original source Evidence,
including IDs, and both phases' complete selected fact vectors. The large
completed pair compares the requested facts exactly; it must not claim identical
independent Ghidra analyses. An earlier candidate attempt found alias-primary
and two generated switch-label differences outside the requested selection.
Their underlying cause is unestablished. To qualify projection independently
of that variation, the portable verifier imports the actual baseline Evidence,
reads every canonical row through MCP, and compares it with the recorded source.
It also compares actual CLI file-source views with retained MCP views, without
Ghidra/JDK configuration, and reexports original source records unchanged.

## Measurements and limits

Each recording contains discovery, both first/warm questions, original Evidence
export and cleanup. The token proxy below adds input-facing catalog JSON,
name/argument JSON, text replies and local recovery output; it does not count
both text and structured copies as if every host supplied both to a model.

| Recording / metric                       |     Before |      After |
| ---------------------------------------- | ---------: | ---------: |
| `true`: RPC calls                        |         13 |         23 |
| `true`: RPC result bytes                 |    921,748 |    171,130 |
| `true`: combined token proxy             |    306,496 |    208,002 |
| `true`: first question                   |   35.534 s |   30.791 s |
| `true`: warm question                    |    0.236 s |    0.224 s |
| `true`: whole scope wall                 |   53.662 s |   36.777 s |
| `true`: family CPU                       |   44.202 s |   35.483 s |
| `true`: kernel family peak               | 1103.9 MiB | 1186.5 MiB |
| jq: RPC calls, including export recovery |         15 |         21 |
| jq: RPC result bytes                     |  3,032,150 |    172,180 |
| jq: combined token proxy                 |    590,032 |    208,302 |
| jq: first question                       |  334.659 s |  318.798 s |
| jq: warm question                        |    2.521 s |    6.916 s |
| jq: whole scope wall                     |  355.586 s |  333.104 s |
| jq: family CPU                           |  318.976 s |  311.319 s |
| jq: kernel family peak                   | 1498.2 MiB | 1692.3 MiB |

The catalog remains complete at 209 tools: 3,263,492 → 3,293,844 bytes.
Its input-facing projection grows by 642 proxy tokens, from 185,367 to 186,009.
Including that increase and every call, the combined serialization proxy falls
32.1% for `true` and 64.7% for jq. Actual model usage is unmeasured.

Preserve the negative results: the large warm question is slower and both
family memory peaks increase. The first native view also pays source-format
validation and SDK schema setup; these phases are not isolated by this driver.
Fresh analysis dominates total wall time and varies between sessions. These
observations do not establish a latency, CPU or memory improvement. The owning
benefit is selected delivery with complete source access and actionable
recovery, rather than eliminating full provider inventory production.

Individual completed samples, tokenizer estimates and portable checks are in
the receipt. A `cl100k_base` estimate over recorded serialization is not actual
model usage. Counts include discovery, call arguments, text replies, errors,
continuations and local recovery output; SDK result JSON is also reported
separately. Actual client schema selection/rendering, wire framing, model
reasoning and isolated correctness-oracle overhead are unmeasured. Single pairs
are observations rather than latency distributions or evidence of improved
model investigation outcomes.

Incomplete attempts remain separate. The first baseline jq driver stopped at
the real oversized reply because it lacked export recovery. The first candidate
jq attempt produced its selected facts and source export, then hit the 3 GiB
early-stop threshold while comparing differing full inventories; no final report
or payload-exit cleanup proof was produced. Expanding the enormous assertion
diagnostic is a source-derived explanation, not an observed final stack trace.
The harness now emits a bounded mismatch with source digests while retaining
strict equality and both full files. The subsequent recording explicitly does
not request cross-session full-source equality.

Two static-check attempts were stopped by the host-memory guard; later checks
passed after host memory recovered. No guard-stopped attempt is a successful
performance sample. Engine-version/platform equivalence, other providers,
complete application reconstruction and post-GC retained heap are unqualified.

Executed verification: 24 focused files/305 tests passed, including advertised
SDK-converted JSON Schema validation, all five tools, nonretaining refusal,
oversized recovery, same-address alternatives, decoding qualifiers, immutable
validation ownership and unknown-artifact sources. Full `npm run check` passed,
including module/architecture guards; `npm run docs:check` also passed. The portable runs passed with 27/444 MCP
calls, ten actual CLI comparisons each, every row reconstructed, original
records preserved and payload cleanup verified. Their scope times are
25.194/77.537 s and kernel family peaks are 978.4/1940.2 MiB; these additional
correctness runs are not part of the selected-question timing pairs.

After rebasing onto main `0134732fc` (including Protobuf/gRPC views), 28 focused
files/325 tests passed. Final field-selection normalization removes repeated
per-row scans of duplicate requested fields while retaining the exact request;
the affected two files/nine tests passed again. Final `npm run check` and
`npm run docs:check` passed. Both real old-source portable checks passed again
against the final build, including every canonical row and all 20 CLI/MCP
comparisons. The observed catalog is then 209 tools/3,317,414 bytes. Those final
source and dependency pins are separate from the earlier frozen timing/token
pairs: final-main performance pairs and actual model usage were not rerun.

## Reproduce

Build separate baseline/candidate runtimes, then run each mode with the same
absolute artifact, Ghidra and JDK paths:

```sh
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/native-inventory-views.mjs \
  --runtime /absolute/baseline --target /absolute/application \
  --ghidra /absolute/ghidra --java /absolute/jdk \
  --mode complete --output /absolute/before

python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/native-inventory-views.mjs \
  --runtime /absolute/candidate --target /absolute/application \
  --ghidra /absolute/ghidra --java /absolute/jdk \
  --mode summary --output /absolute/after

python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/native-inventory-portable.mjs \
  --runtime /absolute/candidate --source /absolute/before \
  --output /absolute/portable
```

`--control /absolute/before` additionally requires every source Evidence field
to match across the two live analyses. Preserve failure if the engine produces
different observations. `--verify-pages` performs extra live full-page checks;
keep those correctness runs distinct from selected-question timing pairs.
With private `tiktoken==0.12.0`, `native-inventory-costs.py --output FILE CASE...`
counts completed recordings and their sibling `.log` resource observations.

The subsequent main `4eaf3a117` oversized-error protocol-framing fix was also
merged into the branch. Its producing-server, native inventory and large-result
checks passed (three files/11 tests), preserving both protocol revisions. The
real old `true` source verifier and `npm run docs:check` passed again. The native
projector and earlier performance pins are unchanged; latest-head pre-push/CI
checks provide the final branch status.
