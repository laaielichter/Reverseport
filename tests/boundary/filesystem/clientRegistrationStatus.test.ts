import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { clearClientLocationEnvironment } from "../../fixtures/clientEnvironment.js";

import {
  readClientRegistrationInspections,
  readClientRegistrationStatuses,
} from "../../../src/application/ClientRegistrationStatus.js";
import { configureClientConfiguration } from "../../../src/application/SetupClientConfiguration.js";
import { classifyClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { existingMaintenanceScope } from "../../../src/application/UpdateMaintenance.js";
import { PRODUCT_IDENTITY } from "../../../src/identity.js";

beforeEach(clearClientLocationEnvironment);
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("client registration status", () => {
  it("discovers Claude Code from its config file without a marker directory", async () => {
    const home = await createTestTempDirectory("rea-claude-config-only-");
    await writeFile(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          reverseport: {
            command: "npx",
            args: ["-y", PRODUCT_IDENTITY.registrationPackageSpecifier, "mcp"],
          },
        },
      }),
    );

    const statuses = await readClientRegistrationStatuses(home, "/current/rea");

    expect(statuses).toEqual([
      expect.objectContaining({
        client: "claude_code",
        config_path: join(home, ".claude.json"),
        state: "aligned",
        remediation: null,
      }),
    ]);
  });

  it("distinguishes aligned, stale, missing, and invalid registrations", async () => {
    const home = await createTestTempDirectory("rea-registrations-");
    const currentEntry = join(home, "current-rea.mjs");
    const foreignEntry = join(home, "foreign-rea.mjs");
    await writeFile(currentEntry, "// current dispatcher\n");
    await writeFile(foreignEntry, "// different dispatcher\n");
    await Promise.all([
      mkdir(join(home, ".codex")),
      mkdir(join(home, ".cursor")),
      mkdir(join(home, ".gemini")),
      mkdir(join(home, ".claude")),
    ]);
    await writeFile(
      join(home, ".codex/config.toml"),
      `[mcp_servers.reverseport]\ncommand = "npx"\nargs = ["-y", "${PRODUCT_IDENTITY.registrationPackageSpecifier}", "mcp"]\nstartup_timeout_sec = 30\ntool_timeout_sec = 450\n`,
    );
    await writeFile(
      join(home, ".cursor/mcp.json"),
      JSON.stringify({
        mcpServers: {
          reverseport: {
            command: foreignEntry,
            args: ["mcp"],
            env: { SECRET: "x" },
          },
        },
      }),
    );
    await writeFile(join(home, ".gemini/settings.json"), "not-json");

    const statuses = await readClientRegistrationStatuses(home, currentEntry);
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          client: "codex",
          state: "aligned",
          remediation: null,
        }),
        expect.objectContaining({
          client: "cursor",
          state: "stale",
          command: [foreignEntry, "mcp"],
          remediation: expect.any(String),
        }),
        expect.objectContaining({
          client: "gemini_cli",
          state: "invalid",
          command: [],
          remediation: expect.any(String),
        }),
        expect.objectContaining({
          client: "claude_code",
          state: "missing",
          command: [],
          remediation: expect.any(String),
        }),
      ]),
    );
    expect(JSON.stringify(statuses)).not.toContain("SECRET");
  });

  it.each([null, [], "invalid"])(
    "reports a malformed server table %j as invalid",
    async (servers) => {
      const home = await createTestTempDirectory("rea-registration-shape-");
      await mkdir(join(home, ".cursor"));
      await writeFile(
        join(home, ".cursor/mcp.json"),
        JSON.stringify({ mcpServers: servers }),
      );
      expect(await readClientRegistrationStatuses(home)).toEqual([
        expect.objectContaining({
          client: "cursor",
          state: "invalid",
          command: [],
        }),
      ]);
    },
  );
});

