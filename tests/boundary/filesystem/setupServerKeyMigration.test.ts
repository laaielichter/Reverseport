import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import {
  configureClientConfiguration,
  inspectClientConfiguration,
} from "../../../src/application/SetupClientConfiguration.js";
import {
  supportedClients,
  type SetupClient,
} from "../../../src/application/SupportedClients.js";
import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Earlier releases registered REA as "rea"; setup now registers "reverseport".
const OLD = "rea";
const NEW = PRODUCT_IDENTITY.mcpServerKey;
const command = ["rea", "mcp"] as const;
const ownedArgs = ["-y", "reverseport@1.0.0", "mcp"];
const owned = { command: "npx", args: ownedArgs };
const foreign = { command: "/opt/other/server", args: ["serve"] };
// A relative launcher cannot be resolved, so its identity stays unknown.
const unknown = { command: "./bin/rea", args: ["mcp"] };

const fixture = async (
  client: Omit<SetupClient, "configPath">,
  file: string,
  original: string,
) => {
  const home = await createTestTempDirectory("rea-server-key-migration-");
  const configPath = join(home, file);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, original);
  return { home, configPath, client: { ...client, configPath } as SetupClient };
};

/** Inspect, configure, and prove the second run is a no-op. */
const migrate = async (client: SetupClient) => {
  const inspection = await inspectClientConfiguration(client, {}, command);
  expect(inspection).toMatchObject({ status: "update" });
  expect(await configureClientConfiguration(client, {}, command)).toEqual({
    status: "configured",
    backupPath: `${client.configPath}.rea.backup`,
  });
  const configured = await readFile(client.configPath, "utf8");
  expect(await configureClientConfiguration(client, {}, command)).toEqual({
    status: "unchanged",
  });
  expect(await inspectClientConfiguration(client, {}, command)).toEqual({
    status: "already_current",
  });
  expect(await readFile(client.configPath, "utf8")).toBe(configured);
  const notes =
    inspection.status === "update" ? (inspection.notes ?? []).join("\n") : "";
  return { configured, notes };
};

