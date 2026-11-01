import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { javaScriptSemanticTraceResultSchema } from "../../../src/domain/javascript/javascriptSemanticTraceSchemas.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "preserves exact empty events and unresolved property queries through public Evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-graph-query-coverage-");
    await writeFile(
      join(root, "main.cjs"),
      'const { EventEmitter } = require("node:events"); const bus = new EventEmitter(); bus.on("", function emptyListener() {}); function read() { return this.speed; }',
    );
    await writeFile(join(root, "other.js"), "export const answer = 42;");
    const response = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        "--source-path",
        "main.cjs",
        "--source-path",
        "other.js",
        "--format",
        "json",
      ],
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const evidence = parseEvidence(response.json);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      evidence.normalized_result,
    );
    expect(result.source_selection?.unselected_files).toBe(0);
    expect(
      result.graph.limitations.some((text) =>
        text.includes("relationships through unselected sources"),
      ),
    ).toBe(false);
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected shared MCP session");
    for (const seed of [
      { kind: "event", name: "" },
      { kind: "property", name: "speed" },
    ] as const) {
      const traced = await call("trace_javascript_semantics", {
        application: evidence,
        query: { seed, direction: "forward-influence" },
      });
      expect(traced.isError, JSON.stringify(traced.content)).not.toBe(true);
      const trace = javaScriptSemanticTraceResultSchema.parse(
        parseEvidence(traced.structuredContent).normalized_result,
      );
      expect(trace.summary.total_seed_matches).toBeGreaterThan(0);
      if (seed.kind === "property")
        expect(trace.summary.relevant_unknowns).toBeGreaterThan(0);
    }
  },
);
