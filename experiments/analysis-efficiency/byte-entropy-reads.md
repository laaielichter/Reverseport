# Byte entropy: separate physical reads from report resolution

Issue: [#6947](https://github.com/morluto/rea/issues/6947).

The question is to return the full-file SHA-256 and entropy, every block in a
selected byte window, and adjacent high/low runs, preserving complete source
Evidence. `ByteEntropyService` previously used `block_size` for both reporting
and physical reads, including outside the selected window. Small report blocks
therefore caused hundreds of thousands of asynchronous reads of a large file.

The shared service now fills a bounded 64 KiB buffer before calculating the
caller-selected blocks. Supported power-of-two block sizes divide that buffer;
the window starts its own block sequence, and only its final block can be short.
Short physical reads are joined before interpretation. The same stable-file,
whole-file hash, cancellation, capacity and descriptor-cleanup owners remain.
No new cache, parser, contract or output selection is introduced.

## Fixed comparison

Baseline: `1d896e03b776453282beca7fd89338be778bfca2`.
Measured implementation: `3ed3276d0ee79c291e1006901ace5b06626c1d4e`.
Both were clean and built with Node 24.22.1, npm 11.16.0 and SDK 2.3.1.
The runtime receipt fingerprints 2,582 compiled/catalog/entrypoint/dependency
and driver files in each lane, checked before and after every task.

Real artifacts are installed Linux x64 binaries, inspected without execution:

| Artifact                                              |       Bytes | SHA-256                                                            |
| ----------------------------------------------------- | ----------: | ------------------------------------------------------------------ |
| LLVM 16 (`/usr/lib/x86_64-linux-gnu/libLLVM-16.so.1`) | 123,379,936 | `f62d254b7f2bf42df8c8b07d46ee3bb4c2cafeca436b2e6bc6ccbe4581f58f40` |
| GNU ls (`/usr/bin/ls`)                                |     151,344 | `cb30d69b24245bf2ecdc9e7f53bbad19159999970b6d82c0c00c7d32d9e37aa4` |

`byte-entropy-oracle.py` independently computes Python byte histograms,
Shannon entropy, selected blocks, rounded-value run classifications and digests.
It checks file state around its reads. Every returned fact agrees with this
oracle, and both lanes have identical complete report hashes and Evidence IDs.

There are three alternating fresh production stdio MCP sessions per lane/case,
18 tasks total. Each discovers all 222 tools, uses exact discovered
`toolDefinition` validation, inspects the bytes, exports the complete Evidence
bundle and verifies its parent record. Fresh HOME/client/server, Node compile
cache disabled, OS caches unflushed. These are fresh sessions; no warm-runtime
speedup is claimed. Cached-catalog SDK bulk validation was not measured here.

| Task (3 samples per lane)                                   | Whole elapsed median, s | Family CPU median, s | Kernel family peak median, MiB | Whole-task estimated tokens |
| ----------------------------------------------------------- | ----------------------: | -------------------: | -----------------------------: | --------------------------: |
| LLVM: 256-byte blocks, offset 3, length 65,539 (257 blocks) |          29.842 → 8.584 |       25.286 → 6.358 |                  629.5 → 672.4 |             62,000 → 62,000 |
| LLVM: whole file, 65,536-byte blocks (1,883 blocks)         |         12.314 → 12.115 |        7.581 → 7.325 |                  667.9 → 674.3 |             91,900 → 91,900 |
| ls: whole file, 256-byte blocks (592 blocks)                |           7.075 → 8.286 |        5.804 → 5.528 |                  659.1 → 659.3 |             67,215 → 67,215 |

The large fine-resolution task improves elapsed median by 71.2% and CPU by
74.9%. Elapsed ranges are 28.541–33.290 → 7.981–10.396 seconds; CPU ranges
23.600–25.429 → 6.049–6.633 seconds. Its kernel peak increases by about
43 MiB (ranges 620.4–637.5 → 665.7–673.2 MiB). This is a speed/CPU improvement
with higher measured peak memory, not a memory optimization.

The other controls do not establish a stable whole-task speedup. The small
file's elapsed median is worse; ranges overlap at 6.469–9.892 → 6.169–9.188
seconds. No general latency or memory benefit is claimed. Full-file reading
and hashing remain necessary even when the selected window is short or empty.

A separate single real-file service probe delegated to actual `open/stat/read`
while counting reads: 481,955 → 1,885 physical reads of all 123,379,936 bytes,
maximum request 256 → 65,536 bytes, service elapsed 17.09 → 1.34 seconds.
The complete Evidence objects were equal and independently checked. This probe
locates the work removed; it is not the repeated public-task performance table.

The [machine-readable report](./byte-entropy-reads.json) preserves ranges,
per-sample phase timings, calls, receipt hashes, artifact identities and commands.
`cl100k_base` via tiktoken 0.14.0 counts the fixed question, server instructions,
all tool names/descriptions/input schemas once, every argument and every text
reply including export. Input-directory cost is 56,685 tokens; raw catalog with
output schemas is separately 838,375. Actual model billing, host framing/replay,
model reasoning quality and inference latency were not measured. No token saving
is claimed: replies and catalog remain unchanged.

## Resource and correctness verification

All tasks ran serially under a one-CPU quota, 3 GiB early memory stop, 4 GiB hard
limit, zero swap and 192-task ceiling. Whole process-family CPU and kernel memory
peak include client/server, runtime fingerprint reads, serialization, source
export and cleanup; kernel peak includes charged file cache. Independent oracle
generation and tokenization are outside timed tasks. Payload exits, remaining
owned processes and memory/PID-limit events were checked: all task payloads
exited 0, cleanup verified, no guard stop/OOM. Final whole-scope counters were
unavailable after transient-scope removal and are not represented as verified.

Executed additional checks:

- Six real CLI calls (three cases in both lanes): every oracle fact, complete
  CLI Evidence equality and matching MCP parent identity passed.
- 36 tests in four exact source/public-boundary files passed, including short
  reads, unaligned windows across buffers, partial tails at minimum/intermediate/
  maximum block sizes, empty windows, cancellation through finalization,
  identity changes, capacity refusal, retained summaries and cleanup retry.
- Six serial static tasks (typecheck, lint including module boundaries, format,
  knip, metadata and required compilation), plus architecture guards passed.
  Static family peak was 1.96 GiB; focused-test/preparation peak was 2.15 GiB.
- An initial typecheck failure in the new short-read test's injected callback
  was fixed with an explicitly typed positional boundary. Its failed receipt is
  retained, not counted as a successful run. Initial local formatter path and
  early profile verification attempts also failed before their intended checks;
  corrected checks are recorded separately.

The public experiments qualify static byte inspection on these Linux files.
They do not establish behavior on every filesystem or operating system and do
not execute LLVM or ls. CLI/MCP contracts, Evidence fields, input limits and
provider authority remain unchanged; generated catalogs and builds are ignored.

After integrating main `21a20306b`, the six serial static tasks, architecture
guards and all 36 focused cases passed again. Three fresh real MCP/source-export
tasks and three CLI calls matched every oracle fact and the frozen cohort's
report/parent identity. The integrated test/preparation family peaked at
2.23 GiB with verified payload exit/cleanup and no guard stop/OOM. These are
integration qualification runs; they do not replace the fixed performance pins.
The committed cost verifier also reproduced the complete measurement JSON.

## Reproduction

Build both pinned checkouts using their locked toolchain, serially. Supply an
independent installed dependency tree matching the lock, without upgrading host
software. Use the exact artifact digests above. The oracle accepts explicit
`--path`, `--block-size`, `--offset`, `--length` and `--output`; omit length for
the two whole-file controls. For example:

```sh
python3 experiments/analysis-efficiency/byte-entropy-oracle.py \
  --path /usr/lib/x86_64-linux-gnu/libLLVM-16.so.1 \
  --block-size 256 --offset 3 --length 65539 --output /absolute/oracle.json
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/byte-entropy-reads.mjs \
  --runtime /absolute/pinned-checkout --oracle /absolute/oracle.json \
  --identity /absolute/runtime-identity.json --output /absolute/new-task-directory
```

Runtime identity JSON contains `source_revision`, `source_clean`,
`node_sha256` and `files: [{path, sha256}]` with absolute paths. Fingerprint the
entire compiled runtime and catalogs, scripts, lock/toolchain files, actual SDK
JavaScript dependencies and the driver/helpers. Both sessions must use the same
Node and dependency contents. Use the same one-CPU/memory policy for the harness;
the historical runs additionally pinned the payload to CPUs 0–1 and the initial
observer to CPU 15. Do not compare an unguarded default-concurrency run as an
equivalent resource measurement.

Retained raw receipts are on the investigation host at
`/tmp/rea-perf-byte-entropy-20261024/`. This includes `cohort/index.json`,
per-task catalog/transcript/report/source export/guard logs, runtime identities,
three oracle JSONs, CLI stdout/stderr, boundary profiles and verification logs.
The cost verifier takes that receipt directory and a separate output:

```sh
python3 experiments/analysis-efficiency/byte-entropy-costs.py \
  --receipts /absolute/receipt-directory --output /absolute/costs.json
```

It requires all 18 successful verified samples, matching parent/report/catalog
identity across lanes, successful source exports and oracle/runtime receipts.
Failed or stopped attempts cannot enter the published cohort.
