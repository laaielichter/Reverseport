import { lstat } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { HopperCancelledError } from "../../../../src/domain/hopperErrors.js";
import { HopperApplicationLauncher } from "../../../../src/hopper/BridgeLauncher.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

it.each(["failed", "cancelled"] as const)(
  "removes the token-bearing bootstrap and releases the lease after a %s launch",
  async (outcome) => {
    const directory = await createTestTempDirectory("rea-bootstrap-cleanup-");
    const controller = new AbortController();
    const reason = { source: "caller", opaque: 7 };
    if (outcome === "cancelled") controller.abort(reason);
    let releases = 0;
    const launcher = new HopperApplicationLauncher(
      {
        environment: {},
        launcherPath: join(directory, "nonexistent-hopper"),
        targetPath: join(directory, "test-binary"),
        targetKind: "executable",
        loaderArgs: [],
        bridgeScriptPath: join(directory, "bridge.py"),
        launchMode: "native",
      },
      {
        platform: "darwin",
        acquireTargetLease: async () => ({
          acquired: true,
          lease: {
            release: async () => {
              releases++;
            },
          },
        }),
      },
    );
    const result = await launcher.launch(
      {
        directory,
        socketPath: join(directory, "bridge.sock"),
        token: "fixture-token",
        runId: "bootstrap-cleanup",
      },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (outcome === "cancelled") {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error).toBeInstanceOf(HopperCancelledError);
      expect(result.error.cause).toBe(reason);
    }
    await expect(lstat(join(directory, "bootstrap.py"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(releases).toBe(1);
  },
);
