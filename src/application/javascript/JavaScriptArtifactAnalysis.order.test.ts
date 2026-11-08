import { expect, it } from "vitest";
import {
  analyzeAndAdoptJavaScriptArtifactFiles,
  javaScriptAnalysisOrder,
} from "./JavaScriptArtifactAnalysis.js";
import { createJavaScriptSemanticGraphProjection } from "./JavaScriptSemanticGraphBuilder.js";
import { analyzeJavaScriptStaticSource } from "../../domain/javascript/javascriptStaticAnalysis.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import { err, ok } from "../../domain/result.js";

const container = "a".repeat(64);

const source = (path: string): JavaScriptArtifactFile => ({
  path,
  container_sha256: container,
  sha256: "b".repeat(64),
  bytes: 1,
  inventory_artifact_id: path,
  kind: "javascript",
  unpacked: false,
  text: { included: true, value: ";" },
});

const fileSet = (files: readonly JavaScriptArtifactFile[]) => ({
  files,
  unavailable_relevant_files: [],
  containers: [],
  text_bytes_read: 0,
  invalid_utf8_files: 0,
});

// Inventory order sorts the dependency tree before the application's own
// directory, as in an electron-vite `app.asar` (upstream REA #9321).
const inventory = [
  source("node_modules/a-lib/index.js"),
  source("node_modules/b-lib/lib/util.js"),
  source("out/main/index.js"),
  source("out/preload/index.js"),
];

it("analyzes first-party sources before installed dependencies", () => {
  expect(javaScriptAnalysisOrder(inventory).map(({ path }) => path)).toEqual([
    "out/main/index.js",
    "out/preload/index.js",
    "node_modules/a-lib/index.js",
    "node_modules/b-lib/lib/util.js",
  ]);
  const firstPartyOnly = inventory.slice(2);
  expect(javaScriptAnalysisOrder(firstPartyOnly)).toBe(firstPartyOnly);
});

it("spends an exhausted result budget on dependencies, not on the application's entry points", async () => {
  const javascript = analyzeJavaScriptStaticSource("");
  const analyzed: string[] = [];
  let budget = 2;
  const worker = {
    analyze: async (file: JavaScriptArtifactFile) => {
      analyzed.push(file.path);
      if (budget-- > 0)
        return ok({ javascript, module: null, projection: null });
      return err({
        javascript: null,
        module: null,
        projection: null,
        error: new AnalysisResourceConstraintError(
          "analyze_javascript_application",
          "capacity",
          "The parent result budget is exhausted",
          { parent_result_budget_exhausted: true },
        ),
      });
    },
  };
  const { analysis } = await analyzeAndAdoptJavaScriptArtifactFiles(
    fileSet(inventory),
    worker,
    createJavaScriptSemanticGraphProjection(),
    async () => {},
  );
  expect(analyzed.slice(0, 2)).toEqual([
    "out/main/index.js",
    "out/preload/index.js",
  ]);
  // Results keep inventory order whatever order analyzed them.
  expect(analysis.files.map(({ file }) => file.path)).toEqual(
    inventory.map(({ path }) => path),
  );
  const status = Object.fromEntries(
    analysis.files.map(({ file, analysis_failure }) => [
      file.path,
      analysis_failure?.status ?? "analyzed",
    ]),
  );
  expect(status).toMatchObject({
    "out/main/index.js": "analyzed",
    "out/preload/index.js": "analyzed",
  });
  expect(status["node_modules/b-lib/lib/util.js"]).not.toBe("analyzed");
});