describe("client registration launcher identity", () => {
  it("reports an unversioned npx registration as stale", async () => {
    const home = await createTestTempDirectory("rea-registrations-");
    await mkdir(join(home, ".codex"));
    await writeFile(
      join(home, ".codex/config.toml"),
      '[mcp_servers.reverseport]\ncommand = "npx"\nargs = ["-y", "reverseport", "mcp"]\n',
    );

    const statuses = await readClientRegistrationStatuses(home);

    expect(statuses).toEqual([
      expect.objectContaining({
        client: "codex",
        command: ["npx", "-y", "reverseport", "mcp"],
        state: "stale",
      }),
    ]);
  });

  it("reports an unpinned bunx registration as stale rather than aligned", async () => {
    const home = await createTestTempDirectory("rea-bunx-unpinned-");
    await writeFile(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          reverseport: { command: "bunx", args: ["reverseport", "mcp"] },
        },
      }),
    );

    const [status] = await readClientRegistrationStatuses(home);

    expect(status).toMatchObject({
      client: "claude_code",
      command: ["bunx", "reverseport", "mcp"],
      state: "stale",
    });
  });

  it("preserves direct command identity as unknown when the current entrypoint is absent", async () => {
    const home = await createTestTempDirectory("rea-registration-unknown-");
    await mkdir(join(home, ".cursor"));
    const command = ["/opt/rea/bin/rea", "mcp"];
    await writeFile(
      join(home, ".cursor/mcp.json"),
      JSON.stringify({
        mcpServers: {
          reverseport: { command: command[0], args: [command[1]] },
        },
      }),
    );

    const [status] = await readClientRegistrationStatuses(home, "");

    expect(status).toMatchObject({
      client: "cursor",
      command,
      state: "unknown",
      remediation: expect.stringContaining("registration was retained"),
    });
    expect(status).not.toHaveProperty("commandIdentity");
    expect(await readClientRegistrationInspections(home, "")).toEqual([
      expect.objectContaining({
        status,
        activation: "enabled",
        commandIdentity: "unknown",
      }),
    ]);
  });

  it("does not use the REA process cwd to resolve a client's relative launcher path", async () => {
    const home = await createTestTempDirectory("rea-registration-relative-");
    await mkdir(join(home, ".cursor"));
    const currentEntry = resolve("./rea.mjs");
    const configPath = join(home, ".cursor/mcp.json");
    const registration = (
      scriptPath: string,
      executable = process.execPath,
    ) => ({
      mcpServers: {
        reverseport: { command: executable, args: [scriptPath, "mcp"] },
      },
    });
    await writeFile(configPath, JSON.stringify(registration("./rea.mjs")));

    const [relativeStatus] = await readClientRegistrationStatuses(
      home,
      currentEntry,
    );
    expect(relativeStatus).toMatchObject({
      command: [process.execPath, "./rea.mjs", "mcp"],
      state: "unknown",
    });

    await writeFile(configPath, JSON.stringify(registration(currentEntry)));
    const [absoluteStatus] = await readClientRegistrationStatuses(
      home,
      currentEntry,
    );
    expect(absoluteStatus).toMatchObject({
      command: [process.execPath, currentEntry, "mcp"],
      state: "aligned",
    });

    const relativeInterpreter = relative(process.cwd(), process.execPath);
    await writeFile(
      configPath,
      JSON.stringify(registration(currentEntry, relativeInterpreter)),
    );
    const [relativeInterpreterStatus] = await readClientRegistrationStatuses(
      home,
      currentEntry,
    );
    expect(relativeInterpreterStatus).toMatchObject({
      command: [relativeInterpreter, currentEntry, "mcp"],
      state: "unknown",
    });
  });
});

