# Stable artifacts: read directly into one private snapshot

Issue: [#6954](https://github.com/morluto/rea/issues/6954).

`readStableArtifact` retained every stream chunk and then concatenated a second
full-file buffer. Its 37 production call sites share this filesystem boundary.
The owner now allocates one snapshot, capped by the caller's byte budget before
converting the descriptor's bigint size, and fills it with direct descriptor
reads. One reusable 64 KiB scratch buffer probes EOF and reads raced growth.
There is no per-chunk data allocation or second full-file concatenation.

The buffer stays private until the count, descriptor/path state and cancellation
checks succeed. Growth still reads through to EOF, an I/O failure or byte-budget
refusal before final integrity checks. Pending reads settle before close; the
existing descriptor owner retains failed cleanup and completed observations.
The streaming helper keeps its separate immutable-chunk contract. No cache,
public schema, report selection, Evidence identity or provider authority changes.

## Fixed real comparison

Baseline: `d87e73f2db50be72d33a4b3c7199af35518b441c`.
Measured implementation: `45307fb9534f464eee094ccddc4e295d1c0dd0fb`.
Both source trees were clean when pinned. Node 24.22.1, npm 11.16.0 and
production MCP SDK 2.3.1 were identical. Runtime receipts fingerprint 2,582
compiled/catalog/entrypoint/dependency and driver files per lane; the driver
checks them and the Node binary before and after each task.

Artifacts were inspected as data without executing the targets:

| Artifact                                                   |       Bytes | SHA-256                                                            |
| ---------------------------------------------------------- | ----------: | ------------------------------------------------------------------ |
| Linux LLVM 16, `/usr/lib/x86_64-linux-gnu/libLLVM-16.so.1` | 123,379,936 | `f62d254b7f2bf42df8c8b07d46ee3bb4c2cafeca436b2e6bc6ccbe4581f58f40` |
| GNU ls, `/usr/bin/ls`                                      |     151,344 | `cb30d69b24245bf2ecdc9e7f53bbad19159999970b6d82c0c00c7d32d9e37aa4` |
| OTP 27 `erl_parse.beam`                                    |     608,240 | `729cce2b1688a1613d1ee71f5d0d99a9430d163d08fbe1aa5148dbbe6494f458` |

The ELF question requests every note table/entry, source ranges and decoded
GNU facts, with complete Evidence access. `stable-artifact-elf-oracle.py`
independently maps ELF64 little-endian file bytes with Python `struct`, including
both program/section aliases, names, alignment, descriptor bytes/digests and
examined coverage. Its supported corpus is explicit, not a general ELF parser
claim. GNU readelf 2.40 independently agrees with the GNU build IDs, ABI and gold
version. LLVM has three tables/three notes, build ID
`649be1a7cae92cf064a666f2a64ececdf264cb7b`, and `gold 1.16`.
The BEAM control requests the complete inspection, checked against the retained
independent OTP chunk/table oracle from the BEAM investigation. All oracle
fields match; full normalized reports, catalog and parent Evidence identities
are identical across lanes. Full CLI Evidence also matches the MCP export.

Each case has three alternating fresh production stdio sessions per lane,
18 tasks total. Each discovers all 222 tools, calls the exact discovered
`toolDefinition` with the default SDK validator, inspects bytes and exports the
complete Evidence bundle. HOME/client/server are fresh; Node compile cache is
disabled; OS caches are unflushed. This measures fresh sessions, not cold disks.

| Completed task, 3 samples/lane | Whole elapsed median, s | Family CPU median, s | Kernel family peak median, MiB | Whole-task estimated tokens |
| ------------------------------ | ----------------------: | -------------------: | -----------------------------: | --------------------------: |
| LLVM notes                     |         15.848 → 12.209 |      13.393 → 11.161 |              756.496 → 725.566 |             58,486 → 58,486 |
| ls notes                       |           7.385 → 7.288 |        6.477 → 6.660 |              644.621 → 643.844 |             58,992 → 58,992 |
| OTP 27 erl_parse complete      |           8.420 → 7.401 |        7.063 → 6.653 |              649.535 → 654.520 |             73,754 → 73,754 |

LLVM kernel-peak ranges are 743.4–819.3 → 721.6–732.2 MiB, a median reduction
of 30.9 MiB (4.1%). Elapsed ranges are 13.853–18.630 → 11.994–12.631 seconds;
CPU ranges are 12.982–14.749 → 10.294–11.868 seconds. These are observed cohort
results, not a general latency guarantee: discovery medians also changed
2.578 → 1.987 seconds, host frequency/background activity was uncontrolled, and
absolute times shifted between earlier experiments with identical baseline
runtime fingerprints. The small and BEAM controls do not establish a general
memory or speed benefit. BEAM peak memory is slightly higher.

The [machine-readable report](./stable-artifact-reads.json) includes full ranges,
per-task phases, commands, digests and resource observations.
`cl100k_base`/tiktoken 0.14.0 counts the question, instructions, all tool names,
descriptions and input schemas once, arguments and every text reply including
export. The input directory costs 56,685 tokens; raw catalog including output
schemas separately costs 838,375. Actual model usage, host framing/replay,
inference latency and answer quality are unmeasured. There is no token saving.

## Locating the memory reduction

A separate 18-probe alternating cohort uses actual `readStableArtifact` and
`ElfNotesService` with three samples/lane/case. Returned bytes are hashed again
against independent `sha256sum`; every ELF oracle field is also checked.
The retained probe source is reproduced in `stable-artifact-profile.mjs`
(formatting only differs from the captured source). It does not force GC.

| Probe            | Process max RSS median, MiB | Whole elapsed median, s | Family CPU median, s | Kernel family peak median, MiB |
| ---------------- | --------------------------: | ----------------------: | -------------------: | -----------------------------: |
| LLVM reader      |               295.4 → 174.4 |           1.247 → 0.843 |        0.974 → 0.577 |                  262.6 → 141.5 |
| LLVM ELF service |               313.1 → 192.9 |           1.750 → 1.145 |        1.419 → 0.802 |                  274.1 → 153.4 |
| ls reader        |                 54.3 → 54.1 |           0.438 → 0.437 |        0.204 → 0.206 |                    21.6 → 22.7 |

Linux process max RSS is distinct from cgroup memory, which includes charged
cache and process-family overhead. The approximately 121 MiB RSS reduction on
the large file supports removing the extra full-file copy. It must not be
substituted for the smaller whole-MCP saving. Imports, independent digest
verification and cleanup are included in whole probe costs. These phase probes
are supporting evidence, not public CLI/MCP qualification for every consumer.

An earlier stream-copy implementation (`cb7364732`) passed correctness but did
not establish a whole-MCP memory benefit: LLVM median 807.4 → 841.0 MiB with
overlapping ranges. Those separate exploratory receipts are retained and are
not pooled with the final direct-read cohort or used for final benefit claims.

## Verification and resource limits

Executed checks:

- 151 focused owner/consumer tests passed in
  `tests/boundary/filesystem/stableArtifact.test.ts` and
  `tests/process-global/stableArtifactConsumers.test.ts`, including short reads,
  cross-buffer partial tails, malformed byte counts, pending-read cancellation,
  physical I/O error precedence, raced huge sizes, growth refusal and incomplete
  private buffers through failed close/cleanup retry.
- All six serial static tasks (typecheck, lint/module boundaries, format, knip,
  metadata and compilation), plus architecture guards passed. Static family
  peak was 1.60 GiB.
- Six real CLI calls and 18 real stdio MCP/source-export tasks passed every
  independent oracle fact and full report/Evidence comparisons.
- All 18 supporting producer probes passed their outcome, payload-exit,
  cleanup, memory/PID-event and independent oracle checks. The committed cost
  verifier reproduced the complete MCP measurement JSON exactly.

Heavy work ran serially under a one-CPU quota, 3 GiB early stop, 4 GiB hard
limit, no swap and 192-task ceiling. Measured tasks include client/server,
fingerprint reads, serialization, export and cleanup; tokenization and oracle
generation are outside measurements. All measured payloads exited 0 with
verified owned cleanup and no guard stop/OOM/limit events. Final whole-scope
counters after transient-scope removal are unavailable and are not verified.

Two cached baseline build preparations returned successful tasks but their
payload-exit witnesses still showed an extra process. Later authoritative
systemd observations showed both scopes inactive/dead with empty control
groups; the cause remains unknown. They are retained preparation attempts, not
benchmark samples or verified-cleanup successes. Runtime bytes were checked
separately in every measured MCP task. An initial CLI harness attempt failed
before task start because its fresh environment omitted the user systemd bus;
the corrected transport environment was passed explicitly without persisting
ambient environment values. Initial test/typecheck/formatter failures from the
implementation iterations remain in the local receipt archive.

Coverage is real static inspection of these Linux artifacts. Windows/macOS,
unusual filesystems and all 37 caller workflows have not been runtime-qualified
by this experiment. Existing cross-provider source tests are complementary
coverage, not real-provider verification. No OOM reproduction is claimed.

## CI follow-up and integration

The first CI run, `40071483901` at `41adc629f`, passed source tests
(17,305 passed, 13 skipped), static checks, package/Windows builds and all nine
selected real-workflow/SQLite compatibility jobs. Four built-test shards passed;
shard 4 failed two Go/PE cleanup cases and three shards were cancelled, leaving
that coverage unknown.

The failed fixture selected its first descriptor during close and omitted that
first call from its counter. The old stream's extra close invocation masked
this assumption; the original fixture passes on the fixed baseline and fails
with direct reads. The fixture now captures ownership at open, counts every
attempt and checks the retained descriptor itself: open after failed close,
closed after exactly one retry. This strengthens lifecycle coverage rather than
lowering the expected count. An intermediate assertion needed a typed getter
for state populated by asynchronous callbacks; its failed typecheck receipt is
retained. The measured production reader was unchanged.

After integrating main `98ec00f40`, qualification at `8e5bf787650e147aa1927c920501665df45dfe3a` passed
all 153 tests in the original two files plus
`tests/boundary/providers/artifactReadCleanupRetry.test.ts`, all six serial static
tasks and architecture guards. Three fresh real MCP/source-export tasks and
three CLI calls matched every oracle fact and the frozen complete parent
Evidence. All seven guarded groups exited 0 with verified payload cleanup and
no memory/PID limit events or OOM; static peak was 1.59 GiB. These integration
checks use their own runtime identity and preserve the fixed performance pins
above. Updated PR CI/review is separate from this local qualification.

## Reproduction

Build both pinned checkouts serially with their locked toolchain and matching
dependencies, without upgrading unrelated host software. Use the artifact
hashes above. The ELF oracle accepts `--path` and `--output`:

```sh
python3 experiments/analysis-efficiency/stable-artifact-elf-oracle.py \
  --path /usr/lib/x86_64-linux-gnu/libLLVM-16.so.1 --output /absolute/oracle.json
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/stable-artifact-reads.mjs \
  --runtime /absolute/pinned-checkout --oracle /absolute/task-oracle.json \
  --identity /absolute/runtime-identity.json --output /absolute/new-task-directory
```

The task oracle has `{operation, input, expected, question}`; use
`inspect_elf_notes` with `{path, max_file_bytes: 268435456}` and the independently
generated expected object. The small control has the same options. The BEAM
operation is `inspect_erlang_beam`, complete/default selection, path only.
Identity JSON has `source_revision`, `source_clean`, `node_sha256` and
`files: [{path, sha256}]`; fingerprint the full compiled runtime/catalogs,
entrypoints, lock/toolchain, actual SDK JS and driver/helpers. The historical
payload affinity was CPUs 0–1, initial observer CPU 15, with the limits above.

Raw receipt archive: `/tmp/rea-perf-stable-read-20261024/direct/` on the
investigation host. It contains runtime/oracle receipts, `cohort/index.json`,
per-task catalogs/transcripts/reports/source exports/guard logs, `cli/` outputs,
`profiles/` raw source results and verified summary, and static/architecture
logs. The parent directory retains earlier variants and failed preparations.
Reproduce the published MCP aggregation with:

```sh
python3 experiments/analysis-efficiency/stable-artifact-costs.py \
  --receipts /absolute/direct-receipt-directory --output /absolute/costs.json
```

The verifier requires all 18 distinct successful samples, exact oracle/runtime
receipts, full source exports and equal parent/report/catalog identities.
A failed or guard-stopped attempt cannot enter the report.
