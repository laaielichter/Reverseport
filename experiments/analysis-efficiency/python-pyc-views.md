# Selected Python pyc facts

Issue [#6922](https://github.com/morluto/rea/issues/6922) asks for selected code-object facts without delivering the whole report. The existing static parser already owns the facts. The change adds a typed `python-pyc` view to the shared retained-Evidence projector, and opt-in `detail: "summary", view: {...}` delivery through the existing CLI/MCP tool. The default complete result and parent Evidence identity remain unchanged.

Names, original indexes, fields and matching-row pages compose. Every same-name alternative survives under its parent-scoped `source_index`; an empty selector selects nothing. `nested_code` keeps original code-constant reference indexes and does not claim runtime calls. Source coverage is separate from page coverage. Complete Evidence remains exportable, and saved bundles support offline views after the original file is deleted.

The immutable-result reader is shared with native-export views instead of adding a second cache implementation. Each owning schema has a weak cache keyed by the validated, owner-sealed result object. It never caches a path or current filesystem state. Mutable/unowned values and failed parses are revalidated; schema-normalized facts stay separate from the source. CLI delivery JSON parsing also has one owner, shared with the existing JavaScript route commands.

## Question and independent oracle

For each target, return every code object with one of three exact names, including `source_index`, `name`, `qualname`, `filename`, `firstlineno`, bytecode byte length/SHA-256 and `nested_code`. Preserve source coverage and export the complete source Evidence. Both lanes perform discovery, one inspection and one Evidence export. The selected lane includes the view in the first inspection; this question fits one page with the default limit of 64.

| Input                                     | Source bytes | All objects | Selected rows | Names                                                       |
| ----------------------------------------- | -----------: | ----------: | ------------: | ----------------------------------------------------------- |
| CPython 3.11.2 `argparse.cpython-311.pyc` |      113,662 |         194 |             3 | `parse_args`, `parse_known_args`, `_parse_known_args`       |
| CPython 3.11.2 `typing.cpython-311.pyc`   |      157,945 |         307 |             3 | `get_type_hints`, `_eval_type`, `_type_check`               |
| Inert compiler-produced control           |        1,396 |           8 |             4 | argparse names, including two distinct `parse_args` objects |

`python-pyc-oracle.py` uses the matching CPython 3.11.2 magic and an independent marshal/CodeType graph walk. It checks the selected facts for **all** objects in the exported source, as well as every returned answer row. The small control is compiled, never executed. The production lanes never execute target bytecode. The original oracle CLI imported the system argparse module as its argument-parser dependency (outside timed tasks); it did not explicitly execute the selected marshal CodeType, but the broader claim that the oracle never loaded target bytecode was inaccurate. Review replaced that dependency with `getopt`, added before/after guards for argparse/typing module loading, and regenerated all three oracles: their complete JSON facts are identical. The current oracle neither imports either selected standard-library module nor executes the decoded CodeType. At `062f94ce3`, a newly compiled control reproduces the original code facts and pyc SHA-256; all three selected stdio/export tasks pass again with the regenerated oracles and a current runtime/driver identity manifest. These observations qualify the three concrete CPython 3.11 artifacts, not every supported historical marshal layout or an agent's investigation quality.

Target SHA-256 values, full commands, runtime/driver identities and receipt digests are in [the machine-readable results](python-pyc-views.json). All six sessions per target produce the same answer digest, parent Evidence ID and complete normalized-source digest.

## Fixed-version measurements

Baseline: `6b3eee1ccf4c51f23bef7a0007c7b8e892f662db`. Candidate: `29ff0893e` (full revision in the results). Three alternating fresh sessions per lane and target, 18 completed tasks. The order reverses in the second pair. Linux x86-64, Node 24.22.1, npm 11.16.0; production stdio MCP with SDK 2.3.1, its exact discovered tool definitions and default output validator. No validator patch or private SDK hook is used.

Each task has a fresh HOME/client/server, disables Node compile caches, and leaves OS caches unflushed. These are fresh-session measurements with warm/uncontrolled OS caches; there is no separate warm-server cohort. Runtime files, installed client modules, entrypoints, the Node executable and driver files are checked before/after tasks. Oracle generation and tokenization are outside timed tasks. Whole-task costs include discovery, SDK schema compilation, runtime checks, source hashing, comparisons, serialization, export and cleanup.

| Median                                               | argparse complete → selected | typing complete → selected | Small control complete → selected |
| ---------------------------------------------------- | ---------------------------: | -------------------------: | --------------------------------: |
| Estimated task tokens                                |             104,415 → 57,300 |           128,858 → 57,316 |                   57,719 → 57,332 |
| Serialized MCP reply bytes, both calls               |              338,446 → 9,011 |            495,172 → 8,799 |                    14,891 → 9,083 |
| Elapsed seconds                                      |                5.760 → 5.559 |              5.761 → 5.761 |                     5.358 → 5.459 |
| Process-family CPU seconds                           |                5.532 → 5.369 |              5.532 → 5.566 |                     5.180 → 5.247 |
| Kernel process-family peak MiB, including file cache |                649.1 → 663.7 |              685.0 → 642.5 |                     644.8 → 654.3 |

The declared token projection falls **45.1%** for argparse and **55.5%** for typing, versus **0.7%** for the small control. No stable general elapsed-time, CPU or memory improvement is established. The parser and complete-source retention still do their full work. Wall-time ranges overlap for every target; typing selected ranges 5.560–6.466 seconds versus 5.660–5.963 complete. Other ranges and individual samples remain in the results.

Token estimates use `tiktoken==0.14.0` / `cl100k_base`. The projection counts the question, server instructions, all 221 discovered tool names/descriptions/input schemas once, every argument and every MCP text reply, including export. Candidate input-directory cost increases from 54,883 to 55,283 estimated tokens. Complete raw catalog transport, including output schemas, is separately counted: 822,529 → 826,451 tokens. It is not added to the model-input directory projection. Structured content is validated and retained; the context projection counts the text reply once. Actual model usage, inference quality, history replay, protocol framing and host-added context are unmeasured.

Each task uses one aggregate CPU quota, payload affinity CPUs 0–1, a 3 GiB early stop, 4 GiB hard limit, no swap and 192-task limit. The observer initially runs on CPU 15; the receipt's initial affinity does not describe payload placement. All 18 payloads exit zero, confirm cleanup, and show zero memory/task limit or OOM events at payload exit. Final whole-scope counters are unavailable and remain null. Peak kernel memory includes file cache and differs from a single process's RSS.

## Verification and integration scope

Executed against the measured base integration:

- 46 source tests: analysis views, schema-specific immutable-result ownership, PYC delivery and existing JavaScript delivery contracts. Converted input schemas validate under draft-2020-12 and draft-07 and agree with runtime parsing on valid/invalid combinations.
- 27 public CLI/MCP tests across PYC and native-export suites: direct selected delivery, full source bundles, retained/offline queries after deleting the source, duplicate names, paging, empty/intersecting selectors, source references, view digests, invalid delivery and existing complete PYC behavior.
- Six serialized static tasks (typecheck, lint, format, unused exports, metadata and their compile dependency) and architecture guards passed. Test-family peak was about 2.48 GiB, with no guard stop/OOM and verified payload cleanup.

The candidate subsequently integrated main `76500f12b54e07b1ea700a403b2593890d63b42a`. The table remains a measurement of the fixed revisions above. At integration `c172fd330`, `npm run docs:generate` and `npm run docs:check` passed (including 9 README consistency tests); the six serialized static tasks and architecture guards passed again, and the two affected retained-view public suites passed all 5 tests. The combined integration job peaked at about 2.59 GiB with verified payload cleanup and no resource stop/OOM. Real-artifact qualification is recorded separately; it does not turn these timings into measurements of a later revision.

Retained failed attempts: an initial test mislabeled magic 3531 as 3.11 (the owner maps it to 3.12); the assertion now compares the complete owner's header. A CLI validation return initially bypassed `logCliCommand`, producing exit zero; validation now runs inside that command owner, before opening the provider, and the public negative regression passes. An oversized acceptance function was split into fixture/selector helpers. A final test invocation used a nonexistent JavaScript test filename and was rejected before running tests; the corrected invocation produced the 46/27 passing results above. An early cached build had an unverified transient cleanup observation; its scope was subsequently inactive. The final baseline build and all measured tasks verify payload cleanup. None of these failed attempts are counted as successful measurements.

## Reproduction

Use the pinned toolchain and dependencies. Build detached baseline and candidate runtimes, and generate independent facts with `python3 python-pyc-oracle.py --path ABSOLUTE_PYC --name NAME (repeatable) --output ORACLE.json`; `--compile-control NEW_DIRECTORY` creates the inert small control. Run `python-pyc-views.mjs --runtime RUNTIME --oracle ORACLE --output NEW_OUTPUT --lane complete|selected`, through `resource-run.py --observe-payload-exit` and the recorded affinity/toolchain wrapper. The optional `--identity` manifest pins compiled files/entrypoints, the Node executable and driver files; the before/after checks are included in task costs. Preserve raw catalog, transcript, complete bundle, report and guard log for every run.

Repeat the recorded alternating order. A cohort manifest binds runtime identities and driver hashes; its index retains each exact command and exit. Aggregate with `uv run --no-project --with tiktoken==0.14.0 python python-pyc-costs.py --cohort COHORT --output RESULTS.json`. The aggregator rejects missing/failed tasks, failed cleanup/resource observations, changed identities, unequal answers/source digests and unexpected call counts. Raw local receipts are under `/tmp/rea-perf-pyc-views-20261023/export-cohort`; they are not required runtime files.
