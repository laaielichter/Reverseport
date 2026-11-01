import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
const { values } = parseArgs({
  options: {
    runtime: { type: "string" },
    corpus: { type: "string" },
    reference: { type: "string" },
    output: { type: "string" },
    mode: { type: "string" },
    "output-profile": { type: "string", default: "full" },
    "warm-continuation": { type: "boolean", default: false },
  },
});
for (const key of ["runtime", "corpus", "reference", "output"])
  assert.ok(
    values[key] && resolve(values[key]) === values[key],
    key + " must be absolute",
  );
assert.ok(["complete", "selected"].includes(values.mode));
assert.ok(["full", "off"].includes(values["output-profile"]));
const root = values.corpus,
  runtime = values.runtime,
  output = values.output;
await mkdir(output);
const reference = JSON.parse(await readFile(values.reference, "utf8"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: runtime,
  encoding: "utf8",
}).trim();
const sourceState = execFileSync("git", ["status", "--porcelain"], {
  cwd: runtime,
  encoding: "utf8",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(runtime, "scripts/rea.mjs"), "mcp"],
  cwd: output,
  env: {
    PATH: process.env.PATH,
    HOME: output,
    REA_LOG_LEVEL: "silent",
    REA_MCP_OUTPUT_SCHEMA_PROFILE: values["output-profile"],
    UV_THREADPOOL_SIZE: "1",
    NODE_OPTIONS: "--max-old-space-size=2048",
    NODE_DISABLE_COMPILE_CACHE: "1",
  },
  stderr: "pipe",
});
const client = new Client({ name: "source-bundle-baseline", version: "1" });
let stderr = "";
transport.stderr?.on("data", (chunk) => {
  stderr += chunk;
});
const report = {
  status: "incomplete",
  runtime_revision: revision,
  runtime_worktree_status: sourceState,
  mode: values.mode,
  output_schema_profile: values["output-profile"],
  reference_sha256: sha(await readFile(values.reference)),
  node_version: process.version,
  calls: [],
  cleanup_verified: false,
};
const transcript = [];
const began = performance.now();
try {
  await client.connect(transport);
  const catalog = await client.listTools();
  await writeFile(join(output, "catalog.json"), JSON.stringify(catalog));
  const definitions = new Map(catalog.tools.map((t) => [t.name, t]));
  const call = async (name, args) => {
    const start = performance.now();
    const reply = await client.callTool(
      { name, arguments: args },
      { toolDefinition: definitions.get(name) },
    );
    transcript.push({ name, arguments: args, reply });
    report.calls.push({
      name,
      elapsed_ms: performance.now() - start,
      is_error: reply.isError === true,
      reply_bytes: Buffer.byteLength(JSON.stringify(reply)),
    });
    return reply;
  };
  const analyzed = await call("analyze_javascript_application", {
    input_path: join(root, "artifact/shipped"),
    detail: "summary",
    max_semantic_nodes: 1,
    max_semantic_nodes_per_file: 1,
  });
  assert.notEqual(analyzed.isError, true, JSON.stringify(analyzed));
  report.preparation_summary = analyzed.structuredContent.normalized_result;
  const parentId = report.preparation_summary.parent_evidence_id;
  assert.ok(parentId);
  const compared = await call("compare_source_to_bundle", {
    reference:
      values.mode === "complete"
        ? reference
        : { kind: "file", path: values.reference },
    application: { kind: "retained-evidence", evidence_id: parentId },
    ...(values.mode === "complete"
      ? {}
      : {
          view: {
            kind: "source-to-bundle",
            collection: "mappings",
            source_paths: [
              "src/createSlice.ts",
              "src/createReducer.ts",
              "src/query/core/buildThunks.ts",
            ],
          },
        }),
  });
  assert.notEqual(compared.isError, true, JSON.stringify(compared));
  if (values.mode === "selected") {
    const selected = compared.structuredContent.normalized_result;
    assert.equal(selected.items.length, 3);
    assert.deepEqual(
      selected.items.map((r) => [r.source_path, r.status]),
      [
        ["src/createReducer.ts", "split"],
        ["src/createSlice.ts", "split"],
        ["src/query/core/buildThunks.ts", "unknown"],
      ],
    );
    const candidates = await call("inspect_analysis_view", {
      source: {
        kind: "retained-evidence",
        evidence_id: selected.parent_evidence_id,
      },
      view: {
        kind: "source-to-bundle",
        collection: "candidates",
        source_paths: ["src/createSlice.ts", "src/createReducer.ts"],
        fields: ["score", "confidence", "signals"],
      },
    });
    assert.notEqual(candidates.isError, true, JSON.stringify(candidates));
    assert.equal(
      candidates.structuredContent.normalized_result.items.length,
      6,
    );
    if (values["warm-continuation"]) {
      const repeated = await call(
        "inspect_analysis_view",
        transcript.at(-1).arguments,
      );
      assert.deepEqual(repeated, candidates);
    }
  }
  report.comparison_reply = compared.structuredContent;
  const exported = await call("export_evidence_bundle", {
    path: join(output, "evidence.json"),
  });
  assert.notEqual(exported.isError, true);
  const bundle = JSON.parse(
    await readFile(join(output, "evidence.json"), "utf8"),
  );
  const comparison = bundle.records.find(
    (r) => r.operation === "compare_source_to_bundle",
  );
  report.retained_records = bundle.records.map((r) => ({
    evidence_id: r.evidence_id,
    operation: r.operation,
  }));
  if (comparison) {
    report.comparison_id = comparison.normalized_result.comparison_id;
    report.comparison_summary = comparison.normalized_result.summary;
    report.coverage = comparison.normalized_result.coverage;
    report.selected_items = comparison.normalized_result.items.filter((r) =>
      [
        "src/createSlice.ts",
        "src/createReducer.ts",
        "src/query/core/buildThunks.ts",
      ].includes(r.source_path),
    );
    report.complete_comparison_bytes = Buffer.byteLength(
      JSON.stringify(comparison),
    );
  }
  report.status = "observed";
  assert.equal(report.comparison_summary.split, 33);
  assert.equal(report.comparison_summary.unknown, 147);
  const views = transcript.filter(
    (r) =>
      ["compare_source_to_bundle", "inspect_analysis_view"].includes(r.name) &&
      r.reply.structuredContent.normalized_result.parent_evidence_id,
  );
  for (const view of views) {
    const result = view.reply.structuredContent.normalized_result;
    assert.equal(result.parent_evidence_id, comparison.evidence_id);
    assert.deepEqual(
      result.source_coverage,
      comparison.normalized_result.coverage,
    );
    for (const row of result.items) {
      const original = comparison.normalized_result.items[row.source_index];
      assert.equal(row.mapping_id, original.mapping_id);
      assert.equal(row.source_path, original.source_path);
      if (result.view.collection === "candidates") {
        const candidate = original.candidates[row.candidate_index];
        assert.equal(row.current_node_id, candidate.current_node_id);
        assert.deepEqual(row.signals, candidate.signals);
        assert.equal(
          row.mapped,
          original.current_node_ids.includes(candidate.current_node_id),
        );
      } else {
        assert.equal(row.status, original.status);
        assert.equal(row.candidate_count, original.candidates.length);
      }
    }
  }
} finally {
  await client.close();
  await transport.close();
  report.cleanup_verified = transport.pid === null;
  report.elapsed_ms = performance.now() - began;
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(join(output, "transcript.json"), JSON.stringify(transcript));
  await writeFile(join(output, "server.log"), stderr);
}
console.log(
  JSON.stringify({
    status: report.status,
    calls: report.calls,
    comparison_summary: report.comparison_summary,
    coverage: report.coverage,
    selected: report.selected_items?.map((r) => ({
      path: r.source_path,
      status: r.status,
      candidates: r.candidates.length,
    })),
    complete_comparison_bytes: report.complete_comparison_bytes,
    cleanup_verified: report.cleanup_verified,
  }),
);
