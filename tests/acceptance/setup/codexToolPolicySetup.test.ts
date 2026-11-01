import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { expect } from "vitest";

import {
  codexToolPolicy,
  codexToolPolicySource,
} from "../../fixtures/codexToolPolicy.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "Codex policy survives setup preview, refresh, doctor, repeat and uninstall",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-codex-tool-policy-");
    const config = join(home, ".codex/config.toml");
    const original = codexToolPolicySource("tables");
    await mkdir(dirname(config), { recursive: true });
    await writeFile(config, original);
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: arguments_,
        cwd: home,
        environment: {
          HOME: home,
          USERPROFILE: home,
          CODEX_HOME: dirname(config),
          XDG_CONFIG_HOME: join(home, ".config"),
          REA_GHIDRA_STARTUP_TIMEOUT_MS: "17000",
        },
      });
    const doctorArguments = [
      "doctor",
      "--client",
      "codex",
      "--skill=false",
      "--json",
    ];
    const assertAligned = (value: unknown) =>
      expect(value).toMatchObject({
        scope_checks: expect.arrayContaining([
          expect.objectContaining({ name: "registration:codex", ok: true }),
        ]),
      });
    const setupArguments = [
      "setup",
      "--client",
      "codex",
      "--skill=false",
      "--json",
    ];
    const preview = await run([...setupArguments, "--dry-run"]);
    expect(preview.exitCode, preview.stdout).toBe(0);
    expect(preview.json).toMatchObject({ status: "planned" });
    expect(await readFile(config, "utf8")).toBe(original);
    expect(await readdir(dirname(config))).toEqual(["config.toml"]);

    const applied = await run([...setupArguments, "--yes"]);
    expect(applied.exitCode, applied.stdout).toBe(0);
    expect(applied.json).toMatchObject({
      status: "ready",
      clients: { codex: { status: "configured" } },
    });
    const configured = await readFile(config, "utf8");
    expect(configured).toContain("# retained root comment");
    expect(configured).toContain("# caller approval");
    expect(
      parseToml(configured, { integersAsBigInt: "asNeeded" }),
    ).toMatchObject({
      model: "caller-model",
      mcp_servers: {
        other: { command: "other" },
        rea: {
          ...codexToolPolicy,
          startup_timeout_sec: 19,
          tool_timeout_sec: 999,
          env: {
            CALLER_SETTING: "kept exactly",
            REA_GHIDRA_STARTUP_TIMEOUT_MS: "17000",
          },
        },
      },
    });
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    assertAligned((await run(doctorArguments)).json);
    const repeated = await run([...setupArguments, "--yes"]);
    expect(repeated.exitCode, repeated.stdout).toBe(0);
    expect(repeated.json).toMatchObject({
      status: "ready",
      appliedActions: [],
    });
    expect(await readFile(config, "utf8")).toBe(configured);
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);

    const removed = await run(["uninstall", "--json"]);
    expect(removed.exitCode, removed.stdout).toBe(0);
    expect(parseToml(await readFile(config, "utf8"))).toEqual({
      model: "caller-model",
      mcp_servers: { other: { command: "other" } },
    });
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
  },
);
