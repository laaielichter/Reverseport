import {
  access,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";

import { setupRegistrationCommand } from "../../../src/application/SetupHost.js";
import { classifyClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "registers a same-file PATH launcher whose manager-owned alias survives a version switch",
  async () => {
    const root = await createTestTempDirectory("rea-stable-launcher-alias-");
    const installs = join(root, "installs");
    const old = join(installs, "old");
    const next = join(installs, "next");
    const scriptWithin = (tag: string) =>
      join("node_modules", ".mise", `reverseport@${tag}`, "scripts", "rea.mjs");
    for (const [version, tag] of [
      [old, "old"],
      [next, "next"],
    ] as const) {
      await mkdir(join(version, "bin"), { recursive: true });
      const script = join(version, scriptWithin(tag));
      await mkdir(dirname(script), { recursive: true });
      await writeFile(script, "#!/usr/bin/env node\n", { mode: 0o700 });
      await symlink(script, join(version, "bin", "rea"));
    }
    const latest = join(installs, "latest");
    await symlink(old, latest, "dir");
    const unstable = join(latest, scriptWithin("old"));
    const alias = join(latest, "bin", "rea");
    const command = setupRegistrationCommand("linux", undefined, unstable, {
      PATH: join(latest, "bin"),
    });
    expect(command).toEqual([alias, "mcp"]);
    expect(classifyClientRegistrationCommand(command, unstable)).toBe("owned");
    await rm(latest);
    await symlink(next, latest, "dir");
    await rm(old, { recursive: true });
    await expect(access(unstable)).rejects.toMatchObject({ code: "ENOENT" });
    await access(command[0]!);
    expect(await realpath(command[0]!)).toBe(join(next, scriptWithin("next")));
    expect(
      classifyClientRegistrationCommand(
        command,
        join(next, scriptWithin("next")),
      ),
    ).toBe("owned");
  },
);

it.skipIf(process.platform === "win32")(
  "keeps selected entrypoint when PATH aliases are foreign, unresolved, unexecutable or relative",
  async () => {
    const root = await createTestTempDirectory("rea-unproven-launcher-alias-");
    const entrypoint = join(root, "selected.mjs");
    await writeFile(entrypoint, "selected", { mode: 0o700 });
    const foreign = join(root, "foreign");
    const missing = join(root, "missing");
    const unexecutable = join(root, "unexecutable");
    for (const path of [foreign, missing, unexecutable]) await mkdir(path);
    await writeFile(join(foreign, "rea"), "different program", { mode: 0o700 });
    await symlink(join(root, "absent"), join(missing, "rea"));
    // Same identity cannot be reached via an executable launcher when the selected
    // file itself has no executable bit; no shell wrapper is inferred or run.
    const selected = join(root, "unexecutable.mjs");
    await writeFile(selected, "selected", { mode: 0o600 });
    await symlink(selected, join(unexecutable, "rea"));
    expect(
      setupRegistrationCommand("linux", undefined, entrypoint, {
        PATH: `${foreign}:${missing}:relative`,
      }),
    ).toEqual([entrypoint, "mcp"]);
    expect(
      setupRegistrationCommand("linux", undefined, selected, {
        PATH: unexecutable,
      }),
    ).toEqual([selected, "mcp"]);
    expect(
      setupRegistrationCommand("win32", undefined, entrypoint, {
        PATH: foreign,
      }),
    ).toEqual([process.execPath, entrypoint, "mcp"]);
  },
);
