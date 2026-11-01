/** Equivalent selected dependency questions; raw artifacts/transcripts stay outside Git. */
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
    ...Object.fromEntries(
      ["runtime", "artifact", "expected", "output"].map((name) => [
        name,
        { type: "string" },
      ]),
    ),
    lane: { type: "string" },
  },
});
for (const name of ["runtime", "artifact", "expected", "output"])
  assert.ok(values[name] && values[name] === resolve(values[name]), name);
assert.ok(["complete", "selected"].includes(values.lane));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const expected = JSON.parse(await readFile(values.expected, "utf8"));
assert.equal(expected.artifact.path, values.artifact);
const names = ["serde", "serde_derive"];
const fields = ["name", "version", "source", "dependencies"];
const choose = (report) =>
  (report.auditable_metadata?.packages ?? []).flatMap((row, index) =>
    names.includes(row.name)
      ? [
          {
            index,
            ...Object.fromEntries(fields.map((field) => [field, row[field]])),
          },
        ]
      : [],
  );
const answer = (rows) => {
  const targets = new Set(
    rows.filter((row) => row.name === "serde_derive").map((row) => row.index),
  );
  return {
    packages: rows,
    direct_edges: rows
      .filter((row) => row.name === "serde")
      .flatMap((row) =>
        row.dependencies
          .filter((index) => targets.has(index))
          .map((to_index) => ({ from_index: row.index, to_index })),
      ),
  };
};
const expectedRows = choose(expected);
await mkdir(values.output, { mode: 0o700 });
const account = await mkdtemp(join(tmpdir(), "rea-rust-views-"));
const client = new Client({ name: "rust-dependency-views", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(values.runtime, "scripts/rea.mjs"), "mcp"],
  env: {
    HOME: account,
    PATH: process.env.PATH,
    NODE_OPTIONS: "--max-old-space-size=2048",
    UV_THREADPOOL_SIZE: "1",
    REA_LOG_LEVEL: "silent",
    TMPDIR: account,
  },
  stderr: "pipe",
});
const serverLog = createWriteStream(join(values.output, "server.log"));
const serverLogFinished = finished(serverLog);
serverLogFinished.catch(() => {});
transport.stderr?.pipe(serverLog);
const report = {
  lane: values.lane,
  artifact_sha256: hash(await readFile(values.artifact)),
  normalized_sha256: hash(JSON.stringify(expected)),
  calls: [],
};
const transcript = [];
const call = createRetainedQueryCaller(client, (receipt, event) => {
  report.calls.push(receipt);
  transcript.push(event);
});
const observe = async (name, input, phase) => {
  const reply = await call(name, input, phase);
  assert.notEqual(reply.isError, true, JSON.stringify(reply));
  assert.ok(reply.structuredContent);
  return reply.structuredContent;
};
try {
  await client.connect(transport);
  const catalog = await client.listTools();
  assert.equal(catalog.nextCursor, undefined);
  report.catalog_tools = catalog.tools.length;
  report.catalog_sha256 = hash(JSON.stringify(catalog));
  await writeFile(join(values.output, "catalog.json"), JSON.stringify(catalog));
  const definitions = new Map(catalog.tools.map((tool) => [tool.name, tool]));
  const original = client.callTool.bind(client);
  client.callTool = (input, options) =>
    original(input, {
      ...options,
      toolDefinition: definitions.get(input.name),
    });
  const selected = values.lane === "selected";
  const reply = await observe(
    "inspect_rust_binary",
    {
      path: values.artifact,
      ...(selected ? { view: { collection: "packages", names, fields } } : {}),
    },
    "question",
  );
  const parentId = selected
    ? reply.normalized_result.parent_evidence_id
    : reply.evidence_id;
  const rows = selected
    ? reply.normalized_result.page.rows
    : choose(reply.normalized_result);
  assert.deepEqual(rows, expectedRows);
  report.answer = answer(rows);
  assert.deepEqual(report.answer, answer(expectedRows));
  report.parent_evidence_id = parentId;
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
  assert.deepEqual(parent.normalized_result, expected);
  assert.equal(parent.subject.digest.sha256, report.artifact_sha256);
  if (selected)
    assert.deepEqual(reply.normalized_result.source_coverage, {
      auditable_metadata_available: expected.auditable_metadata !== null,
      embedded_records:
        expected.auditable_metadata === null ? "unknown" : "complete",
      runtime_dependencies: "unknown",
    });
  assert.equal(hash(await readFile(values.artifact)), report.artifact_sha256);
  report.status = "passed";
} catch (cause) {
  report.status = "failed";
  report.failure = String(cause?.stack ?? cause);
  process.exitCode = 1;
} finally {
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
