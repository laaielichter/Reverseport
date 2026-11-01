/** Equivalent export-table questions over public production stdio MCP workflows. */
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
    oracle: { type: "string" },
    output: { type: "string" },
    lane: { type: "string" },
    buffer: { type: "string", default: "67108864" },
    identity: { type: "string" },
  },
});
for (const key of ["runtime", "oracle", "output"])
  assert.ok(values[key] && values[key] === resolve(values[key]), key);
assert.ok(["complete", "selected"].includes(values.lane));
const buffer = Number(values.buffer);
assert.ok(Number.isSafeInteger(buffer) && buffer >= 10485760);
const expected = JSON.parse(await readFile(values.oracle, "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const artifact = expected.artifact.path;
assert.equal(hash(await readFile(artifact)), expected.artifact.sha256);
await mkdir(values.output, { mode: 0o700 });
const account = await mkdtemp(join(tmpdir(), "rea-export-views-"));
const client = new Client({ name: "native-export-views", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(values.runtime, "scripts/rea.mjs"), "mcp"],
  maxBufferSize: buffer,
  env: {
    HOME: account,
    TMPDIR: account,
    PATH: process.env.PATH,
    REA_LOG_LEVEL: "silent",
    REA_MCP_MAX_RESPONSE_BYTES: String(buffer),
    NODE_OPTIONS: "--max-old-space-size=2048",
    NODE_DISABLE_COMPILE_CACHE: "1",
    UV_THREADPOOL_SIZE: "1",
  },
  stderr: "pipe",
});
const serverLog = createWriteStream(join(values.output, "server.log"));
const serverLogFinished = finished(serverLog);
serverLogFinished.catch(() => {});
transport.stderr?.pipe(serverLog);
const report = {
  lane: values.lane,
  buffer_bytes: buffer,
  artifact: expected.artifact,
  calls: [],
  phases: {},
  status: "running",
};
const verifyRuntime = async (phase) => {
  if (values.identity === undefined) return;
  const started = performance.now();
  const identityBytes = await readFile(values.identity);
  const identity = JSON.parse(identityBytes);
  for (const entry of [...identity.compiled_files, ...identity.entrypoints])
    assert.equal(
      hash(await readFile(join(values.runtime, entry.path))),
      entry.sha256,
      entry.path,
    );
  report.runtime_identity_sha256 ??= hash(identityBytes);
  assert.equal(hash(identityBytes), report.runtime_identity_sha256);
  report.phases[`runtime_validation_${phase}_ms`] = performance.now() - started;
};
const transcript = [];
const call = createRetainedQueryCaller(client, (receipt, event) => {
  report.calls.push(receipt);
  transcript.push(event);
});
const observe = async (name, input, phase) => {
  const reply = await call(name, input, phase);
  if (reply.isError === true) assert.fail(JSON.stringify(reply));
  assert.ok(reply.structuredContent);
  return reply.structuredContent;
};
const choose = (source) =>
  source.exports.flatMap((row, source_index) =>
    expected.names.includes(row.name) ? [{ ...row, source_index }] : [],
  );
try {
  await verifyRuntime("before");
  let start = performance.now();
  await client.connect(transport);
  const catalog = await client.listTools();
  report.phases.discovery_ms = performance.now() - start;
  report.catalog_bytes = Buffer.byteLength(JSON.stringify(catalog));
  report.catalog_sha256 = hash(JSON.stringify(catalog));
  await writeFile(join(values.output, "catalog.json"), JSON.stringify(catalog));
  const selected = values.lane === "selected";
  const reply = await observe(
    "inspect_native_exports",
    { path: artifact, ...(selected ? { detail: "summary" } : {}) },
    "inspect",
  );
  const parentId = selected
    ? reply.normalized_result.parent_evidence_id
    : reply.evidence_id;
  report.parent_evidence_id = parentId;
  let rows;
  if (selected) {
    rows = [];
    let offset = 0;
    do {
      const page = (
        await observe(
          "inspect_analysis_view",
          {
            source: { kind: "retained-evidence", evidence_id: parentId },
            view: {
              kind: "native-exports",
              collection: "exports",
              names: expected.names,
              offset,
              limit: 2,
            },
          },
          "page",
        )
      ).normalized_result;
      assert.equal(page.exports.coverage.status, "complete");
      assert.equal(page.coverage.total, expected.rows.length);
      rows.push(...page.items);
      offset = page.coverage.next_offset;
    } while (offset !== null);
    const empty = (
      await observe(
        "inspect_analysis_view",
        {
          source: { kind: "retained-evidence", evidence_id: parentId },
          view: {
            kind: "native-exports",
            collection: "exports",
            names: ["__rea_export_oracle_missing__"],
            limit: 1,
          },
        },
        "negative",
      )
    ).normalized_result;
    assert.deepEqual(empty.items, []);
    assert.equal(empty.exports.coverage.status, "complete");
    assert.equal(empty.coverage.total, 0);
  } else {
    rows = choose(reply.normalized_result);
    assert.equal(
      reply.normalized_result.exports.some(
        (row) => row.name === "__rea_export_oracle_missing__",
      ),
      false,
    );
  }
  assert.deepEqual(rows, expected.rows);
  await observe(
    "export_evidence_bundle",
    { path: join(values.output, "evidence.json") },
    "export",
  );
  start = performance.now();
  const bundle = JSON.parse(
    await readFile(join(values.output, "evidence.json"), "utf8"),
  );
  const parent = bundle.records.find(
    (record) => record.evidence_id === parentId,
  );
  assert.ok(parent);
  assert.deepEqual(choose(parent.normalized_result), expected.rows);
  assert.equal(
    parent.normalized_result.coverage.exports,
    expected.export_count,
  );
  assert.equal(parent.normalized_result.exports.length, expected.export_count);
  assert.equal(parent.normalized_result.coverage.status, "complete");
  assert.equal(parent.subject.digest.sha256, expected.artifact.sha256);
  report.source_report_sha256 = hash(JSON.stringify(parent.normalized_result));
  report.phases.bundle_verification_ms = performance.now() - start;
  assert.equal(hash(await readFile(artifact)), expected.artifact.sha256);
  report.answer = {
    rows,
    export_count: expected.export_count,
    negative: [],
    coverage: parent.normalized_result.coverage,
  };
  report.status = "passed";
} catch (cause) {
  report.status = "failed";
  report.failure = String(cause?.stack ?? cause);
  process.exitCode = 1;
} finally {
  try {
    await verifyRuntime("after");
  } catch (cause) {
    report.status = "failed";
    report.runtime_identity_failure = String(cause?.stack ?? cause);
    process.exitCode = 1;
  }
  if (
    !(await finalizeRetainedQueryReceipt({
      report,
      client,
      transport,
      account,
      serverLog,
      serverLogFinished,
      output: values.output,
      transcript,
    }))
  )
    process.exitCode = 1;
}
