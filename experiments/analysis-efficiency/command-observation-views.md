# Retained command observations

Addresses [#5584](https://github.com/morluto/rea/issues/5584). GDB command Evidence
repeats ordered MI records in stream groups and a raw mirror; objdump repeats
stdout/stderr in its raw mirror. Explicit `detail: summary` retains the complete
parent and projects existing owner facts once. Default complete Evidence is
unchanged. This adds no tool, MI decoder, live-state cache or command authority.

GDB summaries preserve **every ordered record**, including asynchronous and
unrecognized records, correlated MI result, command, completion/truncation,
invalid-UTF-8 and process-exit facts. They omit the convenience console/target/log
groupings and report their original UTF-16 sizes. Objdump summaries preserve
opaque stdout/stderr, exit/signal, completion and pre/post digest-change facts.
Both carry source parameters/provider/profile, parent identity, limitations and
unknowns. Subjectless observations stay subjectless. Historical observations do
not establish current target state or global coverage. The existing
`inspect_analysis_view` summary operation works after debugger close.

The domain codec now owns the command fact shapes used by contracts and GDB's
capture type; protocol interpretation stays with its provider. MCP requires
retention before command execution. CLI uses the existing shared projection and
nonoverwriting bundle publisher after provider cleanup:

```sh
rea inspect-with-objdump /usr/bin/bash disassemble --symbol execute_command \
  --detail summary --evidence_output /tmp/bash-command-evidence.json --json
```

## Real input and correctness

Linux x86-64, Node 24.18.0/npm 11.16.0; GNU GDB 13.1 (Debian 13.1-3),
GNU objdump 2.40, installed Bash ELF 1,265,648 bytes, SHA-256
`55b89ab22bee4792a210f493a53fb066accd5d30b69837c28d98be5ff863efcf`.
The [receipt](command-observation-views.json) pins native binaries, baseline main
`c2858d2aa0916f0dd2d073d848b8c2195d9bf6b3`, source patch and packaged runtime digests.
No target execution, attach, GUI or database mutation occurred.

An [independent ELF reader](command-observation-oracle.py) maps dynamic symbols
to exact file ranges: `execute_command`, 239 bytes at `0x4ba50`, and
`execute_command_internal`, 15,428 bytes at `0x47e00`. The
[verifier](command-observation-verify.py) checks every disassembled byte and its
contiguous address against those ranges. GDB reports 66/3,365 instructions;
objdump byte lines also include continuations, so their count is not an
instruction count. Ordered summary facts match each exported complete parent.
GDB Evidence has a null subject; the external oracle does not manufacture a
target binding. Actual CLI default objdump Evidence matches the baseline exactly,
including identity; symbol/pathless summaries preserve it in bundles. CLI checks
also cover rejected overwrite, missing destination before dispatch, and a real
GDB command with a caller-owned PTY that remains available after debugger exit.

## Whole tasks and resource costs

The [SDK driver](command-observation-queries.mjs) discovers all 210 tools, reads
architecture and symbol-scoped disassembly, closes GDB where applicable, exports
complete Evidence and finalizes owned resources. GDB uses 8 calls; objdump uses 3.
Warm cases repeat disassembly in the same process, adding one call. Fresh-process
cases have **unflushed OS caches**, not disk-cold inputs. Native commands are
rerun; results are not reused as current live state.

The [actual Codex 0.163 app-server driver](command-observation-wire.py) uses a
loopback deterministic SSE fixture, no AI inference or paid service. All 210
function schemas are present in every normal model-facing request. Matched tasks
use full input/output profiles; only disassembly selects summary. The
[counter](command-observation-costs.py) counts compact JSON serialization with
`tiktoken 0.12.0 / cl100k_base` across **every** request, including schemas,
replayed results and the actual client's local compaction request. The fixture
answers compaction with observed identifiers and the retained-body location.
These are serialization-token proxies, not model rendering, acceptance, answer
quality, actual usage or billing. Compaction behavior is qualified only for this
client/configuration; no inference quality is established.

| Completed GDB task             | JSON token proxy before → after | Requests |  Wall seconds |   CPU seconds | Family peak MiB |
| ------------------------------ | ------------------------------: | -------: | ------------: | ------------: | --------------: |
| Small, 30,000 per-tool budget  |               605,133 → 580,070 |    9 → 9 | 7.906 → 8.618 | 7.195 → 7.832 |   788.9 → 785.9 |
| Large, 350,000 per-tool budget |           1,269,405 → 1,091,290 |   10 → 9 | 9.551 → 9.127 | 8.832 → 8.370 |   805.2 → 770.8 |

Whole-task context proxies decrease **4.14% / 14.03%**, rather than the much
larger reply-byte reduction. The large baseline makes one compaction request;
the candidate makes none. The small task is slower. These single paired samples
do not establish a general speedup. With the client's default output budget,
the small baseline delivers truncated invalid inner JSON and does **not**
complete the question; summary completes it. That incomplete baseline is
excluded from the percentage comparison.

| SDK task      | Reply bytes before → after | Whole wall seconds |   CPU seconds | Family peak MiB |
| ------------- | -------------------------: | -----------------: | ------------: | --------------: |
| GDB small     |            54,123 → 18,009 |      6.631 → 5.447 | 6.102 → 5.240 |   536.3 → 535.8 |
| GDB large     |        2,763,983 → 700,453 |      6.965 → 6.660 | 6.729 → 6.451 |   595.0 → 545.8 |
| Objdump small |            22,467 → 15,990 |      7.599 → 7.699 | 7.110 → 7.264 |   527.8 → 532.5 |
| Objdump large |          964,889 → 487,219 |      7.737 → 7.499 | 7.334 → 6.935 |   537.0 → 536.6 |

Same-process repeat disassembly takes 1,100 → 1,016 ms for GDB and
1,070 → 939 ms for objdump in these observations. Whole warm-task CPU improves
7.613 → 7.162 s for GDB but increases 7.819 → 7.859 s for objdump. Timings include
existing ownership checks; no check was removed or cached.

Retaining a summary also retains an additional derived record: large GDB bundles
grow 1,310,073 → 1,640,022 bytes; objdump 474,288 → 712,656. This trades retained
storage for smaller delivery; long-session heap growth is unmeasured. Retained-data lifetime follows the existing investigation ledger and cleanup
owners. Output still scales
with the requested complete disassembly; summary is not a fixed-size preview.

Each experiment runs in one owned systemd scope, one CPU, no swap, 4 GiB hard /
3 GiB early memory thresholds and host-memory admission/stop thresholds. Recorded
payload exit and cleanup are verified, with zero OOM/resource events. Final
whole-scope counters disappear after teardown and remain explicitly unverified.
The receipt includes CPU time, wall time, peak family memory, warm cases and
bundle growth. Build/check scopes use separate bounded budgets. Host-memory
check stops and initial fixture failures are preserved locally and are not passes.

## Coverage and reproduction

320 focused tests cover the new SDK schemas/views plus existing GDB queue,
malformed output, cancellation, process exit, target identity and cleanup cases,
objdump symbol selection and command admission. Real provider evidence is from
the CLI/SDK/client runs above, not simulated-provider tests.

Run the oracle for the selected Bash image, then use the SDK driver with
`--runtime`, `--input`, `--oracle`, `--output`, `--provider gdb|objdump`,
`--symbol`, `--detail complete|summary` and optional `--warm`. The wire driver
also takes the fixed Codex/Node paths, `--mode`, `--symbol` and `--budget`; it always performs the
export (eight tool calls). Run each through `resource-run.py --observe-payload-exit`, preserving
its sibling `.log`; the verifier and counter accept `--root` for those results.

Default Rizin execution returned ENOENT with no configured alternative. Cutter
reported no live bridge; no configured selector or default bridge directory was
present. Real Rizin/Cutter performance and GUI workflows remain unverified.
Their command semantics were not changed. Existing objdump native symbol
selection was reused. No claim covers arbitrary GDB target execution or another
host client's output budget.

Review follow-up adds nine CLI publication regressions (16 CLI tests including the
existing cleanup cases), three deterministic delivery-oracle tests, and a focused
strict typecheck of the new CLI boundary and its transitive source. Real client
small/default and large/generous summary runs pass the strengthened oracle and
export complete parents; only the explicit complete/default baseline may finish
with an incomplete answer. The unused export switch was removed: export is
mandatory in this question. Product source and the original paired measurements
are unchanged; the receipt records these additional validation runs separately.
