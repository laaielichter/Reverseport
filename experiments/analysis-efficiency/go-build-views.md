# Selected Go build metadata

Addresses [#5499](https://github.com/morluto/rea/issues/5499). A compiler/main-module
identity question previously required the complete Go report, including raw framed
bytes, base64, module text and every parsed dependency. Opt-in `detail: summary`
retains the same complete parent and returns identity, source ranges, counts and
explicit unknowns. Default complete delivery remains compatible.

`inspect_analysis_view` reuses that parent for `kind: go`, collection
`dependencies` or `settings`. Exact paths/keys and original indices intersect;
fields select columns, while every row keeps its original index. Pagination
counts matching rows in producer order, including duplicate module paths. The
view never reopens a target or reparses module text. Unknown lines and original
bytes remain in the complete parent. CLI summaries save that parent in a new
Evidence bundle before returning their projection.

Only immutable authenticated Evidence results reuse schema validation, keyed
by their object identity for the Evidence lifetime. Mutable inline results are
validated on each call. Subject identity is checked separately on every view.
There is no live-file cache. Only page rows are projected; inherited messages
use the existing bounded, deduplicating view-message owner.

## Question and independent checks

The main artifact is the official GitHub CLI v2.102.0 Linux amd64 release:
42,086,560 bytes, SHA-256
`7469124f706944133d6a169691dd1c6c3511b12e85878d255e044e2948df4c9b`.
The archive digest matches its official GitHub asset metadata. Its embedded
compiler is `go1.27.1`, main module `github.com/cli/cli/v2@v2.102.0`, and it has
165 parsed dependency records. The selected `golang.org/x/crypto@v0.57.0` record
keeps original index 152. These are embedded observations, not authentication
of the compiler, supply chain or runtime behavior.

Native `go version -m` independently matches module text, main identity and all
165 dependency identities in original order. Original file ranges match the
reported compiler and framed module bytes. Before/after exports have identical
complete normalized results and parent Evidence identity. The small real case
is the installed 12,366,352-byte Go tool: embedded `go1.23.5`, no decoded main
module and zero retained dependencies, with dependency coverage still unknown.
REA reads both inputs without executing them. The installed Go tool also runs
as the trusted native verifier; the downloaded GitHub CLI binary is never
executed.

Timing baseline is main `ee12d517a25d34853d40e31fc039c7d1576c60e1`. Packaged runtimes
and source patch are pinned in the [receipt](go-build-views.json); later changes
do not relabel these timings. Node 24.18.0/npm 11.16.0, MCP SDK 2.3.1, Linux
x86-64. Fresh processes use unflushed OS caches; the SDK controller pre-reads
the input for verification. These are not disk-cold measurements.

## Actual client context, including every request

The [wire driver](go-build-wire.py) starts actual Codex app-server 0.163.0 with a
fresh account/workspace and a loopback deterministic Responses SSE backend.
It starts a scripted turn and real MCP calls, with **no AI inference or paid
service**. All 210 tools remain discovered/advertised. Full input/output
profiles are explicit, and each relevant tool has a 30,000-token output budget
so complete JSON is delivered without retries or truncation. This does not
qualify another client's defaults or a real model's reasoning/schema acceptance.

All original facts and parent identities match the native oracle. Export cases
also verify the complete parent. The [counter](go-build-wire-costs.py) counts
**every captured request**, including repeated schemas and accumulated tool
outputs, using `tiktoken 0.12.0` / `cl100k_base` on compact request JSON. These are
serialization-token proxies; actual model rendering, usage and cache billing
remain unmeasured.

| Completed question                                     | Requests before → after | Whole request JSON proxy before → after |
| ------------------------------------------------------ | ----------------------: | --------------------------------------: |
| Compiler, main module and dependency count             |                   2 → 2 |          158,529 → 123,368 (22.2% less) |
| Compiler, main module and one selected dependency      |                   2 → 3 |          158,538 → 186,812 (17.8% more) |
| Same selected dependency question plus Evidence export |                   3 → 4 |           256,342 → 250,352 (2.3% less) |

The actual REA namespace costs 51,821 → 51,983 proxy tokens **per request**.
An extra round can outweigh a smaller reply. Summary is useful when identity
and counts already answer the question; complete delivery remains useful for
an initial compound question. Retained views provide selected follow-up facts,
without a claim that every such composition saves total context.

One recording per cell: identity wall/CPU/family peak is
6.970 s / 6.331 s / 861.5 MiB before and 7.069 s / 6.457 s / 857.0 MiB after.
Compound answer-only is 6.973 / 6.333 / 865.0 before and 6.969 / 6.348 / 861.6
after. Export is 7.175 / 6.537 / 866.7 before and 7.274 / 6.568 / 872.6 after.
These scripted-client observations establish no universal latency or memory
gain, and do not measure model inference time.

## Direct SDK task and cold/warm costs

The [SDK driver](go-build-views.mjs) discovers all tools, answers the compound
question, verifies exact facts and exports complete Evidence. Before: one
complete inspection and export. After: summary, selected dependency and export.
For the zero-dependency small case, the summary avoids an unnecessary empty
query. Two repetitions alternate version/target order. All 208 other named
catalog definitions agree; only Go inspection and the retained-view tool change.

| Input      | Whole wall s before → after | Family CPU s before → after | Kernel family peak MiB before → after |
| ---------- | --------------------------- | --------------------------- | ------------------------------------- |
| GitHub CLI | 4.855–4.952 → 6.370–6.564   | 4.682–4.725 → 6.175–6.400   | 671.2–680.1 → 846.4–868.7             |
| Go tool    | 4.349–4.351 → 4.250–4.450   | 4.093–4.140 → 4.092–4.179   | 548.4–548.6 → 544.3–555.6             |

Cold selected-query calls take 1.719–1.751 s in the SDK task, including its
output-schema validation. A separate warm diagnostic takes 1.712 s for the first
query and 32.86 ms for the repeat in one session; both the client validator and
retained facts are warm. This is not a paired whole-task speedup. The complete
warm diagnostic is separately recorded, not mixed into the eight matched runs.

The [SDK counter](go-build-view-costs.py) counts the discovered input catalog
once plus all arguments and text replies, including export: 229,183 → 195,643
for GitHub CLI and 194,854 → 194,724 for the small case. Catalog cost grows
193,192 → 193,652. This catalog-once projection is **not** the actual host
exchange above; omitting repeated schemas would hide the compound-task penalty.

All qualified recordings use one CPU, a 4 GiB hard/3 GiB early family memory
boundary, no swap and 192 tasks. Verified payload exits are zero, only the
observer remains, and observed memory/task resource events are zero. Kernel
family peaks include attributed file cache. Final whole-scope counters are
unavailable. Release acquisition, oracle preparation and compilation are outside
the timed tasks. An initial symlink input was correctly refused; qualification
explicitly selects its regular target. One development static check was stopped
by the host-available-memory guard, with owned cleanup verified and no observed
OOM; the unchanged guard succeeded after headroom recovered.

## Coverage and reproduction

Executed: 10 files / 202 tests covering existing Go readers, mappings, provider,
CLI/MCP and Rust readers, plus selected rows, duplicate paths, empty filters,
identity-only fields, malformed/mutable parents, source conflicts, bounded
messages and unavailable metadata. Actual CLI complete output is identical
before/after; summary bundles retain that exact parent, and file-based CLI
selected queries match the native oracle. Full `npm run check` passed.
After rebasing onto main `c374c2fe7`, the 202 focused tests, full
`npm run check` and `npm run docs:check` (including five README consistency
tests) pass again. A real SDK selected query and complete export also pass
against that rebuilt runtime, retaining the original parent identity and all
165 dependencies. These checks do not relabel the frozen timing cohort.

A review found that a transcript-write failure could skip the SDK driver's
cleanup. The shared finalizer now closes owned resources before publishing the
optional transcript and records publication failures separately. All 11 receipt
failure tests pass. A real selected SDK task and full export pass again; the
same task with an injected transcript-write failure exits 1, preserves its
answer and failure receipt, and verifies that the process family was cleaned.
These qualification runs do not replace the frozen performance measurements.

A second review found that a valid external parent could disagree with its
report's architecture. Go domain now owns the existing architecture-to-subject
mapping; both Evidence production and every Go view use it. The view checks
mapped architecture as well as path, digest and format, including `null` for
unrecognized report names. All 213 focused tests pass, including authenticated
inline/file conflicts and known-alias/unknown-architecture cases.

Initial CI also exposed two existing baseline failures. On unmodified `c374c2fe7`,
`src/cliJsonPaths.test.ts` has the same three URL-message assertion failures.
The duplication gate is already above its 3.5% threshold: 31,737 / 899,602 lines
(3.52789%) on baseline versus 31,748 / 900,474 (3.52570%) on the initial PR head.
These were reproduced separately with the pinned toolchain, bounded resources
and verified cleanup; this PR leaves those unrelated failures unchanged.

Final qualification rebased onto main `cf5194f68`, preserving its new IL2CPP
view contract alongside the Go additions. All 258 tests in 12 files pass,
including 32 IL2CPP view tests and the now-fixed CLI path assertions. Full
`npm run check`, `npm run docs:check` plus five README tests, and the real SDK
selected query/full export pass again. Complete parent identity and all 165
dependencies remain exact. Duplication now passes: baseline 31,644 / 904,778
lines (3.49743%), PR 31,612 / 905,740 (3.49018%), against 3.5%.
One latest-main build was guard-stopped during a host-memory dip; its owned
scope was verified inactive with zero OOM events, then the unchanged guard's
retry passed. These results qualify the rebased source, not new task timings.

The broader metadata audit also read three real Rust binaries. Alpine ripgrep
14.1.1-r0's original `.dep-v0` matches native `readelf` coordinates and independent
zlib/JSON decoding: 42 packages, 88 indexed edges, root index 33. The other two
have no dependency section, which remains unknown coverage. Compiler-path
inferences in all three match native read-only ranges and original byte offsets;
they remain inferences. These fast metadata reads did not justify a Rust cache.
The Alpine archive is pinned by observed SHA-256; APK signatures were not checked.
Real provider verification here covers Linux ELF; PE/Mach-O use authored fixtures.

To reproduce, use built baseline/candidate runtimes and the pinned public input.
Create a baseline complete CLI Evidence JSON, then pin the independent oracle:

```sh
python3 experiments/analysis-efficiency/go-build-view-oracle.py \
  --evidence /tmp/baseline-evidence.json --input /absolute/gh \
  --go /absolute/go --dependency golang.org/x/crypto --output /tmp/go-oracle.json
```

Run `go-build-views.mjs` with absolute `--runtime`, `--input`, `--oracle` and
new `--output` directories, and `--mode complete` or `selected`, under
`resource-run.py --observe-payload-exit`. `--warm` adds a separate diagnostic.
The wire driver additionally requires pinned `--codex` and `--node`, and takes
`--question identity --mode complete|summary` or
`--question dependency --mode complete|selected`; `--export` adds export.
All wire recordings require the same resource guard for owned-scope cleanup.
Counter scripts take `--output` and recording directories, with their guard
logs at the same path plus `.log`. Both counters require `tiktoken==0.12.0`.
