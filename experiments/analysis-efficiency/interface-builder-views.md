# Retained Interface Builder graph validation

Issue #5855. Baseline `f801b2fbfd28f4e3713adefddc7bd73db44c284c`, Linux
x86_64 / AMD EPYC 7B12 / Node 24.18.0 / npm 11.16.0. This is static archive
analysis on Linux, without executing an app or using ibtool or a native
analysis provider.

## Question and oracle

Identify the AAC settings outlets and VBR action in the official
[XLD 20250302 app](https://tmkk.undo.jp/xld/index_e.html), including archive
source/destination object identities, connection evidence and limitations.

- [Official DMG](https://tmkk.undo.jp/xld/xld-20250302.dmg) SHA-256:
  `0032a5470ea4e32a11a35b8077ebf4986102891f8eb82743094f2c6621ad8aeb`.
- Selected document:
  `Contents/PlugIns/XLDAacOutput.bundle/Contents/Resources/English.lproj/XLDAacOutput.nib`.
- Archive SHA-256:
  `4fdbfba451ee64b1d333c96a4f3d1a0c4b543a36b9b3686e1151b51e4dd14c72`.
- Python's independent `plistlib` reads the actual `$objects` table and
  `NSNibOutletConnector` / `NSNibControlConnector` records. Observed connections:

| Kind   | Label         | Source UID | Destination UID |
| ------ | ------------- | ---------- | --------------- |
| outlet | o_bitrate     | 2          | 10              |
| outlet | o_gaplessFlag | 2          | 41              |
| outlet | o_prefPane    | 2          | 53              |
| outlet | o_quality     | 2          | 62              |
| outlet | o_useVBR      | 2          | 58              |
| action | vbrChecked:   | 58         | 2               |

The benchmark checks each connector, both endpoint records, relationship kinds,
archive path/digest and page coverage against these independent facts. It also
compares all returned document rows with the exported complete parent; all
64-document normalized results match the pre-change complete CLI Evidence.
The complete exported parent Evidence is equal across versions for both
admission sizes. The reproduction oracle requires a separate pre-change
complete Evidence file for each size, and the harness compares the entire
parent, including its identity and parameters, for the selected limit. Equality is a preservation control, not an independent proof
of every decoded fact.

The default 64-document report contains 6,528 nodes and 1,378 edges. The small
control admits one document from the same unmodified real app, with 80 nodes
and 13 edges. Both reports retain truncation and hierarchy limitations. Resource
sessions have no executable subject or executable digest; archive identities
must not be promoted to executable identity.

## Completed workflow and accounting

`interface-builder-views.mjs` uses the real SDK and compiled stdio MCP server:
connect, discover the full catalog, open bundle resources, decode with summary
delivery, exhaust three 32-row node pages and one edge page for the selected
document, repeat those same four pages as a warm query diagnostic, export the
complete Evidence, verify the answer and complete parent, and await cleanup.
The repeat is included in all whole-task costs. Each run starts a fresh server
and isolated account. Decoding is the first decode in that server; retained
queries follow the summary's first validation. OS caches were not flushed, so
these are not disk-cold measurements.

Artifact acquisition/extraction, build time and independent oracle preparation
are outside this analysis task. No actual model session or billed model token
usage was measured. The SDK benchmark answers a fixed factual question; it does
not establish agent usability or general provider performance.

Experiments ran serially using `resource-run.py --observe-payload-exit`: one CPU
(affinity 15), 100% quota, 4 GiB hard memory / 3 GiB early stop, no swap and a
192-task ceiling. CPU and peak memory cover the SDK, server and observer family.
Peak is cgroup memory.peak, including charged page cache, rather than summed RSS.
Payload-exit cgroup counters are authenticated and cleanup is verified; final
whole-scope counters are unavailable after the transient scope disappears.
Every accepted and failed task has exit/cleanup verification and zero observed
memory high/max/OOM/OOM-kill and PID-limit events. Missing final counters are
not interpreted as zero.

## Observations

Medians across all accepted baseline runs and the measured optimized
production-source cohort. The later harness-only review fix does not change
those production files; its revalidation is recorded separately. Five
earlier candidate runs remain labeled pre-review diagnostics and are excluded
from the final-source medians. One failed initial harness run is also retained.
All individual runs, phase timings, token estimates and raw receipt hashes are
in `interface-builder-views.json`.

| Admitted documents | Revision | Runs | Whole wall s | Family CPU s | Family peak MiB | First four pages ms | Repeated four pages ms |
| ------------------ | -------- | ---- | ------------ | ------------ | --------------- | ------------------- | ---------------------- |
| 64                 | baseline | 5    | 30.798       | 30.532       | 1614.7          | 2606.3              | 1817.8                 |
| 64                 | final    | 5    | 27.683       | 27.424       | 1551.1          | 338.8               | 94.3                   |
| 1                  | baseline | 4    | 15.702       | 15.456       | 952.6           | 389.5               | 101.0                  |
| 1                  | final    | 4    | 18.101       | 17.822       | 944.8           | 367.5               | 101.7                  |

The larger sampled task has about 10% lower whole wall/CPU medians and 94.8%
lower repeated-page latency. Whole-task ranges overlap substantially:
27.420–51.481 s baseline and 25.247–45.451 s final. Startup/initial decoding
vary independently of the retained-query change; these observations do not
establish a general whole-task speedup or stable memory reduction. Both
versions' slow first runs remain included.

The small sampled task is slower overall (15.3% wall), with no repeat-page
benefit. In the two later interleaved small pairs, baseline took 16.883/18.317 s
and final took 16.988/20.276 s. Do not interpret the earlier unpaired small
measurements as evidence of a cold-start improvement. Startup variance remains
unexplained; this optimization is justified by repeated large-parent queries,
not a claim that every completed task becomes faster.

An additional production-boundary diagnostic isolates the changed projection
from startup, decoding and transport. It imports both compiled owners, seals
separate clones of the actual exported parent with each owner's snapshot
module, and alternates version order for three epochs. Each epoch projects a
summary and the same eight pages; every resulting payload is equal. Median
projection CPU falls from 157.4 to 30.3 ms for the one-document parent and
6003.5 to 914.7 ms for the 64-document parent. Snapshot preparation, Evidence
authentication and all adapters are excluded from this diagnostic; the public
tasks above account for their whole costs. First large-summary CPU rises from
620.2 to 879.8 ms because representation comparison is paid up front. This is a
reuse tradeoff, not a faster first decode. The diagnostic source/receipt hashes,
per-call wall/CPU times and bounded process-family counters are retained in the
JSON; it does not replace real public workflow evidence.

Selection still scans retained rows to count every match; no additional
per-document index is retained. The whole original graph and serialization
costs still exist.

Public input/output contracts and complete parent Evidence are unchanged.
Tokenizer estimates count the entire 212-tool input catalog once, every RPC's
arguments and text response, including warm diagnostics and export. The raw SDK
catalog, including output schemas, is reported separately. Structured content
and model-specific discovery/exposure may incur different costs. The 64-document task estimates are 282,885 baseline and 282,887 for the
initial candidate (198,492 input-catalog tokens in each); the two-token change
comes solely from the export destination. The first ten RPC requests and
replies are exactly equal. Raw SDK catalog exposure estimates 891,652 tokens
including output schemas. Final-source values and every run are retained in
the JSON. There is no claimed token reduction.

## Ownership and reuse

The Interface Builder view owner validates an unknown normalized result with
its existing schema. Reuse requires the application's seal plus exact owned
immutable snapshot identity and representation-preserving comparison against
the parsed result. A weak set records only successful snapshots. It retains no
second graph, file-path cache, index, transient errors or failed subject
bindings. Every view still checks its current parent's target binding and
constructs current parent provenance and limitations. Different results,
mutable imports, forged seals and schema normalization revalidate normally.

Document selection uses the shared matching pager to count all matching rows
while retaining only the requested page. Unfiltered requests keep direct
slicing. Row IDs, ordering, provenance, decoder truncation and unknowns remain
unchanged. CLI and MCP share the same application/domain implementation.

The snapshot comparison helper's type accepts owning schemas with optional
undefined members; its runtime comparison is unchanged and refuses a parsed
representation that actually adds an undefined field.

## Reproduction and limits

Extract the official app without running it. On the baseline, save complete
CLI JSON with `rea decode-interface-builder <XLD.app> --format json` and a
separate control with `rea decode-interface-builder <XLD.app> --max-documents 1
--format json` (without profiler logging mixed into either JSON). Then:

```sh
python3 experiments/analysis-efficiency/interface-builder-oracle.py \
  --bundle '<XLD.app>' \
  --document 'Contents/PlugIns/XLDAacOutput.bundle/Contents/Resources/English.lproj/XLDAacOutput.nib' \
  --baseline '<complete-64-document-evidence.json>' \
  --small-baseline '<complete-1-document-evidence.json>' --output '<oracle.json>'
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/interface-builder-views.mjs \
    --runtime '<absolute baseline or candidate checkout>' --input '<XLD.app>' \
    --oracle '<oracle.json>' --output '<new output directory>' --documents 64
```

Repeat with `--documents 1`. Paths must be absolute. The oracle uses standard
Python only; token estimates use offline tiktoken 0.12.0 / cl100k_base. Count
compact JSON tool name/description/inputSchema entries once, compact
`{name,arguments}` for every transcript event, and every returned text block;
these are estimates, not actual model usage.

Failed attempts remain visible. `base64-a` completed all eight page RPCs but the
first harness incorrectly expected an action-source `contains` edge. Production
correctly returned `target_action`; the harness was corrected before accepted
runs. That failure's costs/receipt remain in the JSON. An initial typecheck
refused the snapshot helper's unnecessarily narrow generic constraint for the
optional resource root; the constraint was corrected without changing runtime
comparison. Build resource observations with a still-exiting Turbo child are
not qualified task measurements.

KeepingYouAwake 1.6.8 (official ZIP SHA-256
`8001a149b4490c008fdac19898bce9902d516c4aa6412a7eb0f9a37443b15c6b`)
was also downloaded and smoke-decoded through the real CLI
(17 documents, 1,369 nodes, 542 edges), but its NIBArchive records cannot be read
by this plistlib oracle. It is not a comparative benchmark or independent NIB
correctness claim. macOS ibtool, runtime UI, other archive variants, globally
complete hierarchy/class interpretation, #5720/#5721 and the remaining source
decoder issues are unverified or unchanged here.

## Integration verification

The measured comparison above was pinned to `f801b2fbf`. The branch was then
rebased onto `f5410bdc4` (the separate #5806 scalar-record fix). All six recorded owned-source
fingerprints remained identical across that rebase. On the rebased runtime both real SDK
tasks passed again, with the complete retained parent equal to the original
baseline for both admission sizes. The complete real CLI Evidence and portable
CLI page also equal the baseline/MCP results. These integration runs are recorded
separately in the JSON and excluded from the pinned comparison medians.

The relevant 12-file suite passed 204 tests after the paging refactor. After
rebasing, another six-file run passed 78 tests covering scalar source facts,
keyed archive number metadata, Interface Builder views, production MCP summary
paging and compiled CLI numeric/hierarchy boundaries. Both cohorts verified
owned cleanup with no observed memory/PID limit events; tests used the bounded
two-CPU, 4 GiB guard. Native ibtool/macOS runtime behavior is not established by
these tests.

Greptile identified that the original script only enforced the pre-change
comparison for 64 documents; the one-document equality above had been checked
manually. The oracle now requires both baseline files and the harness compares
the selected complete parent, including its Evidence ID and parameters, for
either limit. Both real workflows passed again. An intentional wrong baseline
(the 64-document parent supplied for the 1-document task) is rejected after all
other real-task checks succeed, with cleanup verified. These review checks and
updated harness fingerprints are recorded separately. Production source and
original comparison medians are unchanged; original measured fingerprints are
preserved rather than relabeled as the new harness.