describe("JSON registrations under the previous server name", () => {
  it("moves an owned entry to the current name and carries its custom settings", async () => {
    const original = `{
  // keep this comment
  "mcpServers": {
    "peer": {"command": "peer"},
    "${OLD}": {"command": "npx", "args": ${JSON.stringify(ownedArgs)}, "env": {"FOO": "bar"}, "timeout": 99}
  }
}
`;
    const { client, configPath } = await fixture(
      { name: "cursor", format: "json" },
      ".cursor/mcp.json",
      original,
    );
    const { configured, notes } = await migrate(client);
    expect(notes).toContain(`Rename REA's registration "${OLD}" to "${NEW}"`);
    expect(notes).toContain("carry its custom settings");
    expect(configured).toContain("// keep this comment");
    const parsed = JSON.parse(configured.replace(/^\s*\/\/.*$/mu, ""));
    expect(parsed.mcpServers).not.toHaveProperty(OLD);
    expect(parsed.mcpServers.peer).toEqual({ command: "peer" });
    expect(parsed.mcpServers[NEW]).toMatchObject({
      env: { FOO: "bar" },
      timeout: 99,
    });
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
  });

  // A trailing peer keeps the appended member's formatting off the kept line.
  it.each([
    ["foreign", foreign, "its launcher is not REA's"],
    ["unknown", unknown, "REA cannot confirm its launcher"],
  ])(
    "keeps a %s entry byte for byte and reports it",
    async (_identity, entry, reason) => {
      const member = `"${OLD}": ${JSON.stringify(entry)}`;
      const { client } = await fixture(
        { name: "cursor", format: "json" },
        ".cursor/mcp.json",
        `{\n  "mcpServers": {\n    ${member},\n    "peer": {"command": "peer"}\n  }\n}\n`,
      );
      const inspection = await inspectClientConfiguration(client, {}, command);
      expect(inspection).toMatchObject({
        status: "update",
        notes: [expect.stringContaining(reason)],
      });
      expect(await configureClientConfiguration(client, {}, command)).toEqual(
        expect.objectContaining({ status: "configured" }),
      );
      const configured = await readFile(client.configPath, "utf8");
      expect(configured).toContain(member);
      expect(JSON.parse(configured).mcpServers[NEW]).toBeDefined();
      expect(await configureClientConfiguration(client, {}, command)).toEqual({
        status: "unchanged",
      });
    },
  );

  it("keeps every repeated member when an earlier duplicate is not owned", async () => {
    const repeated = `    "${OLD}": ${JSON.stringify(foreign)},\n    "${OLD}": ${JSON.stringify(owned)}`;
    const original = `{\n  "mcpServers": {\n${repeated},\n    "peer": {"command": "peer"}\n  }\n}\n`;
    const { client } = await fixture(
      { name: "cursor", format: "json" },
      ".cursor/mcp.json",
      original,
    );
    const inspection = await inspectClientConfiguration(client, {}, command);
    expect(inspection).toMatchObject({
      status: "update",
      notes: [expect.stringContaining("earlier duplicate")],
    });
    expect(await configureClientConfiguration(client, {}, command)).toEqual(
      expect.objectContaining({ status: "configured" }),
    );
    const configured = await readFile(client.configPath, "utf8");
    expect(configured).toContain(repeated);
    expect(JSON.parse(configured).mcpServers[NEW]).toBeDefined();
  });

  it("removes every repeated member when all of them are owned", async () => {
    const { client } = await fixture(
      { name: "cursor", format: "json" },
      ".cursor/mcp.json",
      `{"mcpServers": {"${OLD}": ${JSON.stringify(owned)}, "peer": {"command": "peer"}, "${OLD}": ${JSON.stringify({ command: "rea", args: ["mcp"] })}}}\n`,
    );
    const { configured } = await migrate(client);
    expect(configured).not.toContain(`"${OLD}":`);
    expect(JSON.parse(configured).mcpServers).toMatchObject({
      peer: { command: "peer" },
      [NEW]: { args: ["mcp"] },
    });
  });

  it("keeps the current entry's settings when both names are present", async () => {
    const { client } = await fixture(
      { name: "cursor", format: "json" },
      ".cursor/mcp.json",
      JSON.stringify({
        mcpServers: {
          [OLD]: { ...owned, oldOnly: true },
          [NEW]: { ...owned, newOnly: true },
        },
      }),
    );
    const { configured, notes } = await migrate(client);
    expect(notes).toContain(
      `keep the existing "${NEW}" entry's custom settings`,
    );
    const servers = JSON.parse(configured).mcpServers;
    expect(servers).not.toHaveProperty(OLD);
    expect(servers[NEW]).toMatchObject({ newOnly: true });
    expect(servers[NEW]).not.toHaveProperty("oldOnly");
  });

  it("reports old tool-name references in the file without editing them", async () => {
    const { client } = await fixture(
      { name: "claude_code", format: "claude_code" },
      ".claude.json",
      JSON.stringify({
        mcpServers: { [OLD]: owned },
        projects: {
          "/work": {
            allowedTools: [`mcp__${OLD}__open_binary`, `mcp__${OLD}__scan`],
          },
        },
      }),
    );
    const { configured, notes } = await migrate(client);
    expect(notes).toContain("2 references to the old tool names remain");
    expect(JSON.parse(configured).projects["/work"].allowedTools).toEqual([
      `mcp__${OLD}__open_binary`,
      `mcp__${OLD}__scan`,
    ]);
  });
});

