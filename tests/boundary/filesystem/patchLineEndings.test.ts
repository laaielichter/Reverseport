import { execFile } from "node:child_process";
import { copyFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);
const project = fileURLToPath(new URL("../../../", import.meta.url));

it("keeps dependency patches LF in a Windows-style autocrlf checkout", async () => {
  // `npm ci` runs prepare, which `git apply`s these patches to LF sources.
  // With core.autocrlf=true a CRLF patch no longer matches and install fails.
  const patches = (await readdir(join(project, "patches"))).filter((name) =>
    name.endsWith(".patch"),
  );
  expect(patches.length).toBeGreaterThan(0);
  const repository = await createTestTempDirectory("rea-patch-eol-");
  const git = (...args: string[]) =>
    execute("git", ["-c", "core.autocrlf=true", ...args], { cwd: repository });
  await git("init", "-q");
  await copyFile(
    join(project, ".gitattributes"),
    join(repository, ".gitattributes"),
  );
  for (const name of patches)
    await copyFile(join(project, "patches", name), join(repository, name));
  await git("add", ".");
  await git(
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-q",
    "-m",
    "fixture",
  );
  for (const name of patches) await rm(join(repository, name));
  await git("checkout", "--", ".");
  for (const name of patches)
    expect(await readFile(join(repository, name), "utf8")).not.toContain("\r");
});
