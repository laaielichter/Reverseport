import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { clearClientLocationEnvironment } from "../../fixtures/clientEnvironment.js";
import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import {
  runUninstall,
  systemUninstallHost,
} from "../../../src/application/Uninstall.js";

// Earlier releases registered REA as "rea"; uninstall removes REA-owned
// entries under both that name and the current one.
const OLD = "rea";
const NEW = PRODUCT_IDENTITY.mcpServerKey;
const owned = { command: "npx", args: ["-y", "reverseport@1.0.0", "mcp"] };
const ownedAlias = { command: PRODUCT_IDENTITY.cliBinary, args: ["mcp"] };
const foreign = { command: "/opt/other/server", args: ["serve"] };
// A relative launcher cannot be resolved, so its identity stays unknown.
const unknown = { command: "./bin/rea", args: ["mcp"] };

beforeEach(clearClientLocationEnvironment);
afterEach(() => vi.unstubAllEnvs());

const fixture = async (prefix: string, file: string, original: string) => {
  const home = await createTestTempDirectory(prefix);
  const configPath = join(home, file);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, original);
  return { home, configPath };
};

const uninstallClient = async (home: string, client: string) => {
  const result = await runUninstall(false, systemUninstallHost(home));
  const outcome = result.items.find(({ name }) => name === client);
  expect(outcome).toBeDefined();
  return { result, outcome: outcome! };
};

const backupOf = (configPath: string) =>
  readFile(`${configPath}.rea.backup`, "utf8");

