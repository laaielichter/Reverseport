/** Compare unchanged public WASM tasks; raw inputs, exports and transcripts stay outside Git. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { finished } from "node:stream/promises";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createRetainedQueryCaller } from "./retained-query-calls.mjs";
import { finalizeRetainedQueryReceipt } from "./retained-query-finalization.mjs";

const { values } = parseArgs({
  options: Object.fromEntries(
    ["runtime", "artifact", "wat", "tools", "output"].map((name) => [
      name,
      { type: "string" },
    ]),
  ),
});
for (const name of ["runtime", "artifact", "wat", "tools", "output"])
  assert.ok(
    values[name] && values[name] === resolve(values[name]),
    `${name} must be absolute`,
  );
const hash = (value) => createHash("sha256").update(value).digest("hex");
const bytes = await readFile(values.artifact);
const nativeWat = await readFile(values.wat, "utf8");
// Native compilation validates the independent name inventory; no instance or target code runs.
const module = new WebAssembly.Module(bytes);
const nativeImports = WebAssembly.Module.imports(module);
const nativeExports = WebAssembly.Module.exports(module);
await mkdir(values.output, { mode: 0o700 });
const account = await mkdtemp(join(tmpdir(), "rea-wat-framing-"));
const client = new Client({ name: "wasm-string-framing", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(values.runtime, "scripts/rea.mjs"), "mcp"],
  env: {
    HOME: account,
    PATH: process.env.PATH,
    NODE_OPTIONS: "--max-old-space-size=2048",
    UV_THREADPOOL_SIZE: "1",
    REA_LOG_LEVEL: "silent",
    REA_WABT_BIN_DIRECTORY: values.tools,
    TMPDIR: account,
  },
  stderr: "pipe",
});
const serverLog = createWriteStream(join(values.output, "server.log"));
const serverLogFinished = finished(serverLog);
serverLogFinished.catch(() => {});
transport.stderr?.pipe(serverLog);
const report = {
  artifact_sha256: hash(bytes),
  artifact_bytes: bytes.length,
  calls: [],
  answers: [],
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
const started = performance.now();
try {
  await client.connect(transport);
  const catalog = await client.listTools();
  assert.equal(catalog.nextCursor, undefined);
  await writeFile(join(values.output, "catalog.json"), JSON.stringify(catalog));
  report.catalog_sha256 = hash(JSON.stringify(catalog));
  report.catalog_tools = catalog.tools.length;
  const definitions = new Map(
    catalog.tools.map((definition) => [definition.name, definition]),
  );
  const originalCall = client.callTool.bind(client);
  client.callTool = (input, options) =>
    originalCall(input, {
      ...options,
      toolDefinition: definitions.get(input.name),
    });
  const observations = [];
  for (const phase of ["fresh", "repeat"]) {
    const summary = await observe(
      "inspect_wasm_artifact",
      { path: values.artifact, detail: "summary" },
      phase,
    );
    const parentId = summary.normalized_result.parent_evidence_id;
    const exports = await observe(
      "inspect_analysis_view",
      {
        source: { kind: "retained-evidence", evidence_id: parentId },
        view: { kind: "wasm", facet: "exports", offset: 0, limit: 4 },
      },
      `${phase}:exports`,
    );
    assert.equal(exports.normalized_result.parent_evidence_id, parentId);
    observations.push({ summary, exports, parentId });
  }
  await observe(
    "export_evidence_bundle",
    { path: join(values.output, "evidence.json") },
    "export",
  );
  const bundle = JSON.parse(
    await readFile(join(values.output, "evidence.json"), "utf8"),
  );
  const kind = (value) => (value === "func" ? "function" : value);
  for (const { summary, exports, parentId } of observations) {
    const parent = bundle.records.find(
      (record) => record.evidence_id === parentId,
    );
    assert.ok(parent);
    assert.equal(parent.subject.digest.sha256, report.artifact_sha256);
    const facts = parent.normalized_result;
    assert.equal(facts.validation, "valid");
    assert.equal(facts.wat.text, nativeWat);
    assert.equal(facts.wat.sha256, hash(nativeWat));
    assert.equal(facts.interface.state, "complete");
    assert.deepEqual(
      facts.interface.entries
        .filter((entry) => entry.direction === "import")
        .map((entry) => ({
          module: entry.module,
          name: entry.name,
          kind: kind(entry.kind),
        })),
      nativeImports,
    );
    assert.deepEqual(
      facts.interface.entries
        .filter((entry) => entry.direction === "export")
        .map((entry) => ({ name: entry.name, kind: kind(entry.kind) })),
      nativeExports,
    );
    assert.deepEqual(exports.normalized_result.item, facts.exports.slice(0, 4));
    assert.equal(
      summary.normalized_result.summary.available_counts.imports,
      nativeImports.length,
    );
    assert.equal(
      summary.normalized_result.summary.available_counts.exports,
      nativeExports.length,
    );
    assert.equal(facts.runtime_execution, "not-performed");
    assert.equal(facts.network_fetch, "not-performed");
    report.answers.push({
      parent_evidence_id: parentId,
      normalized_sha256: hash(JSON.stringify(facts)),
      exports: exports.normalized_result.item,
    });
  }
  assert.deepEqual(report.answers[0], report.answers[1]);
  assert.equal(hash(await readFile(values.artifact)), report.artifact_sha256);
  report.status = "passed";
} catch (cause) {
  report.status = "failed";
  report.failure = String(cause?.stack ?? cause);
  process.exitCode = 1;
} finally {
  report.elapsed_ms_before_cleanup = performance.now() - started;
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
