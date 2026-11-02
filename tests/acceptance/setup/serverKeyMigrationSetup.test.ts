import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "setup plans, approves and applies the move of an owned previous-name registration once",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-server-key-setup-");
    const config = join(home, ".cursor", "mcp.json");
    await mkdir(join(home, ".cursor"));
    const original = `${JSON.stringify(
      {
        mcpServers: {
          rea: {
            command: "npx",
            args: ["-y", "reverseport@1.0.0", "mcp"],
            env: { FOO: "bar" },
          },
        },
      },
      null,
      2,
    )}\n`;
    await writeFile(config, original);
    const run = (mode: string) =>
      cli.run({
        arguments: [
          "setup",
          "--client",
          "cursor",
          "--skill=false",
          "--json",
          mode,
        ],
        cwd: home,
        environment: { HOME: home, USERPROFILE: home, TMPDIR: home },
      });

    const preview = await run("--dry-run");
    expect(preview.exitCode, preview.stdout).toBe(0);
    expect(preview.json).toMatchObject({
      status: "planned",
      plannedActions: [
        {
          id: "configure_client:cursor",
          operation: "update",
          backupPath: `${config}.rea.backup`,
          detail: expect.stringContaining(
            `Rename REA's registration "rea" to "reverseport"`,
          ),
        },
      ],
    });
    expect(await readFile(config, "utf8")).toBe(original);

    const applied = await run("--yes");
    expect(applied.exitCode, applied.stdout).toBe(0);
    expect(applied.json).toMatchObject({
      status: "ready",
      clients: { cursor: { status: "configured" } },
    });
    const servers = JSON.parse(await readFile(config, "utf8")).mcpServers;
    expect(servers).not.toHaveProperty("rea");
    expect(servers.reverseport).toMatchObject({ env: { FOO: "bar" } });
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);

    const repeated = await run("--yes");
    expect(repeated.exitCode, repeated.stdout).toBe(0);
    expect(repeated.json).toMatchObject({
      status: "ready",
      plannedActions: [],
    });
  },
);
