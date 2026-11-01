# Apktool shared decoding and table-only projection

The measured question is the same in every comparison: inspect an APK's
metadata/manifest and its default, German and Brazilian Portuguese string tables.
One existing batch removes repeated decoding. An optional table-only projection
then removes repeated primary strings without changing the selected facts.

This is a static resource-query measurement, not an agent evaluation or a claim
about reconstructing an application's behavior. The machine-readable measured
summary is [apktool-string-tables.json](apktool-string-tables.json).

## Revisions, inputs and execution

- Baseline: `8f7d12e30d63f3d3b4cfe2a90336362841438f56`, latest main at issue start.
- Projection source: `406af90023a545fb280601bf51f445e122c36378`.
- Existing shared decode: [#4777](https://github.com/morluto/rea/issues/4777),
  integrated by [#4804](https://github.com/morluto/rea/pull/4804).
- Projection follow-up: [#4982](https://github.com/morluto/rea/issues/4982).
- Linux x86-64, kernel 6.1.0-53-cloud-amd64, Node 24.18.0, npm 11.16.0,
  Temurin 21.0.12.1, Apktool 3.0.3. The selected JAR's closeout digest is
  `dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423`;
  decoder contents were not independently hashed for every request.

- [newpipe](https://github.com/TeamNewPipe/NewPipe/releases/tag/v0.29.1): 11,507,122 bytes; SHA-256 `18447bfb1e06d113edc88df93f471827280de06f6f3d4dc42f56f28b9c1bab79`. Valid projected counts: 1126/833/779; unsupported entries: 1/1/1.
- [apidemos](https://github.com/appium/android-apidemos/releases/tag/v6.0.18): 6,521,217 bytes; SHA-256 `a9eecf37b26cd084855c530db81c2bb1b91f4c1b095a04f47aa7c20e2791f686`. Valid projected counts: 967/29/29; unsupported entries: 8/0/0.
- [settings](https://github.com/appium/io.appium.settings/releases/tag/v8.2.1): 3,099,589 bytes; SHA-256 `e4024b3ee348929252bcaf5eb422bcab9e4ace96703499a84f3332281c03375f`. Valid projected counts: 25/19/19; unsupported entries: 0/0/0.

The counts are default/de/pt-BR respectively. Source paths, XML digests, exact
caller paths, runtime hashes and per-run identities/costs are in the JSON summary.
The APKs were never installed or executed. Input digests were checked before and
after each completed task; provider-owned workspaces were confirmed absent.

Each task uses a fresh production stdio MCP runtime, complete paginated tool
discovery, client inspection, resource call(s), `close_binary`, transport close
and owned cleanup. OS file caches were not flushed. Every decode has a fresh JVM,
APK snapshot, framework directory and workspace: these are not warm retained
engine/database queries, nor cold-disk measurements.

Tasks run serially on one logical CPU, with an 8 GiB family hard limit, 7 GiB
early stop and no swap. Admission requires 16 GiB host availability; running
tasks stop below 8 GiB host availability. CPU and kernel `memory.peak` cover
the complete owned cgroup, including subprocesses, observer and file cache.
Counters are captured at payload exit while the observer is alive; disappeared
final whole-scope counters remain unknown. All completed payload receipts show
successful owned cleanup and zero observed OOM/limit events at that checkpoint.

## Correctness and owning change

Separate native decodes were retained for independent Python Expat validation.
It checks direct string entries, source entity spelling, unsupported markup
counts, ordering and emitted prefixes against the XML bytes. Manifest text and
package identity are checked separately. All six serial/batch pairs agree on
selected strings, manifest, metadata and target identity. All nine projection
pairs additionally preserve table counts and coverage; batch/table-only counts
and coverage match the XML oracle. This qualifies REA's projection of these
native outputs, not independent binary ARSC decoder completeness.

The existing default batch repeats its primary table in top-level `strings` and
`string_tables[0]`. On NewPipe this made the full resource replies larger than
three serial replies despite reducing decode calls: 616,059 → 680,188 bytes.
ApiDemos' larger common manifest produces the opposite tradeoff. The existing
batch remains the compatibility default.

`string_tables_only: true` (CLI `--string-tables-only`) keeps the complete
requested table facts inline in `string_tables` and leaves `strings` empty by
request. An unrequested field does not establish that a source table is empty.
This also supports one table without `locales`. `include_strings: false` still
suppresses string projection. Omitting the new option preserves old requests:
three real legacy workflows produce identical complete MCP replies, including
Evidence identity, at the new source revision.

The resource projection owner computes the output choice and charges aggregate
entries for the copies actually emitted. The same 10,000-entry policy can thus
return five distinct 2,000-entry tables rather than consuming capacity on a
duplicate primary copy. Per-table limits, XML budgets, physical alias reuse,
coverage, partial observations and cancellation remain at the existing owner.
CLI and MCP share this implementation; there is no new tool or cross-call cache.

## Existing shared decode: three serial calls versus one batch

Three alternating fresh-session pairs per APK, all at the same main revision.
The table reports marginal medians; paired speedups are reported separately.
Elapsed/CPU include discovery, client/Java startup, calls, transcript/hash checks
and cleanup. Native oracle creation, tokenization and verification gates are
separate costs in the JSON, not hidden inside these task timings.

| Target   | Resource calls, s | Whole elapsed, s |  Whole CPU, s | Family peak, MiB |
| -------- | ----------------: | ---------------: | ------------: | ---------------: |
| newpipe  |      23.19 → 7.40 |    35.32 → 19.86 | 34.95 → 19.65 |  1341.7 → 1309.5 |
| apidemos |      17.43 → 6.22 |    30.32 → 18.85 | 30.05 → 18.63 |  1187.1 → 1202.7 |

Paired resource-call speedup medians: NewPipe **3.23×** (2.90–3.23), ApiDemos
**2.80×** (2.66–3.09). Instrumentation confirms three versus one actual decoder
invocations. These call timings include protocol/projection costs; they do not
isolate the Java engine phase. NewPipe's whole raw token estimate increases
951,332 → 962,330 with the default batch; ApiDemos decreases
1,054,893 → 948,591. Fewer calls alone do not establish less context.

## New selector: default batch versus table-only batch

Three alternating pairs per APK; NewPipe repetitions 1/4/3, others 1/2/3.
Repetition 4 replaces a refused start, described below. Both variants still
perform one decode and return the same required facts.

| Target   | Resource call, s | Whole elapsed, s |  Whole CPU, s | Family peak, MiB |
| -------- | ---------------: | ---------------: | ------------: | ---------------: |
| newpipe  |      9.18 → 9.35 |    23.95 → 24.85 | 23.65 → 23.82 |  1327.5 → 1323.6 |
| apidemos |      6.46 → 5.81 |    23.28 → 19.79 | 22.90 → 19.47 |  1247.8 → 1197.0 |
| settings |      4.21 → 4.06 |    17.66 → 19.39 | 17.42 → 19.04 |  1191.6 → 1122.4 |

There is no consistent latency or whole-family memory improvement established
for the selector. NewPipe and Settings have higher whole-task elapsed and CPU
medians. Elapsed ranges overlap: NewPipe 23.53–34.46 → 21.59–42.80 s;
ApiDemos 18.55–27.07 → 19.25–25.96 s; Settings 16.55–23.39 → 16.14–21.72 s.
The cause of this variation was not established; a passing or faster run does
not explain a slower one. The selector's supported benefit is reduced duplicate
delivery, with its full task costs retained here.

Full resource reply bytes fall 680,188 → 506,481 for NewPipe,
616,841 → 463,588 for ApiDemos and 38,725 → 34,199 for Settings.

Offline `tiktoken` 0.12.0 / `cl100k_base` estimates count one complete catalog
page-array plus every call name/argument/reply, including inspection and close.
Full replies include both textual and structured copies. Text-only replies are
also counted separately. These are serialization estimates, not actual model
usage; initialization/framing, prompts, client filtering/rendering/replay and
continuations are unmeasured.

| Target   | Text reply tokens | Whole raw transport tokens | Whole estimated reduction |
| -------- | ----------------: | -------------------------: | ------------------------: |
| newpipe  |   73,661 → 55,797 |          962,330 → 924,352 |                     3.95% |
| apidemos |   65,693 → 49,162 |          948,591 → 913,693 |                     3.68% |
| settings |     4,387 → 3,942 |          814,859 → 814,029 |                     0.10% |

Discovery still has 207 tools; only `decode_android_resources` changes.
The added schema costs 557 catalog bytes / 113 estimated catalog tokens
(805,217 → 805,330). Raw discovery dominates this transport estimate; it does
not establish what a client supplies to its model. Smaller replies and these
estimates do not prove an actual agent context or investigation advantage.

## Verification, attempts and limits

- 94 source tests: provider/resource projection/service, including alias reads,
  aggregate output exhaustion, malformed/physical failures, partial facts,
  cancellation and cleanup. The table-only capacity, single-table provider
  and CLI cases fail on the old implementation (three selected failures,
  82 unrelated tests skipped).
- Nine compiled CLI/MCP tests: schema conversion/advertisement, option forwarding,
  Evidence parameters, legacy locale grammar and existing boolean choices.
- 36 completed real MCP tasks and three real CLI tasks. Nine exact projection
  oracle pairs; three legacy full-reply comparisons; alias/missing, single-table
  and omitted-string cases pass. CLI normalized data, subjects and Evidence IDs
  match MCP exactly on all three APKs.
- `check:fast`, `build:cached` and `verify:test-discovery` passed; the last
  discovered all 1,579 test files exactly once. `npm run check` and `npm run docs:check` also passed.
- An authored test group initially exceeded the 150-line lint limit (153).
  That gate failed after 189.31 s / 186.19 CPU s, peak 4,487,798,784 bytes;
  build/compiled checks did not run in that attempt. The capacity test was moved
  out of that group, and the complete corrected gate passed after 343.97 s /
  338.67 CPU s, peak 4,311,293,952 bytes. No rule was disabled.
- `projection-newpipe-after-2` was refused before scope/payload creation because
  host availability was below 16 GiB; a following poll showed about 10.5 GiB.
  It has no payload timing/counters and is not a completed measurement. The
  refusal stays recorded; a fresh whole repetition-4 pair ran after recovery.
  No existing receipts were overwritten and resource thresholds were unchanged.

Raw transcripts, native outputs, intermediate failures and per-request workspace
arguments remain in ignored local audit storage; the committed JSON is a curated
summary. Small Settings resources and negative time results are retained.
Actual models, APK execution, other providers/platforms and general complex
software effectiveness were not verified by this checkpoint.
