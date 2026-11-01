import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => ({
  afterDiscovery: undefined as undefined | (() => Promise<void>),
}));

vi.mock(
  "../../src/application/ClientConfigurationFiles.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/application/ClientConfigurationFiles.js")
      >();
    return {
      ...actual,
      readClientConfigurationFiles: async (
        ...args: Parameters<typeof actual.readClientConfigurationFiles>
      ) => {
        const files = await actual.readClientConfigurationFiles(...args);
        const change = refresh.afterDiscovery;
        refresh.afterDiscovery = undefined;
        await change?.();
        return files;
      },
    };
  },
);

import {
  configureClientConfiguration,
  inspectClientConfiguration,
} from "../../src/application/SetupClientConfiguration.js";
import type { SetupClient } from "../../src/application/SupportedClients.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

afterEach(() => {
  refresh.afterDiscovery = undefined;
});

it.each(["inspect", "configure"] as const)(
  "%s uses the authoritative user snapshot after Gemini policy is repaired",
  async (operation) => {
    const home = await createTestTempDirectory("rea-setup-policy-snapshot-");
    await mkdir(join(home, ".gemini"));
    const configPath = join(home, ".gemini", "settings.json");
    const client: SetupClient = {
      name: "gemini_cli",
      configPath,
      format: "json",
      geminiSettings: {
        defaultsPath: join(home, "defaults.json"),
        systemPath: join(home, "system.json"),
        workspaceDirectory: home,
        trustedFoldersPath: join(home, "trust.json"),
        platform: process.platform,
      },
    };
    await writeFile(configPath, JSON.stringify({ mcp: { excluded: ["rea"] } }));
    const repaired = '{"caller_setting":true}\n';
    refresh.afterDiscovery = () => writeFile(configPath, repaired);
    if (operation === "inspect") {
      expect(
        await inspectClientConfiguration(client, {}, ["rea", "mcp"]),
      ).toMatchObject({ status: "update" });
      expect(await readFile(configPath, "utf8")).toBe(repaired);
    } else {
      expect(
        await configureClientConfiguration(client, {}, ["rea", "mcp"]),
      ).toMatchObject({ status: "configured" });
      expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
        caller_setting: true,
        mcpServers: { rea: { command: "rea", args: ["mcp"] } },
      });
      expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(repaired);
    }
  },
);
