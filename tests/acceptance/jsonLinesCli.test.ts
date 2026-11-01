import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { parseEvidence } from "../../src/domain/evidence.js";
import { analysisViewJavaScriptEvidence } from "../fixtures/analysisView.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "exports authenticated analysis-view rows, preserving every Evidence fact and empty/partial coverage",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-json-lines-view-");
    const parent = analysisViewJavaScriptEvidence();
    const evidencePath = join(root, "parent.json");
    const requestPath = join(root, "request.json");
    await writeFile(evidencePath, JSON.stringify(parent));
    const request = {
      source: { kind: "evidence-file", path: evidencePath },
      view: { kind: "javascript-facts", property_keys: [], limit: 1 },
    };
    await writeFile(requestPath, JSON.stringify(request));

    const invalid = await cli.run({
      arguments: ["inspect-analysis-view", "--format", "jsonl"],
    });
    expect(invalid.exitCode).toBe(1);
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      $rea: "jsonl/v1",
      type: "error",
      result: { code: "VALIDATION_ERROR" },
    });

    const badOutputValue = await cli.run({
      arguments: ["--format", "jsonl", "--token-limit", "invalid"],
    });
    expect(badOutputValue.exitCode).toBe(1);
    expect(JSON.parse(badOutputValue.stdout)).toMatchObject({
      $rea: "jsonl/v1",
      type: "error",
    });

    for (const where of [undefined, { paths: [] }]) {
      await writeFile(
        requestPath,
        JSON.stringify({
          ...request,
          view: { ...request.view, ...(where === undefined ? {} : { where }) },
        }),
      );
      const json = await cli.run({
        arguments: ["inspect-analysis-view", requestPath, "--json"],
      });
      expect(json.exitCode, json.stderr).toBe(0);
      const expected = parseEvidence(json.json);
      const result = await cli.run({
        arguments: ["inspect-analysis-view", requestPath, "--format", "jsonl"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const records = result.stdout
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
      const final = records.pop();
      expect(final).toMatchObject({
        $rea: "jsonl/v1",
        type: "metadata",
        records: {
          path: ["normalized_result", "rows"],
          emitted: records.length,
          source: records.length,
        },
        context: {
          evidence_links: [parent.evidence_id],
          normalized_result: { parent_evidence_id: parent.evidence_id },
        },
      });
      const reconstructed = {
        ...final.context,
        normalized_result: {
          ...final.context.normalized_result,
          rows: records,
        },
      };
      // Authenticate the reconstructed Evidence, rather than checking only a few
      // convenient fields from a shortened view-shaped object.
      expect(parseEvidence(reconstructed)).toEqual(expected);
      expect(records.length).toBe(where === undefined ? 1 : 0);
    }
  },
);
