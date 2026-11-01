// Compare complete public MCP tasks with caller-selected input advertisements.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Ajv2020 } from "ajv/dist/2020.js";
import { sampleRetainedHeap } from "./mcp-retained-heap.mjs";
import {
  captureRuntimeBinding,
  assertRuntimeBinding,
} from "./managed-cli-runtime.mjs";

const { values } = parseArgs({
  options: {
    runtime: { type: "string" },
    artifact: { type: "string" },
    oracle: { type: "string" },
    output: { type: "string" },
    profile: { type: "string", default: "default" },
    phase: { type: "string", default: "analysis" },
    cache: { type: "string", default: "cold" },
    "cache-root": { type: "string" },
    bindings: { type: "string" },
    role: { type: "string" },
    "diagnostic-heap": { type: "boolean", default: false },
  },
});
assert.ok(["analysis", "discovery"].includes(values.phase));
assert.ok(["cold", "warm"].includes(values.cache));
assert.ok(!values["diagnostic-heap"] || values.phase === "analysis");
for (const key of values.phase === "analysis"
  ? ["runtime", "artifact", "oracle", "output"]
  : ["runtime", "output"])
  assert.ok(
    values[key] && resolve(values[key]) === values[key],
    `${key} must be absolute`,
  );
assert.ok(["default", "full", "compact"].includes(values.profile));
if (values.cache === "warm")
  assert.ok(
    values["cache-root"] &&
      resolve(values["cache-root"]) === values["cache-root"],
  );