describe("OpenCode registrations under the previous server name", () => {
  it("moves an owned V1 entry in a V1 document", async () => {
    const { client } = await fixture(
      { name: "opencode", format: "opencode" },
      ".config/opencode/opencode.json",
      JSON.stringify({
        mcp: {
          [OLD]: {
            type: "local",
            command: ["npx", ...ownedArgs],
            enabled: false,
            timeout: 5000,
          },
        },
      }),
    );
    const { configured } = await migrate(client);
    const { mcp } = JSON.parse(configured);
    expect(mcp).not.toHaveProperty(OLD);
    expect(mcp[NEW]).toMatchObject({
      type: "local",
      enabled: true,
      timeout: 5000,
    });
  });

  it("moves an owned V1 entry beside a native V2 table into that table", async () => {
    const { client } = await fixture(
      { name: "opencode", format: "opencode" },
      ".config/opencode/opencode.json",
      JSON.stringify({
        mcp: {
          servers: { peer: { type: "local", command: ["peer"] } },
          [OLD]: { type: "local", command: ["npx", ...ownedArgs] },
        },
      }),
    );
    const { configured } = await migrate(client);
    const { mcp } = JSON.parse(configured);
    expect(mcp).not.toHaveProperty(OLD);
    expect(mcp.servers.peer).toEqual({ type: "local", command: ["peer"] });
    expect(mcp.servers[NEW]).toMatchObject({ type: "local", disabled: false });
  });

  it("keeps an owned native entry whose V1 fallback is not owned", async () => {
    const original = JSON.stringify({
      mcp: {
        servers: { [OLD]: { type: "local", command: ["npx", ...ownedArgs] } },
        [OLD]: { type: "local", command: ["/opt/other/server"] },
      },
    });
    const { client } = await fixture(
      { name: "opencode", format: "opencode" },
      ".config/opencode/opencode.json",
      original,
    );
    expect(await inspectClientConfiguration(client, {}, command)).toMatchObject(
      { status: "update", notes: [expect.stringContaining("OpenCode V1")] },
    );
    expect(await configureClientConfiguration(client, {}, command)).toEqual(
      expect.objectContaining({ status: "configured" }),
    );
    const { mcp } = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(mcp.servers[OLD]).toEqual({
      type: "local",
      command: ["npx", ...ownedArgs],
    });
    expect(mcp[OLD]).toEqual({ type: "local", command: ["/opt/other/server"] });
    expect(mcp.servers[NEW]).toBeDefined();
  });
});

describe("Codex and Grok TOML registrations under the previous server name", () => {
  it("removes quoted and nested Codex tables and carries the settings", async () => {
    const original = [
      "# top comment",
      'model = "x"',
      "",
      `[mcp_servers."${OLD}"]`,
      'command = "npx"',
      `args = ${JSON.stringify(ownedArgs)}`,
      "tool_timeout_sec = 77",
      "",
      `[mcp_servers."${OLD}".env]`,
      'FOO = "bar"',
      "",
      `[mcp_servers.${OLD}.tools.open_binary]`,
      'approval_mode = "approve"',
      "",
      "# keep the other server",
      "[mcp_servers.other]",
      'command = "other"',
      "",
    ].join("\n");
    const { client } = await fixture(
      { name: "codex", format: "toml" },
      ".codex/config.toml",
      original,
    );
    const { configured } = await migrate(client);
    expect(configured).toContain("# top comment");
    expect(configured).toContain("# keep the other server");
    expect(configured).not.toMatch(new RegExp(`mcp_servers\\.("?)${OLD}\\1`));
    const parsed = parseToml(configured) as {
      mcp_servers: Record<string, Record<string, unknown>>;
    };
    expect(parsed.mcp_servers).not.toHaveProperty(OLD);
    expect(parsed.mcp_servers.other).toEqual({ command: "other" });
    expect(parsed.mcp_servers[NEW]).toMatchObject({
      tool_timeout_sec: 77,
      env: { FOO: "bar" },
      tools: { open_binary: { approval_mode: "approve" } },
    });
  });

  it("re-enables a migrated Grok entry and keeps the list for an unowned one", async () => {
    const ownedToml = [
      `disabled_mcp_servers = ["${OLD}", "other"] # user list`,
      "",
      `[mcp_servers.${OLD}]`,
      'command = "npx"',
      `args = ${JSON.stringify(ownedArgs)}`,
      "",
    ].join("\n");
    const { client } = await fixture(
      { name: "grok_build", format: "grok" },
      ".grok/config.toml",
      ownedToml,
    );
    const { configured, notes } = await migrate(client);
    expect(notes).toContain("re-enables REA");
    expect(configured).toContain("# user list");
    expect(parseToml(configured)).toMatchObject({
      disabled_mcp_servers: ["other"],
      mcp_servers: { [NEW]: { command: "rea", args: ["mcp"] } },
    });
    expect(parseToml(configured)).not.toHaveProperty(`mcp_servers.${OLD}`);

    const foreignToml = ownedToml.replace(
      `command = "npx"\nargs = ${JSON.stringify(ownedArgs)}`,
      'command = "/opt/other/server"\nargs = ["serve"]',
    );
    await writeFile(client.configPath, foreignToml);
    expect(await configureClientConfiguration(client, {}, command)).toEqual(
      expect.objectContaining({ status: "configured" }),
    );
    const kept = await readFile(client.configPath, "utf8");
    expect(kept.startsWith(foreignToml.trimEnd())).toBe(true);
    expect(parseToml(kept)).toMatchObject({
      disabled_mcp_servers: [OLD, "other"],
      mcp_servers: { [OLD]: { command: "/opt/other/server" } },
    });
  });
});

