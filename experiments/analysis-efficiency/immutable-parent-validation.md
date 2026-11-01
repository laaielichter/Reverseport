# Reuse successful immutable parent validation

This checkpoint addresses [#4810](https://github.com/morluto/rea/issues/4810),
found in the [retained-investigation audit](retained-investigation-workflows.md).
It changes the shared format interpretation used by CLI and MCP views, without
adding a tool, changing a schema, projecting away source data, or rerunning a
provider.

## Question, ownership, and compatibility

The task resumes authentic exported Evidence in a fresh production stdio MCP
server, discovers its source, reads six original symbols or modules in two-row
pages, repeats that traversal three times, queries the existing Unknowns,
exports the investigation, and closes it. The original source records must
survive the round trip exactly. Pages are compared to original retained facts.
Independent ELF byte decoding checks symbol names, values, and ranges; JavaScript
checks cover selected source bytes and the `lib/cli.js` module identity, rather
than independently proving the entire application inventory or semantic graph.

Imported JavaScript graphs lack the producer's realm-private format proofs.
Previously each view repeated full schema, graph/hash, and cross-graph binding
validation. Native layout views likewise parsed the entire layout for every
page. An immutable Evidence root alone was insufficient: its selected normalized
result did not carry the JSON owner's private sealing proof.

The JSON owner now transfers that proof to a selected own member without another
walk or per-node registration. Native layouts and imported JavaScript results
record a **successful full
validation of the exact immutable source** in their owning WeakSets. Already
owned JavaScript graphs keep the existing metadata normalization and binding
checks, returning parsed metadata with their original graph references. That
path avoids rewalking a large owned graph just to borrow its wrapper. There is
no second
retained parsed graph, strong cache, cross-process cache, or live-state cache.
The schema implementation is fixed for the process; a different source object
must validate independently. Weak entries do not keep Evidence alive, and session
lookup continues to gate access after close.

Cache admission follows full validation and requires that parsing preserved the
source representation. A shared iterative JSON comparison checks own data keys,
scalar values, prototypes, and enumerability without calling accessors. Object
member order is immaterial; array order remains exact. Two-way identity maps
visit preserved descendants once and reject source-node splits or merges. Both
comparison maps are temporary and discarded on return. Parser defaults,
hidden-field removal, or other normalization retain the parser's
result and do not cache the source. Writable/configurable descriptor differences
are immaterial: the source is sealed while the temporary parse is mutable.
The JSON sealing boundary rejects proxies before reflection, so arbitrary
mutable proxy behavior cannot acquire an immutable proof. Mutable, merely
Object.freeze'd, failed, and abandoned inputs do not qualify for successful
format reuse.

No Evidence identity, source linkage, coverage, unknown, omission, error, or
caller-selected page changes are intended. Complete source Evidence remains
accessible through the existing contracts. The first imported view still pays for full
validation and the representation comparison; a one-off CLI invocation cannot
benefit from a cache in a previous process.

## Inputs and measurement scope

Baseline: `2c4338db1fdb7773e05376301c558cff2a0b4b80` (REA 6.6.0).
Node 24.18.0, npm 11.16.0, Linux x86-64 (AMD EPYC 7B12, kernel 6.1.0-53-cloud).
The ELF producer reports pwntools 4.15.0, pyelftools 0.33, and Unicorn 2.1.2.
The baseline's built runtime was preserved
before production changes. Candidate and baseline use the same locked packages.

- SQLite `/usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6`: SHA-256
  `2e6eef9a727f081f0d453b4e5e6cbd8b9ef8b6f86cbf7681cbad444d3b0b55c8`;
  26 sections, 1,479 symbols, 2,963 relocations. Original history: 1,745,224 bytes.
- Shipped npm 11.16.0: inventory digest
  `f8e576a7d162542c616168b25a95a5f62b9accf29467cc37e149905ad4b8e603`;
  five explicitly selected paths (`package.json`, `bin/npm-cli.js`, `lib/cli.js`,
  `lib/cli/entry.js`, `lib/commands/install.js`), 2,822 application nodes,
  1,796 semantic nodes, 13,682 semantic unknowns. The 1,416 unselected files stay
  unknown. Original history: 21,058,430 bytes.
- Small case `/usr/bin/true`: SHA-256
  `c79bf44242829108e323378531f4ac839513ca1fba45efd6583643526e1e9fd2`;
  31 sections, 53 symbols, 66 relocations. Produced through the real production
  `inspect_binary_layout` MCP operation. An independent raw ELF reader checked
  every symbol name, value, and source range plus section/relocation counts.

The two larger histories were produced and independently checked in the linked
previous audit. They are historical Evidence, not a claim of fresh provider
analysis during a resumed view. All tasks here are static; no target executable
is run.

Each completed comparison includes startup, the complete 207-tool catalog,
import, queries, oracle checks, export, close, receipt writing, and SDK cleanup.
RPC timings exclude subsequent client-side oracle/receipt work. Fresh servers
separate first-view validation from later pages; OS file caches are uncontrolled.
Runs alternate baseline/candidate order. One CPU, 8 GiB hard family memory,
7 GiB early stop, no swap, and a 192-task ceiling bound each serial task.
Resource counters are observed at payload exit while the observer remains alive;
final whole-scope counters are unavailable. Kernel cgroup peaks include charged
file cache and descendants, rather than just the server's JS heap.

## Results and executed validation

Candidate production code: `3930a640fb8387cbd3079eee13fb90f82d1881dc`.
The [curated receipt](immutable-parent-validation.json) retains every final run,
offline token estimates, compatibility checks, and costs of previous attempts.
Values below are medians with min–max ranges across three fresh alternating pairs.

| Source     | First page, before → after (ms)                       | Eight later pages, before → after (ms)             |
| ---------- | ----------------------------------------------------- | -------------------------------------------------- |
| SQLite ELF | 183.56 [170.13–244.27] → 209.05 [203.11–216.88]       | 469.89 [393.47–517.92] → 85.04 [65.10–89.01]       |
| npm        | 2441.08 [1681.26–2479.69] → 1978.73 [1864.89–2720.54] | 15534.41 [10378.13–16864.91] → 82.69 [75.19–84.13] |
| Small ELF  | 133.33 [100.81–242.58] → 226.60 [111.79–556.22]       | 122.93 [76.38–299.47] → 62.58 [57.69–96.24]        |

| Source / runtime    | Whole elapsed (s)   | Family CPU (s)      | Kernel family peak (MiB) |
| ------------------- | ------------------- | ------------------- | ------------------------ |
| SQLite ELF / before | 19.08 [15.26–20.00] | 18.75 [15.01–19.55] | 1013.8 [1009.5–1058.6]   |
| SQLite ELF / after  | 14.38 [14.06–17.25] | 14.09 [13.77–17.00] | 984.0 [957.1–1047.1]     |
| npm / before        | 39.63 [31.21–40.86] | 39.27 [30.87–40.49] | 1338.0 [1301.0–1543.7]   |
| npm / after         | 20.71 [20.01–23.02] | 20.50 [19.73–22.23] | 1286.8 [1250.6–1344.9]   |
| Small ELF / before  | 14.30 [12.00–17.59] | 13.94 [11.77–17.31] | 1013.2 [937.8–1017.4]    |
| Small ELF / after   | 12.31 [11.90–16.25] | 12.04 [11.71–16.07] | 956.3 [931.4–1007.5]     |

| Source     | Paired warm-read ratio, before / after | Paired first-view change, after − before (ms) |
| ---------- | -------------------------------------- | --------------------------------------------- |
| SQLite ELF | 5.53× [4.42–7.96]                      | +25.49 [-41.16–+46.75]                        |
| npm        | 184.65× [125.50–224.30]                | -462.34 [-614.80–+1039.29]                    |
| Small ELF  | 1.28× [1.22–5.19]                      | +10.98 [-15.97–+422.88]                       |

Each pair matches the before/after runs with the same repetition number.
The paired effect can differ from the ratio of marginal medians when the host
speed changes. Positive first-view changes mean higher latency.

The repeated-read benefit is measured per source and pair above. First-view
validation
also performs the representation comparison and can be more expensive. Whole
task, CPU and memory figures above are measured SDK workflow costs, not a
general provider-analysis or agent-investigation speedup. The previous e30
checkpoint had a slow npm repetition on both sides, including a 65-second
candidate task; its cause was not profiled. The original checkpoint and every
fresh run remain retained. The previous `646312dad` checkpoint also had slower
small-case warm reads in two of three pairs (135.54 → 373.14 ms marginal
medians). Those negative results remain available in its linked historical
receipt; the current cohort improves all three small pairs, without establishing
a general small-input or whole-task benefit. No model-token saving, general memory improvement,
or complex-software investigation advantage is established.

All 18 fresh workflow runs preserve original records and canonical answer
digests. Every corresponding query's structured result and complete catalog
is equal. The three public CLI source pairs are also byte-for-byte identical.
The two additional mixed-history tasks preserve all 97 original records, check
64 follow-up heads over 32 pages and revision two, reject stale updates and
tampered imports atomically, clear Unknowns on close, and refuse old references.

Offline `tiktoken` 0.12.0 / `cl100k_base` estimates for one pass over the complete
catalog, named-call arguments and replies are **unchanged** within each pair:
849,736 native, 856,384 JavaScript, and 840,303 small-case tokens. The catalog
contributes 805,215 tokens alone.
These are raw transport serialization estimates, not actual model context or
usage; initialization/framing, prompts, client discovery, rendering/replay,
and continuations are unmeasured. Metadata paths differ from the historical
checkpoint; compare equivalent runs within each checkpoint.

Executed checks at the final production code:

- `npm run check` and `npm run docs:check`: pass, including five README
  consistency tests.
- Three latest-main integration files through `npm run test:focused`, using
  default deadlines: 27 tests pass at the current production source.
- 130 source tests across immutable JSON, native/JavaScript format validation,
  and the shared application view service; `npm run check:fast` and
  `npm run build:cached` pass.
- Four compiled CLI/MCP files (`evidenceBundleInline`, `serverUnknownsMcp`,
  `analysisViewMcp`, and `analysisViewCli`): 36 tests pass.
- Real public stdio MCP: 18 fresh paired tasks and two additional mixed tasks;
  public CLI: six invocations, with three exact output pairs. These corpus
  workflows and four-file boundary checks have exit zero, verified payload
  cleanup and zero observed payload-exit OOM events.

Internal and automated review reproduced **candidate-only** defects before integration.
Generic deep equality ignored hidden fields removed by parsing; the JSON owner
comparison now preserves that normalization. Review also reproduced aliases crossing
preserved subtrees and cloned metadata; four regressions failed against the prior
source. The comparer now visits preserved descendants with two-way identity mapping.
Already-owned JavaScript graphs keep their parsed-metadata fast path, so the generic
comparison and full-result cache only apply to the expensive imported fallback. Its
initial iterative traversal
also repeatedly expanded shared nodes: a valid 27-object graph exhausted an
instrumented 10,000-inspection budget. Tracking source-to-parsed node pairs
reduces that same compiled probe to 54 inspections and successful borrowing.
A parser that splits or merges source nodes keeps its parsed result rather than
expanding repeated paths. Deterministic regressions enforce the inspection
budget instead of relying on timing or letting a regression consume exponential
CPU. These are internal JSON-owner probes, not claimed baseline public-provider
reproductions.

The initial exploratory cohort and historical e30 paired checkpoint are not
the final comparison. One earlier source-check attempt was mistakenly started
during an initial baseline run; the newly started owned scope was stopped after
17.27 s and that check remains incomplete (exit 241). Observed counters, the
contended baseline, subsequent successful retries, and prior checkpoints remain
retained; no OOM or terminal-counter claim is inferred from that stopped task.
Two later tasks stopped because the host-available-memory guard reported its
early-stop condition: candidate JavaScript repetition three and baseline small
repetition three. Both incomplete attempts and the unmatched completed
JavaScript baseline remain separate. After memory recovered, both sides were
rerun as fresh pair four; final JavaScript and small samples use pairs 1, 2, 4.
Neither interrupted task is a completed comparison. The guard later gained
read-only host-memory/cgroup receipt fields; all resource thresholds and its
observer/stop logic remained unchanged.

Real Ghidra, Hopper, JEB, fresh JavaScript producer performance, and actual
agent trials are outside this checkpoint. Private WeakSet metadata/heap retention
was not measured independently; the absence of a strong retained parsed graph
is source-derived. The comparison maps exist only during the first
interpretation; measured family
peaks include their temporary cost.

## Latest-main integration and an unexplained timeout

Merge `71e0b2739` brings in main `bb212ffec`'s three test/config/guide fixes.
The current source passes all 27 tests in those three integration files through
`npm run test:focused` with the default deadlines. The earlier `646312dad`
checkpoint initially passed 26 and timed out the live identity/catalog test at
30 seconds. Matching official-command controls subsequently passed all 27 on
both unmodified main and that candidate. Direct/extended-deadline diagnostics
are recorded separately. Their passing results do not establish the cause of
the original timeout, which remains preserved and unexplained. No test-policy
or product file was changed to obtain a pass.

## Reproduction and retained evidence

Use `retained-investigation.mjs` from this directory with an authentic exported
bundle and its original source Evidence ID. Build both selected runtime revisions
with the pinned toolchain, preserving a separate baseline. For each runtime run:

```sh
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/retained-investigation.mjs \
  --runtime-root /absolute/runtime --revision REVISION \
  --bundle /absolute/history.json --evidence-id ORIGINAL_EVIDENCE_ID \
  --scenario native --delivery focused --output /absolute/new-receipt-directory
```

Use `--scenario javascript` for the npm history, and `--verify-mixed` with an
actual mixed investigation. Reuse the same bytes and source identity on both
sides. Do not regenerate parent identities or synthesize bundle records.
The checked-in wrapper defaults to a 4 GiB hard / 3 GiB early stop. This
checkpoint used a private resource-only copy with 8 GiB / 7 GiB thresholds,
a 16 GiB available-memory start floor and 8 GiB host early stop. Its source
and unchanged observer hashes are recorded in the curated receipt. This local
resource policy does not change the public workflow or global wrapper defaults.
Raw histories, transcripts, oracle outputs, and resource logs stay in the private
local audit cache; only curated receipts are committed.
