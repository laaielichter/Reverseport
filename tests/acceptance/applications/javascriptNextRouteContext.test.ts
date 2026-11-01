import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "binds Next page candidates to their source root through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-next-route-context-");
    const page = "export default function Page(){return null;}";
    await writeFixtureFiles(root, {
      "package.json": JSON.stringify({ dependencies: { next: "16.4.2" } }),
      "app/page.js": page,
      "pages/app/page.js": page,
      "pages/app/settings/page.js": page,
      "components/app/not-a-route/page.js": page,
      "src/app/shadowed/page.js": page,
      "node_modules/ordinary/package.json": JSON.stringify({
        name: "ordinary",
      }),
      "node_modules/ordinary/app/dependency-only/page.js": page,
      "entry.mjs":
        "import Page from './components/app/not-a-route/page.js';export default Page;",
      "workspace/package.json": JSON.stringify({
        devDependencies: { next: "16.4.2" },
      }),
      "workspace/src/app/control/page.js": page,
      "plain/package.json": JSON.stringify({ main: "main.cjs" }),
      "plain/main.cjs":
        "module.exports=require('./components/app/module-only/page.js');",
      "plain/components/app/module-only/page.js":
        "module.exports={kind:'ordinary-module'};",
    });
    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    expect(result.statistics.parse_failures).toBe(0);
    const inventory = result.route_inventory;
    expect(
      inventory?.routes.map(({ path, source_count, occurrence_count }) => ({
        path,
        source_count,
        occurrence_count,
      })),
    ).toEqual([
      { path: "/", source_count: 1, occurrence_count: 1 },
      { path: "/control", source_count: 1, occurrence_count: 1 },
    ]);
    expect(
      inventory?.sources.find(({ key }) => key === "app/page.js")
        ?.next_app_context,
    ).toMatchObject({
      kind: "app-directory",
      directory: "app",
      package: { path: "package.json" },
    });
    const unproven = inventory?.sources.find(
      ({ key }) => key === "plain/components/app/module-only/page.js",
    );
    expect(unproven?.next_app_context).toMatchObject({ kind: "unknown" });
    expect(inventory?.unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_id: unproven?.id,
          kind: "interpretation",
        }),
      ]),
    );
  },
);
