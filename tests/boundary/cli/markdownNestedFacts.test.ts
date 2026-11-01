import { join } from "node:path";
import { expect, it } from "vitest";

import { renderCliDocument } from "../../../src/cliOutput.js";
import { writeOrderedZip } from "../../fixtures/artifactEntryOrder.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { workspaceCliTest } from "../../support/cli/workspaceCliFixture.js";

it("retains nested facts in standalone Markdown table cells and mixed arrays", () => {
  const value = [
    {
      details: { path: "alpha.txt" },
      entries: [{ path: "sub/beta.txt" }],
      mixed: ["selected", { nested: "caller|value" }],
    },
  ];
  const markdown = renderCliDocument(value, "md", false);
  expect(markdown).toContain('{"path":"alpha.txt"}');
  expect(markdown).toContain('\\[{"path":"sub/beta.txt"}\\]');
  expect(markdown).toContain("caller\\|value");
  expect(markdown).not.toContain("[object Object]");
  expect(
    renderCliDocument({ mixed: [1, { path: "retained" }] }, "md", false),
  ).toContain('{"path":"retained"}');
  expect(JSON.parse(renderCliDocument(value, "json", false))).toEqual(value);
});

workspaceCliTest(
  "preserves archive inventory facts through public Markdown and JSON output",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-markdown-archive-facts-");
    const archive = join(root, "fixture.zip");
    await writeOrderedZip(archive, ["alpha.txt", "sub/beta.txt"]);
    const markdown = await cli.run({
      arguments: ["inspect-artifact", archive, "--format", "md"],
    });
    const json = await cli.run({
      arguments: ["inspect-artifact", archive, "--json"],
    });
    expect(markdown.exitCode).toBe(0);
    expect(json.exitCode).toBe(0);
    for (const entry of ["alpha.txt", "sub/beta.txt"]) {
      expect(markdown.stdout).toContain(entry);
      expect(json.stdout).toContain(entry);
    }
    expect(markdown.stdout).not.toContain("[object Object]");
  },
);
