/** Complete entropy question through production stdio, with full source export. */
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
  options: Object.fromEntries(
    ["runtime", "oracle", "identity", "output"].map((name) => [
      name,
      { type: "string" },
    ]),
  ),
});
for (const value of Object.values(values)) assert.equal(value, resolve(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const oracleBytes = await readFile(values.oracle);
const oracle = JSON.parse(oracleBytes);
const identityBytes = await readFile(values.identity);
const identity = JSON.parse(identityBytes);
await mkdir(values.output, { mode: 0o700 });
const account = await mkdtemp(join(tmpdir(), "rea-entropy-task-"));
const client = new Client({ name: "entropy-complete-task", version: "1" });
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
  question:
    "Return the file SHA-256, file-wide entropy, every entropy block and adjacent high/low run in the requested byte window; preserve the complete source Evidence.",
  request: oracle.input,
  calls: [],
  phases: {},
  client:
    "Production stdio SDK, exact discovered toolDefinition and default validator",
  runtime_identity_sha256: sha256(identityBytes),
  oracle_sha256: sha256(oracleBytes),
  driver_sha256: sha256(await readFile(new URL(import.meta.url))),
};
const transcript = [];
let definitions;
const call = createRetainedQueryCaller(
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
const observe = async (name, args, phase) => {
  const result = await call(name, args, phase);
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(result.structuredContent);
  return result.structuredContent;
};
const verifyRuntime = async () => {
  assert.equal(sha256(await readFile(values.oracle)), sha256(oracleBytes));
  assert.equal(sha256(await readFile(values.identity)), sha256(identityBytes));
  assert.equal(sha256(await readFile(process.execPath)), identity.node_sha256);
  assert.equal(
    sha256(await readFile(new URL(import.meta.url))),
    report.driver_sha256,
  );
  for (const item of identity.files)
    assert.equal(sha256(await readFile(item.path)), item.sha256, item.path);
};
try {
  await verifyRuntime();
  const start = performance.now();
  await client.connect(transport);
  report.server_instructions = client.getInstructions() ?? "";
  const catalog = await client.listTools();
  definitions = new Map(catalog.tools.map((tool) => [tool.name, tool]));
  await writeFile(join(values.output, "catalog.json"), JSON.stringify(catalog));
  report.phases.discovery_ms = performance.now() - start;
  const parent = await observe("inspect_byte_entropy", oracle.input, "inspect");
  for (const [key, value] of Object.entries(oracle.expected))
    assert.deepEqual(parent.normalized_result[key], value, key);
  report.parent_evidence_id = parent.evidence_id;
  report.source_report_sha256 = sha256(
    JSON.stringify(parent.normalized_result),
  );
  report.artifact = parent.normalized_result.artifact;
  await observe(
    "export_evidence_bundle",
    { path: join(values.output, "source.evidence.json") },
    "export",
  );
  const bundle = JSON.parse(
    await readFile(join(values.output, "source.evidence.json")),
  );
  assert.deepEqual(
    bundle.records.find((item) => item.evidence_id === parent.evidence_id),
    parent,
  );
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
    report.identity_failure = String(cause);
  }
  await finalizeRetainedQueryReceipt({
    client,
    transport,
    account,
    serverLog,
    serverLogFinished,
    report,
    transcript,
    output: values.output,
  });
  if (
    report.status !== "passed" ||
    report.cleanup_failures.length ||
    report.receipt_failures.length
  )
    process.exitCode = 1;
}
