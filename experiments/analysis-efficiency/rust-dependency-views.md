# Rust dependency fact views

Issue [#5802](https://github.com/morluto/rea/issues/5802) asks for exact embedded
crate versions, sources and selected direct relationships without receiving the
entire dependency report. The existing path-only operation returned every
package, dependency vector and edge. This work adds opt-in first-call selection,
summary delivery and retained package/edge queries to the existing CLI/MCP
contracts. Complete delivery remains the default.

The producer still reads and validates the complete admitted file and report.
This is a context optimization; it does not establish faster binary analysis or
lower peak memory. It adds no tool, path cache, dependency walker or graph index.
Only successful interpretation of an authenticated immutable Evidence result is
reused, keyed by that exact object in a WeakMap for its lifetime. Mutable imports
are revalidated, and every view checks the artifact subject again.

## Pinned artifacts and independent checks

[Curated receipts](rust-dependency-views.json) pin source commits, runtime file
tables, source/driver/resource hashes, package URLs and all measured samples.
Baseline is `d672cc23998b6cbb21c485f118595ebfb82fed33`; measured candidate is
`cae2571e7e64a7364b94bb92c2630cba80ec4478`, pushed before the integration rebase.
The production files are byte-identical to published
`cc83fd1ee` after rebasing onto `a5f982de8`. Later integration measurements do
not relabel the original cohort.

Official Alpine v3.21/community/x86_64 APKs, not locally rebuilt test applications:

| Artifact                           | File bytes | Packages / edges | Complete CLI reply bytes |
| ---------------------------------- | ---------: | ---------------: | -----------------------: |
| ripgrep 14.1.1-r0, `usr/bin/rg`    |  3,416,168 |          42 / 88 |                   10,605 |
| Zellij 0.40.0-r0, `usr/bin/zellij` | 17,151,864 |      422 / 1,063 |                   86,805 |

The [corpus manifest](corpus.json) records APK and extracted-file SHA-256,
transport size and aports revision. Acquisition selected only the named regular
tar member, with bounded download/extraction. Neither binary was executed.
HTTPS provenance and recorded digests are not an APK-signature verification.

GNU objcopy/readelf 2.40 independently extracted `.dep-v0` into private output
files without overwriting the input. Python 3.11.2 zlib/JSON parsing, following
the [upstream parsing format](https://github.com/rust-secure-code/cargo-auditable/blob/master/PARSING.md),
matched every exposed package field and dependency edge, omitted revision,
root index, compressed/inflated length, exact section range and full artifact
digest. An independent topological pass visited all 42/422 packages and matched
the empty cyclic sets. This qualifies these two ELF artifacts; PE/Mach-O view
coverage below uses constructed format fixtures, not real shipped applications.

## Equivalent completed SDK tasks

Linux x64, Node 24.18.0/npm 11.16.0. Three alternating before/after,
after/before, before/after pairs per artifact run serially. Each fresh production
stdio SDK session discovers all 212 tools and uses their named output schemas.
OS caches are unflushed; the controller hashes inputs first. These are fresh
process/session runs, not cold-disk runs.

The fixed question is: which versions and sources of `serde` and `serde_derive`
are embedded, and is there a direct edge between those selected packages?
Both lanes make exactly two RPCs: inspect once, then export complete Evidence.
Baseline derives the answer from the complete reply. Candidate selects both
names and `name/version/source/dependencies` in the initial inspection. There
are no extra lookup calls. All runs compare the answer and exported complete
parent against the independently checked report, including identical parent
Evidence IDs and source SHA-256. Zellij has the direct edge 294 → 296;
ripgrep has only `serde`, with no such edge within the embedded records.

Medians of three whole tasks, including startup, discovery, SDK validation,
both calls, answer/export checks and teardown:

| Artifact | Wall seconds, before → after | Family CPU seconds, before → after | Peak family MiB, before → after |
| -------- | ---------------------------: | ---------------------------------: | ------------------------------: |
| Zellij   |                4.957 → 5.671 |                      4.782 → 5.441 |                   610.3 → 604.3 |
| ripgrep  |                4.859 → 4.758 |                      4.643 → 4.528 |                   569.0 → 587.3 |

The main cohort's Zellij elapsed/CPU medians increase about 14%; do not read the
context improvement as a whole-task speedup. Two further forward/reverse
diagnostic controls added clocks around connect and discovery, comparing
baseline complete, candidate complete and candidate selected. In the first
control these took 5.460/6.164/6.063 seconds, with connect times
2.516/3.086/3.057 seconds. In the reverse control all took 5.360–5.364 seconds,
with connect times 2.528–2.679 seconds. Candidate complete also varied, so those
controls do not isolate a persistent regression to compact projection. They
do not erase the original slower cohort. No stable speedup, peak-memory
improvement or exact cause of startup variation is established.

Initial inspector RPC medians were 380.8 → 473.8 ms for Zellij and
189.4 → 244.2 ms for ripgrep. These include first-use named SDK schema validation,
retention, projection and serialization; they are not isolated parser timings.
Extra retained reads need no source reopen, as the CLI/MCP regressions demonstrate;
their warm latency was not benchmarked.

## Context accounting and limits

Offline tiktoken 0.12.0, `cl100k_base`, counts all discovered tool descriptions
and input schemas once, every call argument and every text reply, including
export. It counts the whole scripted task rather than only the selected reply:

| Artifact | All 212 input definitions + calls, before → after | Only the two used definitions + calls, before → after |
| -------- | ------------------------------------------------: | ----------------------------------------------------: |
| Zellij   |                        223,755 → 199,584 (−10.8%) |                               26,850 → 2,256 (−91.6%) |
| ripgrep  |                         200,603 → 199,584 (−0.5%) |                                3,698 → 2,256 (−39.0%) |

The Zellij inspect response, including both MCP text and structured content,
shrinks from 185,833 to 9,261 bytes; ripgrep shrinks from 22,643 to 9,207.
Those byte counts alone are not token measurements. Full transport catalogs,
including all output schemas, grow from 886,882 to 891,294 estimated tokens.
If all of that transport metadata is charged once along with calls, totals are
913,278 → 892,600 for Zellij and 890,126 → 892,600 for ripgrep: the small case
then costs more. Schema expansion has a cost even when Rust is not called.

No AI inference, actual model usage/billing, host schema injection, prompt-history
replays or analyst answer quality was measured. The two-definition column is a
discovery scenario, not an observed routed host. Do not extrapolate these
proxies to a host that repeats schemas or truncates full replies. Opt-in
delivery preserves caller choice and avoids forcing the small-case tradeoff.

## Correctness, resource bounds and rejected changes

Original-index facts, all matching versions, exact intersecting batch filters,
empty selections, selected fields and matching-row pagination share one domain
projector through the existing application layer. Package defaults omit
dependency vectors; callers explicitly request them for direct references.
Edges support both endpoint filters. Complete parent Evidence stays available
for export, and portable/retained queries still work after deleting the source.
Missing metadata remains unknown, cycles are counted without walking paths,
compiler hashes remain inferred, and embedded coverage never implies complete
runtime dependencies. Defaults preserve complete Evidence identity.

Executed tests cover real CLI/stdio SDK schemas, ELF/PE/thin-Mach-O fixtures,
duplicate package names/versions, retained and portable imports, malformed
edge imports, subject mismatch, unknown metadata, contradictory delivery,
retention requirements, bounded warnings and immutable-cache trust. Existing
Go, malformed Rust, cancellation, capacity and cleanup coverage is retained.
Full typecheck/lint/format/knip/module/architecture checks passed before the
integration rebase; final integration checks are recorded in the PR.

Runtime tasks use one pinned CPU, 4-GiB hard/3-GiB early-stop family limits,
no swap, 192 tasks and host-memory preflight/stop guards. All 12 primary and
six diagnostic samples have verified payload exit/cleanup and zero high/max/
OOM/pid events. CPU and peak memory use cgroup counters at payload exit while
the observer remains alive; final whole-scope counters are unavailable.
Build/check guards use 6/8-GiB hard bounds respectively. An existing 30-second
mixed Go/Rust test timed out in the initial single-CPU cohort; all nine CLI
acceptance tests passed with a bounded two-CPU/4-GiB rerun, without changing
the test's timeout. Other corrected prototype failures remain in the receipts.

A proposed JS JSON-size counter replacement had inconsistent provider timing
and no demonstrated memory benefit on these artifacts. It was reverted; the
final Rust provider is unchanged. Full-file input allocation, complete report
construction, ledger retention and schema duplication remain costs. This issue
does not qualify every Rust workflow, larger graphs, real PE/Mach-O applications,
WASM support or current runtime dependency state.

## Reproduction

Acquire the exact public APK URLs from the manifest and extract only the named
regular binary. Verify both SHA-256 values before inspection. Use objcopy
`--dump-section .dep-v0=SECTION INPUT PRIVATE_COPY`, then Python zlib/JSON to
compare the normalized package/edge records and section bytes. Save the verified
complete CLI `normalized_result` as `EXPECTED`.

Build isolated baseline/candidate runtimes with the pinned toolchain. Keep raw
outputs outside Git. For each artifact, alternate three serial pairs:

```bash
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/rust-dependency-views.mjs \
  --runtime /absolute/runtime --artifact /absolute/binary \
  --expected /absolute/expected-report.json --output /absolute/new-case \
  --lane complete
# Candidate uses --lane selected. Both lanes include complete Evidence export.
```

With private `tiktoken==0.12.0`, run
`rust-dependency-costs.py --output FILE CASE...`; each `CASE.log` must contain
qualified guard observations. The counter rejects failed tasks, missing
cleanup and resource events. Guard-stopped attempts are not completed samples.
