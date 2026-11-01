# Linux Hopper embedding-runtime qualification

This follow-up to the [string-record audit](hopper-string-records.md) resolves
[#5015](https://github.com/morluto/rea/issues/5015): a successful package install
could leave Hopper unable to start its Python bridge. This is a prerequisite
correctness fix. It does not establish faster equivalent investigations.

## Reproduction and owning correction

Baseline REA `093ce695f0a7c3407c7fde520ed8b20c0981b408` ran the actual public
`rea setup --yes --install-hopper --format json` in a fresh Ubuntu Base root,
with full Linux UID/GID support, successful strict APT metadata refresh,
default APT recommendations and unchanged vendor post-install scripts. Setup
reported `ready` and `installed_hopper`; `dpkg --audit` was empty. Python 3.12
was configured, but its reported `/usr/lib/x86_64-linux-gnu/libpython3.12.so.1.0`
was absent. The signed Hopper package did not declare this dependency.

An actual public MCP control-ELF workflow then timed out at its selected
30-second startup budget. Installing only `libpython3.12` resolved to
`libpython3.12t64` version `3.12.3-1ubuntu0.17`: one new package, no upgrades or
removals. The unchanged REA runtime and target then completed all 13 calls.
The independent earlier bootstrap dialog and controlled package intervention
support the embedding-dependency diagnosis; timing alone does not.

The shared Linux installer now asks `/usr/bin/python3` for its version and
shared-library location after the original package transaction. It attempts an
actual load. For a missing standard Ubuntu ABI/layout it installs the matching
versioned library and verifies loadability again. APT success alone cannot
establish readiness. Unknown metadata, alternate prefixes and alternate SONAMEs
retain an explicit unknown diagnosis instead of guessing a package.

Doctor consumes the same fresh, bounded producer, retaining both private-display
and Python observations. Its Python facts concern the system interpreter;
the interpreter actually selected inside Hopper remains unknown. The query
uses isolated Python mode, disables site hooks and bytecode writes, has a
10-second work deadline and 64-KiB output bound, and is not cached: package/interpreter
changes must be visible immediately. The approval plan discloses the conditional
package change without returning the probe program. Existing MCP analysis
contracts and Evidence semantics are unchanged.

Cancellation prevents starting another install stage and preserves the original
reason. A running package transaction is allowed to settle, avoiding forced
interruption of dpkg. This qualifies the install API's signal behavior through
boundary tests; it does not claim new CLI interrupt plumbing or actual
interruption of a real package transaction.

A review follow-up preserves cancellation through doctor as well. A cancelled
Python probe now raises the existing domain cancellation error with its original
reason and completed private-display observations; the owned doctor workflow
performs cleanup and attaches any cleanup failure. It no longer becomes an
ordinary unknown diagnostic. The probe also opts into the existing
stop-and-wait supervisor: cancellation and timeout wait for Python to exit,
with the shared five-second grace period and forced-kill fallback. A real
Python fixture holds its SIGTERM handler until the test releases it, checking
that the probe retains ownership until exit. The success-path native measurements below precede
this error-branch correction. Its boundary tests cover both successful cleanup
and cleanup refusal; final-head validation is tracked on the PR. A pre-fix red
execution and a final-head native rerun are not claimed.

## Pinned environment and artifacts

Native success measurements pin the initial fix at
`0c70be0030f6bb821c4292c4f5b7f776b365c8ec`, based on main
`23f984b1a884baefc3c44e4ab697f6eff61dffb6`.
The measured runtime and bridge manifest covers 1,733 regular files, 26,537,393
bytes. Its SHA-256 is
`8800edc8e70965ae2132e57ca6d999ba276503f27f1045b33305c83cd0e2ff2a`
(sorted paths, compact sorted-key JSON records containing path, bytes and
SHA-256). The tiny MCP loader alone is not a whole-runtime identity.
Earlier prototype runs have a separately recorded manifest; they are not
presented as executions of that same artifact.

- Node 24.18.0; npm 11.16.0; Debian 12 x86-64 host.
- Official [Hopper 6.6.0 Linux demo](https://www.hopperapp.com:443/downloader/public/Hopper-6.6.0-Linux-demo.deb),
  35,748,722 bytes, SHA-256
  `59705e50f7ebf9104abe1e72ac3949bed1a8e43ec67a8c9510a1c5056c200d27`.
  REA's real publisher verifier authenticated signing fingerprint
  `7C2D73BAFAF5B9A710A69DA1A26DF815099B1BCD`; launcher SHA-256
  `b2271008fb82bf14cfae5c3644cdde2b11fc6804bd7c99d67032ec1b1942d53c`.
- Private [Ubuntu Base 24.04.5 root](https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.5-base-amd64.tar.gz),
  SHA-256 `e77b6f10c2590cef872b33ee9f635a0e3fd1f57fb074c0e52b5c7f56147a0c86`,
  matched its official HTTPS checksum; its publisher signature was not
  independently verified. The host glibc 2.36 cannot run this Hopper package;
  the private root supplies glibc 2.39. Related packages were installed only
  there. Strict refresh used `APT::Update::Error-Mode=any`.
- Small control ELF: 17,360 bytes, SHA-256
  `1a6f55303712e096ff5196c7fd6e8acf75473fbf0f7467d7b315f96f50b3f841`.
  GNU objdump independently maps the arithmetic at `0x401126` to
  `arg0 * 7 + 13`; the original build flags were not recovered. The known
  `rea_jeb_native_probe` literal has one native string hit.
- Shipped Debian SQLite 3.40.1-2+deb12u2, `libsqlite3.so.0.8.6`, 1,437,848
  bytes, SHA-256
  `2e6eef9a727f081f0d453b4e5e6cbd8b9ef8b6f86cbf7681cbad444d3b0b55c8`.
  Independent objdump identifies `sqlite3_libversion_number` at `0xa1d50`,
  returning `0x2e6301` (`3040001`). This is a shipped library qualification,
  not a claim about current SQLite versions or whole-program correctness.

## Actual workflows and measurements

The accompanying [receipt](hopper-linux-python-runtime.json) preserves native
stage outcomes, elapsed time, CPU time, peak memory, cleanup and token-estimate
scope, including failed and stopped attempts. Installation uses root inside the
owned fixture. Final analysis also uses a normal UID 1004 with a separate home
and the authenticated public publisher evidence copied unchanged into that
user's cache; production verification still checks it. No target was executed
or modified. Non-root package installation through real pkexec authorization,
custom Hopper Python configuration, native Debian installation and other
operating systems remain unverified.

Fresh final setup reported `ready` / `installed_hopper`, installed the matching
shared library, left `dpkg --audit` empty and passed actual public doctor.
Final normal-user sessions completed the positive, repeated, negative and
decompilation checks: 19 `sqlite_master` matches in 1,437 recognized strings,
74 broader `sqlite` matches and the expected version constant. Both CLI runs
matched their MCP facts and Evidence identity; both target files stayed unchanged.

| Stage / outcome                                | Elapsed (s) | Native CPU (s) | Native peak (MiB) |
| ---------------------------------------------- | ----------: | -------------: | ----------------: |
| Baseline setup: ready, library absent          |      75.353 |         39.002 |            1395.4 |
| Baseline control MCP: startup timeout          |      49.541 |         24.158 |            1282.5 |
| Install only matching libPython                |       5.012 |          1.925 |             174.8 |
| Unchanged runtime control MCP: passed          |      24.791 |         23.608 |            1228.4 |
| Fixed fresh setup: ready                       |      80.739 |         40.404 |            1382.6 |
| Fixed public doctor: healthy                   |       6.035 |          5.160 |             560.9 |
| Fixed normal-user control MCP: 13 calls passed |      24.434 |         23.305 |            1195.7 |
| Fixed normal-user SQLite MCP: 16 calls passed  |      92.504 |         90.138 |            1507.2 |
| Fixed normal-user control CLI: parity passed   |       8.981 |          7.831 |             613.5 |
| Fixed normal-user SQLite CLI: parity passed    |      70.207 |         68.704 |             781.6 |

Each control MCP session includes discovery and 13 calls: open, status, first
literal query, six repeats, absent query, procedure listing, decompilation and
close. SQLite uses 16 calls: a known exported address avoids a separate name
lookup, and full native string inventory, broader query, regex, case and absence
checks are included. Applicable returned string bytes are checked against the
file. Warm queries must preserve facts and Evidence ID. CLI searches compare
normalized facts and Evidence ID with their corresponding MCP result. Both
target digests are checked after the task.

“Fresh” means a new installation state or Hopper process, as indicated; OS
caches were not flushed. Installation fixtures preload 247 previously fetched
APT archives (138,023,324 bytes) without installing packages. These are not
cold-network benchmarks. The baseline failure and successful repair are
different outcomes, not a paired speedup. This change adds no analysis cache
and makes no token reduction or complex-investigation advantage claim.

Native stages have a 6-GiB container cap, 5-GiB early stop, no swap, 128 tasks,
one CPU and explicit affinity. Their separate controller has a 512-MiB cap,
no swap and 64 tasks. Native plus controller caps total 6.5 GiB. Heavy tasks
run serially; admission waits for at least 16 GiB host availability and aborts
below 8 GiB. Host build/check stages have an 8-GiB cap and 7-GiB early stop.
No other user's processes were signalled.

Native CPU and kernel memory peaks include the container guardian and observer.
Payload-exit observations verify no analysis children remain before stopping
the container. Controller counters are separate partial snapshots; adding
separate peaks is only an upper bound, not a simultaneous measurement. Shared
Docker daemon, containerd and system-manager costs and final counters after
scope removal are unknown. Stopped attempts without payload-exit observations
retain unknown cleanup/counter fields. Observed zero OOM counters at payload
exit are not a claim about the whole host.

## Failed attempts and limits

- A single-ID namespace could not apply the real vendor/package UID/GID
  ownership changes. It did not qualify a successful installation.
- An inherited container-loopback proxy prevented publisher downloads; the
  fixture was corrected to forward the same configured proxy through the
  owned bridge gateway. No global proxy configuration was changed.
- An early APT refresh exited zero with failed-index warnings. It was not
  counted as a successful refresh; the strict clean run establishes the result.
- One earlier setup was stopped by the host-memory guard during unpacking.
  Its interrupted package state was retained separately; clean fixtures were
  used for the qualified baseline and final installations.
- SQLite exceeded a caller-selected 30-second startup budget. With the normal
  120-second budget the bridge started, but an initial `libc` positive oracle
  failed: those `.dynstr` bytes were not a recognized Hopper string. The
  corrected native positive is `sqlite_master`. These attempts remain in the
  receipt. Empty recognized-string results do not prove physical absence.
- Early candidate compilation found a TypeScript signal-narrowing error; the
  fix reads live signal state through a helper. Lint found oversized new test
  groups; they were split by behavior. Failed checks are retained as failures.
- Full local fast checks were stopped twice when other host workloads reduced
  available memory. Those attempts did not pass; complete CI and later executed
  checks must be reported separately.
- Local package verification completed installation, update, module loading,
  discovery and several CLI stages, then the same host-memory guard stopped it
  during setup/uninstall after 336.196 seconds (sampled peak 1,742,426,112
  bytes). This is an incomplete package gate, despite the separately completed
  real Hopper setup and analysis workflows. Its payload-exit counters and
  cleanup observation are unknown. CI must complete this gate before merging.

Offline `cl100k_base` estimates include each discovered full catalog, named
arguments and raw replies once per recorded session, plus selected CLI arguments
and stdout. Raw MCP replies can contain both text and structured copies.
The final control and SQLite MCP validation transcripts estimate 845,126 and
1,064,574 tokens respectively, including 805,330 catalog tokens each. The CLI
rows estimate 695 and 2,905 tokens for one selected search each. Those CLI rows
cover different tasks from the multi-call MCP qualification sessions, which
also include full-inventory validation; they do not form an interface-efficiency
comparison. Failed attempts and retries have separate rows in the receipt.
Actual agent/model usage, host schema filtering, protocol framing, prompts,
rendering/replay, independent oracle context and unrecorded in-flight failures
are unmeasured. This is provider qualification, not an agent benchmark.