describe("Name-keyed lists", () => {
  it("drops the old name from OMP's denylist and renames it in the allowlist", async () => {
    const { client } = await fixture(
      { name: "omp", format: "omp" },
      ".omp/agent/mcp.json",
      JSON.stringify({
        mcpServers: { [OLD]: owned },
        disabledServers: [OLD, "x"],
        enabledServers: [OLD, "y"],
      }),
    );
    const { configured, notes } = await migrate(client);
    expect(notes).toContain("re-enables REA");
    expect(notes).toContain(`Replace "${OLD}" with "${NEW}" in enabledServers`);
    expect(JSON.parse(configured)).toEqual({
      mcpServers: { [NEW]: expect.objectContaining({ type: "stdio" }) },
      disabledServers: ["x"],
      enabledServers: [NEW, "y"],
    });
  });

  it("never touches OMP lists for an unowned entry", async () => {
    const lists = { disabledServers: [OLD], enabledServers: [OLD] };
    const { client } = await fixture(
      { name: "omp", format: "omp" },
      ".omp/agent/mcp.json",
      JSON.stringify({ mcpServers: { [OLD]: foreign }, ...lists }),
    );
    expect(await configureClientConfiguration(client, {}, command)).toEqual(
      expect.objectContaining({ status: "configured" }),
    );
    expect(JSON.parse(await readFile(client.configPath, "utf8"))).toMatchObject(
      { mcpServers: { [OLD]: foreign }, ...lists },
    );
  });

  it("migrates a Pi entry and leaves Pi's ignored lists unchanged", async () => {
    const lists = { disabledServers: [OLD, "x"], enabledServers: [OLD] };
    const { client } = await fixture(
      { name: "pi", format: "pi" },
      ".pi/agent/mcp.json",
      JSON.stringify({ mcpServers: { [OLD]: owned }, ...lists }),
    );
    const { configured } = await migrate(client);
    const parsed = JSON.parse(configured);
    expect(parsed.mcpServers).not.toHaveProperty(OLD);
    expect(parsed.mcpServers[NEW]).toBeDefined();
    expect(parsed).toMatchObject(lists);
  });
});

