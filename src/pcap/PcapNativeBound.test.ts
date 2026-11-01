import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import type { ArtifactAnalysisResources } from "../process/ArtifactAnalysisResources.js";
import {
  BOUNDED_PRODUCER_LIMITS,
  prlimitCeilingArguments,
  type LinuxResourceLimits,
} from "../process/LinuxResourceLimits.js";
import { preparePcapNativeBound } from "./PcapNativeBound.js";

const resources = {
  readLimits: (limits: LinuxResourceLimits) => Promise.resolve(limits),
} as ArtifactAnalysisResources;

const withPlatform = async (
  platform: NodeJS.Platform,
  run: () => Promise<void>,
) => {
  const previousPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
  try {
    await run();
  } finally {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: previousPlatform,
    });
  }
};

it("uses the shared 1 GiB ceiling for the Windows job memory limit", async () => {
  await withPlatform("win32", async () => {
    await expect(preparePcapNativeBound({}, resources)).resolves.toMatchObject({
      nativeBound: {
        memoryLimitBytes: BOUNDED_PRODUCER_LIMITS.address_space_bytes,
      },
    });
  });
});

it("pins capture ceilings through the shared prlimit prefix and keeps 300 CPU seconds", async () => {
  const root = await createTestTempDirectory("rea-pcap-prlimit-");
  const limiter = join(root, "prlimit");
  await writeFile(limiter, "#!/bin/sh\n");
  await chmod(limiter, 0o700);
  const limits = {
    address_space_bytes: BOUNDED_PRODUCER_LIMITS.address_space_bytes,
    file_bytes: BOUNDED_PRODUCER_LIMITS.file_bytes,
    cpu_seconds: 300,
  };
  await withPlatform("linux", async () => {
    const prepared = await preparePcapNativeBound(
      { REA_TSHARK_PRLIMIT_COMMAND: limiter },
      resources,
    );
    expect(prepared.nativeBound.limiter?.arguments).toEqual(
      prlimitCeilingArguments(limits),
    );
    expect(prepared.limitations[0]).toContain(String(limits.cpu_seconds));
  });
});
