# Hopper literal search: reuse decoded records

For [#5010](https://github.com/morluto/rea/issues/5010), the bridge now keeps
the existing decoded records in its sorted search inventory and projects only
matches. Previously, every positive literal search called `_string_inventory`
again, sorting all native object addresses and building another complete map
before selecting records. The value-only `_strings` representation and the
intermediate match list have been removed.

This removes repeated work at its owner. Three paired SQLite workflows found
shorter warm queries, but **did not demonstrate an overall task speedup**:
whole elapsed and CPU were worse. Token estimates were effectively unchanged; no memory
improvement was established. The [curated receipt](hopper-string-records.json)
keeps individual measurements, equality checks and failed attempts.

## Representation and reuse boundary

The existing `(id(document), kind)` search cache now holds references to full
records rather than just their decoded values. The existing string-record
owner still performs byte decoding, encoding inference and unknown handling.
Matching reads `record.value`; output copies the selected record with its
address, retaining native display, encoding/extent metadata and decoding
failures. The original document lifetime and annotation invalidation apply.
This does not add another cache or duplicate decoded payloads. Both CLI and
MCP use the same bridge through the existing application workflow. Regex keeps
its supervised worker implementation.

The lookup remains a linear scan of recognized native strings. A complete
inventory is still decoded for the first exhaustive search, and returned hits
still consume output and retained Evidence. This change does not introduce
pagination, broader binary string discovery or a new context contract.

## Pinned real-provider scope

Baseline: REA 6.7.0 at `c12d9eda87aa5a022ee7e18ea96d8d03bfd12e96`, Node
24.18.0, Debian 12 x86-64, Linux `6.1.0-53-cloud-amd64`. All paired tasks used
the same compiled runtime SHA-256
`0809b5004f214efa4b79775d5fda796eaecf4ad5756c55ee3b9d7cf82d91b750`.
Baseline and candidate bridge digests are recorded separately in the receipt;
the baseline file was mounted read-only over the bridge for baseline runs.

The official [Hopper 6.6.0 Linux demo package](https://www.hopperapp.com:443/downloader/public/Hopper-6.6.0-Linux-demo.deb)
was authenticated through REA's production publisher verifier: 35,748,722
bytes, SHA-256
`59705e50f7ebf9104abe1e72ac3949bed1a8e43ec67a8c9510a1c5056c200d27`,
primary signing fingerprint `7C2D73BAFAF5B9A710A69DA1A26DF815099B1BCD`.
The extracted launcher digest was
`b2271008fb82bf14cfae5c3644cdde2b11fc6804bd7c99d67032ec1b1942d53c`.
Normal demo activation used an owned private Xvfb display.

The host's glibc 2.36 could not satisfy this package's GLIBC_2.38 requirement.
Analysis therefore ran in a user-mapped private Ubuntu Base 24.04.5 namespace
with glibc 2.39, Qt6/X11 and embedded Python 3.12. The
[rootfs archive](https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.5-base-amd64.tar.gz)
matched its official HTTPS checksum, SHA-256
`e77b6f10c2590cef872b33ee9f635a0e3fd1f57fb074c0e52b5c7f56147a0c86`;
its publisher signature was not independently verified. Related libraries were
installed only into that private image. Actual `rea setup` and vendor package
post-install scripts were not executed. Native Debian installation and other
operating systems remain unqualified.

| Artifact                             |     Bytes | Independent oracle                                       |
| ------------------------------------ | --------: | -------------------------------------------------------- |
| Small authored C ELF                 |    17,360 | Source `input * 7 + 13` and ELF symbol                   |
| Source-built conformance ELF         |    22,584 | Fixture source, known literal bytes and symbol addresses |
| Shipped Debian `libsqlite3.so.0.8.6` | 1,437,848 | GNU objdump: version function returns `3040001`          |

Artifact digests, compiler and flags are in the receipt. No target was executed.
The small ELF was a baseline setup/decompilation smoke test; the conformance
ELF had baseline/candidate semantic and CLI/MCP checks. SQLite supplied the
repeated performance cohort. A constant-return oracle does not establish
whole-program correctness, ABI inference or complex-investigation effectiveness.

## Completed task and correctness

Each of three baseline/candidate pairs used a fresh Hopper process and the
same public stdio MCP workflow, including catalog discovery and 17 tool calls:

1. Open the SQLite copy and inspect `binary_session`.
2. Search `sqlite_master` in case-sensitive literal mode, then repeat six times.
3. Read `list_strings` as a full-inventory validation oracle; compare all
   matching records, including their metadata, with the selected result.
4. Check broader `sqlite` search, regex, case-insensitive and absent-pattern
   queries against their expected native inventory scope.
5. Resolve `sqlite3_libversion_number`, decompile it, check its constant against
   independent objdump, and close the binary and MCP transport.
6. Verify unchanged target bytes and cleanup of the owned process family.

There were 1,437 recognized string objects, 19 `sqlite_master` matches and 74
broader `sqlite` matches. Applicable decoded hit bytes were also checked
against file contents. All 42 Evidence payloads across the three pairs matched
on normalized and raw facts, identity, subject, provider/profile, authority,
confidence, limitations, relationship coverage, locations and evidence links.
Live environment observations were excluded from cross-session equality.

The real conformance workflows each completed 70 public calls, including six
expected errors. They exercised Unicode symbol identity, literal metacharacters,
case/regex modes, annotation cache invalidation, typed string fragments,
display escaping and source-byte checks using the existing real-provider
verifier. CLI `fragment_tail` search returned the same normalized facts and
Evidence ID as MCP on both revisions (2,293 stdout bytes each).

Native recognition remains qualified: the full 4,120-byte source literal and
some known UTF-8, ellipsis and Latin-1 literals were not recognized. Their file
bytes were verified, while decoded native-object coverage remains unverified.
The fragmented 549-byte source literal was recognized as separate objects;
matching does not pretend to join those fragments. Escaped text and literal
backslash-n were distinguished. Real UTF-16 provider decoding was not qualified;
the focused boundary fixture covers that representation separately. Empty
search results establish absence only within the native typed-object inventory.

## Measurements

Runs were serial and ordered B1/C1, C2/B2, B3/C3. C2 first stopped under the
host memory guard; its separate completed retry supplies the C2 row. OS caches
were not flushed. “Cold” means the first string query in a fresh provider;
“warm” means six repeats within that provider.

Medians across the three completed sessions per revision:

| Cost                                     |    Baseline |   Candidate |
| ---------------------------------------- | ----------: | ----------: |
| Per-run median warm query                |   14.849 ms |   12.628 ms |
| Six warm queries, total                  |  100.202 ms |   75.552 ms |
| Whole SDK workflow                       |    86.583 s |    90.786 s |
| Whole guarded workflow                   |    89.384 s |    93.630 s |
| Family CPU at payload exit               |    88.333 s |    92.590 s |
| Kernel family peak, including file cache | 1,438.4 MiB | 1,440.0 MiB |

Warm-query medians were lower in all three pairs, although one baseline run
was particularly variable. Whole guarded elapsed was about 4.7% worse and CPU
about 4.8% worse. The first query accounted for 65.2–71.2 seconds on baseline
and 72.3–77.5 seconds on candidate; that interval includes native preparation.
Do not interpret this cohort as end-to-end acceleration or dismiss the
unfavorable rows.

A separate pair moved the **existing** `procedure_address` call before the
first string search, keeping the same 17 calls and equivalent facts/Evidence.
Most preparation cost then occurred in that unchanged lookup: 67.949 seconds
baseline versus 94.358 seconds candidate, before the changed search path ran.
The subsequent first string query took 329.254 versus 337.533 ms; total guarded
elapsed was 89.096 versus 113.917 seconds. This locates substantial cost outside
literal projection and preserves the negative whole-task result. It does not
prove its cause, establish a cold-query improvement or justify pooling the
reordered pair with the original cohort.

## Resource and context accounting

Every heavy task used an owned cgroup v2 family: 8 GiB hard limit, 7 GiB early
stop, zero swap, one CPU quota and affinity, 192 tasks, 3,072 MiB Node heap,
and one heavy job at a time. Host admission required 16 GiB available; tasks
stopped below 8 GiB. Later long runs added admission at 24 GiB sustained for
20 seconds without relaxing the family guard.

Family counters include the namespace, native engine, MCP client/runtime,
validation and cleanup, including charged file cache. SDK wall time includes
catalog discovery and correctness assertions. Admission wait is outside the
guarded time and recorded separately where available; older waits and outer
guard/systemd costs were not measured. Payload-exit CPU, kernel memory peak,
limit counters and owned cleanup were verified while an observer remained.
Final counters after the scope disappeared remain unknown. Completed paired
payloads observed zero memory-limit, OOM/OOM-kill and task-limit events.

The unchanged catalog advertised 207 tools, 3,158,927 serialized bytes,
SHA-256 `a1851aa1bfe3d72d6be6bec130519dbdfc1ee49288320cfac0144ced77755c61`.
Offline tiktoken 0.12.0 `cl100k_base` estimates for every completed SQLite
comparison were effectively unchanged (medians across three runs):

| Serialization counted once                         | Baseline estimate | Candidate estimate |
| -------------------------------------------------- | ----------------: | -----------------: |
| Full catalog page array                            |           805,330 |            805,330 |
| Named tool requests                                |               361 |                361 |
| Raw replies                                        |           259,809 |            259,811 |
| Total above                                        |         1,065,500 |          1,065,502 |
| Text reply blocks alone, overlapping the raw count |           126,832 |            126,833 |

Whole raw estimates ranged from 1,065,496–1,065,500 on baseline and
1,065,500–1,065,506 on candidate. The small variations include live environment
observations; there is no context reduction.

The full inventory and extra controls are validation overhead included in
these totals. Raw replies may contain text and structured copies. Actual model
usage, prompts, initialization/protocol framing, client filtering/rendering or
replay and independent-oracle context were not measured. The receipt separates
other tasks and the interrupted transcript's persisted lower bound; it does
not count an unrecorded in-flight request or reply as observed. No model-token
saving or agent-reasoning advantage is claimed.

## Failed attempts and verification

The receipt preserves setup, diagnostic, failed and completed costs separately:

- Initial private-rootfs configuration failed on an unmapped package GID, then
  on the harness PATH; ordinary pending configuration completed successfully.
- One low-host-memory probe was refused before creating a payload.
- The first MCP harness used a relative path, correctly refused by the public
  input boundary. A later custom-runtime launch lacked libXtst6, which the
  production dependency list already includes. Both were harness/setup errors.
- Two unchanged-baseline launches timed out at bridge startup. An owned-display
  observation showed completed native analysis but a Python bootstrap failure.
  Adding only the missing embedded Python library made the baseline pass;
  [#5015](https://github.com/morluto/rea/issues/5015) records the separate
  installer dependency hypothesis and its unverified actual-installer scope.
- C2 stopped after 82.607 seconds when host available memory crossed the
  unchanged stop threshold. Its sampled family peak was 1,517,019,136 bytes
  and last observed CPU 78.255 seconds. Payload-exit/final counters are unknown;
  it is incomplete and excluded from completed-run statistics.
- An initial `test:local` invocation rejected built boundary projects before
  running tests. The documented `test:focused` invocation then passed all
  35 tests in five files, covering string search, regex, bridge facade and
  real-provider verifier behavior. Those local tests do not themselves qualify
  a native engine; the public native workflows above provide that evidence.

`npm run check:fast` also passed (typecheck and lint both cached). Build and
metadata preparation passed before the native workflows. `npm run docs:check`
passed its cached metadata checks and all five README consistency tests.

Reproduction uses `node scripts/rea.mjs --mcp` with an explicitly configured
Hopper launcher and private display. Drive the named calls above with absolute
target paths, retain full replies and compare independently verified bytes,
facts and Evidence. For the source fixture, compile
`tests/conformance/c/fixture.c` with
`gcc -O0 -g -fno-inline -fno-omit-frame-pointer -fno-pie -no-pie`.
Debug build paths can change rebuilt artifact digests. The shipped SQLite
digest pins the measured artifact rather than every build of its package.

The focused local gate was:

```sh
npm run test:focused -- \
  tests/boundary/providers/hopper/hopperStringSearch.test.ts \
  src/hopper/HopperRegexSearch.test.ts \
  tests/boundary/providers/hopper/hopperBridgeFacade.test.ts \
  tests/conformance/providers/hopper/realHopperSearch.test.ts \
  tests/conformance/providers/hopper/realHopperExhaustiveSearch.test.ts
```