await mkdir(values.output, { recursive: false });
const hash = (value) => createHash("sha256").update(value).digest("hex");
let oracle;
let artifactSha;
if (values.phase === "analysis") {
  oracle = JSON.parse(await readFile(values.oracle, "utf8"));
  artifactSha = hash(await readFile(values.artifact));
  assert.equal(artifactSha, oracle.artifact_sha256);
}
let expectedBinding;
let bindingBefore;
let auditBeforeMs;
let measurementInputsSha256;
const producerSources = {};
if (values.bindings !== undefined) {
  assert.ok(["baseline", "candidate"].includes(values.role));
  const inputBytes = await readFile(values.bindings);
  measurementInputsSha256 = hash(inputBytes);
  const inputs = JSON.parse(inputBytes.toString("utf8"));
  for (const name of [
    "mcp-input-catalog.mjs",
    "managed-cli-runtime.mjs",
    "mcp-retained-heap.mjs",
  ]) {
    producerSources[name] = hash(
      await readFile(new URL(name, import.meta.url)),
    );
    assert.equal(producerSources[name], inputs.harness_sources_sha256[name]);
  }
  expectedBinding = inputs.runtime_bindings[values.role];
  const start = performance.now();
  bindingBefore = await captureRuntimeBinding(values.runtime, "mcp");
  auditBeforeMs = performance.now() - start;
  assertRuntimeBinding(bindingBefore, expectedBinding, values.role);
}
const environment = {
  PATH: process.env.PATH,
  HOME: values.output,
  REA_LOG_LEVEL: "silent",
  UV_THREADPOOL_SIZE: "1",
  NODE_OPTIONS: "--max-old-space-size=2048",
  ...(values.cache === "cold"
    ? { NODE_DISABLE_COMPILE_CACHE: "1" }
    : { NODE_COMPILE_CACHE: values["cache-root"] }),
  ...(values.profile === "default"
    ? {}
    : { REA_MCP_INPUT_SCHEMA_PROFILE: values.profile }),
};
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    ...(values["diagnostic-heap"] ? ["--inspect=127.0.0.1:0"] : []),
    join(values.runtime, "scripts/rea.mjs"),
    "mcp",
  ],
  cwd: values.output,
  env: environment,
  stderr: "pipe",
});
const protocolRequests = {};
const send = transport.send.bind(transport);
transport.send = (...args) => {
  const method = args[0].method;
  if (typeof method === "string")
    protocolRequests[method] = (protocolRequests[method] ?? 0) + 1;
  return send(...args);
};
const client = new Client({ name: "rea-catalog-task", version: "1" });
const report = {
  profile: values.profile,
  phase: values.phase,
  cache: values.cache,
  cache_root: values["cache-root"] ?? null,
  role: values.role,
  measurement_inputs_sha256: measurementInputsSha256,
  producer_sources_sha256: producerSources,
  artifact_sha256: artifactSha,
  calls: [],
  checks: [],
  status: "incomplete",
  cleanup_verified: false,
  protocol_requests: protocolRequests,
};
const transcript = [];
let stderr = "";
let inspectorEndpoint;
transport.stderr?.on("data", (value) => {
  stderr += value;
  if (values["diagnostic-heap"] && inspectorEndpoint === undefined)
    inspectorEndpoint = stderr.match(
      /Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/u,
    )?.[1];
});
const began = performance.now();
try {
  await client.connect(transport);
  report.protocol_era = client.getProtocolEra();
  await writeFile(
    join(values.output, "server.json"),
    JSON.stringify({
      info: client.getServerVersion(),
      capabilities: client.getServerCapabilities(),
      instructions: client.getInstructions(),
    }),
  );
  const catalog = await client.listTools();
  assert.equal(catalog.nextCursor, undefined);
  const definitions = new Map(catalog.tools.map((tool) => [tool.name, tool]));
  assert.equal(definitions.size, catalog.tools.length);
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  for (const tool of catalog.tools)
    assert.ok(
      ajv.validateSchema(tool.inputSchema),
      `Invalid schema: ${tool.name}`,
    );
  {
    const encoded = JSON.stringify(catalog);
    await writeFile(join(values.output, "catalog.json"), encoded);
    report.catalog_sha256 = hash(encoded);
  }
  report.tool_names = [...definitions.keys()];
  if (values.phase === "discovery") {
    const prompts = await client.listPrompts();
    assert.equal(prompts.nextCursor, undefined);
    await writeFile(
      join(values.output, "prompts.json"),
      JSON.stringify(prompts),
    );
    report.prompts_sha256 = hash(JSON.stringify(prompts));
    report.answer = {
      tools: report.tool_names,
      prompts: prompts.prompts.map((prompt) => prompt.name),
    };
    report.status = "passed";
  } else {
    const call = async (name, args) => {
      const definition = definitions.get(name);
      assert.ok(definition, `Missing named tool ${name}`);
      const start = performance.now();
      const reply = await client.callTool(
        { name, arguments: args },
        { toolDefinition: definition },
      );
      report.calls.push({
        name,
        elapsed_ms: performance.now() - start,
        is_error: reply.isError === true,
      });
      transcript.push({ name, arguments: args, reply });
      return reply;
    };
    const input = {
      path: values.artifact,
      view: {
        collection: "packages",
        names: ["serde"],
        fields: ["name", "version", "kind"],
      },
    };
    const first = await call("inspect_rust_binary", input);
    assert.notEqual(first.isError, true);
    const selected = first.structuredContent;
    assert.ok(selected?.normalized_result?.page);
    assert.deepEqual(selected.normalized_result.page.rows, oracle.serde_rows);
    assert.equal(selected.subject.digest.sha256, artifactSha);
    const parentId = selected.normalized_result.parent_evidence_id;
    for (let index = 0; index < 2; index++) {
      const reply = await call("inspect_analysis_view", {
        source: { kind: "retained-evidence", evidence_id: parentId },
        view: {
          kind: "rust",
          collection: "packages",
          names: ["serde"],
          fields: ["name", "version", "kind"],
        },
      });
      assert.notEqual(reply.isError, true);
      assert.deepEqual(
        reply.structuredContent.normalized_result.page.rows,
        oracle.serde_rows,
      );
      assert.equal(
        reply.structuredContent.normalized_result.parent_evidence_id,
        parentId,
      );
    }
    const malformed = await call("inspect_rust_binary", {
      path: values.artifact,
      view: { collection: "packages", offset: -1 },
    });
    assert.equal(malformed.isError, true);
    report.checks.push(
      "Independent package rows and digest; repeated retained identity; canonical negative-offset refusal",
    );
    const exported = await call("export_evidence_bundle", {
      path: join(values.output, "evidence.json"),
    });
    assert.notEqual(exported.isError, true);
    const bundle = JSON.parse(
      await readFile(join(values.output, "evidence.json"), "utf8"),
    );
    const parent = bundle.records.find(
      (record) => record.evidence_id === parentId,
    );
    assert.ok(parent, "Complete original Evidence is retained");
    assert.equal(parent.subject.digest.sha256, artifactSha);
    assert.deepEqual(
      parent.normalized_result.auditable_metadata.packages,
      oracle.packages,
    );
    assert.deepEqual(
      parent.normalized_result.auditable_metadata.dependency_edges,
      oracle.edges,
    );
    report.parent_evidence_id = parentId;
    report.parent_semantic_sha256 = hash(JSON.stringify(parent));
    report.answer = oracle.serde_rows;
    assert.deepEqual(
      await client.listTools(),
      catalog,
      "Advertisement changed after canonical materialization",
    );
    report.checks.push(
      "Catalog remains identical after canonical materialization",
    );
    report.status = "passed";
  }
  if (values["diagnostic-heap"]) {
    report.status = "incomplete";
    assert.ok(inspectorEndpoint, "Missing explicitly launched inspector");
    report.diagnostic_heap = await sampleRetainedHeap(
      inspectorEndpoint,
      transport.pid,
    );
    report.status = "passed";
  }
} finally {
  await client.close();
  await transport.close();
  report.cleanup_verified = transport.pid === null;
  assert.ok(report.cleanup_verified);
  report.elapsed_ms = performance.now() - began;
  if (expectedBinding !== undefined) {
    const start = performance.now();
    const after = await captureRuntimeBinding(values.runtime, "mcp");
    report.runtime_audit_ms = {
      before: auditBeforeMs,
      after: performance.now() - start,
    };
    assertRuntimeBinding(after, expectedBinding, values.role);
    assert.deepEqual(after, bindingBefore);
    assert.equal(
      hash(await readFile(values.bindings)),
      measurementInputsSha256,
    );
    for (const [name, digest] of Object.entries(producerSources))
      assert.equal(
        hash(await readFile(new URL(name, import.meta.url))),
        digest,
      );
    report.runtime_binding = after;
    report.runtime_binding_verified = true;
  }
  await writeFile(
    join(values.output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    join(values.output, "transcript.json"),
    JSON.stringify(transcript),
  );
  await writeFile(join(values.output, "server.log"), stderr);
}
