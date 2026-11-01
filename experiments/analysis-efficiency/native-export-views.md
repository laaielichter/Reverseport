# Native export questions over retained Evidence

Issue #6900: retrieve the export count and every declared version/alias of two
named exports, verify a missing-name query within the examined table, and export
the complete Evidence. The previous workflow returns the complete export table
to the client. The selected workflow returns a summary, queries matching rows,
and keeps the same complete parent accessible through Evidence export.

## Pinned inputs and correctness

- Baseline: `f713087132021d235682f908a1c0f3bc6ab8762d` (main, including the ELF
  unknown-coverage fix #6827). Candidate and experiment driver:
  `c7a90b742a29328e5b0069c6f8a34381e0c11e57`.
- Linux x86-64, Node 24.22.1, npm 11.16.0; package and kernel versions are in
  [the receipt](native-export-views.json). Each runtime's compiled files and
  entrypoints were SHA-256 checked before and after every task. Source checkouts
  were clean when frozen. Later reporting changes do not change that measured
  implementation revision.
- `/usr/lib/x86_64-linux-gnu/libLLVM-14.so.1`: 109,967,296 bytes, 44,459 exports,
  SHA-256 `436887791de0478d72c8323be99df69d6d0cf82745e5abec79d5e0374f4df560`.
  Query `LLVMContextCreate` and `LLVMContextDispose`: two rows.
- `/usr/lib/x86_64-linux-gnu/libc.so.6`: 1,926,232 bytes, 3,025 exports,
  SHA-256 `6b4a45352fd0c540a9c7c718f35ce8c8e46a4e482f9d3885a910c32d1a0e1421`.
  Query `malloc` and `memcpy`: three rows, including both `memcpy` versions and
  the IFUNC declaration. No runtime address or execution claim is made.

The independent oracle combines GNU `readelf` 2.40 dynamic symbol facts with
direct ELF64 little-endian mapping of version indices and hidden flags in
[native-export-oracle.py](native-export-oracle.py). It checks the full export
count and each selected row, including its index in the original report. All six
tasks for each artifact produced identical answers, complete parent Evidence IDs
and source report digests. Target bytes were unchanged. This oracle is qualified
for these ELF64 little-endian artifacts and selected ASCII names; it does not
establish real PE performance or arbitrary ELF encoding coverage.

## Measured completed tasks

Three alternating pairs per artifact, serial execution, fresh stdio client,
server and HOME per task; Node compile cache disabled. Retained page queries
reuse their parent within the task. OS file caches were not flushed, and there
was no separate warm-server cohort. All twelve tasks passed without resource
stops, OOM events, process-limit events or owned payload processes remaining.

| Artifact / workflow | Calls | Reply bytes | Projected tokens | Elapsed seconds, median [range] | Family CPU seconds, median [range] | Kernel family peak MiB, median [range] |
| ------------------- | ----: | ----------: | ---------------: | ------------------------------- | ---------------------------------- | -------------------------------------- |
| libc / complete     |     2 |   1,653,415 |          289,912 | 18.848 [18.657–30.361]          | 17.260 [15.342–29.125]             | 993.1 [962.6–1,048.7]                  |
| libc / selected     |     5 |      25,952 |           58,253 | 18.858 [17.044–32.088]          | 17.476 [15.765–31.440]             | 928.6 [922.2–939.7]                    |
| LLVM / complete     |     2 |  28,986,227 |        4,355,448 | 97.516 [94.112–119.443]         | 88.030 [84.867–111.504]            | 1,833.8 [1,806.6–1,861.8]              |
| LLVM / selected     |     4 |      19,695 |           57,346 | 37.094 [29.132–39.676]          | 32.645 [19.386–38.746]             | 1,142.6 [1,123.0–1,233.6]              |

These are scripted SDK tasks, with the full 220-tool directory discovered once.
The `cl100k_base` estimate (tiktoken 0.12.0) counts a fixed task description,
every tool name/description/input schema once, all call arguments and text
replies, including Evidence export. It excludes host injection and history
replay. No actual model ran; these are neither billable usage nor investigation
quality measurements. The SDK also receives output schemas: the entire raw
catalog costs 812,145 tokens before and 815,046 after if a host injects all of it.
That cost is reported separately. With only the three task tools injected,
estimated task totals are 238,857 → 7,198 for libc and 4,304,393 → 6,291 for LLVM.
Tokenizer work ran separately from the twelve task measurements.

Both libc lanes used a 10 MiB transport budget. Both LLVM timing lanes used
64 MiB to permit a complete-response comparison. Separate final probes at
10 MiB observed the baseline complete call return `resource_constraint`, while
the selected task completed. The failed complete task is preserved and excluded
from successful-task timing statistics. These boundary probes establish behavior,
not an additional performance pair.

The selected libc task has extra calls and shows no established latency gain;
its medians are essentially equal within the observed ranges.
LLVM has substantial observed task savings, but the result does not identify a
faster native parser: both workflows still analyze and retain the full table.
The `inspect` RPC includes analysis, Evidence, validation and delivery; no
internal phase attribution was measured. Per-call timings are retained for each pair; first selected-page calls validate
the retained parent, while later queries reuse that checked representation.
The weak cache holds validation of an exact immutable retained report, not live
filesystem state. Unfiltered pages slice the original order; filtered pages scan
the retained rows and preserve every matching alternative.

Resources: one CPU's aggregate quota (100%), clients/servers bound to CPUs 0–1,
observer initially on CPU 15; 3 GiB early stop, 4 GiB hard limit, no swap, 192
tasks. The guard's affinity field records initial placement; it does not describe
the wrapper's child affinity override. A live cgroup/process observation confirmed
the quota and override. Family CPU and peak memory come from kernel cgroup
counters at payload exit while an observer remains alive. Cleanup was verified
at that point. Final whole-scope counters became unavailable after scope removal
and remain null; no final whole-scope counter verification is claimed. Timing
includes discovery, runtime hashing, client checks, Evidence export and receipts.
Variation in the slower complete samples is retained in the ranges.

## Reproduction and validation

Run from the candidate checkout with its locked dependencies and pinned Node.
Freeze a clean built runtime with `scripts/rea.mjs`, `package.json`, `dist/` and
dependencies; record source revision plus SHA-256 for compiled files and
entrypoints as demonstrated by the committed receipt's runtime identities.

```sh
python3 experiments/analysis-efficiency/native-export-oracle.py \
  /usr/lib/x86_64-linux-gnu/libLLVM-14.so.1 LLVMContextCreate LLVMContextDispose \
  > /absolute/path/oracle.json
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/native-export-views.mjs \
  --runtime /absolute/path/runtime --identity /absolute/path/runtime/runtime-identity.json \
  --oracle /absolute/path/oracle.json --output /absolute/path/unused-receipt-directory \
  --lane selected --buffer 67108864
```

Use `--lane complete` against the baseline. Repeat three pairs in alternating
order. The JSON receipt records every executed command, runtime binding,
per-call timings/bytes, results and SHA-256 of raw reports/catalogs/transcripts/
Evidence/resource logs. Its `cohort` manifest records driver and guard hashes.
Generate token estimates with `native-export-costs.py --cohort COHORT --output
OUTPUT CASE...`, using tiktoken 0.12.0. Raw local receipts are under
`/tmp/rea-perf-native-exports-20261023/`; they are not committed binaries or
portable artifact downloads. `selector-cohort/index.json` and `manifest.json` bind
the twelve cases. Preserve these files together when rerunning the cost script.

Executed functional validation of the measured implementation:

- 48 selected tests passed: parser, export views, MCP schemas/retention preflight,
  and actual public CLI/stdio workflows for PE and ELF fixtures. Source deletion
  after retention still permits equivalent offline CLI and retained MCP views.
  Sparse field checks also recompute the returned view digest in the native
  regression and actual MCP acceptance workflow.
- `npm run check`, documentation generation/check and test-discovery verification
  passed; 2,180 tests were discovered exactly once.
- Real LLVM public CLI summary → full Evidence bundle → offline selected view
  was also checked; the complete bundle retains 44,459 exports.
- Earlier assertion spelling mistakes, an architecture-boundary test placement
  violation and a concurrent-worker timeout are retained in the local logs.
  The test was moved to the native layer. A later field-omission regression
  reproduced source defaults leaking into projected columns; the projection
  schema now removes those defaults, while complete source normalization retains
  them. Final bounded tests and static gates passed. No real Hopper/Ghidra/IDA behavior changed or was qualified here.

Partial/unsupported source coverage, duplicate names/versions, PE ordinal-only
exports, forwarded exports, field projection, malformed retained input and older
encoding metadata are covered by deterministic boundary regressions. Those tests
supplement the real ELF tasks; they are not real PE provider measurements.

## Initial CI attribution

[CI run 40015745440](https://github.com/morluto/rea/actions/runs/40015745440)
tested head `5e9a17bea7a6bc5931df60256eef61010a9c67e1`, merge
`e6f10a331aed5228504ed45ca6244b9498548cb9`, against main
`f713087132021d235682f908a1c0f3bc6ab8762d`. Static checks, build, docs and selected
real-format qualification jobs passed. Source tests and built tests failed.
Every cancelled shard's log was inspected: 11 source and 46 built failures were
actually observed, including the ADB floating-point regex rejected in `v` mode.

Bounded serial controls compared that exact main base with implementation
`c7a90b742a29328e5b0069c6f8a34381e0c11e57`. The source selection reproduced all
11 failures on both. A broader built selection executed 52 cases on both, with
48 failures and four passes; it includes every observed CI built failure. The
two extra failures and four passes in this selection are not presented as CI
observations. All selected case identities, statuses and full failure messages
were identical after replacing only the two checkout roots, including the
physical path of their shared dependency symlink. No assertion text was removed.
All 57 actual CI failures were therefore reproduced on the base and candidate.

Local `ci-attribution.json`, `ci-observed-case-identities.json`,
`ci-control-index.json`, the four control reports and their resource logs under
the receipt directory retain commands, pinned revisions, complete differences
and SHA-256 bindings. Controls had no resource stop or OOM and verified payload
cleanup. This attribution applies to that initial CI run and those revisions;
later CI results must be inspected separately.
