import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { systemUninstallHost } from "../../../src/application/Uninstall.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.each(["darwin", "linux"] as const)(
  "purges producer-owned default cache namespaces on %s and preserves their siblings",
  async (platform) => {
    const home = await createTestTempDirectory("rea-managed-cache-purge-");
    const cache = join(
      home,
      platform === "darwin" ? "Library/Caches" : "xdg-cache",
    );
    const directories = [
      join(home, ".rea", "cache"),
      join(home, ".rea", "state"),
      join(cache, "rea", "kuna"),
      ...(platform === "linux" ? [join(cache, "rea", "hopper-releases")] : []),
    ];
    for (const directory of directories) {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "cached"), "REA cache");
    }
    const sibling = join(cache, "rea", "caller-evidence");
    await mkdir(sibling);
    await writeFile(join(sibling, "retained"), "caller evidence");
    const host = systemUninstallHost(
      home,
      undefined,
      { XDG_CACHE_HOME: cache },
      platform,
    );
    try {
      const result = await host.purgeData();
      expect(result.filter(({ status }) => status === "removed")).toHaveLength(
        directories.length,
      );
      for (const directory of directories)
        await expect(readFile(join(directory, "cached"))).rejects.toMatchObject(
          { code: "ENOENT" },
        );
      expect(await readFile(join(sibling, "retained"), "utf8")).toBe(
        "caller evidence",
      );
      expect(
        (await host.purgeData()).every(({ status }) => status === "skipped"),
      ).toBe(true);
    } finally {
      await host.close?.();
    }
  },
);

it("retains an arbitrary caller-selected Kuna cache and refuses a linked managed namespace", async () => {
  const home = await createTestTempDirectory("rea-managed-cache-link-");
  const custom = join(home, "caller-data");
  await mkdir(custom);
  await writeFile(join(custom, "evidence"), "retained");
  const cache = join(home, "cache");
  await mkdir(cache);
  await symlink(custom, join(cache, "rea"), "dir");
  const host = systemUninstallHost(
    home,
    undefined,
    {
      XDG_CACHE_HOME: cache,
      REA_KUNA_CACHE_DIR: custom,
    },
    "linux",
  );
  try {
    expect(await host.purgeData()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "kuna-custom-cache",
          status: "retained",
        }),
        expect.objectContaining({ name: "kuna", status: "retained" }),
        expect.objectContaining({
          name: "hopper-releases",
          status: "retained",
        }),
      ]),
    );
    expect(await readFile(join(custom, "evidence"), "utf8")).toBe("retained");
  } finally {
    await host.close?.();
  }
});

it("reports the Hopper producer's invalid cache selection rather than silently falling back", async () => {
  const home = await createTestTempDirectory("rea-managed-cache-invalid-");
  const fallback = join(home, ".cache", "rea", "hopper-releases");
  await mkdir(fallback, { recursive: true });
  await writeFile(join(fallback, "release"), "retained");
  const host = systemUninstallHost(
    home,
    undefined,
    { XDG_CACHE_HOME: "relative" },
    "linux",
  );
  try {
    expect(await host.purgeData()).toContainEqual(
      expect.objectContaining({
        name: "hopper-releases",
        status: "failed",
        detail: expect.stringContaining("absolute"),
      }),
    );
    expect(await readFile(join(fallback, "release"), "utf8")).toBe("retained");
  } finally {
    await host.close?.();
  }
});
