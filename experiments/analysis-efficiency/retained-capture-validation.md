# Retained historical capture validation

On main `5fa4defcbc0e55ef1ec84c888b918abe945303fe` (2026-10-20), repeated
historical capture pages still validated and copied the complete capture.
The immutable-parent work in [#4962](https://github.com/morluto/rea/pull/4962)
covered native layouts and JavaScript, rather than historical captures.
This continuation of [#3133](https://github.com/morluto/rea/issues/3133)
removes that repeated work without changing its query contract.

## Reconciled audit scope

The earlier directory list is a starting point, not a list of unfinished fixes.
Current history and the existing evidence support these narrower conclusions:

| Scope                                         | Existing work and remaining limit                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared Evidence and queries                   | [#3134](https://github.com/morluto/rea/issues/3134) and [#4810](https://github.com/morluto/rea/issues/4810) are closed. Authentic mixed histories and immutable native/JavaScript validation reuse have dedicated [measurements](immutable-parent-validation.md). This capture owner still repeated complete validation. |
| Apktool                                       | [#4777](https://github.com/morluto/rea/issues/4777) is closed. Shared decoding and optional primary-string omission have [three-APK evidence](apktool-string-tables.md). Do not implement another decode cache from the old issue list.                                                                                  |
| Hopper                                        | [#5017](https://github.com/morluto/rea/pull/5017) already reuses decoded string records. Its [checkpoint](hopper-string-records.md) preserves faster warm queries and the negative whole-task result.                                                                                                                    |
| JEB                                           | The [Linux CE audit](jeb-linux-native.md) verifies selected real CLI/MCP reads. It does not justify another wrapper cache; discovery and other platforms remain separate coverage gaps.                                                                                                                                  |
| IDA                                           | Existing [native Windows verification](ida-native-windows.md) includes selected real completed-task performance and correctness/authority checks. It does not qualify every operation or platform.                                                                                                                       |
| JavaScript/browser/Electron                   | Prior experiments and retained pages already exist. [#4415](https://github.com/morluto/rea/issues/4415) remains exploratory; no safe general Joplin preparation speedup is established.                                                                                                                                  |
| Other static formats                          | Managed, Flutter, SQLite, WASM, EVM, PCAP, signals and SAZ already have checkpoints in this directory. Extend a specific measured question rather than create duplicate selectors or caches.                                                                                                                             |
| Other providers, languages and infrastructure | Rizin/Cutter/GDB/objdump, Go/Rust, ADB/Frida/inspector and startup/resource owners still need bounded real-workflow questions. Historical local improvements do not prove complete coverage or establish another bottleneck.                                                                                             |

This reconciles the cited issues and checked-in evidence; it is not a new
performance qualification of all `src/` directories or provider capabilities.

## Owning change and lifetime

`safeParseOwnedWebNetworkCapture` belongs to the capture format owner. A
successful complete schema parse may authenticate the exact source only if
`canBorrowParsedJsonSnapshot` verifies an existing realm-private sealing proof,
unchanged values, schema normalization, descriptors and alias topology.
The existing immutable JSON primitives supply that proof; an external freeze
or caller flag cannot supply it.

One weak-set entry records the successful interpretation, without retaining
another report, index or source reference. Its lifetime follows the source's
reachability. Exact-object identity, not a path, digest string or live-state
assumption, keys reuse. Mutable, merely frozen, malformed and normalized inputs
keep the ordinary validation path. Failures are not cached. Validation is
synchronous and publishes the proof only after complete success.

Capture pages and HAR grouping use this same owner. Producer admission and
one-shot environment-file loading retain ordinary owner-schema validation,
avoiding an extra reuse-proof traversal where no repeated result is available.
Each consumer still checks its own subject,
operation, format, coverage, declarations and resource budget. In particular,
validating a report does not authenticate a different parent's subject.
No provider rerun, new tool, schema, default, target execution or persisted cache
is introduced. Existing conservative grouping admission budgets remain intact.

## Real recordings and completed task

Two unchanged public recordings from the aioquic server's
[log listing](https://quic.aiortc.org/logs) were downloaded on 2026-10-20:

| Recording                                                     |     Bytes | Events | SHA-256                                                            |
| ------------------------------------------------------------- | --------: | -----: | ------------------------------------------------------------------ |
| [compact](https://quic.aiortc.org/logs/dadb9dba427e797c.qlog) |    29,034 |    132 | `2dbe00348c2f6fcd81f829564718e276052d4aaea77f2a6745cbd147869aec6f` |
| [large](https://quic.aiortc.org/logs/6e037439a5f79d47.qlog)   | 5,922,676 | 30,753 | `4854882fdeec3d66701779cfde1c614a09e3d5e3b90afdea3fc3d2566a0e6e3f` |

Both report JSON qlog 0.3 with one server trace. The producer version and
deployment authenticity remain unknown. No recorded destination was contacted.

Production stdio MCP created authentic complete Evidence, exported it, and
fresh servers imported that same unchanged bundle for each comparison. Each
task discovers the complete live catalog, imports, performs three traversals
of summary/three two-record complete pages/trace facts, exports again and closes
the transport. This is 17 RPCs and one catalog discovery, with 14 warm selected
queries after the first view. The question is the first six source events and
trace event total, revisited within one retained investigation.

An independent JSON read checks event counts, original event objects, ordinals
and trace/event pointers. It explicitly expects only the QUIC reset-token
transport-credential redaction in those selected events and checks its sidecar.
All 15 selected-view Evidence records, parent identities and original-record
round trips agree exactly between implementations. This does not independently
qualify every transport fact or prove network completeness.

## Measurements

Three fresh-server tasks per implementation per recording ran serially,
baseline/candidate first and candidate/baseline in each later cohort.
The [curated receipt](retained-capture-validation.json) preserves every run,
runtime fingerprints, source and answer identities, resource observations and
incomplete attempts. Raw captures, bundles, replies and logs stay outside Git.

Linux x86-64, Node 24.18.0/npm 11.16.0, MCP SDK 2.3.1. Each client uses the
exact named live tool definition for output validation. First-view time includes
client/schema initialization as well as capture validation; it is not isolated
parser time. OS file caches were warm and unflushed. No cold-disk run occurred.

Medians across three completed tasks:

| Recording / metric                                |     Before |      After |
| ------------------------------------------------- | ---------: | ---------: |
| Large: first selected view                        |    2.903 s |    4.077 s |
| Large: 14 warm queries                            |    6.399 s |    0.113 s |
| Large: complete owned scope wall                  |   20.089 s |   14.742 s |
| Large: complete payload-family CPU                |   19.792 s |   14.496 s |
| Large: kernel family peak, including file cache   | 1702.1 MiB | 1123.4 MiB |
| Compact: first selected view                      |    1.401 s |    1.462 s |
| Compact: 14 warm queries                          |    0.183 s |    0.108 s |
| Compact: complete owned scope wall                |    6.178 s |    6.080 s |
| Compact: complete payload-family CPU              |    5.960 s |    5.850 s |
| Compact: kernel family peak, including file cache |  658.7 MiB |  660.9 MiB |

Large warm totals range 6.394–6.482 s before and 0.111–0.115 s after.
The extra first-parse structural comparison costs time; repeated views recover
that cost in this large-recording task. Small-task wall times overlap, so no
small-input whole-task benefit or universal capture speedup is established.
The weak-set bookkeeping's exact heap size and post-GC retained heap were not
measured; the implementation retains no second capture representation.

The catalog is unchanged at 3,254,305 serialized bytes. The 15 query replies are
unchanged at 160,659 bytes for compact and 160,539 for large, including the SDK
result envelopes. Actual model token usage and tokenizer estimates are
unmeasured; no token reduction or model-quality improvement is claimed.

Query scopes use one logical CPU, 4 GiB hard/3 GiB early memory limits, no swap
and 192 tasks. All 12 completed observations verify payload exit, cleanup and
zero OOM/limit events. Final counters after the transient scope disappears
remain unknown; payload-exit counters are recorded while its observer is alive.
An initial build stopped at 3 GiB before completion, without OOM. The subsequent
serial build used 6 GiB hard/5 GiB early limits and peaked at 3264.9 MiB.
Two initial producer harnesses stopped on the oracle's incorrect expectation
that a reset credential would remain raw. Their original exports remain intact;
they are not completed performance tasks or product failures.

## Reproduction and validation

Build each runtime with the pinned toolchain and preserve a separate baseline.
Keep each capture's absolute selected path identical across compared runtimes:

```sh
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/retained-capture-validation.mjs \
  --runtime /absolute/baseline --capture /absolute/input.qlog \
  --output /absolute/new-producer-output

python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/retained-capture-validation.mjs \
  --runtime /absolute/candidate --capture /absolute/input.qlog \
  --bundle /absolute/new-producer-output/original.json \
  --output /absolute/new-import-output
```

Executed source verification passed 189 assertions across ten files, covering
capture schemas/views/services, subject rechecks, forged freezes, normalization,
mutation, invalid ordinals, HAR budgets, environment loading and replay.
Four compiled CLI/MCP/decoder/acceptance files passed 43 assertions. One
guard-unavailable refusal case was skipped because this Linux host has decoder
memory containment; the actual decoder heap-exhaustion and recovery case passed.
The ten existing RPC/receipt/finalization regressions passed. `npm run check`
passed, and test discovery found all 1711 test files exactly once.

Final-driver replays completed both public producer tasks with no cleanup or
receipt errors. Their selected Evidence matches imported-source queries, and
both real CLI projections exactly match the MCP Evidence. The final driver
uses the existing tested finalizer and streams stderr; these are separate
verification runs, not relabeled samples from the earlier timing cohorts.
One intermediate check encountered an unformatted driver revision; formatting
was corrected before the successful full check. The first full typecheck also
hit the 5 GiB early stop; its successful run used 8 GiB hard/7 GiB early limits
and peaked at 5392.8 MiB without OOM. Queries remained within the smaller limit.

Timing claims cover these qlog tasks only. Current HAR/SAZ/mitmproxy performance,
other hosts, real model token costs and post-GC retained heap remain unmeasured.

## Latest-main integration

Main advanced to `d72021b0dabedcc6fbc7bc6e0286fd359c604271` before publication,
adding Evidence-file sources and template path pairs. The change rebased without
conflicts. The original timing distributions above retain their original base.

One additional pair per recording compares this current main with the rebased
candidate, using the final driver and original authentic bundles. Both preserve
all selected Evidence and original records. For large, 14 warm queries cost
6.316 → 0.106 s; complete scope wall is 19.466 → 13.719 s; payload-family CPU
19.133 → 13.524 s; family peak 1712.5 → 1122.7 MiB. Compact scope wall is
6.574 → 5.664 s in this single pair, without establishing a small-task trend.
Both real CLI projections again exactly match the original MCP Evidence.
Individual counters are in the receipt's `latest_main_integration` section.

Evidence-file reads still authenticate a fresh object on each read. This
optimization is not a file-path cache and does not reuse an earlier file's
validation after its bytes change.

The first integrated 14-file source run passed 251/252 assertions and failed
the newly merged file-authentication cancellation injection in
`AnalysisViewService.test.ts`. An unmodified-main 13-file control passed
243/243 with a different service-file order. A controlled unmodified-main run
placing `environmentReplay.test.ts` before `AnalysisViewService.test.ts`
reproduced exactly that cancellation failure (62 passes, one failure).
The service project shares modules between files; the source test installs a
module spy after another file may already have loaded the service. This is
source-derived reasoning for the order sensitivity, rather than a reproduced
production cancellation defect. No unrelated test or production repair is
included, and the combined failure remains part of the verification record.

The service file passed all 48 assertions in its own process, and the other
13 selected source files passed 204 assertions. The final narrowed implementation
passed the full `npm run check`, plus 20 additional compiled MCP assertions,
including identical retained/inline/Evidence-file manifest projection.

After limiting reuse to retained/grouping queries, both public imports and real
CLI projections passed again. This first unpaired replay was slower across
catalog discovery, import and first-view work: large scope wall was 31.854 s,
CPU 28.414 s, with 0.234 s for 14 warm queries. Compact scope wall was 11.687 s.
The cause of this broad slowdown is unestablished; these runs are not discarded.

A subsequent adjacent baseline/candidate large-recording control used the final
code and same inputs. Scope wall was 18.870 → 14.242 s; CPU 18.519 → 14.048 s;
kernel family peak 1722.1 → 1147.0 MiB; 14 warm queries 5.998 → 0.108 s.
First view was slower at 2.797 → 4.041 s. All original and selected Evidence
agree. This final single pair requalifies the narrowed code; it is not a new
latency distribution or an explanation of the slower unpaired replay.

## Review-driven oracle correction

Review found that the original page oracle checked only returned rows: a short
page could pass with unchanged coverage metadata. The driver now also requires
both selected records before checking their facts. This fixes the oracle at its
owner, without changing production code or introducing a second validator.

The revised driver's exact page-validation block rechecked all 22 completed
production transcripts: 198 pages and 396 records passed. Controls truncating
an authentic response to zero or one record, with coverage unchanged, both
failed the new assertion. These are archived-response controls, not additional
real-provider qualification. Earlier timings remain unchanged observations.

Both real MCP import/query/export tasks were then repeated with the revised
driver. Compact scope wall/CPU/peak were 5.370 s / 5.195 s / 648.4 MiB; large
were 14.242 s / 13.966 s / 1140.9 MiB. Both preserve the prior answer digests,
verify cleanup, and record zero OOM or limit events at payload exit. These
candidate-only correctness replays do not create another before/after pair.
