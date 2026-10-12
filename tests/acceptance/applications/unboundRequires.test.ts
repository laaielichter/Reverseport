import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative } from "node:path";

import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains unbound CommonJS semantic relationships through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-unbound-requires-");
    const lines = [
      'require("./dependency.cjs");',
      'void require("./dependency.cjs");',
      'consume(require("./dependency.cjs"));',
      'require("./dependency.cjs").member;',
      'const {} = require("./dependency.cjs");',
      'const bound = require("./dependency.cjs");',
      'const { left, right } = require("./dependency.cjs");',
      'module.exports = require("./dependency.cjs", require("./nested.cjs"));',
      'function local(require) { require("./shadow.cjs"); }',
      "require(dynamicSpecifier);",
      'let assigned; assigned = require("./dependency.cjs");',
    ] as const;
    const source = lines.join("\n");
    const files = {
      "main.cjs": source,
      "imports.mjs": 'import "./dependency.cjs";',
      "dependency.cjs": 'throw new Error("fixture must not execute");',
      "nested.cjs": 'throw new Error("fixture must not execute");',
    };
    await Promise.all(
      Object.entries(files).map(([path, text]) =>
        writeFile(join(root, path), text),
      ),
    );
    const nativeRequire = createRequire(join(root, "main.cjs"));
    for (const name of ["dependency", "nested"])
      expect(
        relative(root, nativeRequire.resolve(`./${name}.cjs`)).replaceAll(
          "\\",
          "/",
        ),
      ).toBe(`${name}.cjs`);

    let document: unknown;
    if (surface === "CLI") {
      const response = await cli.run({
        arguments: ["analyze-javascript-application", root, "--format", "json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(response.exitCode, response.stderr).toBe(0);
      document = response.json;
    } else {
      const { call } = await connectLocalToolsMcp();
      const response = await call("analyze_javascript_application", {
        input_path: root,
        format: "directory",
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      document = response.structuredContent;
    }
    const evidence = parseEvidence(document);
    const { graph } = javascriptApplicationAnalysisResultSchema.parse(
      evidence.normalized_result,
    );
    const links = graph.edges.filter(
      ({ relation, properties, evidence: edgeEvidence }) =>
        relation === "imports" &&
        properties.module_link_kind === "require" &&
        edgeEvidence.location.available &&
        edgeEvidence.location.value.kind === "source-range" &&
        edgeEvidence.location.value.source === "main.cjs",
    );
    expect(links).toHaveLength(10);
    for (const [line, count] of [
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1],
      [6, 1],
      [7, 2],
      [8, 1],
      [11, 1],
    ] as const)
      expect(
        links.filter(
          ({ evidence: edgeEvidence }) =>
            edgeEvidence.location.available &&
            edgeEvidence.location.value.kind === "source-range" &&
            edgeEvidence.location.value.start.line === line,
        ),
        `semantic links on line ${line}`,
      ).toHaveLength(count);
    const digest = createHash("sha256").update(source).digest("hex");
    for (const edge of links) {
      expect(edge.evidence.artifact).toMatchObject({
        available: true,
        sha256: digest,
      });
      expect(edge.properties.resolution_status).toBe("resolved");
      expect(edge.properties.resolved_path).toBe(
        edge.properties.specifier === "./nested.cjs"
          ? "nested.cjs"
          : "dependency.cjs",
      );
    }
    const bare = links.find(
      ({ evidence: edgeEvidence }) =>
        edgeEvidence.location.available &&
        edgeEvidence.location.value.kind === "source-range" &&
        edgeEvidence.location.value.start.line === 1,
    );
    expect(bare).toMatchObject({
      properties: {
        imported_name: null,
        local_name: null,
        exported_name: null,
      },
      evidence: {
        location: {
          available: true,
          value: {
            source: "main.cjs",
            start: { line: 1, column: 0 },
            end: { line: 1, column: lines[0].length - 1 },
          },
        },
      },
    });
    expect(
      graph.nodes
        .flatMap(({ observations }) => observations)
        .find(
          ({ properties }) =>
            properties.semantic_role === "source-module" &&
            properties.path === "main.cjs",
        )?.properties.import_relationships,
    ).toBe(10);
    expect(
      graph.edges.some(
        ({ relation, properties }) =>
          relation === "imports" &&
          properties.kind === "require" &&
          properties.specifier === "./dependency.cjs",
      ),
    ).toBe(true);
    expect(
      graph.edges.filter(
        ({ relation, properties }) =>
          relation === "imports" &&
          properties.module_link_kind === "commonjs-export" &&
          properties.specifier === "./dependency.cjs",
      ),
    ).toHaveLength(1);
  },
);
