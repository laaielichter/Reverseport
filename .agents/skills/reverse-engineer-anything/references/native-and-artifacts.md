# Native, managed, and packaged artifacts

For release comparisons, export `list_procedures` Evidence from each target before
closing it. Close clears session records: import both bundles after collecting the
two targets, or supply portable inline Evidence. `match_native_functions` pairs unique exact names and, when supplied,
complete observed body bytes. Reuse optional same-context `list_names`,
`procedure_info`, `read_bytes` and existing `analyze_function` dossiers as
`left_observations`/`right_observations`; an MCP `analyze_function` summary
reply contributes its `parent_evidence_id` as a `retained-evidence` reference,
not the summary itself. Avoid decompiling every function merely to match it. Its summary retains a parent for
`inspect_analysis_view` `function-matches` collections `matches` and `functions`.
Select columns, batch IDs and page individual facts; aliases remain unresolved.
Unpaired observations do not prove additions/removals. Existing matched dossier
pairs include inputs for `compare_functions`; otherwise analyze just chosen pairs.

## Apple app resources

Use `open_bundle_resources` with the selected app path, then `inspect_plist`,
`decode_interface_builder`, `inspect_asset_catalog`, or `inspect_keyed_archive`.
The resource session reads the app without resolving `CFBundleExecutable` or
starting a deep provider. Preserve `resource_root` provenance, per-resource
hashes where reported, and null executable identity; a directory path is not
an executable digest. Export retained Evidence before closing or switching
roots. Binary analysis snapshots do not apply. Use `open_binary` to switch to
executable analysis, and `close_binary` to release either session kind.

The four matching CLI commands accept the app path directly. For an archive
inside the app, use `inspect-keyed-archive APP_PATH RELATIVE_ARCHIVE_PATH`.
Host requirements for plist and compiled asset/Interface Builder tooling still
apply; a resource-only session does not establish provider availability.

## Desktop installation directories

