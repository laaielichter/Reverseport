import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { createMarkdownRenderer, disposeMdItInstance } from "vitepress";
import { afterAll, expect } from "vitest";

import { createEvidence } from "../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { renderCliDocument } from "../../../src/cliOutput.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

afterAll(() => disposeMdItInstance());

const renderedCells = (html: string): string[] => {
  const text = (node: DefaultTreeAdapterTypes.Node): string =>
    node.nodeName === "#text" && "value" in node
      ? node.value
      : "childNodes" in node
        ? node.childNodes.map(text).join("")
        : "";
  const cells: string[] = [];
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ("tagName" in node && (node.tagName === "th" || node.tagName === "td"))
      cells.push(text(node));
    else if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parseFragment(html));
  return cells;
};

cliTest(
  "preserves literal Evidence keys and values when Markdown tables are rendered",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-markdown-literal-cells-");
    const path = join(root, "bundle.json");
    const literal =
      "`code` **bold** _name_ ~~deleted~~ [label](target) ![alt](image)";
    const punctuation = "\\`tick` \\*star* \\[label](target) a|b <T> &copy;";
    const identifiers = "x__y__z _a_b_ 中_文 snake_case_";
    const row = {
      [literal]: literal,
      punctuation,
      nested: { text: literal, values: ["__name__", "plain"] },
      empty: "",
      zero: 0,
      disabled: false,
      absent: null,
      source_index: identifiers,
    };
    const result = { scalar: { [literal]: literal }, rows: [row] };
    const record = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      { operation: "ordinary-json", parameters: {}, result },
    );
    const saved = JSON.stringify(createEvidenceBundle([record]));
    await writeFile(path, saved);
    const base = [
      "inspect-evidence-bundle",
      JSON.stringify({ path, detail: "complete" }),
      "--filter-output",
      "records.0.normalized_result",
    ];
    const json = await cli.run({ arguments: [...base, "--json"] });
    const markdown = await cli.run({ arguments: [...base, "--format", "md"] });
    expect(json.exitCode, json.stderr).toBe(0);
    expect(markdown.exitCode, markdown.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      records: { "0": { normalized_result: result } },
    });
    expect(await readFile(path, "utf8")).toBe(saved);
    // Intraword underscores cannot form emphasis, so identifiers stay readable.
    expect(markdown.stdout).toContain(" source_index ");
    expect(markdown.stdout).toContain(
      " x__y__z \\_a_b\\_ 中_文 snake_case\\_ ",
    );

    const renderer = await createMarkdownRenderer(root, { linkify: false });
    const html = renderer.render(markdown.stdout);
    const expectedCells = [
      "Key",
      "Value",
      literal,
      literal,
      ...Object.keys(row),
      literal,
      punctuation,
      JSON.stringify(row.nested),
      "",
      "0",
      "false",
      "null",
      identifiers,
    ];
    expect(renderedCells(html)).toEqual(expectedCells);
    expect(html).not.toMatch(/<(?:em|strong|s|code|img)(?:\s|>)/u);

    // Standalone reports share the same table owner as command output.
    expect(
      renderedCells(renderer.render(renderCliDocument(result, "md", false))),
    ).toEqual(expectedCells);
  },
);
