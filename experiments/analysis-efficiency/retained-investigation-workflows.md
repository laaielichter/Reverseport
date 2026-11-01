# Retained investigation query checkpoint

[#3134](https://github.com/morluto/rea/issues/3134) measured existing retained
queries on Linux. Selected reads preserved the requested facts, original
Evidence and Unknown revisions, including a mixed investigation. Existing
contracts suffice for these questions; this checkpoint adds no production API,
cache, persistence or default change.

Imported JavaScript pages repeatedly validated their entire source graph. That
separate, observed bottleneck is owned by
[#4810](https://github.com/morluto/rea/issues/4810). Smaller replies did not
establish a general model-token or whole-task latency improvement.

The [curated measurements](retained-investigation-results.json) retain individual
SDK/model costs and unsuccessful attempts. Raw bundles, transcripts, profiles
and detailed receipts stay private and are not build inputs.

## Sources and questions

Runtime: `f4322b15ed1423d736bd2572cf7a8eadf2b466e1`, Linux x86-64,
Node 24.18.0/npm 11.16.0. The SDK discovered all 207 advertised tools
(3,152,125 serialized catalog bytes). Model trials used Codex CLI 0.161.0,
requested `gpt-6.1-sol`/high, direct MCP, and the same four enabled tool names:
`import_evidence_bundle`, `get_evidence_bundle`, `inspect_analysis_view`, and
`list_unknowns`. The resolved service-side model identity is unknown. These are
selected-client-tool trials, not an evaluation of full-catalog agent discovery.

Two public source workflows produced authentic bundles through production MCP:

- Native: `inspect_binary_layout` on Debian's `libsqlite3.so.0.8.6`, SHA-256
  `2e6eef9a727f081f0d453b4e5e6cbd8b9ef8b6f86cbf7681cbad444d3b0b55c8`.
  Pwntools 4.15.0/pyelftools 0.33/Unicorn 2.1.2 observed 26 sections, 1,479
  symbols and 2,963 relocations. An independent ELF64 decoder checked section
  and relocation counts and every symbol's table/entry index, value, raw name
  bytes and source entry range against the original file.
- JavaScript: shipped npm 11.16.0, directory inventory digest
  `f8e576a7d162542c616168b25a95a5f62b9accf29467cc37e149905ad4b8e603`.
  `analyze_javascript_application` selected exactly `package.json`,
  `bin/npm-cli.js`, `lib/cli.js`, `lib/cli/entry.js`, and
  `lib/commands/install.js`. It parsed four JavaScript files; 1,416 other
  relevant files remained unselected. The complete retained result contained
  2,822 application nodes, 1,796 semantic nodes and 13,682 semantic unknowns.
  Source-file digests and the `lib/cli.js` source-module identity were checked
  against shipped bytes. Inventory/discovery completeness remains producer-relative.

Analyst-recorded Unknowns came from the actual source limitations: five native
and seven JavaScript questions. These registry heads are distinct from the
13,682 semantic-graph unknowns. The exported histories contained 15 and 17
records, respectively, and approximately 1.75 and 21.06 MB of canonical JSON.
No synthetic payload arrays were used.

The SDK task read the first six original symbol/module rows and the relevant
current Unknown heads. Complete delivery and selected delivery answered the
same question; selected delivery intentionally exercised two-row pages. Each
fresh server performed three traversals, exported again and closed. The model
task additionally requested native identity/counts, or the five JavaScript source
choices and exact `lib/cli.js` source module, with explicit runtime uncertainty.
Compare arms within each declared task, not SDK costs against model costs.

## Correctness, capacity and lifetime

Both fresh-server SDK repetitions passed in both delivery arms. Selected rows,
ordering and counts agreed with original records; all original records and
Unknown revisions survived export/import, including links, omitted fields,
nulls and scalar types. Query calls did not rerun either producer. The resumed
servers had no native producer configuration.

The JavaScript complete bundle exceeded the default 10 MiB receive-buffer
boundary. Its typed capacity refusal preserved the complete retained data and a
usable connection. Complete-arm costs include that refusal and subsequent
selected-view recovery; they are not timings for a successful complete transfer.

A mixed history combined both authentic investigations and promoted 64 actual
semantic unknowns to separately identified analyst follow-ups. One follow-up
was updated to investigating. It contained 97 records, 76 heads and 77 revisions.
Both source queries preserved all original records/revisions. Thirty-two
two-head pages verified every semantic-follow-up head, including revision two.
A stale update and a tampered bundle import were rejected without changing the
ledger. Export reproduced the complete original mixed bundle. Closing cleared
records/Unknowns and made the old reference unavailable; no implicit persistence
or producer restart was introduced.

Public CLI `inspect-evidence-bundle` summary and inline `inspect-analysis-view`
summary also passed on both authentic sources. Portable CLI input still requires
complete input admission/validation; small output does not remove that cost.

## SDK costs

Each row spans two fresh MCP servers. Query time is the sum of SDK RPC elapsed
times over three traversals. Local post-call contract validation, oracle checks
and transcript writes are included only in the whole harness, along with startup,
full discovery, file reads, import, export and close. OS caches were uncontrolled/warm. A fresh imported
session is not a cold native-analysis measurement.

| Source / arm                   | Three traversals | Query reply bytes |   Whole elapsed | Local family CPU |     Family peak |
| ------------------------------ | ---------------: | ----------------: | --------------: | ---------------: | --------------: |
| Native complete                |    1.329–1.385 s |        11,224,227 | 14.117–14.722 s |  13.915–14.485 s | 1,110–1,161 MiB |
| Native selected                |    0.530–0.572 s |           167,985 | 12.907–13.316 s |  12.679–13.116 s |   935–1,000 MiB |
| JavaScript complete + recovery |  11.242–11.938 s |           212,856 | 26.300–27.105 s |  26.100–26.870 s | 1,321–1,334 MiB |
| JavaScript selected            |  10.967–10.990 s |           208,350 | 25.708–26.197 s |  25.505–25.980 s | 1,336–1,344 MiB |

Mixed-history selected tasks took 16.933 s native and 26.500 s JavaScript,
including the larger import and complete round-trip checks. Their family peaks
were 1,261 and 1,347 MiB. This does not establish scaling to thousands of
registry heads or every provider.

Original-session npm warm pages measured 8–31 ms; after import, repeated pages
cost about 1.1–1.4 s. Source inspection shows that imported immutable Evidence
does not carry the format owner's private graph proofs, so each view repeats
full validation. Native layout views also parse the complete layout on each
page. #4810 owns equivalent before/after verification of a correction; this
checkpoint claims no speedup from an unimplemented cache.

## Actual model tasks

All twelve attempts retained their costs. Ten supplied every checked fact and
current Unknown identity/status; runtime and unselected-source coverage stayed
unknown. One initial JavaScript selected attempt searched the wrong connector
and received an approval-policy refusal. One guided complete attempt stopped
without an REA RPC and asserted tool unavailability without a supporting
connection/discovery observation. Both are failed tasks, despite CLI exit zero.

| Cohort / arm                          | Successful tasks |       Total input tokens |                  Elapsed |
| ------------------------------------- | ---------------: | -----------------------: | -----------------------: |
| Native complete                       |              2/2 |        287,913 / 348,976 |        52.103 / 58.261 s |
| Native selected, two-head pages       |              2/2 |        335,445 / 286,938 |        62.078 / 57.933 s |
| JavaScript complete + recovery        |              2/2 |        454,491 / 328,066 |        76.490 / 58.335 s |
| JavaScript selected, two-head pages   |              1/2 | 167,470 failed / 339,528 | 34.206 failed / 66.455 s |
| JavaScript guided complete + recovery |              1/2 |  168,862 / 28,696 failed | 69.206 / 29.187 failed s |
| JavaScript guided selected            |              2/2 |        124,218 / 129,134 |        53.464 / 58.526 s |

The separate guided JavaScript cohort named the exact configured tools and
allowed one sufficiently large Unknown page for this bounded question. Both
arms received the same discovery guidance. Its single completed complete-arm
sample is insufficient for a stable repeated-pair benefit claim. Native total
input/time overlapped; extra pages and model turns can consume the reply saving.
Do not pool failed tasks as fast answers or attribute guidance changes to REA.

The JSON report records total/cached/uncached input, output, local CPU and peak
memory per attempt. These are client-reported usage counters, not tokenizer
estimates; output includes the client's reported reasoning accounting without
adding it again. Schema/discovery, errors, retries and continuations remain in
the task. Remote model compute, full-catalog model behavior and other hosts were
not measured.

Heavy runs were serial, one CPU, 8 GiB family hard limit, 7 GiB early stop,
no swap. Kernel peaks include charged file cache. Counter observations were
taken at payload exit while the owned observer remained alive; terminal
whole-scope counters remain unknown. Observed payload OOM/capacity events were
zero, all payloads exited and cleanup was verified. The expected MCP response
refusal is a separate transport-capacity outcome.

## Reproduce

Build the pinned runtime, acquire the matching real artifacts and produce the
two authentic histories with the public operations above. Export before close.
Keep bundles, transcripts and model profiles private. For a known source ID:

```sh
node experiments/analysis-efficiency/retained-investigation.mjs \
  --runtime-root /absolute/built-rea \
  --revision f4322b15ed1423d736bd2572cf7a8eadf2b466e1 \
  --bundle /absolute/authentic-history.json \
  --evidence-id ev_ORIGINAL_SHA256 \
  --scenario native --delivery focused \
  --output /absolute/new-receipt-directory
```

Run under the existing process-family resource wrapper, with sufficient bounds
for the selected source. Repeat with `--delivery complete`; use
`--scenario javascript` for module rows. The task's Unknown domain is
`retained-native` or `retained-javascript`. Output is never overwritten.
`agent-trial.py --mode direct` supports the same four enabled names; its success
exit only establishes client completion. Grade original IDs/digests, exact
facts, coverage and Unknowns from the retained transcript and final answer.

For a privately supplied authentic mixed bundle, add `--verify-mixed`. Besides
the normal source query and original-record round trip, this pages every current
head in `javascript-semantic-followup`, checks the current updated revision,
submits a deliberately stale update and a tampered copy of the bundle, verifies
atomic refusal, then checks Unknown/reference lifetime after close. The bundle
must contain genuine follow-ups and at least one updated head. The checkpoint's
64-head bundle passed this mode for both source scenarios. Its extra verification
costs are separate from the original SDK comparison rows above.

Rejected SDK calls are recorded before propagating the original failure, with
request, phase and elapsed time. Reply bytes stay null when no usable reply was
received. Receipt-write failures remain distinct; simultaneous call/write
failures retain both causes. Deterministic failure tests run with
`python3 -m unittest discover -s experiments/analysis-efficiency -p test_retained_queries.py`.

Finalization independently attempts client/transport close, log completion and
both receipt outputs. Cleanup failures preserve the original task failure and
call costs, record the failing phase and retain the workspace for retry. A file
receipt refusal still permits stdout; a broken stdout write is recorded in a
file retry. Files publish through a sibling temporary file and rename; an
interrupted retry preserves the previous receipt. Failed publication files stay
in the owned output directory. Cleanup or receipt-output failures make the
command fail. Six additional regressions exercise stream/file errors, partial
publication and peer cleanup; these are harness failure checks, not real-provider
evidence.