describe("uninstall under the current and previous server names", () => {
  it("removes owned entries under both names in one edit with one backup", async () => {
    const original = `{
  // keep this comment
  "mcpServers": {
    "${OLD}": ${JSON.stringify(owned)},
    "peer": {"command": "peer"},
    "${NEW}": ${JSON.stringify(ownedAlias)}
  }
}
`;
    const { home, configPath } = await fixture(
      "rea-uninstall-both-names-",
      ".cursor/mcp.json",
      original,
    );
    const { outcome } = await uninstallClient(home, "cursor");
    expect(outcome).toMatchObject({
      status: "removed",
      detail: `Removed registration from ${configPath}.`,
    });
    const removed = await readFile(configPath, "utf8");
    expect(removed).toContain("// keep this comment");
    expect(JSON.parse(removed.replace(/^\s*\/\/.*$/mu, ""))).toEqual({
      mcpServers: { peer: { command: "peer" } },
    });
    expect(await backupOf(configPath)).toBe(original);

    const again = await uninstallClient(home, "cursor");
    expect(again.outcome).toMatchObject({ status: "skipped" });
    expect(await readFile(configPath, "utf8")).toBe(removed);
  });

  it("removes an owned entry that only exists under the previous name", async () => {
    const { home, configPath } = await fixture(
      "rea-uninstall-old-name-",
      ".cursor/mcp.json",
      JSON.stringify({ mcpServers: { [OLD]: owned, peer: foreign } }),
    );
    const { outcome } = await uninstallClient(home, "cursor");
    expect(outcome.status).toBe("removed");
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      mcpServers: { peer: foreign },
    });
  });

  it.each([
    ["foreign", foreign],
    ["unknown", unknown],
  ])(
    "keeps a %s previous-name entry byte for byte and reports it",
    async (_identity, kept) => {
      const original = `{"mcpServers": {"${OLD}":   ${JSON.stringify(kept)}, "${NEW}": ${JSON.stringify(owned)}}}\n`;
      const { home, configPath } = await fixture(
        "rea-uninstall-kept-old-",
        ".cursor/mcp.json",
        original,
      );
      const { outcome } = await uninstallClient(home, "cursor");
      expect(outcome).toMatchObject({
        status: "removed",
        detail: `Removed registration from ${configPath}. The "${OLD}" entry REA cannot prove it created was kept.`,
      });
      const removed = await readFile(configPath, "utf8");
      expect(removed).toContain(`"${OLD}":   ${JSON.stringify(kept)}`);
      expect(JSON.parse(removed)).toEqual({ mcpServers: { [OLD]: kept } });
      expect(await backupOf(configPath)).toBe(original);
    },
  );

  it("retains a configuration whose entries under both names are not REA's", async () => {
    const original = JSON.stringify({
      mcpServers: { [OLD]: unknown, [NEW]: foreign },
    });
    const { home, configPath } = await fixture(
      "rea-uninstall-unowned-",
      ".cursor/mcp.json",
      original,
    );
    const { outcome } = await uninstallClient(home, "cursor");
    expect(outcome).toMatchObject({
      status: "retained",
      detail: `The "${NEW}" and "${OLD}" registration is not REA-owned.`,
    });
    expect(await readFile(configPath, "utf8")).toBe(original);
    await expect(backupOf(configPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses the whole file when a previous-name duplicate is not REA's", async () => {
    // The client reads the last member; removing it would activate the first.
    const original = `{"mcpServers": {"${OLD}": ${JSON.stringify(foreign)}, "${NEW}": ${JSON.stringify(owned)}, "${OLD}": ${JSON.stringify(owned)}}}\n`;
    const { home, configPath } = await fixture(
      "rea-uninstall-shadowed-old-",
      ".cursor/mcp.json",
      original,
    );
    const { result, outcome } = await uninstallClient(home, "cursor");
    expect(result.status).toBe("failed");
    expect(outcome.status).toBe("failed");
    expect(outcome.detail).toContain(
      `Configuration repeats the "${OLD}" member, and an earlier duplicate is not REA-owned`,
    );
    expect(await readFile(configPath, "utf8")).toBe(original);
    await expect(backupOf(configPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("removes REA-owned duplicates under the previous name", async () => {
    const original = `{"mcpServers": {"${OLD}": ${JSON.stringify(ownedAlias)}, "peer": {"command": "peer"}, "${OLD}": ${JSON.stringify(owned)}}}\n`;
    const { home, configPath } = await fixture(
      "rea-uninstall-owned-duplicates-",
      ".cursor/mcp.json",
      original,
    );
    const { outcome } = await uninstallClient(home, "cursor");
    expect(outcome.status).toBe("removed");
    const removed = await readFile(configPath, "utf8");
    expect(removed).not.toContain(`"${OLD}"`);
    expect(JSON.parse(removed)).toEqual({
      mcpServers: { peer: { command: "peer" } },
    });
  });
});

describe("OpenCode V1 entries under the previous name", () => {
  const opencode = (servers: object, v1: object) =>
    JSON.stringify({ mcp: { servers, ...v1 } });
  const ownedOpenCode = {
    type: "local",
    command: [PRODUCT_IDENTITY.cliBinary, "mcp"],
    enabled: true,
  };
  const foreignOpenCode = { type: "local", command: ["/usr/bin/false"] };

  it("removes an owned V1 entry beside an owned V2 entry under each name", async () => {
    const { home, configPath } = await fixture(
      "rea-uninstall-opencode-old-",
      ".config/opencode/opencode.json",
      opencode(
        { [NEW]: ownedOpenCode, [OLD]: ownedOpenCode },
        { [OLD]: ownedOpenCode },
      ),
    );
    const { outcome } = await uninstallClient(home, "opencode");
    expect(outcome.status).toBe("removed");
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      mcp: { servers: {} },
    });
  });

  it("refuses when removing an owned previous-name entry would activate a foreign V1 entry", async () => {
    const original = opencode(
      { [NEW]: ownedOpenCode, [OLD]: ownedOpenCode },
      { [OLD]: foreignOpenCode },
    );
    const { home, configPath } = await fixture(
      "rea-uninstall-opencode-old-fallback-",
      ".config/opencode/opencode.json",
      original,
    );
    const { outcome } = await uninstallClient(home, "opencode");
    expect(outcome.status).toBe("failed");
    expect(outcome.detail).toContain(
      `OpenCode falls back to the V1 "mcp.${OLD}" entry, which is not REA-owned`,
    );
    expect(await readFile(configPath, "utf8")).toBe(original);
  });
});

describe("TOML and YAML entries under the previous name", () => {
  it.each([
    ["bare", `[mcp_servers.${OLD}]`, `[mcp_servers.${OLD}.env]`],
    ["quoted", `[mcp_servers."${OLD}"]`, `[mcp_servers."${OLD}".env]`],
  ])(
    "removes owned Codex tables under both names with %s headers",
    async (_spelling, header, envHeader) => {
      const prefix = '# Keep this explanation.\nmodel = "o3"\n';
      const original = `${prefix}
${header}
command = "npx"
args = ["-y", "reverseport@1.0.0", "mcp"]

${envHeader}
FOO = "bar"

[mcp_servers.${NEW}]
command = "rea"
args = ["mcp"]
`;
      const { home, configPath } = await fixture(
        "rea-uninstall-codex-old-",
        ".codex/config.toml",
        original,
      );
      const { outcome } = await uninstallClient(home, "codex");
      expect(outcome.status).toBe("removed");
      const removed = await readFile(configPath, "utf8");
      expect(removed).toContain("# Keep this explanation.");
      expect(parseToml(removed)).toEqual({ model: "o3" });
      expect(await backupOf(configPath)).toBe(original);
    },
  );

  it("keeps a foreign Codex table under the previous name", async () => {
    const foreignTable = `[mcp_servers.${OLD}]\ncommand = "/opt/other/server"\nargs = ["serve"]\n`;
    const original = `${foreignTable}\n[mcp_servers.${NEW}]\ncommand = "rea"\nargs = ["mcp"]\n`;
    const { home, configPath } = await fixture(
      "rea-uninstall-codex-foreign-old-",
      ".codex/config.toml",
      original,
    );
    const { outcome } = await uninstallClient(home, "codex");
    expect(outcome.status).toBe("removed");
    expect(outcome.detail).toContain(`The "${OLD}" entry`);
    const removed = await readFile(configPath, "utf8");
    expect(removed).toContain(foreignTable);
    expect(parseToml(removed)).toEqual({
      mcp_servers: { [OLD]: { command: "/opt/other/server", args: ["serve"] } },
    });
  });

  it("removes an owned Grok Build table and leaves the disable list alone", async () => {
    const original = `disabled_mcp_servers = ["${OLD}", "other"]

[mcp_servers.${OLD}]
command = "rea"
args = ["mcp"]
`;
    const { home, configPath } = await fixture(
      "rea-uninstall-grok-old-",
      ".grok/config.toml",
      original,
    );
    const { outcome } = await uninstallClient(home, "grok_build");
    expect(outcome.status).toBe("removed");
    expect(parseToml(await readFile(configPath, "utf8"))).toEqual({
      disabled_mcp_servers: [OLD, "other"],
    });
  });

  it("removes owned Hermes entries under both names and keeps comments", async () => {
    const original = `# Hermes settings
model: gpt
mcp_servers:
  ${OLD}:
    command: rea
    args: [mcp]
  peer:
    command: peer # keep
  ${NEW}:
    command: npx
    args: ["-y", "reverseport@1.0.0", "mcp"]
`;
    const { home, configPath } = await fixture(
      "rea-uninstall-hermes-old-",
      ".hermes/config.yaml",
      original,
    );
    const { outcome } = await uninstallClient(home, "hermes");
    expect(outcome.status).toBe("removed");
    const removed = await readFile(configPath, "utf8");
    expect(removed).toContain("# Hermes settings");
    expect(removed).toContain("# keep");
    expect(parseYaml(removed)).toEqual({
      model: "gpt",
      mcp_servers: { peer: { command: "peer" } },
    });
  });
});

describe("OMP lists under the previous name", () => {
  it("removes an owned previous-name entry and leaves its lists to the user", async () => {
    const { home, configPath } = await fixture(
      "rea-uninstall-omp-old-",
      ".omp/agent/mcp.json",
      JSON.stringify({
        mcpServers: { [OLD]: owned },
        disabledServers: [OLD],
        enabledServers: [OLD, "peer"],
      }),
    );
    const { outcome } = await uninstallClient(home, "omp");
    expect(outcome.status).toBe("removed");
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      mcpServers: {},
      disabledServers: [OLD],
      enabledServers: [OLD, "peer"],
    });
  });
});
