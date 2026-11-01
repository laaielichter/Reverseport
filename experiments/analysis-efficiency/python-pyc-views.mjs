/** Same selected code-object question through production stdio MCP delivery. */
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
import { createRetainedQueryCaller } from "./retained-query-calls.mjs";
import { finalizeRetainedQueryReceipt } from "./retained-query-finalization.mjs";

const { values } = parseArgs({
  options: {
    runtime: { type: "string" },
    identity: { type: "string" },
    oracle: { type: "string" },
    output: { type: "string" },
    lane: { type: "string", default: "complete" },
    "page-size": { type: "string", default: "64" },
    "two-step": { type: "boolean", default: false },
    "probe-support": { type: "boolean", default: false },
  },
});
for (const key of ["runtime", "oracle", "output"])
  assert.ok(values[key] && values[key] === resolve(values[key]), key);
assert.ok(["complete", "selected"].includes(values.lane));
const pageSize = Number(values["page-size"]);
assert.ok(Number.isSafeInteger(pageSize) && pageSize > 0);
const expected = JSON.parse(await readFile(values.oracle, "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
assert.equal(
  hash(await readFile(expected.artifact.path)),
  expected.artifact.sha256,
);
await mkdir(values.output, { mode: 0o700 });
const account = await mkdtemp(join(tmpdir(), "rea-pyc-views-"));
const client = new Client({ name: "pyc-views", version: "1" });
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
const serverLog = createWriteStream(join(values.output, "server.log"));
const serverLogFinished = finished(serverLog);
serverLogFinished.catch(() => {});
transport.stderr?.pipe(serverLog);
const report = {
  status: "running",
  lane: values.lane,
  artifact: expected.artifact,
  selected_names: expected.names,
  calls: [],
  phases: {},
  client: "SDK exact discovered toolDefinition, default validator",
  task: "Return every matching code object for exact names with original indices and selected fields; export complete source Evidence.",
  bytecode_execution: false,
  page_size: pageSize,
  direct_first_view: values.lane === "selected" && !values["two-step"],
};
const verifyRuntime = async (phase) => {
  if (values.identity === undefined) return;
  const started = performance.now();
  const bytes = await readFile(values.identity);
  const identity = JSON.parse(bytes);
  for (const entry of [...identity.compiled_files, ...identity.entrypoints])
    assert.equal(
      hash(await readFile(join(values.runtime, entry.path))),
      entry.sha256,
      entry.path,
    );
  for (const entry of identity.driver_files)
    assert.equal(
      hash(await readFile(new URL(entry.path, import.meta.url))),
      entry.sha256,
    );
  assert.equal(hash(await readFile(process.execPath)), identity.node_sha256);
  report.runtime_identity_sha256 ??= hash(bytes);
  assert.equal(hash(bytes), report.runtime_identity_sha256);
  report.phases[`runtime_validation_${phase}_ms`] = performance.now() - started;
};
const transcript = [];
let definitions;
const caller = createRetainedQueryCaller(
  {
    callTool(params, options) {
      return client.callTool(params, {
        ...options,
        toolDefinition: definitions.get(params.name),
      });
    },
  },
  (receipt, event) => {
    report.calls.push(receipt);
    transcript.push(event);
  },
);
const observe = async (name, input, phase) => {
  const result = await caller(name, input, phase);
  if (result.isError === true) assert.fail(JSON.stringify(result));
  assert.ok(result.structuredContent);
  return result.structuredContent;
};
const columns = new Set(["source_index", ...expected.fields]);
const select = (row) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => columns.has(key)));
try {
  await verifyRuntime("before");
  const started = performance.now();
  await client.connect(transport);
  report.server_instructions = client.getInstructions() ?? "";
  const catalog = await client.listTools();
  definitions = new Map(catalog.tools.map((tool) => [tool.name, tool]));
  await writeFile(join(values.output, "catalog.json"), JSON.stringify(catalog));
  report.phases.discovery_ms = performance.now() - started;
  report.catalog_tools = catalog.tools.length;
  const selected = values.lane === "selected";
  const selectedView = (offset) => ({
    kind: "python-pyc",
    collection: "code_objects",
    names: expected.names,
    fields: expected.fields,
    offset,
    limit: pageSize,
  });
  const response = await observe(
    "inspect_python_pyc",
    {
      path: expected.artifact.path,
      ...(selected
        ? {
            detail: "summary",
            ...(values["two-step"] ? {} : { view: selectedView(0) }),
          }
        : {}),
    },
    "inspect",
  );
  const parentId = selected
    ? response.normalized_result.parent_evidence_id
    : response.evidence_id;
  report.parent_evidence_id = parentId;
  let answer;
  if (!selected) {
    const source = response.normalized_result;
    assert.deepEqual(source.artifact, expected.artifact);
    assert.equal(source.coverage.status, "complete");
    const rows = source.code_objects.map((row, source_index) =>
      select({ ...row, source_index }),
    );
    assert.deepEqual(rows, expected.rows);
    answer = rows.filter((row) => expected.names.includes(row.name));
  } else {
    answer = [];
    let offset = 0;
    let page = values["two-step"] ? undefined : response.normalized_result;
    do {
      page ??= (
        await observe(
          "inspect_analysis_view",
          {
            source: { kind: "retained-evidence", evidence_id: parentId },
            view: selectedView(offset),
          },
          "selected-page",
        )
      ).normalized_result;
      assert.equal(page.kind, "python-pyc");
      assert.deepEqual(page.pyc.artifact, expected.artifact);
      assert.equal(page.pyc.coverage.status, "complete");
      assert.equal(page.pyc.coverage.code_objects, expected.rows.length);
      assert.equal(page.coverage.total, expected.answer.length);
      answer.push(...page.items);
      if (page.coverage.next_offset === null) break;
      assert.ok(page.coverage.next_offset > offset);
      assert.ok(page.coverage.next_offset <= expected.answer.length);
      offset = page.coverage.next_offset;
      page = undefined;
    } while (true);
  }
  assert.deepEqual(answer, expected.answer);
  report.answer_sha256 = hash(JSON.stringify(answer));
  report.answer_count = answer.length;
  await writeFile(join(values.output, "answer.json"), JSON.stringify(answer));
  await observe(
    "export_evidence_bundle",
    { path: join(values.output, "evidence.json") },
    "export",
  );
  const bundle = JSON.parse(
    await readFile(join(values.output, "evidence.json"), "utf8"),
  );
  const parent = bundle.records.find(
    (record) => record.evidence_id === parentId,
  );
  assert.ok(parent);
  assert.equal(parent.operation, "inspect_python_pyc");
  assert.deepEqual(parent.normalized_result.artifact, expected.artifact);
  assert.equal(parent.normalized_result.coverage.status, "complete");
  assert.deepEqual(
    parent.normalized_result.code_objects.map((row, source_index) =>
      select({ ...row, source_index }),
    ),
    expected.rows,
  );
  report.source_report_sha256 = hash(JSON.stringify(parent.normalized_result));
  report.complete_source_export_verified = true;
  if (values["probe-support"]) {
    report.support = {};
    for (const [label, name, input] of [
      [
        "summary_delivery",
        "inspect_python_pyc",
        { path: expected.artifact.path, detail: "summary" },
      ],
      [
        "summary_view",
        "inspect_analysis_view",
        {
          source: { kind: "retained-evidence", evidence_id: parentId },
          view: { kind: "summary" },
        },
      ],
    ]) {
      try {
        const reply = await caller(name, input, "capability-probe");
        report.support[label] = { is_error: reply.isError === true, reply };
      } catch (cause) {
        report.support[label] = { is_error: true, message: String(cause) };
      }
    }
  }
  report.status = "passed";
} catch (cause) {
  report.status = "failed";
  report.error = String(cause);
} finally {
  try {
    await verifyRuntime("after");
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