describe("client registration package version identity", () => {
  it.each([
    ["4.1.0", true],
    ["v4.1.0", false],
  ] as const)(
    "preserves package version %s ownership with canonical-only drift reporting",
    async (version, reportsDrift) => {
      const home = await createTestTempDirectory(
        "rea-registration-version-drift-",
      );
      await mkdir(join(home, ".codex"));
      const reference = `reverseport@${version}`;
      const command = ["npx", "-y", reference, "mcp"];
      await writeFile(
        join(home, ".codex/config.toml"),
        `[mcp_servers.reverseport]\ncommand = "${command[0]}"\nargs = ["${command[1]}", "${command[2]}", "${command[3]}"]\n`,
      );

      const [status] = await readClientRegistrationStatuses(home);

      expect(classifyClientRegistrationCommand(command, undefined)).toBe(
        "owned",
      );
      expect(status).toMatchObject({
        client: "codex",
        command,
        package_reference: reference,
        state: "stale",
      });
      if (reportsDrift) {
        expect(status?.remediation).toContain(
          `current REA CLI package is ${PRODUCT_IDENTITY.packageVersion}`,
        );
        expect(status?.remediation).toContain(
          "does not resolve package-runner",
        );
        expect(status?.remediation).toContain(
          "reverseport setup --client codex",
        );
      } else {
        expect(status?.remediation).not.toContain("current REA CLI package");
        expect(status?.remediation).not.toContain(
          "does not resolve package-runner",
        );
      }
      expect(status?.remediation).toContain("reverseport setup");
    },
  );
});

describe("commandcode registration status", () => {
  const writeCommandcodeRegistration = async (
    home: string,
    registration: Record<string, unknown>,
  ): Promise<void> => {
    await mkdir(join(home, ".commandcode"));
    await writeFile(
      join(home, ".commandcode/mcp.json"),
      JSON.stringify({ mcpServers: { reverseport: registration } }),
    );
  };

  const ownedArgs = (): readonly string[] => [
    "-y",
    PRODUCT_IDENTITY.registrationPackageSpecifier,
    "mcp",
  ];

  it.each([undefined, "sse"])(
    "reports transport %j as invalid",
    async (transport) => {
      const home = await createTestTempDirectory("rea-commandcode-transport-");
      await writeCommandcodeRegistration(home, {
        ...(transport === undefined ? {} : { transport }),
        command: "npx",
        args: [...ownedArgs()],
      });

      expect(await readClientRegistrationStatuses(home)).toEqual([
        expect.objectContaining({
          client: "commandcode",
          state: "invalid",
          command: [],
        }),
      ]);
    },
  );

  it("reports a disabled registration as stale", async () => {
    const home = await createTestTempDirectory("rea-commandcode-disabled-");
    await writeCommandcodeRegistration(home, {
      transport: "stdio",
      enabled: false,
      command: "npx",
      args: [...ownedArgs()],
    });

    expect(await readClientRegistrationStatuses(home)).toEqual([
      expect.objectContaining({
        client: "commandcode",
        state: "stale",
      }),
    ]);
  });
});

describe("client activation keys", () => {
  it.each([
    ["disabled = true", "aligned"],
    ["enabled = false", "stale"],
  ] as const)(
    "reads only the activation key Codex honors (%s)",
    async (activation, state) => {
      const home = await createTestTempDirectory("rea-codex-activation-");
      await mkdir(join(home, ".codex"));
      const entry = resolve("scripts/rea.mjs");
      await writeFile(
        join(home, ".codex/config.toml"),
        `[mcp_servers.reverseport]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(entry)}, "mcp"]\nstartup_timeout_sec = 30\ntool_timeout_sec = 450\n${activation}\n`,
      );
      expect(
        await readClientRegistrationStatuses(home, entry, { environment: {} }),
      ).toEqual([expect.objectContaining({ client: "codex", state })]);
    },
  );

  // Each JSON client loads REA under the key it ignores and skips it under the key it honors.
  it.each([
    ["kimi", { disabled: true }, "aligned"],
    ["kimi", { enabled: false }, "stale"],
    ["devin", { enabled: false }, "aligned"],
    ["devin", { disabled: true }, "stale"],
  ] as const)(
    "reads only the activation key %s honors (%j)",
    async (client, activation, state) => {
      const home = await createTestTempDirectory("rea-json-activation-");
      const entry = resolve("scripts/rea.mjs");
      const [config, fields] =
        client === "kimi"
          ? [
              join(home, ".kimi-code/mcp.json"),
              {
                env: { REA_MCP_INPUT_SCHEMA_PROFILE: "compact" },
                startupTimeoutMs: 30_000,
                toolTimeoutMs: 450_000,
              },
            ]
          : [
              join(
                process.platform === "win32"
                  ? join(home, "AppData", "Roaming", "devin")
                  : join(home, ".config", "devin"),
                "mcp_config.json",
              ),
              {},
            ];
      await mkdir(dirname(config), { recursive: true });
      await writeFile(
        config,
        JSON.stringify({
          mcpServers: {
            reverseport: {
              command: process.execPath,
              args: [entry, "mcp"],
              ...fields,
              ...activation,
            },
          },
        }),
      );
      expect(
        await readClientRegistrationStatuses(home, entry, {
          environment: { XDG_CONFIG_HOME: join(home, ".config") },
        }),
      ).toEqual([expect.objectContaining({ client, state })]);
    },
  );
});

