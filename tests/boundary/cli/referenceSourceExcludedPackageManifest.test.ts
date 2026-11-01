import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { historicalSourceGraphSchema } from "../../../src/domain/referenceSourceGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "keeps package selection unknown when its manifest is excluded",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-reference-excluded-package-main-",
    );
    const config = await createTestTempDirectory(
      "rea-reference-excluded-package-main-config-",
    );
    await mkdir(join(root, "pkg"), { recursive: true });
    await Promise.all([
      writeFile(join(root, ".gitignore"), "pkg/package.json\n"),
      writeFile(join(root, "main.cjs"), 'require("./pkg");\n'),
      writeFile(join(root, "pkg", "package.json"), '{"main":"actual.cjs"}\n'),
      writeFile(join(root, "pkg", "actual.cjs"), "module.exports = 1;\n"),
      writeFile(join(root, "pkg", "index.js"), "module.exports = 2;\n"),
    ]);

    const result = await cli.run({
      arguments: ["import-reference-source", root, "--json"],
      environment: {
        HOME: config,
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: config,
      },
    });
    expect(result.exitCode, result.stderr + JSON.stringify(result.json)).toBe(
      0,
    );
    const graph = historicalSourceGraphSchema.parse(result.json);
    expect(graph.exclusions).toContainEqual({
      path: "pkg/package.json",
      entry_kind: "file",
      reason: "project-ignored",
      pattern: "pkg/package.json",
    });
    expect(graph.entries.map(({ path }) => path)).toEqual(
      expect.arrayContaining(["pkg/actual.cjs", "pkg/index.js"]),
    );
    expect(graph.relationships).toContainEqual({
      from_path: "main.cjs",
      to: "pkg",
      kind: "requires",
      resolution: "unresolved",
      parse_state: "parsed",
    });
    expect(graph.relationships).not.toContainEqual(
      expect.objectContaining({
        from_path: "main.cjs",
        to: "pkg/index.js",
        resolution: "internal",
      }),
    );
  },
);
