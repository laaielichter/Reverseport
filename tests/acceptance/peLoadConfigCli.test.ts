import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import {
  PE_LOAD_CONFIG_FIXTURE,
  peLoadConfigImage,
} from "../../src/native/pe/PeLoadConfig.fixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

for (const bits of [32, 64] as const) {
  cliTest(`reads PE${bits} TLS callbacks through the CLI`, async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pe-config-cli-");
    await writeFile(join(root, "app.exe"), peLoadConfigImage({ bits }));
    const result = await cli.run({
      arguments: ["inspect-pe-load-config", "app.exe", "--json"],
      cwd: root,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_pe_load_config").outputSchema.parse(
      result.json,
    );
    expect(evidence.normalized_result.bits).toBe(bits);
    expect(evidence.normalized_result.tls?.callbacks).toHaveLength(3);
    expect(evidence.normalized_result.load_config).toMatchObject({
      dynamic_value_reloc_table_offset:
        PE_LOAD_CONFIG_FIXTURE.dynamicRelocOffset,
      dynamic_value_reloc_table_section:
        PE_LOAD_CONFIG_FIXTURE.dynamicRelocSection,
    });
    expect(evidence.subject?.local_path).toBe(join(root, "app.exe"));
  });
}
cliTest("fails closed at the callback limit", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-pe-config-budget-");
  const path = join(root, "app.exe");
  await writeFile(path, peLoadConfigImage());
  const result = await cli.run({
    arguments: [
      "inspect-pe-load-config",
      path,
      "--max-callbacks",
      "1",
      "--json",
    ],
  });
  expect(result.exitCode).toBe(1);
  expect(JSON.stringify(result.json)).toContain("Raise max_callbacks above 1");
});
