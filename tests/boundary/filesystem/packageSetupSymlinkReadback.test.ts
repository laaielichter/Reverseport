import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

import { configureClientConfiguration } from "../../../src/application/SetupClientConfiguration.js";
import {
  assertCodexSymlink,
  CODEX_ORIGINAL,
} from "../../../scripts/verify-package-setup.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// The packaged-setup verifier reads back symlinked Codex and Cursor configs.
// Real setup writes through both links; the verifier must accept that result
// (its Codex table check once matched a mangled header and always failed).
it("accepts setup that writes through symlinked Codex and Cursor configs", async () => {
  const home = await createTestTempDirectory("rea-package-symlink-");
  const targets = join(home, "targets");
  await mkdir(targets);
  await mkdir(join(home, ".codex"));
  await mkdir(join(home, ".cursor"));
  const codexTarget = join(targets, "config.toml");
  const cursorTarget = join(targets, "mcp.json");
  const codexConfig = join(home, ".codex", "config.toml");
  const cursorConfig = join(home, ".cursor", "mcp.json");
  await writeFile(codexTarget, CODEX_ORIGINAL);
  await writeFile(cursorTarget, "{}\n");
  await symlink(codexTarget, codexConfig);
  await symlink(cursorTarget, cursorConfig);
  const cli = resolve("scripts/rea.mjs");
  const command = [process.execPath, cli, "mcp"];
  expect(
    await configureClientConfiguration(
      { name: "codex", format: "toml", configPath: codexConfig },
      {},
      command,
    ),
  ).toMatchObject({ status: "configured" });
  expect(
    await configureClientConfiguration(
      { name: "cursor", format: "json", configPath: cursorConfig },
      {},
      command,
    ),
  ).toMatchObject({ status: "configured" });
  await expect(
    assertCodexSymlink({ cli, codexConfig, cursorConfig, codexTarget }),
  ).resolves.toBeUndefined();
});
