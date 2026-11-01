# MCP discovery and complete Rust tasks

Target-free stdio discovery previously constructed the canonical analysis runtime before the client could inspect its directory. The candidate records SDK advertisements at build time for default/explicit compact and explicit full inputs. Its first tool, prompt or completion request materializes canonical validators and handlers on the same SDK server. HTTP, output-schema-off, initial-target and unrecorded source runs retain eager composition.

Pinned baseline: [`main@c465ff5a8`](https://github.com/morluto/rea/commit/c465ff5a814b8e1a386fc547cbcd94df5c35f086). Measured candidate: [`04900abbc`](https://github.com/leeguooooo/rea/commit/04900abbcd3c3438fce4af932ff28400fe744a7d). Both use the same main base and locked dependencies. Before/after source and all compiled JS/JSON bindings identify the exact runtime used in every trial. The input manifest and producer scripts are also hashed and checked.

## Real tasks and independent facts

Official Alpine v3.21 packages supply ripgrep 14.1.1-r0 (3,416,168-byte executable) and Zellij 0.40.0-r0 (17,151,864 bytes). Their download URLs, archive/executable digests and aports revisions are retained in [the measurement data](mcp-startup.json). The independent Python ELF/section/zlib/JSON oracle checks 42 packages and 88 dependency edges for ripgrep, and 422 packages and 1,063 edges for Zellij. Serde versions are 1.0.210 and 1.0.137 respectively; the selected package kind remains explicit unknown (`null`). Verification covers embedded static build metadata; execution and runtime reachability remain unverified.

Each analysis task initializes the actual SDK client, lists and validates the input directory, selects serde name/version/kind, reads the exact retained parent twice, verifies canonical rejection of a negative offset, exports and independently checks the complete package/edge inventory, confirms unchanged advertisements after materialization, then closes. All five tool calls and both directory reads are included in the measured task. Discovery tasks initialize, list tools/prompts, validate the input directory and close without an analysis call.

All 72 paired trials and four priming runs passed. Each artifact has identical answers, parent Evidence IDs and complete semantic hashes across roles, profiles and cache modes. Both profiles retain byte-identical directories across baseline/candidate and before/after canonical materialization. The directory contains 213 tools. Complete Evidence is retained and exported through the existing shared workflow.

## Measured cost

Three alternating pairs per condition; table values are medians. Min/max ranges and individual receipts are in [mcp-startup.json](mcp-startup.json). Each cell is baseline → candidate. Kernel process-family peak includes file cache, SDK driver, observer and REA children.

| Task      | Cache | Inputs            |  Wall seconds | Family CPU seconds | Family peak MiB |
| --------- | ----- | ----------------- | ------------: | -----------------: | --------------: |
| Directory | cold  | compact (default) | 5.661 → 2.236 |      5.403 → 2.050 |   559.3 → 248.6 |
| Directory | cold  | full              | 5.256 → 2.337 |      5.040 → 2.175 |   650.9 → 349.1 |
| Directory | warm  | compact (default) | 5.056 → 2.236 |      4.800 → 2.015 |   572.8 → 251.4 |
| Directory | warm  | full              | 4.957 → 2.338 |      4.754 → 2.139 |   672.7 → 349.6 |
| ripgrep   | cold  | compact (default) | 8.177 → 8.078 |      7.945 → 7.899 |   849.7 → 792.5 |
| zellij    | cold  | compact (default) | 8.276 → 7.276 |      8.041 → 7.105 |   846.2 → 819.0 |
| ripgrep   | cold  | full              | 8.180 → 7.483 |      8.000 → 7.312 |   846.5 → 794.4 |
| zellij    | cold  | full              | 8.484 → 7.776 |      8.284 → 7.514 |   850.4 → 813.1 |
| ripgrep   | warm  | compact (default) | 7.976 → 6.879 |      7.739 → 6.678 |   826.8 → 802.6 |
| zellij    | warm  | compact (default) | 8.285 → 7.472 |      8.019 → 7.254 |   882.1 → 811.4 |
| ripgrep   | warm  | full              | 8.074 → 7.476 |      7.890 → 7.265 |   852.1 → 803.6 |
| zellij    | warm  | full              | 8.382 → 7.479 |      8.151 → 7.293 |   854.3 → 830.0 |

Discovery improves clearly in this cohort. Completed-task changes depend on the workload: default cold ripgrep is approximately unchanged. Initialization moves into the first actual analysis request; its latency must be assessed with the full workflow.

| Default ripgrep first RPC | Baseline ms | Candidate ms |
| ------------------------- | ----------: | -----------: |
| cold                      |       231.5 |       2532.1 |
| warm                      |       227.1 |       2118.2 |

Within each profile, advertised context remains identical. Input-directory estimates are 49,670 tokens for default compact and 205,744 for full. Whole-task estimates include the supplied question/recipe, server instructions, directory once, every tool argument and text reply, and the prompt directory in discovery tasks. This projection assumes the client retains one unchanged directory; raw catalog result costs count every observed list result separately, including output schemas. These use tiktoken 0.14.0/cl100k_base; actual model usage, reasoning and SDK initialization/framing are unmeasured.

Linux x64 / AMD EPYC 7B12 / kernel 6.1.0-54-cloud-amd64 / Node 24.18.0, npm 11.16.0. Timed SDK tasks negotiated the legacy protocol era; auto/modern correctness is covered separately by compiled boundary tests. Trials run serially under a 1-CPU quota pinned to CPU 15, 4 GiB hard memory / 3 GiB early stop, no swap and 192 tasks. No resource stop, OOM or remaining payload process was observed. Cold disables server Node compile cache; warm uses a role/profile-specific cache populated by one complete task. Fresh processes and HOME are used each trial. Cache hit rate and OS page cache are unmeasured. Runtime audits warm compiled-file pages and are included in whole-task costs. Builds, downloads, oracle generation and cache priming are preparation outside those costs. Retained V8 heap and forced-GC measurements were not separately collected.

## Ownership and validation

`OwnedMcpServers` seals publication before taking its close snapshot, keeps failed exact close capabilities for retry and serves both eager and deferred paths. Deferred startup still joins servers published before an asynchronous serving handle settles. Post-snapshot and post-close factory calls are refused before allocation. Both production-boundary regressions fail with only the shared guard removed and pass restored.

The moved transport/delivery implementation preserves current complete-error retention, escaped-preview fitting, response/string-limit recovery, target-content provenance and native Evidence continuations. Canonical parsers remain authoritative after lazy binding. Both protocol eras, input/output profile choices, invalid input/output, completion cancellation, partial startup and cleanup retry are exercised.

Aggregation keeps catalog, producer-script and guard-script digests in distinct variables. Before publishing a trial it verifies that the catalog digest matches both its catalog-file receipt and the shared profile identity. Deliberately selecting the guard digest for that field is rejected. Regeneration preserves all measured timing, CPU, memory, context and parent-Evidence values.

Executed local gates: 125 focused tests across 14 files; a repeated 22-case schema/profile subset after the pinned main merge; all six static-check tasks plus architecture guards; builds for both pinned runtimes; six documentation checks and five README consistency tests. HTTP coverage includes the real compiled CLI session/replacement/Host tests. Runtime-binding admission rejects a mismatched compiled graph before MCP launch; aggregation rejects a tampered trial binding. The raw receipts remain in `/tmp/rea-perf-mcp-startup-20261022`, identified by hashes in the data. Real initial-target providers, foreign OS runtime behavior and other providers remain outside this measurement.

## Reproduction

Use the pinned Node/npm toolchain and separate clean baseline/candidate checkouts. Build each with `npm ci` and `npm run build:cached` (the measured workspace shared one locked dependency installation). Acquire and verify the official packages listed in the data, extract the named executables and generate independent oracles with `mcp-input-catalog-oracle.py`.

Capture each checkout with `node experiments/analysis-efficiency/managed-cli-runtime.mjs CHECKOUT mcp`. Construct `measurement-inputs.json` using the recorded schema, updating absolute checkout/artifact/oracle paths and their independently verified bindings. Keep it immutable through a cohort; producer source digests cover `mcp-input-catalog.mjs`, `managed-cli-runtime.mjs`, `resource-run.py` and `resource_payload.py`.

Run `mcp-input-catalog.mjs` through `resource-run.py --observe-payload-exit` with `--runtime`, `--output`, `--bindings`, `--role baseline|candidate`, `--profile default|full`, `--phase discovery|analysis` and `--cache cold|warm`. Analysis also takes `--artifact` and `--oracle`; warm requires a role/profile-specific `--cache-root`. Disable the driver compile cache for both cohorts. Prime each warm role/profile once with the complete ripgrep task. Follow the 72-case order in the data, reversing role order in every second pair. Aggregate with `python mcp-startup-costs.py LAB --output mcp-startup.json` using tiktoken 0.14.0. The aggregator verifies every input/runtime/guard binding and completed receipt before producing summaries.
