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
    documents: { type: "string", default: "64" },
  },
});
for (const key of ["runtime", "input", "oracle", "output"])
  assert.equal(values[key], resolve(values[key]));
const maxDocuments = Number(values.documents);
assert.ok([1, 64].includes(maxDocuments));
const oracle = JSON.parse(await readFile(values.oracle, "utf8"));
const baselinePath = oracle.complete_result_paths?.[String(maxDocuments)];
assert.equal(
  typeof baselinePath,
  "string",
  "Provide a pre-change baseline for the selected document limit.",
);
assert.equal(baselinePath, resolve(baselinePath));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(
  sha256(await readFile(join(values.input, oracle.document))),
  oracle.archive_sha256,
);
const require = createRequire(join(values.runtime, "package.json"));
const { Client } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/client"))
);
const { StdioClientTransport } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/client/stdio"))
);
await mkdir(values.output, { mode: 0o700 });
const account = await mkdtemp(join(tmpdir(), "rea-interface-builder-views-"));
const report = {
  question:
    "Identify archived AAC settings outlets and the VBR action with source/destination object identities, coverage and complete Evidence access.",
  max_documents: maxDocuments,
  calls: [],
};
const client = new Client({
  name: "rea-interface-builder-views",
  version: "1",
});
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
const call = createRetainedQueryCaller(client, (receipt, event) => {
  report.calls.push(receipt);
  transcript.push(event);
});
async function result(name, input, phase = name) {
  const reply = await call(name, input, phase);
  assert.ok(!reply.isError, JSON.stringify(reply));
  assert.ok(reply.structuredContent);
  assert.equal(reply.content.length, 1);
  assert.equal(reply.content[0].type, "text");
  assert.deepEqual(JSON.parse(reply.content[0].text), reply.structuredContent);
  return reply.structuredContent;
}
try {
  await client.connect(transport);
  const catalog = await client.listTools();
  assert.equal(catalog.nextCursor, undefined);
  report.catalog_tools = catalog.tools.length;
  await writeFile(join(values.output, "catalog.json"), JSON.stringify(catalog));
  await result("open_bundle_resources", { path: values.input });
  const initial = await result("decode_interface_builder", {
    max_documents: maxDocuments,
    detail: "summary",
  });
  const summary = initial.normalized_result;
  report.parent_evidence_id = summary.parent_evidence_id;
  assert.equal(summary.resource_root.executable_sha256, null);
  assert.equal(summary.artifact.sha256, null);
  assert.equal(summary.summary.truncated, true);
  assert.ok(
    summary.summary.documents.some(
      (d) =>
        d.relative_path === oracle.document &&
        d.archive_sha256 === oracle.archive_sha256,
    ),
  );
  const collections = {};
  for (const pass of ["first", "warm"]) {
    for (const collection of ["nodes", "edges"]) {
      const rows = [];
      let offset = 0;
      for (;;) {
        const selected = await result(
          "inspect_analysis_view",
          {
            source: {
              kind: "retained-evidence",
              evidence_id: report.parent_evidence_id,
            },
            view: {
              kind: "interface-builder",
              collection,
              document: oracle.document,
              offset,
              limit: 32,
            },
          },
          `retained:${pass}:${collection}:${offset}`,
        );
        const page = selected.normalized_result;
        assert.equal(page.parent_evidence_id, report.parent_evidence_id);
        assert.equal(page.source_truncated, true);
        assert.ok(page.unknowns.length > 0);
        rows.push(...page.items);
        if (page.coverage.exhausted) {
          assert.equal(rows.length, page.coverage.total);
          break;
        }
        assert.ok(page.items.length > 0);
        offset += page.items.length;
      }
      if (pass === "warm") assert.deepEqual(rows, collections[collection]);
      else collections[collection] = rows;
    }
  }
  const byId = new Map(collections.nodes.map((n) => [n.id, n]));
  for (const expected of oracle.connections) {
    const connector = collections.nodes.find(
      (n) => n.kind === expected.kind && n.name === expected.name,
    );
    assert.ok(connector);
    const sourceRelation =
      expected.kind === "outlet" ? "contains" : "target_action";
    const source = collections.edges.find(
      (e) => e.to === connector.id && e.relation === sourceRelation,
    );
    assert.equal(
      byId.get(source.from).attributes.interface_builder_object_id,
      expected.source,
    );
    const relation = expected.kind === "outlet" ? "outlet_to" : "target_action";
    const destination = collections.edges.find(
      (e) =>
        e.from === connector.id &&
        e.relation === relation &&
        byId.get(e.to)?.attributes.interface_builder_object_id ===
          expected.destination,
    );
    assert.equal(
      byId.get(destination.to).attributes.interface_builder_object_id,
      expected.destination,
    );
    for (const row of [connector, source, destination])
      assert.ok(
        row.evidence.some(
          (e) =>
            e.artifact_path === oracle.document &&
            e.artifact_sha256 === oracle.archive_sha256,
        ),
      );
  }
  report.answer = oracle.connections;
  await result("export_evidence_bundle", {
    path: join(values.output, "evidence.json"),
  });
  const bundle = JSON.parse(
    await readFile(join(values.output, "evidence.json"), "utf8"),
  );
  const parent = bundle.records.find(
    (e) => e.evidence_id === report.parent_evidence_id,
  );
  assert.equal(parent.subject, null);
  assert.equal(parent.operation, "decode_interface_builder");
  const full = parent.normalized_result;
  for (const collection of ["nodes", "edges"])
    assert.deepEqual(
      collections[collection],
      full.graph[collection].filter((r) =>
        r.evidence.some((e) => e.artifact_path === oracle.document),
      ),
    );
  const baselineBytes = await readFile(baselinePath, "utf8");
  const expectedParent = JSON.parse(baselineBytes);
  report.baseline_sha256 = sha256(baselineBytes);
  report.baseline_evidence_id = expectedParent.evidence_id;
  const mismatch = `Complete retained Evidence differs from the pre-change ${maxDocuments}-document baseline.`;
  assert.equal(parent.evidence_id, expectedParent.evidence_id, mismatch);
  assert.deepEqual(parent, expectedParent, mismatch);
  report.available_counts = {
    nodes: full.graph.nodes.length,
    edges: full.graph.edges.length,
  };
  report.oracle_sha256 = sha256(await readFile(values.oracle));
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