When an installation directory is supplied and its runtime is unknown, use
`inspect_desktop_application` with its absolute path. Default MCP summary
delivery retains complete Evidence. Read `files`, `omissions`, `candidates`, `components` or
`next_probes` with `inspect_analysis_view` kind `desktop-application`, selecting
exact paths, batched file/omission IDs or families and only needed fields and pages.
Summary `probe_issues` retains counts and bounded previews. Select files with
`has_issues: true` and fields `path`, `read_status`, `issues` to retrieve exact
failures directly; preview text is display data, while `file_id` selects full facts. Preserve source
coverage, read-range identity and unknowns; directory snapshot identity is not
a digest of every file's contents. Component path markers do not establish
runtime presence. For compact CLI output, use
`inspect-desktop-application PATH --detail summary --evidence_output BUNDLE`.
See [desktop installations](https://github.com/laaielichter/reverseport/blob/main/docs/desktop-applications.md).

## Go build metadata

Use `inspect_go_binary` for an explicit local ELF, PE or Mach-O (universal
files need `architecture`) when the
question concerns the embedded compiler version, module/dependency versions,
local replacements or build settings. No `open_binary`, Go installation or
target execution is required. The CLI equivalent is `inspect-go-binary PATH`.
Preserve artifact SHA-256, original file ranges, framed module bytes and every
unparsed module-text line. A missing record is an unknown, not proof of a
non-Go binary; observed metadata does not authenticate its claims. Function,
source and type recovery remain a separate native-analysis question.

## Model files

Use `inspect_model_artifact` (`inspect-model-artifact PATH`) for local GGUF v2/v3
and safetensors declarations without a model runtime. Header-only mode does not
read weights or establish full-file identity. `hash: "full"` explicitly streams
all bytes. Retained `model-artifact` views page `metadata`, `tensors` and derived
`types`, with exact batch filters and selected fields. Arrays retain typed counts
and eight-element previews; omitted values, unknown types and runtime behavior
stay explicit. See [model files](https://github.com/laaielichter/reverseport/blob/main/docs/model-artifacts.md).

## IL2CPP metadata

Use `inspect_il2cpp_metadata` for an explicit local Unity `global-metadata.dat`
(versions 24, 27, 29, 31 and 39) when the question concerns assembly images,
names, member owners, string literals, namespaces or index ranges. No `open_binary`, Unity installation or target
execution is required. The CLI equivalent is `inspect-il2cpp-metadata PATH`.
MCP defaults to counts with complete retained Evidence. Query `sections`,
`images`, `types`, `methods`, `fields`, `properties`, `events`, `parameters` or
`string_literals` through `inspect_analysis_view`; use exact names,
batch indices and selected fields. Row indices are scoped by artifact SHA-256
and collection; page offsets count filtered matches. Parameters support batch
`method_indices` to read one method's parameters directly. Historical reports
without member collections retain unknown counts rather than empty inventories. Preserve
artifact SHA-256 and index widths. Unrecognized magic may mean encryption and
is unsupported, not decrypted. Linking names to `GameAssembly` or
`UnityFramework` code addresses remains a separate native-analysis question.
See [IL2CPP metadata](https://github.com/laaielichter/reverseport/blob/main/docs/il2cpp-metadata.md).

## Rust dependency metadata

Use `inspect_rust_binary` for an explicit local ELF, PE, or Mach-O (universal
files need `architecture`) when
the question concerns the cargo-auditable crate list embedded in `.dep-v0`
(Mach-O: `__DATA,.dep-v0`). No `open_binary`, Rust installation, or target
execution is required. The CLI equivalent is `inspect-rust-binary PATH`.
Preserve artifact SHA-256, package order, dependency indices, and the section
file range. A missing section is null metadata, not proof the binary has no
dependencies. An omitted package kind stays null. A rustc commit hash is
inferred from a read-only `/rustc/<40-hex>/` path and does not by itself
identify the compiler. See [Rust binaries](https://github.com/laaielichter/reverseport/blob/main/docs/rust-binaries.md).

## PE Authenticode certificate tables

Use `inspect_pe_certificates` for an explicit local PE32/PE32+ image when the
question concerns the Authenticode certificate table, WIN_CERTIFICATE types, or
embedded PKCS#7 signer and X.509 identity fields. No `open_binary`, Windows SDK,
or target execution is required. The CLI equivalent is
`inspect-pe-certificates PATH`. Preserve artifact SHA-256, table file ranges,
payload hashes, original validity-time spellings, and
`subject_key_identifier_hex` when the signer uses that form. A missing
`IMAGE_DIRECTORY_ENTRY_SECURITY` directory is observed absence of that table,
not proof the image is unsigned in every catalog or overlay sense. Signatures,
chains, timestamps, and Authenticode digest coverage remain unobserved. See
[PE Authenticode certificate tables](https://github.com/laaielichter/reverseport/blob/main/docs/pe-certificates.md).

## PE import and delay-load tables

Use `inspect_pe_imports` for an explicit local PE32/PE32+ image when the
question concerns imported DLL and function names, ordinals, delay-load
descriptors, or the pefile import hash. No `open_binary`, Windows SDK, or
target execution is required. The CLI equivalent is `inspect-pe-imports PATH`.
Preserve artifact SHA-256, directory file ranges, original DLL spellings, and
ILT/IAT RVAs. A missing `IMAGE_DIRECTORY_ENTRY_IMPORT` directory is observed
absence of that table, not proof the image never imported APIs through another
table or overlay. Bound snapshots, loaded IAT contents, and export-forward
resolution remain unobserved. See
[PE import and delay-load tables](https://github.com/laaielichter/reverseport/blob/main/docs/pe-imports.md).

## PE TLS callbacks and load configuration

Use `inspect_pe_load_config` for an explicit local PE32/PE32+ image when the
question concerns code that runs before the entry point through TLS callbacks,
or the security cookie, SafeSEH, CFG, EH-continuation and XFG declarations in
the load configuration. No `open_binary`, Windows SDK, or target execution is
required. The CLI equivalent is `inspect-pe-load-config PATH`. Preserve artifact
SHA-256, directory and callback-array file ranges, and callback VAs as
hexadecimal strings. Fields outside the declared `Size` are `null`. Guard-flag
mitigations carry `evidence_kind: "inferred"`; enforcement remains unobserved.
See
[PE TLS callbacks and load configuration](https://github.com/laaielichter/reverseport/blob/main/docs/pe-load-config.md).

## ELF note tables

Use `inspect_elf_notes` for an explicit local ELF32/ELF64 image when the
question concerns PT_NOTE/SHT_NOTE owners, GNU build-id, or GNU ABI-tag
fields. No `open_binary` or target execution is required. The CLI equivalent
is `inspect-elf-notes PATH`. Preserve artifact SHA-256, table file ranges,
descriptor hashes, and original owner spellings. A missing table is observed
absence of those declarations, not proof the image never carried notes in
another container. See
[ELF note tables](https://github.com/laaielichter/reverseport/blob/main/docs/elf-notes.md).

## Apple IPS crash reports

Use `inspect_apple_ips` for an explicit local Apple `.ips` file when the
question concerns crash metadata, exception and termination facts, threads,
usedImages, lossless registers, or documented crash classes. No `open_binary`,
Xcode, atos, or target execution is required. The CLI equivalent is
`inspect-apple-ips PATH`. Preserve artifact SHA-256, `bug_type` as a string,
uppercase image UUIDs, and integer literals that exceed IEEE-754 range. Only
`bug_type` `"309"` yields a crash body; other DiagnosticReports types return
no crash result. Opened Mach-O and dSYM UUID joins remain unobserved. See
[Apple IPS crash reports](https://github.com/laaielichter/reverseport/blob/main/docs/apple-ips.md).

## Linux kernel modules

Use `inspect_kernel_module` for an explicit local ELF32/ELF64 relocatable
object when the question concerns `.modinfo` license, vermagic, alias,
depends, or parm strings, the `__versions` symbol CRCs, or an appended module
signature trailer. No `open_binary`, Linux host, or `modinfo` program is
required. The CLI equivalent is `inspect-kernel-module PATH`. Preserve
artifact SHA-256, key order, duplicate keys, CRC hex, and section file ranges.
A missing section is observed absence when section names are known, not proof
the module never carried that metadata. `.gnu.linkonce.this_module` is reported
as present or absent; `struct module` stays unknown because its layout changes
with the kernel version. `__ksymtab` records are not decoded. The PKCS#7 range
and its SHA-256 are observed; certificate, signer, and digest coverage remain
unvalidated. An absent trailer is not proof the module is unsigned in another
container. gzip, xz, and zstd whole-file containers are unsupported and name
`external_decompression` as the next probe: use an external codec utility to
decompress into a separate file, then call `inspect_kernel_module` on that file. See
[Linux kernel modules](https://github.com/laaielichter/reverseport/blob/main/docs/kernel-modules.md).

## CPython pyc files

Use `inspect_python_pyc` for an explicit local CPython 3.7–3.13 `.pyc` when the
question concerns the header magic, PEP 552 source hash or timestamp, nested
code-object names, or bytecode identity. No `open_binary`, Python installation,
or target execution is required. The CLI equivalent is `inspect-python-pyc PATH`.
Preserve artifact SHA-256, the 16-byte header fields, nested code names, and
bytecode SHA-256. Bytecode is not decompiled. A decoded header does not prove
the matching `.py` is present. See [CPython pyc inspection](https://github.com/laaielichter/reverseport/blob/main/docs/python-pyc.md).

## Erlang BEAM files

Use `inspect_erlang_beam` for an explicit local `FOR1`/`BEAM` file when the
question concerns IFF chunks, atom names, exports, imports, lambdas, or the
Code header. No `open_binary`, Erlang installation, or bytecode execution is
required. The CLI equivalent is `inspect-erlang-beam PATH`. Preserve artifact
SHA-256, chunk file ranges, 1-based atom indices, and original atom spellings.
Missing optional tables stay null. For a few facts, use `detail: "summary"` with
a `beam` view selecting a collection, exact names/indices and fields; read later
pages from `parent_evidence_id` or the complete Evidence bundle. Same-name
exports retain every arity and original atom index. CLI summary delivery requires
`--evidence_output`. Null table counts remain distinct from decoded empty tables. See
[Erlang BEAM files](https://github.com/laaielichter/reverseport/blob/main/docs/erlang-beam.md).

## SQLite snapshots

Use `inspect_sqlite_database` with an explicit local database snapshot for its
schema and optional rows from one exact ordinary table. It requires Node.js
24.x >=24.15 or 26+ with the native `DatabaseSync.limits` API. It also consumes the
existing sibling `-wal`; retain both original digests when citing its result.
Default output is a compact inventory; a selected table expands only its own
schema and samples 20 rows. Select `columns` to avoid irrelevant or large cells,
and request `schema_scope: "database"` only for complete schema details.
Choose `row_limit` when a finite sample is useful and keep truncation and
unspecified row order explicit. Virtual tables, shadow tables and views are
schema facts, not row-read targets. ReversePort inspects private copies and leaves
the source files untouched; obtain a coherent quiescent database/WAL snapshot
before inspection. See [SQLite snapshots](https://github.com/laaielichter/reverseport/blob/main/docs/sqlite-databases.md).

## Recorded Linux crashes

Use `inspect_recorded_crash` with an explicit Linux x86-64 ELF core path to
inspect historical thread registers, signals, raw notes and original file
ranges. It is independent of the active disassembler target. Source-bound
register values and note bytes are observations; missing notes, signal-thread
association and current executable/library identity remain unknown. PIDs are
historical metadata and never authorize live attach or control.

The optional `include_debugger_context` facet adds mapping candidates through
caller-supplied GDB/pwndbg in an owned core-only session. Display names do not
establish current file identity; zero reported flags leave permissions unknown.
Requested unavailable context fails with setup guidance. See
[recorded crashes](https://github.com/laaielichter/reverseport/blob/main/docs/recorded-crashes.md)
for exact upstream profiles, bounds and verification coverage.

## Offline ELF layout

Use `inspect_binary_layout` with an explicit local ELF path for file-backed
sections, symbols, relocations, linkage names, and static mitigation inferences
without opening a disassembler target. When that complete record is already
retained, call `inspect_analysis_view` for a summary, mitigations or linkage
facet, one section or symbol, or a stable page. Do not re-run the decoder to
read a single object.

## Offline WASM

Use `inspect_wasm_artifact` with caller-supplied WABT for selected local bytes.
For counts, validation and WAT identity, select `detail: "summary"` on the first
MCP call. The complete original Evidence stays retained; use
`normalized_result.parent_evidence_id` for exact exports or text pages. Omitted
or complete detail keeps the existing complete result.
For a completed result, use `inspect_analysis_view` with its reported retained
reference for a summary or `view: {kind: "wasm", facet: "exports", offset: 0, limit: 32}`.
Facets also include sections, imports, candidates, glue, WAT, headers, details
and tool profile. Text offsets count UTF-16 code units; follow `next_offset`.
The complete source remains retained after an oversized MCP reply. No target
execution or network acquisition is implied, and WAT is decoded representation.

## Offline APK signatures

Use `inspect_apk_signature` for a selected local APK/ZIP/AAB. Default MCP summaries
retain complete Evidence. Select `view.collection: signers/digests/lineage`,
with scheme or ID batches, fields and paging; use `inspect_analysis_view` kind
`apk-signature` for retained reads after deletion. IDs retain artifact/scheme
scope and signer links; `fields: []` keeps identity links. Empty pages preserve
partial decoding reasons and unknown authenticity. CLI compact delivery needs
`--evidence_output` to preserve the complete parent.
It reads the APK
Signing Block (v2/v3/v3.1) and v1 `META-INF` signing without executing anything,
and reports each signer's certificate facts (for v1, the certificate the PKCS#7
block's SignerInfo names), the declared v3 rotation lineage,
the declared source-stamp certificate and, for SHA-256/SHA-512 digests, whether
the declared content digest matches the current bytes. That match is not a
signature verification: anyone who changes the bytes can recompute the digest.
`posture` summarises v1-only signing (which cannot tell a v1-only APK from one
whose v2/v3 block was removed), observed signer agreement across schemes,
whether the v1 signer equals the block-scheme signer (`false` is notable),
whether every differing signer appears in a declared (unverified) rotation
lineage, and the strongest scheme.
It never claims authenticity: no signature or lineage is cryptographically
verified.

## Native targets

After `open_binary`, use focused search, procedure, or function tools directly.
Use `binary_overview` when target metadata or inventory context helps answer the
question. Prefer literal search, names, decompilation, callers, callees, and
cross-references. Addresses and recovered pseudocode are analysis observations,
not original source. Provider unavailability and unsupported metadata remain
unknown rather than false.

For a completed `analyze_function` dossier, use `inspect_analysis_view` with
`view: {kind: "native", facet: "value_flow_operations", offset: 0, limit: 32}`
and the exact retained Evidence ID to read selected facts without reanalysis.
The default MCP reply is already a summary of that dossier: its
`normalized_result.parent_evidence_id` is the retained ID to page, and its
null counts mark facets the provider did not record or declared unavailable.
Native facets also include procedure, pseudocode, assembly, basic blocks,
comments, callers/callees, references, unresolved calls, referenced strings and
names, the native API record, and value-flow summaries. Pseudocode offsets and limits count UTF-16
code units; use the returned `next_offset` for continuation. Provider limitations
and unavailable facts remain explicit; the complete parent Evidence is retained.

`inspect_macho` on a large framework returns megabytes of imports and exports.
Select `detail: "summary"` for slice identity, UUID and per-collection counts,
then page rows with `view: {kind: "macho", facet: "exports", offset: 0, limit: 64}`
and `normalized_result.parent_evidence_id`. Facets are entrypoints,
architectures, build_metadata, load_commands, dependencies, imports, exports,
segments and provenance. `source_exhaustive: false` means unreturned symbols
may exist.

To see which functions or Objective-C methods a Mach-O actually calls in one
run, use `observe_native_calls` with explicit breakpoints and a bounded
`duration_ms`/`max_events`. It launches a new process under LLDB, so the target
runs and may change files or use the network. Hardened-runtime targets need the
`get-task-allow` entitlement.
Function breakpoints use exact LLDB runtime names: a Darwin C `_main` static symbol
may be `main` at runtime. ReversePort does not translate names. Set `module` to the image
file name when selecting that image only; otherwise loaded system images also
match. Inspect retained locations and module paths before attributing a call.

Use `binary_session` with no arguments to check the open target, selected
provider, and alignment. Its default `result.tool_availability` carries a
complete inventory grouped by shared facts. Expand each group's `names` and
inherit the inventory-level client requirements unless a group overrides them;
availability, reasons, remediation, modes, and flags remain inline. The
`effects` and `annotations` arrays name true flags from fixed vocabularies, so an
omitted known flag is false. `tools/list` remains the canonical source for full
tool schemas when target or provider state changes.

Provider capability groups carry provider identity and ordered limitations.
Prepend each set's `shared_limitations` to a group's `limitations` to recover the
operation's full ordered list. Candidate capabilities describe possible
providers. Top-level session capabilities describe the current route, and
`analysis_provider_binding` identifies the selected provider.

## Ghidra startup deadline recovery

`provider_timeout` during the first Ghidra query can cover import, auto-analysis,
bridge startup, and readiness. The default 330,000 ms is configurable through
`REA_GHIDRA_STARTUP_TIMEOUT_MS`; a smaller query still needs the same cold import.

When the error names `ghidra.startup_timeout_ms`, call
`update_analysis_settings` with `action: "set"` and a larger value within the
reported bounds. Resolve retained cleanup before the next startup attempt.
No ReversePort restart is needed; an already accepted startup keeps its original
budget. A new attempt repeats import. Preserve useful Evidence before closing
and reopening the target when remediation requires that lifecycle step.

For a per-function timeout, update `ghidra.decompile_timeout_seconds` and retry
the same function on the existing Program. Explicit `null` removes that
per-function deadline. Inspection is optional when the error supplies the
setting and bounds. Runtime updates disappear when ReversePort exits; environment
changes only seed future ReversePort processes.

The client's tool-call deadline must allow startup plus the requested query;
server settings and progress notifications cannot override it. CLI analysis
avoids the MCP client deadline, but retains the provider deadline. For example:

```sh
REA_GHIDRA_STARTUP_TIMEOUT_MS=1800000 rea analyze /absolute/path/to/app.exe --provider ghidra --json
```

Thirty minutes is an example budget, not a completion guarantee. Keep host CPU
and memory controls in place. Disable specific expensive analyzers only when
their missing coverage is acceptable and retain the resulting limitations.
Exported C and embedded resources remain useful independent evidence, but a
timeout does not establish complete analysis or absence of code. See the
[deadline and client guide](https://github.com/laaielichter/reverseport/blob/main/docs/mcp-contracts.md#ghidra-first-query-deadlines-and-recovery).

## Bridge request ceiling

Hopper and Cutter share `REA_BRIDGE_MAX_REQUEST_BYTES`. Unset, both sides use
16777216 bytes. The payload budget excludes the terminating LF. A decimal
integer from 7464 to 536870887 raises or lowers that ceiling. The floor fits
the largest bounded symbol-name command. A tight Cutter status still returns
its session id and up to 64 completion receipts. Its path is included when it
fits, and is unknown when it does not, so an older descriptor path is not
paired with the new generation. The maximum is the encoded payload, one byte under Node's string ceiling so
the framing LF still fits. Cutter measures, signs, and writes a fitting
response in bounded chunks. The bridge searches only the newly read bytes
for the framing LF. The client unescapes each socket chunk into one response
string before parsing it, so this ceiling does not keep the paged wire frame
and another concatenated copy. Invalid values are configuration errors and do not fall back to 16777216. Set the variable in the environment that starts ReversePort, restart ReversePort,
and start Hopper or Cutter from that same environment. An out-of-band bridge
without the setting stays at 16777216 bytes. The client reports that mismatch
during discovery only after the hello proves a live authenticated bridge, and
does not send a status request or the command. A stale descriptor is ignored.
Discovery fails if any such live ceiling differs, even when another live
session matches. A command response discarded for that ceiling stays an
unknown execution with `output_truncated`. A hello
that never sends its authenticated frame does not hold the accept loop.
At most 8 connection threads run; a further accept is closed, and a failure
to start a thread does not stop the listener. `completed_connection` is the
longest prefix of connections that have terminated. Dense scalar replies are
encoded in bounded batches.
The 25000 ms Cutter request deadline and the 256-candidate discovery budget
still have no runtime override.

## Static memory and original file bytes

For Ghidra, `read_bytes` reads initialized analysis memory, including loader
fixups; it does not read a running process. Check `returned_bytes` and `complete`
before decoding a table. An incomplete read is missing coverage, not a zero-filled
tail. Use `list_segments` to inspect the selected block's initialization and address-space
facts, and retain unavailable facts as unknown.

Use `address_to_file_offset` to anchor one observed address to original file
bytes. A mapping for the first address does not establish a contiguous mapping
for an entire table, and loader fixups can make analysis bytes differ from source
bytes. Keep source ranges and analysis-memory observations separate.

A pointer table can refer to writable slots populated by a constructor rather
than directly to immutable resources. An uninitialized block or an observed zero
does not establish the slot's later runtime value. Follow `xrefs` and the relevant
writer's assembly or pseudocode; distinguish recorded assignments from inferred
execution order. Do not replace unreadable bytes with zeros or conclude that a
resource is absent without the necessary initialization evidence.

## DOS MZ with Ghidra

For an admitted DOS MZ target, use `inspect_native_load_image` to check measured
loaded bytes, file mappings, relocations and the entry against the immutable
snapshot. Keep `mismatch` and `unsupported` explicit. Verified import covers the
reported static image, not runtime DOS or PC-98 hardware behavior.

For Ghidra decompilation, `procedure_pseudo_code` also accepts `procedure: "file-offset:0x..."`; CLI `reverseport decompile <path> --file-offset=0x... --provider ghidra` resolves the source byte offset internally. An unresolved 0x-prefixed numeric procedure selector also falls back to a unique file mapping. Existing symbols and analysis addresses win; multiple mappings fail as ambiguous. Preserve the returned file-offset and address locations and raw selection observations. ELF virtual addresses are distinct from file offsets; never assume an arbitrary offset plus image base is an analysis address.

Complete function body ranges use inclusive ends and can contain gaps. Do not
treat the enclosing span as code.
For packed targets, retain the original and separately derived artifact identities;
decompiling an unpacking stub does not recover the unpacked program.

When reading Objective-C dispatch metadata, distinguish class implementation
methods from protocol requirements: class methods report null requirement
flags, while decoded protocol declarations retain required and optional facts.
Property attributes remain raw name/value tokens; use the property's
`atomicity` field for the decoded `N` marker or the default atomic behavior.
Null class/meta flags, ivar counts, atomicity, or read-only values mean the
selected provider did not establish that fact. Symbol names alone do not prove
that a class is a root class or has no ivars.

## Managed PE/CLI

Start with `inspect_managed_artifact`. ReversePort's canonical managed inspection is
execution-free: do not claim it loaded, reflected, executed, or resolved the
assembly. Keep managed/native boundaries and unavailable reconstruction facts
explicit. A bring-your-own reconstruction oracle is separate from the canonical
parser and must not become an implicit setup dependency.

For identity/classification questions, `inspect_managed_artifact` can explicitly
select `detail: "summary"` on the first MCP call. It retains complete metadata
and returns a linked overview with full classification/evidence, nullable
module/MVID, frameworks, metadata coverage/issues/limitations and returned-row
counts. Default complete requests remain unchanged. Read original rows with
`inspect_analysis_view`, source `normalized_result.parent_evidence_id`, and
`view: {kind: "managed", collection: "attributes", offset: 0, limit: 16}`.
Collections are `references`, `resources` and `attributes`. Paging does not
repeat parsing. Returned-row exhaustion
does not prove complete metadata or absence under partial/unavailable coverage;
preserve build-local tokens and their artifact/MVID scope.

`inspect_managed_members` always returns the assembly-wide `member_refs`, even
for one selected type. For questions about a selected type, select
`detail: "summary"` with `type_names`; it returns the selection (with unmatched
names), coverage and per-collection counts. Page rows with
`view: {kind: "managed-members", collection: "call_edges", offset: 0, limit: 64}`
over `types`, `exported_types`, `fields`, `methods`, `member_refs`, `call_edges`,
`field_accesses` or `user_strings`.

### .NET NativeAOT

NativeAOT binaries contain native machine code, so ordinary CIL decompilers
cannot recover the original method bodies. When managed metadata/CIL is absent,
classify that as a native-analysis route rather than claiming source recovery.
Open the native image with the selected deep provider and inspect functions,
strings, calls, and references; describe decompiler output as pseudocode and
inference.

NativeAOT images can be PE/COFF, ELF, or Mach-O executables and shared
libraries. Use file bytes and loader metadata rather than suffixes to identify
them. For packaged apps, inventory/extract with ReversePort's artifact tools and retain
the exact contained image identity. PDB, ELF debug, or dSYM sidecars are
additional evidence only when the provider accepts and matches them.

ReversePort has a built-in read-only snapshot parser for x64 PE targets with .NET 8 RTR
9.1 metadata. An optional headless Ghidra adapter adds database annotations and
broader metadata recovery on Linux; it requires an explicitly configured
NativeAOT JAR. These are separate routes. The built-in parser also runs on
Windows Ghidra P0; read frozen literals from its report, because
`search_strings` does not include them. See the
[NativeAOT guide](https://github.com/laaielichter/reverseport/blob/main/docs/ghidra-nativeaot.md)
for setup, supported layouts, and host restrictions. Preserve binary identity
and distinguish derived metadata from Ghidra database observations. Recovered
types and native pseudocode are not original C# source. Windows Ghidra P0 has
no database mutation authority.

## Packages and extraction

Use `inspect_artifact` for application bundles, archives, ZIP/APK/IPA/MSIX/AppX,
ASAR, or DMG inputs when the artifact graph and findings help answer the
question. It returns the complete artifact graph inline. Cite graph manifest
IDs when using them.

For an IPA or a macOS `.app`, ZIP, or DMG, pass the inventory Evidence to
`project_apple_application_graph`. It reports application roots and nested
bundles by path convention: app extensions, XPC services, frameworks, login
items, system and driver extensions, and plug-ins. It also lists privileged
helpers, launchd plists, symlinks, and each bundle's `info_plist_path` and
executable candidates. Roles are path conventions, not parsed plists; read the
listed plists with `inspect_plist`.

After `open_binary` on a `.app` or Mach-O, use `trace_dylib_resolution` to see
which file each `@rpath`, `@loader_path` and `@executable_path` load reaches for
every executable in the bundle. It also lists missing or weak loads and earlier
`@rpath` candidates that are absent. Narrow large bundles with `roots` or
`architecture`. System paths stay undetermined because the dyld shared cache
provides them.

Use `extract_artifact` when materialized files from a supported format are needed.
It extracts the active target and accepts optional `integrity_policy`; see the [MCP contracts](https://github.com/laaielichter/reverseport/blob/main/docs/mcp-contracts.md).
It materializes all regular files into a fresh temporary directory chosen by
ReversePort. Symlinks and encrypted entries are inventory facts, not extractable files.
The result reports the materialized directory; callers do not choose the
destination. No separate permission grant is needed.

Native DMG traversal automatically uses a read-only mount on supported macOS
hosts, with an owned temporary mount directory and cleanup. It needs no approval
flag. Unsupported hosts or mount failures remain explicit limitations; do not
claim child inventory when only root identity is available. DMG extraction is
unavailable through `extract_artifact`. To access DMG files on macOS, create a
read-only mount with your own tools, select files from that mount for analysis,
and detach the mount you created when finished. ReversePort's inspection mount is
temporary, not a retained export of the image's contents.

For headerless DOS COM, explicitly open with `format: "dos-com"` (CLI
`--target-format dos-com`). Inspect the load image before trusting function
analysis: the entry is `0x10100`, file offset zero, with imposed real-mode segment
context. PSP/stack/device state remains unmodeled. See [DOS guide](https://github.com/laaielichter/reverseport/blob/main/docs/ghidra-dos.md).

Use `inspect_byte_entropy` to triage high- and low-entropy ranges before extraction.

For other headerless images (embedded firmware without ELF/Mach-O/PE/MZ
headers), open with `format: "raw-binary"`, `architecture` (`x86`, `x86_64`,
`arm`, `arm64`, `6502`, or `m68k`), and `entry_point` (`0x` hex). File offset 0 is mapped at
that address. Hopper and IDA refuse this interpretation; Ghidra uses
`BinaryLoader` with a generic language: big-endian for `m68k`, little-endian
otherwise. Big-endian ARM, Thumb-only, and Cortex-M variants are unsupported.
`6502` selects NMOS 6502; the entry and complete file mapping must fit within
`0x0000..0xffff`. 65C02, 65816, cartridge containers, bank switching, and mapper
semantics are unsupported. `m68k` requires an even entry and decodes the 68040
superset of the 68000 family; Amiga/Atari containers and vector-table entry
discovery are unsupported. Windows Ghidra P0 admits raw images only for `6502`. See [raw binary guide](https://github.com/laaielichter/reverseport/blob/main/docs/raw-binary.md).

### Function annotations in Ghidra

Use `annotate_native_function` for one function name and/or entry comments, with at least one explicit change. Review its annotation readback and refreshed dossier inline. Changes are atomic and session-scoped; empty comments clear them, omitted fields preserve them. Later MCP calls observe edits until close. CLI `annotate-native-function` returns the updated analysis before discarding the session. Original executable bytes are unchanged; edits invalidate immutable snapshots. Windows P0 does not admit database mutations. For naming only, `set_address_name` / `set_addresses_names` also work with Ghidra: they name function entries or data addresses (primary labels) and return compact per-address success booleans instead of a dossier.

## Offline PE resource inventory

Use `inspect_pe_resources` with an absolute `path`, or
`reverseport inspect-pe-resources ./selected.exe --json`, for portable PE32/PE32+
resource inspection without opening a native target. Preserve returned Evidence:
type/name/language IDs and UTF-16 names, original directory/data/payload ranges,
code pages, payload hashes and static icon-group references. Same-language icon
resolution is explicit; missing references and size mismatch remain visible.
Other payloads are opaque, and this operation does not decode images or simulate
Windows resource loading. Consult the budgets and supported tree profile in
[offline binary diagnostics](https://github.com/laaielichter/reverseport/blob/main/docs/binary-diagnostics.md).

## Specialised targets

Moved here from the main skill so it stays short; the routes are unchanged.

- Firmware image: `inspect_firmware_regions` when advertised. Use
  `extract_firmware` when extraction is requested, with a caller-selected new
  absolute output directory. These tools use caller-supplied Binwalk/Unblob on
  Linux; see the [firmware guide](https://github.com/laaielichter/reverseport/blob/main/docs/firmware-analysis.md).
- .NET NativeAOT PE/ELF: native Ghidra analysis. Native code can yield pseudocode;
  consult the NativeAOT workflow in `references/native-and-artifacts.md` for
  optional metadata recovery and its supported host/layout boundary.
- Fiddler Everywhere traffic or a native `.saz` capture: read the
  [Fiddler workflow](references/runtime-observation.md#fiddler-everywhere-traffic-debugging).
  Inspect saved SAZ with `inspect_web_network_capture` and `format: "saz"`;
  connect Everywhere's separate MCP server for live traffic.
- Retained HAR/SAZ/native mitmproxy/aioquic qlog capture: `inspect_web_network_capture`. Select
  original record ordinals when useful; inspect producer fields and byte/number
  sidecars without fetching recorded URLs or claiming live attribution. HAR/SAZ/qlog
  old-generation heap is `REA_CAPTURE_DECODER_OLD_GENERATION_MIB` (default 192 MiB,
  floor 8, maximum 16384), set where ReversePort starts. Host memory and `NODE_OPTIONS` do not
  raise it. See
  [historical captures](https://github.com/laaielichter/reverseport/blob/main/docs/web-network-captures.md) for the exact upstream
  profile and credential exclusions. Qlog support starts with aioquic 1.5.0
  JSON 0.3; stream coverage and endpoint loss declarations do not recover bodies
  or establish network loss. Prefer detail summary, then kind qlog trace/stream
  pages; select one trace, stream ID and direction for contribution/range pages.
  Facts retain all-recorded-events-before-selection scope. Other qlog layouts
  and PCAP correlation are unsupported.
- Packet-field discovery: `inspect_packet_fields` searches installed protocols
  and field names/types before choosing fields for `inspect_packet_capture`.
  Query/page the relevant records; registrations do not establish observed traffic.
- Recorded packet captures: `inspect_packet_capture` with selected TShark fields,
  display filters and decode-as rules. Requires Linux, util-linux prlimit and `REA_TSHARK_COMMAND`; see
  [capture guide](https://github.com/laaielichter/reverseport/blob/main/docs/packet-captures.md).
  Packet limits count input packets before filtering. Output defaults to 50 matching
  frames; use `match_offset` / `match_limit` for later pages, or explicit null
  limit for complete matching output. Preserve the source digest across pages.
  This does not perform live capture.
  For address/DNS/SNI/protocol summaries use `inspect_pcap_capture` with MCP
  detail summary, then retained kind pcap pages. Requires Wireshark 4.x tshark
  and capinfos, with Linux prlimit or Windows Job Objects; see
  [packet summaries](https://github.com/laaielichter/reverseport/blob/main/docs/pcap-analysis.md).
  Select an exact DNS question for address pages; page exhaustion does not prove
  network completeness. This reads recordings and does not acquire traffic.
- Decoder discovery: `inspect_signal_decoders` searches installed decoder IDs
  or selected decoder help, including channels and options. Query and page the
  relevant details before choosing settings; this does not scan hardware.
- Recorded logic/signal traces: `decode_signal_recording` with explicit decoder,
  channel and protocol settings. On Linux with util-linux prlimit, supply sigrok-cli 0.7.2 through
  `REA_SIGROK_COMMAND`; see [recording guide](https://github.com/laaielichter/reverseport/blob/main/docs/signal-recordings.md).
  Output defaults to 50 literal lines; select annotation classes and page with
  `line_offset` / `line_limit`, or explicit null for all remaining output.
  Window counts are display lines, not annotations or samples. Preserve source digests across pages.
  This reads existing files; it does not acquire hardware signals.
- Explicit local WebAssembly artifact: `inspect_wasm_artifact`. Supply WABT 1.0.42
  through `REA_WABT_BIN_DIRECTORY`; retain exact byte/tool identity and decoded WAT.
  Select JavaScript glue and candidate paths explicitly and preserve URL/path
  ambiguity. No implicit fetch or target execution; WAT is not original source.
  See the [WASM guide](https://github.com/laaielichter/reverseport/blob/main/docs/wasm-artifacts.md).
- Explicit local Android APK (or ZIP/AAB) signing: `inspect_apk_signature`.
  Prefer its summary or selected signer/digest/lineage page; retain complete
  Evidence and use `inspect_analysis_view` kind `apk-signature` for follow-ups.
  Reports which schemes are present (v1 JAR, v2, v3, v3.1), each signer's
  certificate SHA-256 fingerprint (v1 included, from its PKCS#7 block), v3 key-rotation lineage, source stamp, and
  whether each signed digest still matches the bytes (self-consistency). This
  is identity and integrity, not a trust or authenticity verdict.
  See the [APK signature guide](https://github.com/laaielichter/reverseport/blob/main/docs/apk-signature.md).
- Explicit local EVM bytecode carrier: `inspect_evm_interface` with caller-selected
  `raw` or `hex` encoding. The owned worker deadline is `timeout_ms` (default
  30000 ms, range 1..2147483647, next call). It does not raise the fixed byte,
  address-space, or CPU allowances. Preserve carrier/decoded digests and treat selectors,
  argument strings and mutability as inferred candidates; this performs no chain
  lookup or target execution. For the complete inferred interface without hex or
  duplicate stdout, discover support and select `detail: "summary"`; complete
  Evidence stays retained under its original identity. Use the returned
  `parent_evidence_id` for exact function or `bytecode_hex`/stdout/stderr pages.
  Candidate coverage does not establish interface completeness. See the
  [EVM bytecode guide](https://github.com/laaielichter/reverseport/blob/main/docs/evm-bytecode.md).
- Embedded Go compiler, module or build-setting metadata: `inspect_go_binary`
  with the explicit local file. This built-in target-free inspection requires no
  Go installation or disassembler. Preserve raw module bytes and source ranges;
  absent metadata does not prove a binary is not Go, and unparsed text records
  remain explicit. See the
  [Go binary guide](https://github.com/laaielichter/reverseport/blob/main/docs/go-binaries.md).
- Embedded CUDA/HIP code objects: `inspect_gpu_code_objects`; inventory targets
  first, then decode selected payloads and query retained GPU Evidence.
- Bundled GGUF or safetensors model declarations: `inspect_model_artifact`
  with the explicit local file. Default header hashing leaves full-file identity
  unknown; `hash: "full"` additionally reads all weights for SHA-256. MCP returns
  retained summaries; optional `view` selects one page in the initial call. Use
  `inspect_analysis_view` kind `model-artifact` for
  batched metadata keys, tensor names or type totals, selected fields and pages.
  Preserve header-scoped indices and array preview omissions; do not infer model
  behavior from declared architecture or tensor types. See the
  [model file guide](https://github.com/laaielichter/reverseport/blob/main/docs/model-artifacts.md).
- Unity IL2CPP names, member owners and string literals from `global-metadata.dat`:
  `inspect_il2cpp_metadata` with the explicit local file; MCP defaults to compact
  counts. Query sections, images, types, methods, fields, properties, events,
  parameters or string_literals through `inspect_analysis_view`
  with the returned `parent_evidence_id`, using exact filters, batch indices and
  selected fields. Parameters accept `method_indices`, avoiding a scan of all
  parameter pages. Missing collections in historical Evidence remain unknown.
  Versions 24, 27, 29, 31 and 39; no Unity, IL2CPP
  binary or disassembler is run. Unrecognized magic (possibly encrypted) and
  other versions are unsupported. Optional matching `binary_path` enables static native addresses and type references; query `method_addresses` with indices or addresses/states, preserving every shared-body method and both artifact identities. Without a linked binary native counts remain unknown. Byte-pattern fallback is inferred; no runtime behavior or same-build pairing is proved. See the
  [IL2CPP metadata guide](https://github.com/laaielichter/reverseport/blob/main/docs/il2cpp-metadata.md).
- Embedded cargo-auditable Rust dependency metadata: `inspect_rust_binary`
  with the explicit local ELF, PE, or thin Mach-O file. This built-in
  target-free inspection requires no Rust installation or disassembler. Preserve
  package order, dependency indices, and the section file range. A missing
  `.dep-v0` section is null metadata, not proof the binary has no dependencies.
  A rustc commit hash is an inference from a read-only `/rustc/<40-hex>/` path.
  For selected crates, use `view: {collection: "packages", names: [...],
  fields: ["name", "version", "source"]}` on the first call; explicitly include
  `dependencies` for direct index references. Use `detail: "summary"` for counts
  and ranges, or retained `inspect_analysis_view` Rust package/edge pages for
  subsequent filters. Keep the complete parent Evidence accessible; CLI compact
  delivery requires `--evidence_output`.
  See the
  [Rust binary guide](https://github.com/laaielichter/reverseport/blob/main/docs/rust-binaries.md).
- PE Authenticode certificate table: `inspect_pe_certificates` with the explicit
  local PE32/PE32+ file. This built-in target-free inspection requires no
  Windows SDK. Preserve WIN_CERTIFICATE ranges, types, payload SHA-256, and
  PKCS#7 signer/X.509 identity fields, including `subject_key_identifier_hex`
  when the signer uses that form. A missing security directory is observed
  absence of that table, not proof the image is unsigned in every catalog sense.
  Signatures are not verified. See the
  [PE certificate guide](https://github.com/laaielichter/reverseport/blob/main/docs/pe-certificates.md).
- PE import and delay-load tables: `inspect_pe_imports` with the explicit
  local PE32/PE32+ file. This built-in target-free inspection requires no
  Windows SDK. Preserve DLL names, named and ordinal functions, ILT/IAT RVAs,
  delay-load descriptors, and the pefile import hash of the standard import
  table. A missing import directory is observed absence of that table, not
  proof the image never imported APIs through another table. Bound snapshots
  and loaded IAT contents remain unobserved. See the
  [PE import guide](https://github.com/laaielichter/reverseport/blob/main/docs/pe-imports.md).
- PE TLS callbacks and load configuration: `inspect_pe_load_config` with the
  explicit local PE32/PE32+ file. This built-in target-free inspection requires
  no Windows SDK. Preserve callback VAs as strings with their RVA, file offset
  and section, and the size-covered security cookie, SafeSEH, CFG,
  EH-continuation and XFG fields. Guard-flag mitigation claims are inferred
  linker declarations, not proof of enforcement. A missing directory is observed
  absence of that declaration. See the
  [PE load configuration guide](https://github.com/laaielichter/reverseport/blob/main/docs/pe-load-config.md).
- ELF note tables: `inspect_elf_notes` with the explicit local ELF32/ELF64
  file. This built-in target-free inspection requires no disassembler. Preserve
  PT_NOTE and SHT_NOTE ranges, owners, types, descriptor SHA-256, and GNU
  build-id or ABI-tag fields. A missing table is observed absence of those
  declarations, not proof the image never carried notes. See the
  [ELF notes guide](https://github.com/laaielichter/reverseport/blob/main/docs/elf-notes.md).
- Apple `.ips` crash reports: `inspect_apple_ips` with the explicit local
  file. This built-in target-free inspection requires no Xcode, atos, or
  pwntools. Preserve first-line metadata, `bug_type` as a string, process and
  exception facts, lossless integer registers, usedImages UUIDs, and
  documented classification matches. Only `bug_type` `"309"` yields a crash
  body; other types, including `"288"` stackshots, return no crash result.
  Opened Mach-O and dSYM UUID joins remain unobserved. See the
  [Apple IPS guide](https://github.com/laaielichter/reverseport/blob/main/docs/apple-ips.md).
- Linux kernel module metadata: `inspect_kernel_module` with the explicit local
  ELF32/ELF64 relocatable file. This built-in target-free inspection requires
  no Linux host or `modinfo`. Preserve `.modinfo` key order and duplicate keys,
  `__versions` CRC hex, section file ranges, and the appended signature
  trailer's PKCS#7 SHA-256. A missing section is observed absence when section
  names are known, not proof the module never carried that metadata.
  `struct module` is not decoded. The signature is not validated. gzip, xz, and
  zstd containers are unsupported; decompress into a separate file with an
  external codec utility, then inspect the decompressed `ET_REL` image. See the
  [kernel module guide](https://github.com/laaielichter/reverseport/blob/main/docs/kernel-modules.md).
- CPython 3.7–3.13 `.pyc` header, nested marshal code objects and bytecode
  identity: `inspect_python_pyc` with the explicit local file. This built-in
  target-free inspection requires no Python installation. Preserve magic,
  PEP 552 hash or mtime/size, nested names, and bytecode SHA-256. Bytecode is
  not decompiled, and a decoded header does not prove the matching `.py` is
  present. See the
  [CPython pyc guide](https://github.com/laaielichter/reverseport/blob/main/docs/python-pyc.md).
- Erlang BEAM IFF container: `inspect_erlang_beam` with the explicit local
  `.beam` file. This built-in target-free inspection requires no Erlang
  installation. Preserve chunk names, atom order, export/import/lambda tables,
  and the Code header. For selected facts, prefer `detail: "summary"` plus a
  `beam` view (collection, names/indices, fields and paging), retaining the full
  Evidence. CLI summary requires `--evidence_output`. Missing table counts stay
  null; decoded empty tables count zero. Bytecode is not executed. See the
  [Erlang BEAM guide](https://github.com/laaielichter/reverseport/blob/main/docs/erlang-beam.md).

- Explicit local SQLite database snapshot: `inspect_sqlite_database`. Inspect
  with Node.js 24.x >=24.15 or 26+ providing native SQLite limits. Read schema
  first (compact inventory by default), or select an exact ordinary table
  and `columns` when rows are needed. Defaults are selected-table schema and
  20 rows; request `schema_scope: "database"` for the complete stored schema. Preserve both database and existing sibling WAL identity; row samples
  report truncation and have unspecified order. Use a quiescent snapshot rather
  than assuming a live database/WAL pair was copied atomically. See the
  [SQLite guide](https://github.com/laaielichter/reverseport/blob/main/docs/sqlite-databases.md).
- Explicit Linux ELF file for offline layout, symbols, relocations or static
  mitigation evidence: `inspect_binary_layout`. This target-free operation uses
  caller-supplied pwntools without opening a disassembler database. Preserve its
  raw locations and inference/coverage limits; see the
  [offline binary guide](https://github.com/laaielichter/reverseport/blob/main/docs/binary-diagnostics.md).
- Supplied Linux x86-64 ELF core: `inspect_recorded_crash`. Read every recorded
  thread, raw note and source-bound register without opening a live target.
  Historical PIDs do not select live processes. Request `include_debugger_context`
  only when core-only mapping candidates help; see the
  [recorded crash guide](https://github.com/laaielichter/reverseport/blob/main/docs/recorded-crashes.md).
- PE resource type/name/language trees and static icon group references:
  `inspect_pe_resources` with an explicit path. This portable operation requires
  no active target or engine; opaque payloads retain file ranges and SHA-256.
- PE export directories and ELF dynamic-symbol exports: `inspect_native_exports`
  with an explicit path; portable, no active target or engine.

For an existing IDA MCP configuration, use `open_binary` with the original
input binary and `provider_id: "ida"`; do not pass an `.idb` or `.i64` database.
The legacy attached profile binds the already-open GUI input by SHA-256 and
leaves its database open. The modern headless profile creates and closes an
owned private database without saving. Installation and registration reuse
[mrexodia/ida-pro-mcp](https://github.com/mrexodia/ida-pro-mcp); see the
[IDA provider guide](https://github.com/laaielichter/reverseport/blob/main/docs/ida-provider.md).
Proceed directly to `analyze_function`, pseudocode, or function/string searches
after opening; IDA does not supply `binary_overview`. Consult session availability
when composing broader workflows. Modern direct callers and unsupported dossier
facets remain unknown; live IDA results are not replayed from snapshots.

## Offline PE and ELF export tables

Use `inspect_native_exports` with an absolute `path`, or
`reverseport inspect-native-exports ./libexample.so --json`, to read a PE export
directory or ELF dynamic symbol table on any host without opening a native
target. Ordinal-only, forwarded and hidden-version exports stay distinct;
partial or unsupported coverage means the inventory is incomplete, not that
exports are absent. Use `inspect_macho` for Mach-O. See
[offline binary diagnostics](https://github.com/laaielichter/reverseport/blob/main/docs/binary-diagnostics.md).

For exact core-module import/export differences, use `compare_wasm_interfaces`
with two complete inspection Evidence records (or current-session retained
references) and explicit scope. Preserve unknown types/duplicate names; static
interface equality is not runtime compatibility. CLI accepts complete inline
Evidence in `reverseport compare-wasm-interfaces input.json --json`.

## Godot PCK

For a standalone PCK, `open_binary` then `inspect_artifact` with
`detail: "summary"` retains the complete static inventory. Use the returned
`parent_evidence_id` with `inspect_analysis_view` inventory occurrences filtered
by exact `logical_paths` or `occurrence_ids`, and join `artifact_id` to nodes
filtered by `artifact_ids`. Select only needed fields; identity links remain.
Prefer `inspect-artifact --detail summary --evidence_output PATH` for CLI tasks;
the same CLI discovers embedded packs via their EOF trailer without opening a
native analysis provider. Normal native opening remains unchanged.

Distinguish declared MD5 from observed SHA-256 and graph/page completeness from
`source_coverage`. Encrypted directories and sparse bundles have unknown entry
coverage; encrypted members have unknown content identity. An empty filtered
page cannot prove absence in unknown coverage. Retained views are historical,
not fresh filesystem checks. No decryption, Godot resource decoding, GDScript
decompilation or target execution is provided. See
[Godot PCK](https://github.com/laaielichter/reverseport/blob/main/docs/godot-pck.md).

## Kuna provider

With `REA_KUNA_COMMAND` configured, `provider_id: "kuna"` answers procedure
lists, lookups, pseudocode, assembly and `analyze_function` from Kuna's cached
whole-program export. Callers/callees use a separate body-free graph shared by
the session; `xrefs` returns exact-address incoming sites and filters forwarding
aliases. These queries and inventory lookups do not trigger a C export. Indirect
targets remain unknown and can make relationship coverage partial. Reference
caches expire on close; a fresh CLI process repeats the native reference walk.
Typed references, CFG, raw-memory tools and annotations remain unsupported. A cold first
answer can come from a single-function run (its limitations say so); assembly
waits for the export. For pseudocode and assembly, `raw_result.source` names the
cached `.c`/`.asm` file and byte span, which you may search directly instead of
calling per function. See the
[Kuna provider guide](https://github.com/laaielichter/reverseport/blob/main/docs/kuna-provider.md).
