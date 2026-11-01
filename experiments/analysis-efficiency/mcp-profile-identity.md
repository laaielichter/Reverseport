# MCP schema profile identity startup

Continues [#723](https://github.com/morluto/rea/issues/723). The default catalog
identity was already recorded at build time (#4041). Compact input and omitted
output advertisement profiles still converted and hashed the complete catalog
on demand. This change records the four built-in combinations at the same
owning build step. Canonical tool facts and output-schema conversion are shared
while building those records. Only immutable hash triples reach the runtime:
the generated module grows from 411 to 1,320 bytes.

Exact full/compact and full/off selections choose their matching record. Source
execution and custom compact budgets retain lazy dynamic calculation, including
snapshotting the caller's budget. The build consumes the compiled contracts and
pinned converter before bundling; rebuilding invalidates the records. No live
provider state is cached. Output-off identities still cover canonical output
contracts, as before. All four digest triples match the pre-change runtime.

## Completed task and oracle

A fresh **actual Codex app-server 0.163.0** discovers every tool, then reports
whether a target is open, cleanup is pending, a provider is bound, and whether
the package version and catalog count match, twice in the same session.
The oracle is the selected package metadata, the pinned 209-tool contract,
no-target state, text/structured-result agreement and original pre-change
identities. Canonicalized actual-client catalogs agree before/after within
each profile; JSON object order in Codex's tool map varies by process.

The [driver](mcp-profile-identity.py) uses the installed client's version-specific
`initialize`, `thread/start`, `mcpServerStatus/list` and `mcpServer/tool/call`
protocol ([official app-server documentation](https://learn.chatgpt.com/docs/app-server)).
It uses a fresh temporary account/configuration and starts **no model turns**.
This establishes actual-client schema discovery and direct tool-call
compatibility, not model analysis quality or actual model token savings.
Existing compact/off choices remain explicit; neither becomes a new default.

Baseline: main `d532b18123916a9e88f98c7880ba4f984e23d715`. Both packaged runtimes
are frozen before measurement; their source patch, package/manifests and raw
transcripts/resource observations are retained outside Git, pinned by the
[receipt](mcp-profile-identity.json). Later validation does not relabel timings.
Node 24.18.0/npm 11.16.0, MCP SDK 2.3.1, negotiated protocol `2025-06-18`, Linux
x86-64. Two repetitions alternate baseline/candidate cohorts and reverse profile
order. Every recording starts a fresh server and includes discovery, first and
warm status calls, verification and cleanup. OS caches are unflushed.

The existing guard admits one CPU, a 4 GiB hard/3 GiB early memory boundary,
2 GiB Node heaps, no swap and 192 tasks. Kernel family peaks include file cache,
Codex, REA and controller; they are not provider heap measurements. All 16
qualified recordings exit successfully with only the observer remaining, no
resource stop and zero observed OOM events. Final whole-scope counters are
unavailable. The host's CPU is shared with unrelated work; ranges retain the
observed variation.

## Measurements

Ranges show both repetitions. Times include the whole task and shutdown.

| Input / output profile | Wall seconds before → after | CPU seconds before → after | Family peak MiB before → after |
| ---------------------- | --------------------------- | -------------------------- | ------------------------------ |
| full / full            | 8.91–8.92 → 8.82–10.31      | 8.45–8.48 → 8.07–9.82      | 765–766 → 764–769              |
| compact / full         | 11.15–18.99 → 8.82–8.89     | 10.61–16.52 → 8.19–8.48    | 772–779 → 745–745              |
| full / off             | 10.33–19.59 → 8.70–8.79     | 9.76–16.96 → 8.19–8.20     | 671–677 → 626–632              |
| compact / off          | 10.74–23.47 → 7.98–8.29     | 10.18–19.23 → 7.40–7.76    | 635–637 → 598–600              |

First/warm call times remain separately recorded in the receipt. Across the
three non-default profiles the first call ranges from 2.73–6.15 s before to
0.81–1.38 s after; warm calls range from 1.04–3.12 s before to 1.03–1.42 s after.
The default profile has no established gain; one candidate repetition is slower.

Fresh-process [identity probes](mcp-profile-digest.mjs) isolate the lazy read
from module loading. The non-default digest computation takes 1.28–3.79 s
before and under 0.2 ms after. Building all four identities shares schema
conversion: isolated compute CPU increases from 1.636 s (one identity) to
2.373 s (four). Full uncached builds were 42.59 → 81.09 s wall, 41.59 → 68.27 s
CPU, 3318.5 → 3216.4 MiB peak. These single builds include TypeScript, bundling
and concurrent host contention, so their difference is not attributed solely
to digest generation. The isolated phase is one observation per version.

There is **no token reduction from this change**. Each profile's complete
catalog size and serialization-token estimate are unchanged. Full/full remains
3,322,571 bytes as exposed by this client; compact/off remains 233,547 bytes
through existing configuration. The input-facing catalog plus both argument
and text replies is about 209.8k proxy tokens with full input and 66.3k with
compact input, before and after. Small differences come from fresh timestamps
and runtime paths. The [cost script](mcp-profile-costs.py) uses
`tiktoken==0.12.0`/`cl100k_base`; these estimates are not actual model usage or a
claim about what the host injects. Output schemas, hidden prompts and model
reasoning must not be inferred from that projection.

## Validation and remaining scope

Executed: four files / 46 tests pass, including real production stdio doctor
for all four profiles, source catalog/schema consistency, output-off identity
coverage, malformed replies, startup cancellation/cleanup, generated immutable
record reuse and caller-selected custom budgets. The pre-change runtime is
also an independent oracle for all four complete hash triples.

After rebasing onto main `e84468c0b`, the four files / 46 tests pass again,
as do `npm run check` (types, lint, format, knip, metadata and architecture)
and `npm run docs:check` (including five README consistency tests). Actual
Codex compact/off discovery and both status calls pass again with verified
cleanup. This final qualification does not replace the pinned timing cohort.
An initial static check identified the build-only export as untracked; the
existing output-policy regression now directly exercises its four profiles.

Earlier exploratory attempts remain excluded: one controller expected the
wrong count key; one functional compact/off run left a child alive at payload
exit. The corrected controller waits for its allocated scope to drain without
killing individual PIDs; all later qualified runs verify that drain. Neither
failed attempt establishes a production regression.

SDK 2.3.1 already supports a named `toolDefinition`, used by REA's doctor to
avoid preparing every output validator for its one probe. Generic external SDK
callers still incur their own catalog preparation. Input presentation and
output refs already have owning reuse; these were not duplicate fixes.
Target/provider investigations, other clients/platforms and actual model
analysis cost remain unverified by this no-target startup task.

To reproduce with the pinned client and a built runtime, run under the existing
resource guard:

```sh
python3 experiments/analysis-efficiency/resource-run.py --observe-payload-exit -- \
  python3 experiments/analysis-efficiency/mcp-profile-identity.py \
  --output /tmp/rea-profile-case --runtime /absolute/built/rea \
  --node /absolute/node24/bin/node --codex /absolute/codex-0.163.0 \
  --input-profile compact --output-profile off
```

Retain the resource output as `/tmp/rea-profile-case.log` for the cost script.
The driver is pinned to Codex 0.163.0's experimental protocol and the 209-tool
catalog in this receipt; update its oracle deliberately for another revision.
