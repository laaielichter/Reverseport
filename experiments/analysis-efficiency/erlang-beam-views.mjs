/** Compare a completed selected-export question through production stdio MCP. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
const { values } = parseArgs({
  options: {
    ...Object.fromEntries(
      ["runtime", "oracle", "output", "identity"].map((k) => [
        k,
        { type: "string" },
      ]),
    ),
    lane: { type: "string", default: "complete" },
    "page-size": { type: "string", default: "64" },
    "sdk-cache": { type: "boolean", default: false },
  },
});
assert.ok(["complete", "selected"].includes(values.lane));
const pageSize = Number(values["page-size"]);
assert.ok(Number.isSafeInteger(pageSize) && pageSize > 0);
for (const key of ["runtime", "oracle", "output", "identity"])
  assert.equal(values[key], resolve(values[key]));
const { createRetainedQueryCaller } =
  await import("./retained-query-calls.mjs");
const { finalizeRetainedQueryReceipt } =
  await import("./retained-query-finalization.mjs");
const hash = (x) => createHash("sha256").update(x).digest("hex"),
  oracleBytes = await readFile(values.oracle),
  expected = JSON.parse(oracleBytes),
  identityBytes = await readFile(values.identity),
  identity = JSON.parse(identityBytes);
assert.equal(
  hash(await readFile(expected.expected.artifact.path)),
  expected.expected.artifact.sha256,
);
await mkdir(values.output, { mode: 0o700 });
const account = await mkdtemp(join(tmpdir(), "rea-beam-task-"));
const client = new Client({ name: "beam-selected-exports", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(values.runtime, "scripts/rea.mjs"), "mcp"],
  maxBufferSize: 10485760,
  env: {
    HOME: account,
    TMPDIR: account,
    PATH: process.env.PATH,
    REA_LOG_LEVEL: "silent",
    NODE_OPTIONS: "--max-old-space-size=2048",
    NODE_DISABLE_COMPILE_CACHE: "1",
    UV_THREADPOOL_SIZE: "2",
  },
  stderr: "pipe",
});
const serverLog = createWriteStream(join(values.output, "server.log")),
  serverLogFinished = finished(serverLog);
serverLogFinished.catch(() => {});
transport.stderr?.pipe(serverLog);
const report = {
  status: "running",
  lane: values.lane,
  artifact: expected.expected.artifact,
  calls: [],
  phases: {},
  question: `Return every exported function named ${expected.names.join(", ")} with its original export-table index, function atom index, arity and code label. Preserve complete source Evidence.`,
  client: values["sdk-cache"]
    ? "Production stdio SDK, cached catalog definitions and default validator"
    : "Production stdio SDK, exact discovered toolDefinition and default validator",
  runtime_identity_sha256: hash(identityBytes),
  oracle_sha256: hash(oracleBytes),
  driver_sha256: hash(await readFile(new URL(import.meta.url))),
};
const verifyRuntime = async () => {
  assert.equal(hash(await readFile(values.identity)), hash(identityBytes));
  assert.equal(hash(await readFile(values.oracle)), hash(oracleBytes));
  for (const r of [...identity.compiled_files, ...identity.entrypoints])
    assert.equal(
      hash(await readFile(join(values.runtime, r.path))),
      r.sha256,
      r.path,
    );
  for (const r of identity.dependency_files ?? [])
    assert.equal(hash(await readFile(r.path)), r.sha256, r.path);
  for (const r of identity.driver_files)
    assert.equal(
      hash(await readFile(new URL(r.path, import.meta.url))),
      r.sha256,
      r.path,
    );
  assert.equal(hash(await readFile(process.execPath)), identity.node_sha256);
  assert.equal(
    hash(await readFile(new URL(import.meta.url))),
    report.driver_sha256,
  );
};
const transcript = [];
let definitions;
const caller = createRetainedQueryCaller(
  {
    callTool(params, options) {
      return client.callTool(
        params,
        values["sdk-cache"]
          ? options
          : {
              ...options,
              toolDefinition: definitions.get(params.name),
            },
      );
    },
  },
  (receipt, event) => {
    report.calls.push(receipt);
    transcript.push(event);
  },
);
const observe = async (name, input, phase) => {
  const result = await caller(name, input, phase);
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(result.structuredContent);
  return result.structuredContent;
};
const verifySource = (source) => {
  for (const [key, value] of Object.entries(expected.expected))
    assert.deepEqual(source[key], value, key);
  assert.equal(source.coverage.status, "complete");
};
try {
  await verifyRuntime();
  const started = performance.now();
  await client.connect(transport);
  report.server_instructions = client.getInstructions() ?? "";
  const catalog = await client.listTools();
  definitions = new Map(catalog.tools.map((t) => [t.name, t]));
  report.catalog_tools = catalog.tools.length;
  await writeFile(join(values.output, "catalog.json"), JSON.stringify(catalog));
  report.phases.discovery_ms = performance.now() - started;
  const selected = values.lane === "selected";
  const selectedView = (offset) => ({
    kind: "beam",
    collection: "exports",
    names: expected.names,
    fields: ["function_index", "function", "arity", "label"],
    offset,
    limit: pageSize,
  });
  const response = await observe(
    "inspect_erlang_beam",
    {
      path: expected.expected.artifact.path,
      ...(selected ? { detail: "summary", view: selectedView(0) } : {}),
    },
    "inspect",
  );
  report.parent_evidence_id = selected
    ? response.normalized_result.parent_evidence_id
    : response.evidence_id;
  let answer;
  if (!selected) {
    verifySource(response.normalized_result);
    answer = (response.normalized_result.exports ?? [])
      .map((r, i) => ({ source_index: i, ...r }))
      .filter((r) => expected.names.includes(r.function));
  } else {
    answer = [];
    let offset = 0,
      page = response.normalized_result;
    for (;;) {
      assert.equal(page.kind, "beam");
      assert.equal(page.page.collection, "exports");
      assert.deepEqual(page.beam.artifact, expected.expected.artifact);
      assert.deepEqual(page.beam.coverage, expected.expected.coverage);
      assert.equal(page.beam.counts.exports, expected.expected.exports.length);
      assert.equal(page.coverage.total, expected.answer.length);
      answer.push(...page.page.items);
      if (page.coverage.next_offset === null) break;
      assert.ok(page.coverage.next_offset > offset);
      offset = page.coverage.next_offset;
      page = (
        await observe(
          "inspect_analysis_view",
          {
            source: {
              kind: "retained-evidence",
              evidence_id: report.parent_evidence_id,
            },
            view: selectedView(offset),
          },
          "selected-page",
        )
      ).normalized_result;
    }
  }
  assert.deepEqual(answer, expected.answer);
  report.answer_count = answer.length;
  report.answer_sha256 = hash(
    JSON.stringify(
      answer.map((r) =>
        Object.fromEntries(
          Object.entries(r).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    ),
  );
  await writeFile(join(values.output, "answer.json"), JSON.stringify(answer));
  await observe(
    "export_evidence_bundle",
    { path: join(values.output, "evidence.json") },
    "export",
  );
  const bundle = JSON.parse(
    await readFile(join(values.output, "evidence.json")),
  );
  const parent = bundle.records.find(
    (r) => r.evidence_id === report.parent_evidence_id,
  );
  assert.ok(parent);
  assert.equal(parent.operation, "inspect_erlang_beam");
  verifySource(parent.normalized_result);
  report.source_report_sha256 = hash(JSON.stringify(parent.normalized_result));
  report.complete_source_export_verified = true;
  report.status = "passed";
} catch (cause) {
  report.status = "failed";
  report.error = String(cause);
} finally {
  try {
    await verifyRuntime();
  } catch (cause) {
    report.status = "failed";
    report.runtime_identity_failure = String(cause);
  }
  await finalizeRetainedQueryReceipt({
    client,
    transport,
    serverLog,
    serverLogFinished,
    account,
    report,
    output: values.output,
    transcript,
  });
  if (
    report.status !== "passed" ||
    report.cleanup_failures.length ||
    report.receipt_failures.length
  )
    process.exitCode = 1;
}
