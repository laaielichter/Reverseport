# Ghidra Evidence projection

Continues [#5337](https://github.com/morluto/rea/issues/5337). The bridge
adapter supplied a complete `rawResult` for every successful operation, even
when strict parsing preserved the same value in `normalized_result`. Function
observation envelopes repeated their value and already-projected qualifications.
The generic Evidence contract already permits `raw_result: null` in this case.

## Owning change

The Ghidra inventory and function parsers now declare whether they retain an
independent upstream representation. Execution consumes those parsed facts and
named metadata, replacing the positional helper argument that required every
caller to supply another complete report. CLI and MCP use the same projection.

Ordinary inventories and function observations omit the redundant copy.
Limitations, relationship coverage and locations remain canonical Evidence
fields. The following representations remain available:

- The overview's upstream segment permissions, sections and provenance.
- Load-image observations before local attestation and enrichment.
- File-offset selection roles, which generic locations alone do not express.
- The database type reply before adding a locally derived NativeAOT overlay.

No tool, schema, query default, provider protocol, cache, target execution or
annotation authority is added. Existing source Evidence is not rewritten.
New records have the identities appropriate to their new representation;
artifact and procedure identities remain unchanged. Consumers should read
function results from `normalized_result`, rather than `raw_result.value`.

## Real inputs and completed question

Both ELF x86-64 targets are read without executing them:

| Target           |     Bytes | SHA-256                                                            | Provenance                                                                                                                                      |
| ---------------- | --------: | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `true`           |    35,664 | `c79bf44242829108e323378531f4ac839513ca1fba45efd6583643526e1e9fd2` | Installed Debian coreutils 9.1-1; package metadata is a local observation.                                                                      |
| `jq-linux-amd64` | 2,267,912 | `b1c22172dd303f3be49e935aa56aa48a8b7a46e0bc838b4997d3bb451495870f` | [Official jq 1.8.2 asset](https://github.com/jqlang/jq/releases/tag/jq-1.8.2); matches both the corpus and the release API's asset digest/size. |

Each fresh production stdio MCP session discovers the complete catalog, opens
the target, reads documents and the complete observed procedure inventory,
selects the first internal non-thunk procedure, reads overview/load image and
six function operations, repeats inventory/pseudocode, exports Evidence and
closes. This is one catalog discovery and 15 RPCs, including cleanup.
It qualifies this inventory/function-read question, rather than application
feature reconstruction or complete native-code discovery.

The live named SDK contracts validate replies. Each selected record binds to
the original target digest and Ghidra profile. The candidate's complete selected
fact vector equals the baseline after excluding only `evidence_id` and
`raw_result`: subject, parameters, normalized facts, provider/profile, authority,
limitations, relationships, locations and Evidence links remain equal. Exported
records match returned Evidence, repeated facts agree, and target hashes remain
unchanged. This is representation equivalence, not an independent qualification
of every Ghidra interpretation.

## Measurements and limits

Linux x86-64, Node 24.18.0/npm 11.16.0, MCP SDK 2.3.1, Ghidra 12.1.4 and
Eclipse Adoptium 21.0.12.1+1-LTS. Sessions and Java analysis are fresh; OS caches
are warm and unflushed. Configured Java heap is 768 MiB with one active processor.
The whole process family uses one logical CPU, 4 GiB hard/3 GiB early-stop memory,
no swap and 192 tasks. No completed query task has an OOM/limit event or cleanup
failure at verified payload exit. Final whole-scope counters after scope removal
remain unavailable. Post-GC retained heap is unmeasured.

The small pair uses main `4e716b06078d725a53234503cbefbb340731e809` and its
candidate. Main advanced during the experiment; the large pair uses
`3fca2e0ca6e54ba700c286d9a85a9600dee6a19d` on both sides. Existing timing
samples keep their original runtime fingerprints. The [curated receipt](ghidra-evidence-projection.json)
retains individual observations and incomplete attempts; raw data stays outside Git.

| Recording / metric                              |     Before |      After |
| ----------------------------------------------- | ---------: | ---------: |
| `true`: observed procedures                     |        231 |        231 |
| `true`: all RPC result bytes                    |    473,344 |    326,642 |
| `true`: catalog + request arguments + results   |  3,729,626 |  3,582,925 |
| `true`: complete scope wall                     |   34.369 s |   34.901 s |
| `true`: payload-family CPU                      |   33.150 s |   33.834 s |
| `true`: kernel family peak including file cache |  947.9 MiB |  977.7 MiB |
| `jq`: observed procedures                       |      2,279 |      2,279 |
| `jq`: all RPC result bytes                      |  2,375,466 |  1,264,884 |
| `jq`: catalog + request arguments + results     |  5,639,932 |  4,529,351 |
| `jq`: complete scope wall                       |  279.699 s |  399.097 s |
| `jq`: payload-family CPU                        |  277.696 s |  352.660 s |
| `jq`: kernel family peak including file cache   | 1060.0 MiB | 1038.3 MiB |

RPC result bytes include the SDK's text and structured representations. Request
objects and the complete catalog are included in the combined byte count;
initialization, wire framing and model rendering are unmeasured. Actual model
tokens and tokenizer estimates are unmeasured. The observed byte reduction
does not establish a token saving or better agent investigation outcome.

The large result envelopes shrink by 46.8%; combined serialization shrinks by
19.7%, with unchanged catalog and call count. Small combined serialization
shrinks by 3.9%. These are single pairs, not distributions. No whole-task latency,
CPU or peak-memory improvement is established. The large candidate's first
`list_documents` costs 391.136 s versus 270.160 s before; this phase includes
startup, analysis wait and client work, not isolated engine time. Changed
projection code executes after the bridge returns its observation, but the
cause of the preparation-time variation is unestablished. One warm inventory
read costs 338.93 → 197.59 ms; this is not a general latency qualification.

A subsequent unchanged-main repeat with the same target/profile returned 2,276
procedures instead of 2,279, omitting `0x4f9930`, `0x5260b0` and `0x529640`
relative to its earlier inventory. The strict oracle rejected that control
before export. Its cause is unestablished; it is retained as an incomplete
attempt, not added to performance averages or treated as a projection defect.

## Verification scope

The production-boundary capacity regression supplies 30,000 valid simulated
Ghidra procedure rows through `GhidraProvider`, `BinarySession` and MCP. On
unchanged production main it fails with `resource_constraint` at the existing
10 MiB response budget. The candidate delivers every row exactly, without a
budget increase or truncation. This qualifies response admission, not a real
30,000-function Ghidra analysis or a universal maximum procedure count.

Source/parser tests cover strict rejection, sidecars, distinct file-offset
mapping roles, overview details, NativeAOT enrichment and unchanged observations.
Executed checks and real-provider verification are recorded in the receipt.
NativeAOT overlay tests use producer fixtures; real Windows/macOS and other
engine versions remain unqualified here.

The existing real large-result helper passed through a private stdio harness:
oversized lookup/read/annotation/dossier replies retained complete Evidence,
subsequent queries recovered, complete CLI readback matched the original bytes
with `raw_result: null`, and generated target bytes remained unchanged.
The public `verify-real-ghidra-address-context.mjs` also passed with real
Ghidra/CLI/MCP, including file-offset selection, address round trips, recovery,
unchanged source and verified cleanup. These capacity/address fixtures use a
separate 6 GiB family cap; they are correctness checks, not latency pairs.

Three early `true` harness attempts used an incorrect subject-digest selector,
assumed the composed overview's provider was Ghidra, or misread the existing
finalizer's boolean result. The last completed its facts but exited nonzero;
none is a completed performance sample. A first `jq` candidate hit the SDK's
five-minute deadline while awaiting readiness, then cleaned up successfully.
The final driver's startup/RPC deadlines are ten minutes on both sides; product
defaults are unchanged. Earlier successful warm facts were rechecked from their
archived production replies when explicit warm-result assertions were added.

## Reproduce

Build and retain separate baseline/candidate runtimes. Use the same absolute
target path and caller-supplied Ghidra/JDK for both:

```sh
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/ghidra-evidence-projection.mjs \
  --runtime /absolute/baseline --target /absolute/application \
  --ghidra /absolute/ghidra --java /absolute/jdk \
  --expect duplicate --output /absolute/new-before

python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  node experiments/analysis-efficiency/ghidra-evidence-projection.mjs \
  --runtime /absolute/candidate --target /absolute/application \
  --ghidra /absolute/ghidra --java /absolute/jdk \
  --expect compact --control /absolute/new-before/facts.json \
  --output /absolute/new-after
```

The candidate's independent baseline comparison is included in harness costs;
its isolated verification overhead is unmeasured. Static checks use a separate
8 GiB memory cap. All heavy operations run serially.
