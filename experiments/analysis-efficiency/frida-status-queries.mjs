import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { finished } from "node:stream/promises";
import { parseArgs } from "node:util";
import { createRetainedQueryCaller } from "./retained-query-calls.mjs";
import { finalizeRetainedQueryReceipt } from "./retained-query-finalization.mjs";
const { values } = parseArgs({
  options: {
    runtime: { type: "string" },
    output: { type: "string" },
    detail: { type: "string", default: "complete" },
    capture: { type: "string", default: "libc" },
  },
});
const { runtime, output, detail, capture } = values;
assert.ok(runtime && output);
assert.ok(["complete", "summary"].includes(detail));
assert.ok(["libc", "small"].includes(capture));
const require = createRequire(join(runtime, "package.json"));
const { Client } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/client"))
);
const { StdioClientTransport } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/client/stdio"))
);
const { parseLinuxProcessStat } = await import(
  pathToFileURL(join(runtime, "dist/process/LinuxProcessStat.js"))
);
await mkdir(output, { mode: 0o700 });
const account = await mkdtemp(join(tmpdir(), "rea-frida-real-"));
const serverLog = createWriteStream(join(output, "server.log"));
const serverLogFinished = finished(serverLog);
serverLogFinished.catch(() => {});
const client = new Client({ name: "rea-frida-audit", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(runtime, "scripts/rea.mjs"), "mcp"],
  env: {
    PATH: process.env.PATH,
    HOME: account,
    NODE_OPTIONS: "--max-old-space-size=2048",
    UV_THREADPOOL_SIZE: "1",
    REA_LOG_LEVEL: "silent",
  },
  stderr: "pipe",
});
transport.stderr?.pipe(serverLog, { end: false });
const report = {
  question:
    "Retain a complete caller-requested libc export inventory, then check only session identity/state and message capture coverage twice, preserving complete Evidence.",
  detail,
  capture,
  calls: [],
  status: "pending",
};
const transcript = [];
const caller = createRetainedQueryCaller(client, (receipt, event) => {
  report.calls.push(receipt);
  transcript.push(event);
});
const call = async (name, input) => {
  const r = await caller(name, input, name);
  assert.ok(!r.isError, JSON.stringify(r));
  return r.structuredContent;
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let session;
let birth;
const stat = async () => {
  try {
    return parseLinuxProcessStat(
      await readFile(`/proc/${session.pid}/stat`, "utf8"),
    );
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
};
try {
  await client.connect(transport);
  const catalog = await client.listTools();
  await writeFile(join(output, "catalog.json"), JSON.stringify(catalog));
  report.catalog_tools = catalog.tools.length;
  const defs = new Map(catalog.tools.map((t) => [t.name, t]));
  const orig = client.callTool.bind(client);
  client.callTool = (input, options) =>
    orig(input, {
      ...options,
      timeout: 30000,
      toolDefinition: defs.get(input.name),
    });
  report.devices = await call("list_frida_devices", {});
  session = await call("start_frida_session", {
    mode: "spawn",
    device_id: "local",
    program: "/usr/bin/sleep",
    argv: ["8"],
  });
  report.session = session;
  birth = await stat();
  assert.ok(birth);
  report.target_birth = birth;
  report.same_owned_cgroup =
    (await readFile(`/proc/${session.pid}/cgroup`, "utf8")) ===
    (await readFile("/proc/self/cgroup", "utf8"));
  assert.ok(report.same_owned_cgroup);
  const source = `send({kind:'ready',pid:Process.id});
setTimeout(() => {
  if (${JSON.stringify(capture)} === 'small') { send({kind:'complete',total:0}); return; }
  const module = Process.enumerateModules().find(m => /(^|\\/)libc\\.so\\.6$/.test(m.path));
  if (!module) { send({kind:'missing-libc'}); return; }
  const exports = module.enumerateExports().map(e => ({type:e.type,name:e.name,address:e.address.toString()}));
  send({kind:'module',pid:Process.id,path:module.path,base:module.base.toString(),size:module.size,total:exports.length});
  for (let offset = 0; offset < exports.length; offset += 64) send({kind:'exports',offset,items:exports.slice(offset,offset+64)});
  send({kind:'complete',total:exports.length});
}, 300);`;
  await writeFile(join(output, "selected-script.js"), source);
  report.source_sha256 = createHash("sha256").update(source).digest("hex");
  const loaded = await call("load_frida_script", {
    session_id: session.session_id,
    source_kind: "inline",
    source,
  });
  assert.equal(loaded.normalized_result.source_sha256, report.source_sha256);
  report.load = loaded.normalized_result;
  await call("resume_frida_session", { session_id: session.session_id });
  await delay(750);
  const snapshots = [];
  for (let n = 0; n < 2; n++)
    snapshots.push(
      await call("frida_session_status", {
        session_id: session.session_id,
        ...(detail === "summary" ? { detail } : {}),
      }),
    );
  await call("export_evidence_bundle", { path: join(output, "evidence.json") });
  const bundle = JSON.parse(
    await readFile(join(output, "evidence.json"), "utf8"),
  );
  for (const snapshot of snapshots) {
    assert.equal(snapshot.raw_result, null);
    const parent =
      detail === "summary"
        ? bundle.records.find(
            (e) =>
              e.evidence_id === snapshot.normalized_result.parent_evidence_id,
          )
        : snapshot;
    assert.ok(parent);
    assert.equal(parent.authority, "external-service");
    assert.equal(parent.environment, null);
    assert.equal(parent.raw_result, null);
    assert.equal(parent.operation, "frida_session_status");
    assert.deepEqual(parent.parameters, { session_id: session.session_id });
    const r = parent.normalized_result;
    assert.equal(r.pid, session.pid);
    assert.equal(r.state, "running");
    assert.equal(r.messages_truncated, false);
    const payloads = r.messages
      .filter((m) => m.type === "send")
      .map((m) => m.payload);
    const ready = payloads.find((p) => p?.kind === "ready");
    const complete = payloads.find((p) => p?.kind === "complete");
    assert.equal(ready?.pid, session.pid);
    assert.ok(complete);
    let count = 0;
    let header;
    if (capture === "libc") {
      header = payloads.find((p) => p?.kind === "module");
      assert.ok(header);
      assert.equal(header.pid, session.pid);
      for (const chunk of payloads.filter((p) => p?.kind === "exports")) {
        assert.equal(chunk.offset, count);
        count += chunk.items.length;
      }
      assert.equal(count, header.total);
      assert.ok(count > 1000);
      const maps = await readFile(`/proc/${session.pid}/maps`, "utf8");
      assert.ok(maps.includes(header.path));
    }
    assert.equal(count, complete.total);
    if (detail === "summary") {
      const view = snapshot.normalized_result;
      assert.equal(view.parent_operation, parent.operation);
      assert.equal(view.parent_digest, parent.evidence_id.slice(3));
      assert.equal(view.artifact, null);
      assert.deepEqual(view.source_parameters, parent.parameters);
      assert.deepEqual(view.source_provider, parent.provider);
      const { messages, ...metadata } = r;
      assert.deepEqual(view.summary, {
        ...metadata,
        messages_retained: messages.length,
      });
      assert.ok(view.unknowns.length > 0);
      assert.ok(view.limitations.some((m) => m.includes("operating system")));
      assert.deepEqual(
        bundle.records.find((e) => e.evidence_id === snapshot.evidence_id),
        snapshot,
      );
    }
    report.answer = {
      pid: r.pid,
      state: r.state,
      scripts: r.scripts.length,
      messages: r.messages.length,
      messages_truncated: r.messages_truncated,
      exports: count,
      module_path: header?.path ?? null,
    };
  }
  report.native_oracle =
    "Caller-authored script digest and contiguous chunk coverage; PID/birthtime/cgroup and libc path independently checked in procfs. Export addresses and native export completeness not independently qualified.";
  report.exported_bundle_bytes = Buffer.byteLength(
    await readFile(join(output, "evidence.json")),
  );
  await call("close_frida_session", { session_id: session.session_id });
  session.closed = true;
  const deadline = performance.now() + 12000;
  while (true) {
    const current = await stat();
    if (
      current === null ||
      current.startTime !== birth.startTime ||
      ["zombie", "dead"].includes(current.lifecycle)
    ) {
      report.original_target_exited = true;
      break;
    }
    assert.ok(
      performance.now() < deadline,
      "Original target exit not observed",
    );
    await delay(50);
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  if (session && !session.closed)
    try {
      await call("close_frida_session", { session_id: session.session_id });
    } catch (error) {
      report.session_cleanup_failure = String(error);
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
      output,
      transcript,
    }))
  )
    process.exitCode = 1;
}
