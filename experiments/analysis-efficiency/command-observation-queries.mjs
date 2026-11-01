import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createRetainedQueryCaller } from "./retained-query-calls.mjs";
import { finalizeRetainedQueryReceipt } from "./retained-query-finalization.mjs";

const { values } = parseArgs({
  options: {
    runtime: { type: "string" },
    input: { type: "string" },
    oracle: { type: "string" },
    output: { type: "string" },
    provider: { type: "string" },
    symbol: { type: "string" },
    detail: { type: "string", default: "complete" },
    warm: { type: "boolean", default: false },
  },
});
for (const key of ["runtime", "input", "oracle", "output"])
  assert.equal(values[key], resolve(values[key]));
assert.ok(["gdb", "objdump"].includes(values.provider));
assert.ok(["complete", "summary"].includes(values.detail));
const oracle = JSON.parse(await readFile(values.oracle, "utf8"));
assert.ok(oracle.symbols.some((row) => row.name === values.symbol));
const inputBytes = await readFile(values.input);
assert.equal(
  createHash("sha256").update(inputBytes).digest("hex"),
  oracle.artifact_sha256,
);
const require = createRequire(join(values.runtime, "package.json"));
const { Client } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/client"))
);
const { StdioClientTransport } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/client/stdio"))
);
await mkdir(values.output, { mode: 0o700 });
const account = await mkdtemp(join(tmpdir(), "rea-command-views-"));
const client = new Client({ name: "command-observation-task", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(values.runtime, "scripts/rea.mjs"), "mcp"],
  env: {
    HOME: account,
    PATH: process.env.PATH,
    NODE_OPTIONS: "--max-old-space-size=2048",
    UV_THREADPOOL_SIZE: "1",
    REA_LOG_LEVEL: "silent",
  },
  stderr: "pipe",
});
const serverLog = createWriteStream(join(values.output, "server.log"));
const serverLogFinished = finished(serverLog);
serverLogFinished.catch(() => {});
transport.stderr?.pipe(serverLog);
const transcript = [];
const report = {
  question:
    "Read architecture and the complete byte-annotated disassembly of one selected native function; export complete Evidence. No inferior execution.",
  provider: values.provider,
  symbol: values.symbol,
  detail: values.detail,
  warm: values.warm,
  calls: [],
  observations: [],
};
const call = createRetainedQueryCaller(client, (receipt, event) => {
  report.calls.push(receipt);
  transcript.push(event);
});
let sessionId;
try {
  await client.connect(transport);
  const catalog = await client.listTools();
  await writeFile(join(values.output, "catalog.json"), JSON.stringify(catalog));
  const definitions = new Map(catalog.tools.map((tool) => [tool.name, tool]));
  const originalCall = client.callTool.bind(client);
  client.callTool = (input, options) =>
    originalCall(input, {
      ...options,
      timeout: 60000,
      toolDefinition: definitions.get(input.name),
    });
  const observe = async (name, input, phase = name) => {
    const response = await call(name, input, phase);
    assert.ok(!response.isError, JSON.stringify(response));
    report.observations.push({
      name,
      phase,
      evidence: response.structuredContent,
    });
    return response.structuredContent;
  };
  const completeParents = [];
  const disassemble = async (phase) => {
    const selection = values.detail === "summary" ? { detail: "summary" } : {};
    const result =
      values.provider === "gdb"
        ? await observe(
            "gdb_console",
            {
              session_id: sessionId,
              command: `disassemble /r ${values.symbol}`,
              ...selection,
            },
            phase,
          )
        : await observe(
            "inspect_with_objdump",
            {
              path: values.input,
              operation: "disassemble",
              symbol: values.symbol,
              ...selection,
            },
            phase,
          );
    completeParents.push(result);
  };
  if (values.provider === "gdb") {
    const started = await observe("start_gdb_session", {});
    sessionId = started.session_id;
    for (const command of [
      "set auto-load off",
      "set debuginfod enabled off",
      `file ${values.input}`,
      "show architecture",
    ])
      await observe("gdb_console", { session_id: sessionId, command });
  } else
    await observe("inspect_with_objdump", {
      path: values.input,
      operation: "file_headers",
    });
  await disassemble("disassembly:fresh");
  if (values.warm) await disassemble("disassembly:repeat");
  if (sessionId) {
    await observe("close_gdb_session", { session_id: sessionId });
    sessionId = undefined;
  }
  await observe("export_evidence_bundle", {
    path: join(values.output, "evidence.json"),
  });
  const bundle = JSON.parse(
    await readFile(join(values.output, "evidence.json"), "utf8"),
  );
  for (const delivered of completeParents) {
    const parent =
      values.detail === "complete"
        ? delivered
        : bundle.records.find(
            (record) =>
              record.evidence_id ===
              delivered.normalized_result.parent_evidence_id,
          );
    assert.ok(parent);
    assert.equal(parent.normalized_result.completion_status, "complete");
    assert.equal(parent.normalized_result.output_truncated, false);
    if (values.provider === "gdb") assert.equal(parent.subject, null);
    else assert.equal(parent.subject.digest.sha256, oracle.artifact_sha256);
    if (values.detail === "summary") {
      const selected = delivered.normalized_result.summary;
      const { available_counts: counts, ...facts } = selected;
      const { console, target, log, ...records } = parent.normalized_result;
      assert.deepEqual(
        values.provider === "gdb" ? facts : selected,
        values.provider === "gdb" ? records : parent.normalized_result,
      );
      if (values.provider === "gdb")
        assert.equal(counts.console_utf16_units, console.length);
      assert.equal(delivered.raw_result, null);
    }
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  if (sessionId)
    try {
      const closed = await call(
        "close_gdb_session",
        { session_id: sessionId },
        "cleanup:gdb",
      );
      assert.ok(!closed.isError);
    } catch (error) {
      report.gdb_cleanup_failure = String(error);
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
