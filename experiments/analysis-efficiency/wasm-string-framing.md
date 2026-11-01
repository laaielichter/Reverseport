# WAT framing costs on shipped WASM

[Issue #5760](https://github.com/morluto/rea/issues/5760) follows the current
WASM summary workflow; no new tool, selector, cache or default is needed.
The [curated measurements](wasm-string-framing.json) pin source, runtime,
artifact, producer and answer fingerprints, including every final sample.

## Owner and preserved behavior

WABT's WAT framing scanned instruction text character by character. Interface
tokenization also decoded quoted bytes merely to obtain an end position.
`WabtString` now owns a shared quoted-string boundary operation, preserving
escaped-quote/backslash parity. The top-level framer searches for structural
ASCII delimiters and skips string payloads. Name and custom-payload consumers
still decode their bytes; unsupported typed signatures remain unknown.
Nested/line comments, exact source forms and full retained WAT remain available.
Data forms were already excluded from interface parsing; this does not add a
new data filter or reinterpret raw WASM outside WABT.

Baseline source is `d0067ba34a39`; candidate code is
`9776d78f6c799cba8d8cf5c9b3139a86449eaebd`, based on latest main
`335c042d166b` (the intervening main change is testing documentation).
Linux x64, Node 24.18.0/npm 11.16.0, native WABT 1.0.42. Three alternating
baseline/candidate, candidate/baseline, baseline/candidate pairs ran serially.
Each task starts a fresh production stdio MCP server, discovers all 212 tools,
inspects the selected artifact twice with existing summary delivery, reads the
first four exact exports after each inspection, exports complete Evidence and
closes. OS file caches are warm/unflushed; no cold-disk claim is made.

The public SQLite Wasm 3.53.4-build1 and VS Code tree-sitter-wasm 0.3.1 CSS
components match the pinned [corpus](corpus.json) archive and member digests.
An 80-byte source-assembled module supplies the small control, with an escaped
import name. Native `WebAssembly.Module` import/export metadata independently
checks all returned names/kinds without instantiating or executing target code.
A separate native `wasm2wat --enable-all` output checks exact full WAT and its
SHA-256. Every before/after original Evidence ID, normalized report digest,
source byte digest, selected export and catalog digest agrees. This does not
independently prove every typed signature or future WASM proposal.

## Completed-task costs

Medians of three complete tasks per side; kernel process-family memory includes
file cache. Wall time includes startup, discovery, all five investigation RPCs,
client validation, independent checks, export and transport cleanup.

| Artifact      | Wall seconds, before → after | CPU seconds, before → after | Peak MiB, before → after |
| ------------- | ---------------------------: | --------------------------: | -----------------------: |
| Small control |              10.192 → 10.192 |               9.863 → 9.869 |            785.3 → 791.1 |
| SQLite        |              13.714 → 13.311 |             13.319 → 12.957 |           985.1 → 1149.4 |
| CSS grammar   |              12.409 → 12.112 |             12.039 → 11.727 |          1031.7 → 1071.6 |

Whole-task median wall reductions are about 2.9%/2.4% for SQLite/CSS; small-task
time is unchanged. Three pairs are descriptive observations, not statistical
or cross-provider guarantees. Memory does not improve: SQLite's median is
higher, with overlapping 970–1141 versus 982–1156 MiB ranges. No heap-retention
cause or memory-saving claim is established.

Separate fresh-process parser cohorts use one first parse and five repeated
in-memory parses, checking the complete parsed-result digest after each parse.
Median first/warm parse milliseconds: SQLite 236.41/153.76 → 103.56/45.54;
CSS 133.57/111.35 → 15.07/15.64; small 2.99/0.62 → 2.49/0.40. These phase
improvements do not include native WABT production or complete task costs.

The unchanged catalog and all five named request/reply envelopes cost median
894,936 / 895,044 / 895,430 `cl100k_base` tokens for small/SQLite/CSS in both
implementations. This is a single serialized SDK transport proxy using
tiktoken 0.12.0; actual model input/usage, repeated model namespaces and protocol
initialization/framing are unmeasured. No token saving is claimed.

All 18 final MCP tasks and 18 parser processes completed under one CPU,
4 GiB hard/3 GiB early-stop memory, no swap and 192 tasks, with payload-exit
counters and cleanup verified and no limit/OOM events. Final whole-scope counters
after transient scope removal remain unknown. Raw binaries, exports,
transcripts and logs stay outside Git. The earlier string-only 18-task
cohort, an invalid source-kind harness attempt and a cache-hit build with
unverified payload cleanup are retained and excluded from final benefit claims.

## Reproduction

Build/freeze each runtime with the pinned toolchain; keep the selected artifact,
WABT directory and independently produced WAT paths identical across lanes:

```sh
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/wasm-string-framing.mjs \
  --runtime /absolute/runtime --artifact /absolute/input.wasm \
  --wat /absolute/native-output.wat --tools /absolute/wabt/bin \
  --output /absolute/new-output-directory
```

For parser-only cohorts, import `dist/wasm/WabtWat.js` from each frozen runtime,
load the same native WAT once, and call `parseWabtWat(text)` six times. Measure
each call with `performance.now()`; outside that timer, hash
`JSON.stringify(result)` and require the same digest for every call and lane.
Keep each artifact in a separate fresh guarded process.

Source verification passed 76 tests across nine files, including malformed
strings, slash parity, comments, invalid names, capacity/partial facts,
cancellation, cleanup retry and shared application behavior. `npm run check`
passed typecheck, lint, formatting, Knip, metadata and architecture guards.
Four compiled CLI/MCP/acceptance files passed another 14 tests. The native WABT
artifact verifier passed 51 CLI/MCP cases; the native interface verifier passed
nine cases, including all admitted kinds, escaped/BOM names, padded LEB128,
signature changes, duplicate imports and unsupported reference semantics.
The build used a separate 6 GiB hard/5 GiB early-stop guard; the full check used
8/7 GiB, peaking at 5.37 GiB without resource events. These are build/check
budgets; runtime tasks retain the smaller bounds above.
