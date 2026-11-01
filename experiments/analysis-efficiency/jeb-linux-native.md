# JEB Linux CE native workflow checkpoint

This checkpoint qualifies Linux CE setup and selected native reads for
[#4996](https://github.com/morluto/rea/issues/4996). It changes documentation;
it does not introduce a provider cache or claim a before/after speedup.
The existing shared CLI/MCP implementation returned consistent facts and
Evidence, with one metadata request per persistent MCP task. Further wrapper
caching is not justified by these measurements.

## Pinned inputs and scope

Baseline: REA 6.6.0 at `7c458f04b9155707c8ba406f8b455b10016f1b99`, Node 24.18.0,
npm 11.16.0, Temurin 21.0.12.1, Linux x86-64
`6.1.0-53-cloud-amd64`. All six final sessions used the same compiled MCP
runtime digest, recorded in the [curated receipt](jeb-linux-native.json).

The official CE archive was obtained through
<https://www.pnfsoftware.com/dl?jeb4ce>: 697,549,250 bytes, observed SHA-256
`709e7fe8e88bb0e9e2bc03b028f8b9fc78cec0289d04abe54fc26cda6369e175`.
HTTPS download and ZIP CRC checks completed; a publisher signature was not
independently verified. This distribution identifies as
`5.48.0.202610071539`, serving MCP 1.3.0. The installation and first-use
activation remained private; no engine binaries, keys or raw decompilation
are included here.

| Artifact                                                 |     Bytes | Independent check                                                             |
| -------------------------------------------------------- | --------: | ----------------------------------------------------------------------------- |
| Authored C ELF, ET_EXEC                                  |    17,360 | Source arithmetic and GNU `nm` symbol                                         |
| Debian `libsqlite3.so.0.8.6`, package `3.40.1-2+deb12u2` | 1,437,848 | GNU `nm` and `objdump`: exported version function returns immediate `3040001` |

Target SHA-256 digests:

- Fixture: `1a6f55303712e096ff5196c7fd6e8acf75473fbf0f7467d7b315f96f50b3f841`.
- SQLite: `2e6eef9a727f081f0d453b4e5e6cbd8b9ef8b6f86cbf7681cbad444d3b0b55c8`.

Neither target was executed. The fixture's expected arithmetic was `input * 7 + 13`.
That check does not establish inferred ABI, signedness or equivalence for every
input. SQLite's constant-return oracle is also narrower than complete-program
correctness.

## Setup and item identity

The current official CE build successfully accepted `-c --mcp`, using
`--interface=127.0.0.1`, a dedicated port and `--infile` for the selected ELF.
This agrees with the [current upstream MCP manual](https://www.pnfsoftware.com/jeb/manual/mcp/).
The earlier documented licensed-build result used a programmatic launcher;
its CLI behavior should not be generalized to all 5.48 distributions.

Code-item references also need their owning representation. The CE native
`list_code_items` tool returned `sqlite3_libversion_number` for a filtered
method query. That exact reference succeeded through REA. Earlier raw ELF
address attempts did not complete successfully. A numeric reference did work
for the authored ET_EXEC pilot, so neither observation establishes a universal
numeric-address rule. Preserve the engine's reference and explicit unit path;
keep file offsets and independently obtained ELF addresses separate.

The native CE catalog advertised 27 tools. REA currently exposes four JEB
operations; native code-item discovery is not among them. The final tasks
therefore start with a known reference. This is a selected-read qualification,
not a complete method-discovery or provider-parity comparison.

## Completed workflow and accounting

Three alternating fresh-engine sessions per artifact completed the same task:

1. Start the private headless engine; prove that its child PID owns the
   selected IPv4 or mapped-IPv6 loopback listener before connecting.
2. Connect the production stdio MCP runtime and discover its full catalog.
3. Inspect JEB, list all three units, then concatenate four one-item pages
   including the empty remainder and compare with the original listing.
4. Decompile the selected method, check the independent oracle and complete
   inline Evidence, then repeat it six times with identical facts and Evidence IDs.
5. Check a missing item returns an error; make one real CLI query and compare
   its normalized facts, raw text and Evidence ID with MCP; close the client.
6. Verify target bytes are unchanged and the borrowed engine survived REA
   cleanup, then stop the harness-owned engine.

Each task made 15 public MCP calls and one CLI parity query. Request tracing
observed one upstream catalog walk, one `get_client_information`, five
`list_units` and eight `decompile_code_item` calls. Explicit metadata refresh
and reconnect behavior were not part of this repeat-read measurement.
Tracing covered the production MCP child; the separate CLI query's upstream
requests were not instrumented.
Evidence retained `subject: null` and the artifact-identity limitation;
an independent native project-digest observation was not substituted for
identity atomically bound to each read.

All heavy work ran serially inside a cgroup v2 family with an 8 GiB hard cap,
7 GiB early stop, one CPU quota and affinity, and zero swap. Startup required
16 GiB host availability; a running task would stop below 8 GiB. The JVM used
`-Xmx1536m -XX:ActiveProcessorCount=1`; the production MCP child used a
2048 MiB Node heap, and the harness/CLI inherited a 3072 MiB Node heap limit.
These are audit settings, not general engine-size recommendations.

OS and vendor file caches were not flushed. “First” means the first selected
function read in a fresh JVM; “warm” means repeated reads in that same engine.
The private fetch observer recorded request names and byte counts without
cloning response bodies; its overhead is included.

Whole-task counters include the JVM, MCP client, production runtime, CLI
parity, native oracle and cleanup, including cgroup-charged file cache.
Host-admission wait is recorded separately. Outer guard/systemd-manager costs
were not measured. Payload-exit counters and cleanup were verified while an
observer remained alive; disappeared final whole-scope counters remain unknown.

## Measured costs

Medians with observed minimum–maximum across three completed sessions:

| Cost                                     |               Authored ELF |             Shipped SQLite |
| ---------------------------------------- | -------------------------: | -------------------------: |
| First selected MCP read                  |      4.134 s (3.845–5.037) |   24.508 s (22.823–49.977) |
| Six warm MCP reads, total                |     253.2 ms (113.4–842.9) |     190.0 ms (160.9–416.9) |
| Whole guarded task elapsed               |   27.638 s (26.749–32.622) |   48.296 s (45.625–82.039) |
| Whole family CPU                         |   27.291 s (26.399–32.155) |   47.753 s (45.370–78.877) |
| Kernel family peak, including file cache | 1540.1 MiB (1531.5–1614.9) | 1799.6 MiB (1714.7–1865.8) |

The slower third sessions remain in the results. Their extra elapsed and CPU
costs are unexplained; no favorable resampling, stable latency improvement or
memory reduction is claimed. Warm reads are already short relative to first
reads. Adding another live-project cache would introduce identity and
invalidation obligations without a demonstrated bottleneck here.

All six completed payloads recorded zero memory-limit, task-limit, OOM and
OOM-kill events. This is a payload-exit observation, not a claim that missing
final counters equal zero.

## Context estimates

The unchanged production catalog contained 207 tools, 3,158,927 serialized
bytes, SHA-256
`a1851aa1bfe3d72d6be6bec130519dbdfc1ee49288320cfac0144ced77755c61`.
An offline tiktoken 0.12.0 `cl100k_base` count assigned 805,330 tokens to one
raw catalog page-array in every session.

| Estimated serialization                              | Authored ELF median | SQLite median |
| ---------------------------------------------------- | ------------------: | ------------: |
| Catalog + named MCP arguments + raw replies          |             814,268 |       814,878 |
| Above, plus selected CLI arguments and parity stdout |             814,610 |       815,249 |
| MCP text reply blocks alone                          |               3,957 |         4,203 |

Raw replies contain both text and structured copies. These counts describe
the validation exchange, including its extra pagination, repeated and negative
queries. Actual model usage, prompts, protocol/initialization framing, client
filtering/rendering/replay, shell framing and context for independent oracles
were not measured. No model-token savings or complex-investigation advantage
is established. Catalog delivery is a shared concern; existing
[PR #3026](https://github.com/morluto/rea/pull/3026) already explores family
selection and is outside this checkpoint.

## Preserved attempts and verification limits

The JSON receipt retains costs and outcomes for all earlier attempts:

- Three host-memory refusals happened before scope/payload creation.
- First-use EULA and missing-key attempts exited before analysis. Although
  JEB exited zero, the harness correctly reported failure.
- The 30-second raw-address SQLite attempt returned typed `provider_timeout`;
  the 60-second raw-address attempt returned an upstream refusal. Neither is a
  completed benchmark or proof of a REA defect.
- A producer-reference SQLite read succeeded, but the initial test oracle
  rejected its valid C `L` integer suffix. The oracle was corrected before
  the final cohort; that incomplete workflow and its cost remain recorded.
- Setup, diagnostic help, successful pilots, native discovery checks and
  offline tokenizer work are recorded separately from the final cohort.

This audit does not qualify CE Java/Android decompilation, GUI project opening,
Windows/macOS, more than 100 units, real caller cancellation, or recovery after
engine restart. Existing reconnect/invalidation work is
[PR #3754](https://github.com/morluto/rea/pull/3754). The selected function and
constant checks do not establish broader software-analysis effectiveness.

## Release 6.7.0 integration control

Main advanced to `a25eb5fbb424197cb8e699e15a82a6ff869658aa` during review.
The branch rebased onto that release checkpoint, rebuilt, and passed
`docs:check` plus uncached typecheck/lint. Two additional fresh-engine public
workflows passed against `837718b1968b5fd90762c4c54895b11e9f5478fd`: one
authored ELF and one shipped SQLite, adding 30 MCP calls and two CLI parity
queries. They verify the rebuilt 6.7.0 runtime and remain separate from the
six-session performance cohort above. Their runtime/catalog digests and
process-family costs are recorded in the JSON receipt.

The first additional SQLite attempt was stopped after 28.244 seconds when
host available memory fell below the unchanged 8 GiB stop threshold. Final
scope limit/OOM counters were observed as zero; payload-exit counters were
unavailable, so that attempt is incomplete. Its sampled peak is not a kernel
peak claim. Target bytes remained unchanged. The successful retry used a
stricter 24 GiB admission wait with the original 8 GiB family cap, 7 GiB early
stop, one CPU and zero swap. No failed attempt was replaced or counted passed.

## Reproduction entrypoints

The small source fixture was compiled with `gcc -O1 -g -fno-pie -no-pie`:

```c
#include <stdio.h>
__attribute__((noinline)) int rea_probe_value(int input) { return input * 7 + 13; }
int main(void) { puts("rea_jeb_native_probe"); return rea_probe_value(4) == 41 ? 0 : 1; }
```

Its recorded digest pins the tested build; debug/source paths can change a
rebuilt binary's digest. The source expression and independently resolved
symbol remain the fixture oracle.

From the caller's JEB directory, after completing its official first-use setup
and selecting JDK 21 through `JAVA_HOME`:

```sh
"$JAVA_HOME/bin/java" -Xmx1536m -XX:ActiveProcessorCount=1 -jar bin/app/jeb.jar -c --mcp \
  --interface=127.0.0.1 --port=18425 \
  --infile=/usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6
```

In the pinned REA checkout, with the pinned Node toolchain and built runtime:

```sh
export REA_JEB_MCP_URL=http://127.0.0.1:18425/mcp
export REA_JEB_MCP_TIMEOUT_MS=60000
node scripts/rea.mjs inspect-jeb-client --json
node scripts/rea.mjs list-jeb-units --count 100 --json
node scripts/rea.mjs decompile-jeb-item sqlite3_libversion_number method \
  --unit-path libsqlite3.so.0.8.6/libsqlite3.so.0.8.6/x86_64-image --json
nm -D --defined-only /usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6
objdump -d --disassemble=sqlite3_libversion_number \
  /usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6
```

The listed commands reproduce individual reads and the file oracle; the
full measurement also used the MCP sequence and process-family observer
described above. JVM heap flags alone do not impose its family/host guards.
Private raw transcripts and engine documents are excluded from the repository.

The baseline gate passed `npm run docs:check`, `npm run check:fast` and
`git diff --check`; its typecheck/lint were cache hits. The release integration
gate above also passed with uncached typecheck/lint. The first gate attempt was refused
before scope creation; the admitted gate passed under the unchanged bounds.
The runtime results above were executed against the pinned baseline.