describe("ZCode fallback registrations under the previous server name", () => {
  it("does not copy an owned fallback entry into the first native table", async () => {
    const home = await createTestTempDirectory("rea-server-key-zcode-");
    const client = supportedClients(home, "linux", {}).find(
      ({ name }) => name === "zcode",
    );
    if (client?.zcodeFallbackPath === undefined)
      throw new Error("missing ZCode client");
    const fallback = JSON.stringify({
      mcpServers: { [OLD]: owned, peer: { command: "peer" } },
    });
    await mkdir(dirname(client.zcodeFallbackPath), { recursive: true });
    await writeFile(client.zcodeFallbackPath, fallback);
    await mkdir(dirname(client.configPath), { recursive: true });
    await writeFile(client.configPath, JSON.stringify({ mcp: {} }));
    const { configured, notes } = await migrate(client);
    expect(notes).toContain(`keeps "${OLD}" for its other readers`);
    expect(JSON.parse(configured).mcp.servers).toEqual({
      peer: { command: "peer" },
      [NEW]: { command: "rea", args: ["mcp"] },
    });
    expect(await readFile(client.zcodeFallbackPath, "utf8")).toBe(fallback);
  });
});

describe("Hermes YAML registrations under the previous server name", () => {
  it("moves an owned entry and keeps comments and peers", async () => {
    const original = [
      "# Hermes settings",
      "model: x",
      "mcp_servers:",
      "  # the old REA entry",
      `  ${OLD}:`,
      "    command: npx",
      `    args: [${ownedArgs.map((part) => JSON.stringify(part)).join(", ")}]`,
      "    timeout: 120",
      "  peer:",
      "    command: peer # keep",
      "",
    ].join("\n");
    const { client } = await fixture(
      { name: "hermes", format: "hermes" },
      ".hermes/config.yaml",
      original,
    );
    const { configured } = await migrate(client);
    expect(configured).toContain("# Hermes settings");
    expect(configured).toContain("command: peer # keep");
    const parsed = parseYaml(configured) as {
      mcp_servers: Record<string, unknown>;
    };
    expect(parsed.mcp_servers).not.toHaveProperty(OLD);
    expect(parsed.mcp_servers.peer).toEqual({ command: "peer" });
    expect(parsed.mcp_servers[NEW]).toMatchObject({
      enabled: true,
      timeout: 120,
    });
  });
});

describe("Gemini and Qwen policies naming the previous server name", () => {
  const gemini = async (settings: unknown) => {
    const home = await createTestTempDirectory("rea-server-key-gemini-");
    const configPath = join(home, ".gemini", "settings.json");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(settings));
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
    return client;
  };

  it("migrates an owned user entry", async () => {
    const client = await gemini({ mcpServers: { [OLD]: owned } });
    const { configured } = await migrate(client);
    const parsed = JSON.parse(configured);
    expect(parsed.mcpServers).not.toHaveProperty(OLD);
    expect(parsed.mcpServers[NEW]).toBeDefined();
  });

  it.each([
    [{ excluded: ["REA"] }, "mcp.excluded"],
    [{ allowed: [" rea "] }, "mcp.allowed"],
  ])("blocks setup without editing a policy %j", async (policy, setting) => {
    const settings = { mcp: policy, mcpServers: { [OLD]: owned } };
    const client = await gemini(settings);
    const original = await readFile(client.configPath, "utf8");
    expect(await inspectClientConfiguration(client, {}, command)).toEqual({
      status: "invalid",
      remediation: expect.stringContaining(setting),
    });
    expect(await configureClientConfiguration(client, {}, command)).toEqual({
      status: "failed",
      reason: "readback",
    });
    expect(await readFile(client.configPath, "utf8")).toBe(original);
  });

  it("admits an allowlist that also names the current server", async () => {
    const client = await gemini({
      mcp: { allowed: [OLD, NEW] },
      mcpServers: { [OLD]: owned },
    });
    const { configured } = await migrate(client);
    expect(JSON.parse(configured).mcp).toEqual({ allowed: [OLD, NEW] });
  });

  it("blocks Qwen when its allowlist names only the previous server", async () => {
    const { client } = await fixture(
      { name: "qwen_code", format: "json" },
      ".qwen/settings.json",
      JSON.stringify({ mcp: { allowed: [OLD] } }),
    );
    expect(await inspectClientConfiguration(client, {}, command)).toEqual({
      status: "invalid",
      remediation: expect.stringContaining("mcp.allowed"),
    });
  });
});
