import {
  captureRuntimeBinding,
  assertRuntimeBinding,
} from "./managed-cli-runtime.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
const execute = promisify(execFile);
const [runtime, root, output, mode, cache = "cold"] = process.argv.slice(2);
for (const value of [runtime, root, output])
  assert.equal(resolve(value), value);
assert.ok(["complete", "selected"].includes(mode));
assert.ok(["cold", "warm"].includes(cache));
await mkdir(output);
await mkdir(join(output, "tmp"));
const oracle = JSON.parse(await readFile(join(root, "oracle.json"), "utf8"));
const target = join(root, "Newtonsoft.Json.dll");
const hash = (value) => createHash("sha256").update(value).digest("hex");
assert.equal(hash(await readFile(target)), oracle.assembly_sha256);
const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, stable(value[key])]),
        )
      : value;
const report = {
  status: "incomplete",
  runtime,
  mode,
  cache,
  node: process.version,
  question:
    "Report identity/selection/source coverage for JsonConvert, its total method count and the first eight complete method records, plus the first sixteen assembly-wide MemberRef records and continuation coverage.",
  recipe:
    mode === "selected"
      ? "Use --detail summary --evidence-bundle FILE; pass the exact parent_evidence_id to inspect-analysis-view --evidence-bundle FILE with source kind retained-evidence and view {kind:managed-members,collection:methods|member_refs,offset:0,limit:8|16}."
      : "Use inspect-managed-members --type Newtonsoft.Json.JsonConvert; the completed full Evidence supplies the requested rows and remains accessible.",
  calls: [],
  cleanup_verified: false,
};
const began = performance.now();
const environment = {
  PATH: process.env.PATH,
  HOME: output,
  TMPDIR: join(output, "tmp"),
  LANG: "C.UTF-8",
  REA_LOG_LEVEL: "silent",
  UV_THREADPOOL_SIZE: "1",
  NODE_OPTIONS: "--max-old-space-size=2048",
  ...(cache === "cold"
    ? { NODE_DISABLE_COMPILE_CACHE: "1" }
    : { NODE_COMPILE_CACHE: join(root, `compile-cache-${mode}`) }),
};
const call = async (label, args, json = true) => {
  const started = performance.now();
  const result = await execute(
    process.execPath,
    [join(runtime, "scripts/rea.mjs"), ...args],
    {
      cwd: output,
      env: environment,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120000,
    },
  );
  await writeFile(join(output, label + ".stdout"), result.stdout);
  await writeFile(join(output, label + ".stderr"), result.stderr);
  report.calls.push({
    label,
    arguments: ["rea", ...args],
    elapsed_ms: performance.now() - started,
    stdout_bytes: Buffer.byteLength(result.stdout),
    stdout_file: label + ".stdout",
  });
  return json ? JSON.parse(result.stdout) : result.stdout;
};
let parent, summary, methods, refs;
try {
  const inputs = JSON.parse(
    await readFile(join(root, "measurement-inputs.json"), "utf8"),
  );
  const expected = inputs.expected_runtime_bindings?.[mode];
  assert.ok(expected, `Missing expected runtime for ${mode}`);
  assert.equal(
    expected.git_revision,
    mode === "complete"
      ? inputs.baseline_revision
      : inputs.feature_parent_revision,
  );
  assert.notEqual(
    inputs.expected_runtime_bindings.complete.root,
    inputs.expected_runtime_bindings.selected.root,
  );
  assert.notEqual(
    inputs.expected_runtime_bindings.complete.compiled_cli_sha256,
    inputs.expected_runtime_bindings.selected.compiled_cli_sha256,
  );
  const bindingStarted = performance.now();
  report.runtime_binding = await captureRuntimeBinding(runtime);
  report.runtime_binding_audit_ms = {
    before: performance.now() - bindingStarted,
  };
  assertRuntimeBinding(report.runtime_binding, expected, mode);
  await call("help-members", ["inspect-managed-members", "--help"], false);
  if (mode === "complete") {
    parent = await call("complete", [
      "inspect-managed-members",
      target,
      "--type",
      "Newtonsoft.Json.JsonConvert",
      "--json",
    ]);
    methods = parent.normalized_result.methods.slice(0, 8);
    refs = parent.normalized_result.member_refs.slice(0, 16);
  } else {
    await call("help-view", ["inspect-analysis-view", "--help"], false);
    const bundlePath = join(output, "parent.json");
    summary = await call("summary", [
      "inspect-managed-members",
      target,
      "--type",
      "Newtonsoft.Json.JsonConvert",
      "--detail",
      "summary",
      "--evidence-bundle",
      bundlePath,
      "--json",
    ]);
    const id = summary.normalized_result.parent_evidence_id;
    assert.ok(id);
    const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    assert.equal(bundle.records.length, 1);
    parent = bundle.records[0];
    assert.equal(parent.evidence_id, id);
    for (const [collection, limit] of [
      ["methods", 8],
      ["member_refs", 16],
    ]) {
      const value = await call(collection, [
        "inspect-analysis-view",
        JSON.stringify({
          source: { kind: "retained-evidence", evidence_id: id },
          view: { kind: "managed-members", collection, offset: 0, limit },
        }),
        "--evidence-bundle",
        bundlePath,
        "--json",
      ]);
      const page = value.normalized_result;
      assert.equal(page.parent_evidence_id, id);
      assert.deepEqual(page.source_coverage, parent.normalized_result.coverage);
      assert.deepEqual(
        page.page.rows,
        parent.normalized_result[collection].slice(0, limit),
      );
      assert.equal(
        page.coverage.total,
        parent.normalized_result[collection].length,
      );
      assert.equal(page.coverage.next_offset, limit);
      assert.equal(page.coverage.exhausted, false);
      if (collection === "methods") methods = page.page.rows;
      else refs = page.page.rows;
    }
  }
  const data = parent.normalized_result;
  assert.equal(data.artifact.sha256, oracle.assembly_sha256);
  assert.equal(data.methods.length, 72);
  assert.equal(data.member_refs.length, 2149);
  assert.equal(data.types.length, 1);
  assert.equal(data.types[0].token, oracle.selected_types[0].token);
  for (let i = 0; i < data.methods.length; i++) {
    const row = data.methods[i],
      wanted = oracle.selected_types[0].methods[i];
    assert.equal(row.token, wanted.token);
    assert.equal(row.name, wanted.name);
    assert.equal(row.rva, wanted.rva);
    assert.equal(
      row.signature.raw_sha256,
      hash(Buffer.from(wanted.signature_hex, "hex")),
    );
  }
  for (let i = 0; i < refs.length; i++) {
    const row = refs[i],
      wanted = oracle.member_refs_first_16[i];
    assert.equal(row.token, wanted.token);
    assert.equal(row.name, wanted.name);
    assert.equal(
      row.signature.raw_sha256,
      hash(Buffer.from(wanted.signature_hex, "hex")),
    );
  }
  assert.equal(methods.length, 8);
  assert.equal(refs.length, 16);
  if (summary) {
    assert.equal(summary.normalized_result.summary.reported_counts.methods, 72);
    assert.equal(
      summary.normalized_result.summary.reported_counts.member_refs,
      2149,
    );
    assert.deepEqual(summary.normalized_result.summary.coverage, data.coverage);
    assert.deepEqual(
      summary.normalized_result.summary.selection,
      data.selection,
    );
  }
  const answer = {
    parent_evidence_id: parent.evidence_id,
    artifact_sha256: oracle.assembly_sha256,
    selection: data.selection,
    source_coverage: data.coverage,
    total_methods: data.methods.length,
    total_member_refs: data.member_refs.length,
    methods,
    member_refs: refs,
    limitation:
      "MemberRef rows are assembly-wide; methods are selected-type rows. Page exhaustion is not an absence claim.",
  };
  report.parent_evidence_id = parent.evidence_id;
  report.parent_semantic_sha256 = hash(JSON.stringify(stable(parent)));
  report.answer_sha256 = hash(JSON.stringify(stable(answer)));
  report.oracle_verified = {
    all_selected_method_metadata: 72,
    returned_methods: 8,
    returned_member_refs: 16,
  };
  const bindingFinished = performance.now();
  assertRuntimeBinding(
    await captureRuntimeBinding(runtime),
    report.runtime_binding,
    mode,
  );
  report.runtime_binding_audit_ms.after = performance.now() - bindingFinished;
  report.runtime_binding_verified = true;
  report.status = "passed";
  await writeFile(join(output, "parent-evidence.json"), JSON.stringify(parent));
  await writeFile(join(output, "answer.json"), JSON.stringify(answer));
} finally {
  report.elapsed_ms = performance.now() - began;
  report.cleanup_verified = true;
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(
  JSON.stringify({
    status: report.status,
    mode,
    cache,
    parent: report.parent_evidence_id,
    answer: report.answer_sha256,
    calls: report.calls.map((c) => ({
      label: c.label,
      elapsed_ms: c.elapsed_ms,
      bytes: c.stdout_bytes,
    })),
  }),
);