describe("Ghidra multi-function deadline registration advice", () => {
  it.each([
    { provider: "ghidra", timeout: 10, hasBatchScope: true },
    { provider: "ghidra", timeout: 1800, hasBatchScope: true },
    { provider: "hopper", timeout: 1800, hasBatchScope: false },
  ])(
    "preserves a selected $timeout-second $provider deadline and describes its scope",
    async ({ provider, timeout, hasBatchScope }) => {
      const home = await createTestTempDirectory("rea-codex-decompile-scope-");
      await mkdir(join(home, ".codex"));
      const entry = resolve("scripts/rea.mjs");
      const configPath = join(home, ".codex/config.toml");
      // Two 600-second Ghidra decompiles plus startup/headroom would need an
      // estimated 1650 seconds. A caller's shorter or longer choice stays theirs.
      const original = `[mcp_servers.reverseport]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(entry)}, "mcp"]\nstartup_timeout_sec = 30\ntool_timeout_sec = ${timeout}\n[mcp_servers.reverseport.env]\nREA_ANALYSIS_PROVIDER = "${provider}"\nREA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS = "600"\n`;
      await writeFile(configPath, original);
      const [status] = await readClientRegistrationStatuses(home, entry, {
        environment: {},
      });
      expect(status).toMatchObject({ client: "codex", state: "aligned" });
      if (hasBatchScope) {
        expect(status?.advisory).toContain("single-decompile estimate");
        expect(status?.advisory).toContain("every attempted function");
        expect(status?.advisory).toContain("trace_native_values");
        expect(status?.advisory).toContain("max_functions");
      } else expect(status?.advisory).toBeUndefined();
      const configured = await configureClientConfiguration(
        { name: "codex", format: "toml", configPath },
        {},
        [process.execPath, entry, "mcp"],
      );
      expect(configured).toMatchObject({ status: "unchanged" });
      expect(await readFile(configPath, "utf8")).toBe(original);
      await expect(readFile(`${configPath}.rea.backup`)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
});

describe("Node-wrapped registration policy", () => {
  it.each([1, 30])(
    "accepts Codex caller-selected startup timeout %d independently of launcher",
    async (timeout) => {
      const home = await createTestTempDirectory("rea-node-registration-");
      await mkdir(join(home, ".codex"));
      const entry = resolve("scripts/rea.mjs");
      await writeFile(
        join(home, ".codex/config.toml"),
        `[mcp_servers.reverseport]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(entry)}, "mcp"]\nstartup_timeout_sec = ${String(timeout)}\ntool_timeout_sec = 450\n`,
      );
      const statuses = await readClientRegistrationStatuses(home, entry, {
        environment: {},
      });
      expect(statuses).toEqual([
        expect.objectContaining({
          client: "codex",
          state: "aligned",
        }),
      ]);
    },
  );

  it("keeps a short positive Codex tool timeout aligned and reports an advisory", async () => {
    const home = await createTestTempDirectory("rea-codex-short-tool-timeout-");
    await mkdir(join(home, ".codex"));
    const entry = resolve("scripts/rea.mjs");
    await writeFile(
      join(home, ".codex/config.toml"),
      `[mcp_servers.reverseport]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(entry)}, "mcp"]\nstartup_timeout_sec = 5\ntool_timeout_sec = 10\n`,
    );
    const [status] = await readClientRegistrationStatuses(home, entry, {
      environment: {},
    });
    expect(status).toMatchObject({
      client: "codex",
      state: "aligned",
      advisory: expect.stringContaining("tool_timeout_sec = 450 seconds"),
    });
  });

  it.each([1, 30])(
    "checks Grok Build startup timeout %d independently of launcher",
    async (timeout) => {
      const home = await createTestTempDirectory("rea-grok-registration-");
      await mkdir(join(home, ".grok"));
      const entry = resolve("scripts/rea.mjs");
      await writeFile(
        join(home, ".grok/config.toml"),
        `[mcp_servers.reverseport]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(entry)}, "mcp"]\nstartup_timeout_sec = ${String(timeout)}\n`,
      );
      const statuses = await readClientRegistrationStatuses(home, entry, {
        environment: {},
      });
      expect(statuses).toEqual([
        expect.objectContaining({
          client: "grok_build",
          state: timeout === 30 ? "aligned" : "stale",
        }),
      ]);
    },
  );

  it("reports Grok Build stale when reverseport is listed in disabled_mcp_servers", async () => {
    const home = await createTestTempDirectory("rea-grok-disabled-status-");
    await mkdir(join(home, ".grok"));
    const entry = resolve("scripts/rea.mjs");
    await writeFile(
      join(home, ".grok/config.toml"),
      `disabled_mcp_servers = ["reverseport"]\n[mcp_servers.reverseport]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(entry)}, "mcp"]\nstartup_timeout_sec = 30\n`,
    );
    expect(
      await readClientRegistrationStatuses(home, entry, { environment: {} }),
    ).toEqual([
      expect.objectContaining({ client: "grok_build", state: "stale" }),
    ]);
  });

  it("checks a direct-launcher Codex startup timeout without Node wrapping", async () => {
    const home = await createTestTempDirectory("rea-direct-registration-");
    await mkdir(join(home, ".codex"));
    await writeFile(
      join(home, ".codex/config.toml"),
      '[mcp_servers.reverseport]\ncommand = "/current/rea"\nargs = ["mcp"]\nstartup_timeout_sec = 1\n',
    );
    const statuses = await readClientRegistrationStatuses(
      home,
      "/current/rea",
      {
        environment: {},
      },
    );
    expect(statuses).toEqual([
      expect.objectContaining({ client: "codex", state: "stale" }),
    ]);
  });

  it.each([{ tools: ["binary_session"] }, { tools: ["*"] }, { tools: [] }])(
    "checks Copilot tool selection $tools independently of launcher",
    async ({ tools }) => {
      const home = await createTestTempDirectory("rea-node-copilot-");
      await mkdir(join(home, ".copilot"));
      const entry = resolve("scripts/rea.mjs");
      await writeFile(
        join(home, ".copilot/mcp-config.json"),
        JSON.stringify({
          mcpServers: {
            reverseport: {
              type: "stdio",
              command: process.execPath,
              args: [entry, "mcp"],
              tools,
            },
          },
        }),
      );
      const statuses = await readClientRegistrationStatuses(home, entry, {
        environment: {},
      });
      expect(statuses).toEqual([
        expect.objectContaining({
          client: "copilot_cli",
          state: "aligned",
        }),
      ]);
    },
  );
});

describe("explicit client selection", () => {
  // A regular file where the shared directory belongs fails every access
  // probe (ENOTDIR on POSIX, ENOENT on Windows), which is the shape an ACL
  // failure takes for automatic discovery.
  const unreachableSharedParent = async (): Promise<string> => {
    const home = await createTestTempDirectory("rea-selected-unreachable-");
    await writeFile(join(home, ".agents"), "not a directory");
    return home;
  };

  it("inspects a selected client whose config location cannot be probed", async () => {
    const home = await unreachableSharedParent();

    const statuses = await readClientRegistrationStatuses(
      home,
      "/current/rea",
      {
        environment: {},
        selectedClientIds: ["freebuff"],
      },
    );

    // Before explicit selection authorised the read, every probe failed and
    // the client was omitted, so doctor reported "not detected" instead.
    expect(statuses).toEqual([
      expect.objectContaining({
        client: "freebuff",
        config_path: join(home, ".agents", "mcp.json"),
        command: [],
      }),
    ]);
  });

  it.skipIf(process.platform === "win32")(
    "reports an unreadable selected config instead of omitting the client",
    async () => {
      const home = await unreachableSharedParent();

      const statuses = await readClientRegistrationStatuses(
        home,
        "/current/rea",
        {
          environment: {},
          selectedClientIds: ["freebuff"],
        },
      );

      expect(statuses).toEqual([
        expect.objectContaining({
          client: "freebuff",
          state: "invalid",
          remediation: expect.stringContaining("could not be read"),
        }),
      ]);
    },
  );

  it("keeps automatic discovery probing when no client is selected", async () => {
    const home = await unreachableSharedParent();

    const statuses = await readClientRegistrationStatuses(
      home,
      "/current/rea",
      {
        environment: {},
      },
    );

    expect(statuses.map(({ client }) => client)).not.toContain("freebuff");
  });
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "reports an inaccessible configuration target instead of omitting its registration",
  async () => {
    const home = await createTestTempDirectory(
      "rea-registration-denied-target-",
    );
    const locked = join(home, "owned-denied");
    await mkdir(locked);
    const target = join(locked, "client.json");
    await writeFile(
      target,
      JSON.stringify({
        mcpServers: { reverseport: { command: "rea", args: ["mcp"] } },
      }),
    );
    const path = join(home, ".claude.json");
    await symlink(target, path);
    await chmod(locked, 0);
    try {
      const statuses = await readClientRegistrationStatuses(
        home,
        "/current/rea",
      );
      expect(
        statuses.find((status) => status.client === "claude_code"),
      ).toMatchObject({
        config_path: path,
        state: "invalid",
        command: [],
        remediation: expect.any(String),
      });
      expect(
        (await existingMaintenanceScope(home, "/current/rea", process.env))
          .clients,
      ).not.toContain("claude_code");
    } finally {
      await chmod(locked, 0o700);
    }
  },
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "reports an unresolved configuration location when metadata lookup is denied",
  async () => {
    const home = await createTestTempDirectory(
      "rea-registration-denied-metadata-",
    );
    const locked = join(home, "owned-denied");
    const directory = join(locked, "claude");
    await mkdir(directory, { recursive: true });
    vi.stubEnv("CLAUDE_CONFIG_DIR", directory);
    await chmod(locked, 0);
    try {
      const statuses = await readClientRegistrationStatuses(
        home,
        "/current/rea",
      );
      expect(
        statuses.find((status) => status.client === "claude_code"),
      ).toMatchObject({
        state: "invalid",
        command: [],
        remediation: expect.stringContaining("EACCES"),
      });
    } finally {
      await chmod(locked, 0o700);
    }
  },
);

it("reports a dangling configuration entry as missing without losing the detected client", async () => {
  const home = await createTestTempDirectory(
    "rea-registration-dangling-config-",
  );
  const path = join(home, ".claude.json");
  await symlink(join(home, "absent.json"), path);
  expect(
    (await readClientRegistrationStatuses(home)).find(
      (status) => status.client === "claude_code",
    ),
  ).toMatchObject({ config_path: path, state: "missing", command: [] });
});

describe("registrations under the previous server name", () => {
  const owned = {
    command: "npx",
    args: ["-y", PRODUCT_IDENTITY.registrationPackageSpecifier, "mcp"],
  };
  const cursor = async (
    servers: Record<string, unknown>,
  ): Promise<{ readonly home: string; readonly path: string }> => {
    const home = await createTestTempDirectory("rea-previous-server-key-");
    await mkdir(join(home, ".cursor"));
    const path = join(home, ".cursor", "mcp.json");
    await writeFile(path, JSON.stringify({ mcpServers: servers }));
    return { home, path };
  };
  const inspect = async (home: string) => {
    const inspections = await readClientRegistrationInspections(
      home,
      "/current/rea",
    );
    const inspection = inspections.find(
      ({ status }) => status.client === "cursor",
    );
    if (inspection === undefined) throw new Error("cursor was not inspected");
    return inspection;
  };

  it("names the current and previous keys as decided", () => {
    expect(PRODUCT_IDENTITY.mcpServerKey).toBe("reverseport");
    expect(PRODUCT_IDENTITY.previousMcpServerKeys).toEqual(["rea"]);
  });

  it("reports an owned previous-name entry alone as stale under that key", async () => {
    const { home, path } = await cursor({ rea: owned });
    expect(await inspect(home)).toEqual({
      status: {
        client: "cursor",
        config_path: path,
        command: [owned.command, ...owned.args],
        package_reference: PRODUCT_IDENTITY.registrationPackageSpecifier,
        server_key: "rea",
        state: "stale",
        remediation: expect.stringContaining(
          'previous server name "rea". reverseport setup renames it to "reverseport"',
        ),
      },
      activation: "enabled",
      commandIdentity: "owned",
    });
  });

  it.each(["rea", "reverseport"])(
    "reads the %s entry's own environment",
    async (key) => {
      const home = await createTestTempDirectory("rea-previous-server-env-");
      await mkdir(join(home, ".codex"));
      await writeFile(
        join(home, ".codex", "config.toml"),
        `[mcp_servers.${key}]\ncommand = "npx"\nargs = ["-y", "${PRODUCT_IDENTITY.registrationPackageSpecifier}", "mcp"]\nstartup_timeout_sec = 30\ntool_timeout_sec = 450\n[mcp_servers.${key}.env]\nREA_ANALYSIS_PROVIDER = 5\n`,
      );
      const statuses = await readClientRegistrationStatuses(
        home,
        "/current/rea",
      );
      expect(statuses.find(({ client }) => client === "codex")).toMatchObject({
        state: "invalid",
        command: [],
      });
    },
  );

  it("keeps an unresolved previous-name entry unknown", async () => {
    const { home } = await cursor({
      rea: { command: join(tmpdirMissing, "rea"), args: ["mcp"] },
    });
    expect(await inspect(home)).toMatchObject({
      status: { state: "unknown", server_key: "rea" },
      commandIdentity: "unknown",
    });
  });

  it("reports a foreign previous-name entry alone as missing with an advisory", async () => {
    const { home, path } = await cursor({
      rea: { command: "foreign-server", args: [] },
    });
    const inspection = await inspect(home);
    expect(inspection).toMatchObject({
      status: { state: "missing", command: [] },
      activation: "unknown",
      commandIdentity: "unknown",
    });
    expect(inspection.status.server_key).toBeUndefined();
    expect(inspection.status.server_key_advisory).toContain(
      `${path} registers a server under REA's previous name "rea" that reverseport setup keeps unchanged: its launcher is not REA's.`,
    );
  });

  it("flags an owned enabled previous-name entry beside the current one as a duplicate", async () => {
    const { home } = await cursor({ reverseport: owned, rea: owned });
    const inspection = await inspect(home);
    expect(inspection).toMatchObject({
      status: {
        state: "stale",
        remediation: expect.stringContaining(
          'An REA-owned registration under the previous server name "rea" is also enabled',
        ),
      },
      activation: "enabled",
      commandIdentity: "owned",
    });
    expect(inspection.status.server_key).toBeUndefined();
  });

  it.each([
    ["a disabled owned", { ...owned, disabled: true }, "is not enabled in"],
    [
      "a foreign",
      { command: "foreign-server", args: [] },
      "its launcher is not REA's",
    ],
  ])(
    "keeps the current entry aligned beside %s previous-name entry and reports it",
    async (_label, previous, advisory) => {
      const { home } = await cursor({ reverseport: owned, rea: previous });
      const inspection = await inspect(home);
      expect(inspection.status).toMatchObject({
        state: "aligned",
        server_key_advisory: expect.stringContaining(advisory),
      });
      expect(inspection.status.server_key).toBeUndefined();
    },
  );
});

const tmpdirMissing = resolve("/nonexistent-rea-release");
