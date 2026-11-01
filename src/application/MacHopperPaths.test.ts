import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, relative } from "node:path";
import { describe, expect, it } from "vitest";

import {
  localMacHopperRenamedLauncherCandidates,
  macHopperCanonicalLauncherCandidates,
  macHopperRenamedLauncherCandidates,
  readMacHopperRenamedLauncherCandidates,
} from "./MacHopperPaths.js";

describe("macOS Hopper launcher paths", () => {
  const home = "/fixture/home";

  it("keeps canonical system and user candidates ahead of renamed bundles", () => {
    expect(macHopperCanonicalLauncherCandidates(home)).toEqual([
      "/Applications/Hopper Disassembler.app/Contents/MacOS/hopper",
      "/fixture/home/Applications/Hopper Disassembler.app/Contents/MacOS/hopper",
    ]);
    expect(
      macHopperRenamedLauncherCandidates(
        home,
        new Map([
          [
            "/Applications",
            ["Hopper z.app", "Hopper a.app", "Hopper Disassembler.app"],
          ],
          ["/fixture/home/Applications", ["Hopper User.app"]],
        ]),
      ),
    ).toEqual([
      "/Applications/Hopper a.app/Contents/MacOS/hopper",
      "/Applications/Hopper z.app/Contents/MacOS/hopper",
      "/fixture/home/Applications/Hopper User.app/Contents/MacOS/hopper",
    ]);
  });

  it("finds the same renamed user bundles through runtime and doctor scans", async () => {
    // Keep native ownership for all I/O, including UNC temporary directories.
    // On Windows, a checkout-relative home models POSIX separators without
    // discarding the drive/share or normalizing a UNC prefix through posix.join.
    const root =
      process.platform === "win32" ? join(process.cwd(), "build") : tmpdir();
    await mkdir(root, { recursive: true });
    const temporary = await mkdtemp(join(root, "rea-hopper-paths-"));
    const home =
      process.platform === "win32"
        ? relative(process.cwd(), temporary).replaceAll("\\", "/")
        : temporary;
    const applications = join(temporary, "Applications");
    try {
      await mkdir(join(applications, "Hopper Preview.app"), {
        recursive: true,
      });
      await mkdir(join(applications, "Hopper Disassembler.app"));
      await writeFile(join(applications, "Hopper File.app"), "");
      const runtime = [...localMacHopperRenamedLauncherCandidates(home)];
      expect(runtime.filter((path) => path.startsWith(home))).toEqual([
        posix.join(
          home,
          "Applications/Hopper Preview.app/Contents/MacOS/hopper",
        ),
      ]);
      expect(await readMacHopperRenamedLauncherCandidates(home)).toEqual(
        runtime,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
