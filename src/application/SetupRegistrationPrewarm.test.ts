import { describe, expect, it } from "vitest";

import { PRODUCT_IDENTITY } from "../identity.js";
import {
  launchRegistrationRunnerCommand,
  materializeRegistrationRunnerCache,
  registrationPrewarmCommand,
  type RegistrationRunnerLaunch,
  type RegistrationRunnerLauncher,
} from "./SetupRegistrationPrewarm.js";

const specifier = PRODUCT_IDENTITY.registrationPackageSpecifier;

const launch = (
  overrides: Partial<RegistrationRunnerLaunch> = {},
): RegistrationRunnerLaunch => ({
  exitCode: 0,
  signal: null,
  stdout: "",
  stderr: "",
  timedOut: false,
  ...overrides,
});

describe("registrationPrewarmCommand", () => {
  it("replaces the server subcommand of an npx registration", () => {
    expect(registrationPrewarmCommand(["npx", "-y", specifier, "mcp"])).toEqual(
      ["npx", "-y", specifier, "--version"],
    );
  });

  it("keeps the Windows command wrapper", () => {
    expect(
      registrationPrewarmCommand([
        "cmd.exe",
        "/d",
        "/c",
        "npx",
        "-y",
        specifier,
        "mcp",
      ]),
    ).toEqual(["cmd.exe", "/d", "/c", "npx", "-y", specifier, "--version"]);
  });

  it("replaces the server subcommand of a bunx registration", () => {
    expect(registrationPrewarmCommand(["bunx", specifier, "mcp"])).toEqual([
      "bunx",
      specifier,
      "--version",
    ]);
  });

  it("keeps direct launchers and non-server commands undefined", () => {
    expect(registrationPrewarmCommand(["/opt/rea/rea", "mcp"])).toBeUndefined();
    expect(
      registrationPrewarmCommand(["npx", "-y", specifier, "doctor"]),
    ).toBeUndefined();
    expect(registrationPrewarmCommand([])).toBeUndefined();
  });
});

describe("materializeRegistrationRunnerCache", () => {
  it("skips direct launchers without launching", async () => {
    let launched = 0;
    const launcher: RegistrationRunnerLauncher = async () => {
      launched += 1;
      return launch();
    };
    const result = await materializeRegistrationRunnerCache(
      ["/opt/rea/rea", "mcp"],
      {},
      launcher,
    );
    expect(result).toEqual({ status: "skipped", reason: "direct_launcher" });
    expect(launched).toBe(0);
  });

  it("materializes the pinned spec once and reports warmed", async () => {
    const commands: (readonly string[])[] = [];
    const launcher: RegistrationRunnerLauncher = async (
      command,
      arguments_,
      options,
    ) => {
      commands.push([command, ...arguments_]);
      expect(options.timeoutMs).toBeGreaterThan(0);
      expect(options.env.REA_PREWARM_PROBE).toBe("1");
      expect(options.cwd.length).toBeGreaterThan(0);
      return launch({ stdout: "6.7.0\n" });
    };
    const result = await materializeRegistrationRunnerCache(
      ["npx", "-y", specifier, "mcp"],
      { REA_PREWARM_PROBE: "1" },
      launcher,
    );
    expect(result).toEqual({ status: "warmed" });
    expect(commands).toEqual([["npx", "-y", specifier, "--version"]]);
  });

  it("reports a bounded failure reason for a non-zero exit", async () => {
    const result = await materializeRegistrationRunnerCache(
      ["npx", "-y", specifier, "mcp"],
      {},
      async () => launch({ exitCode: 1, stderr: "spawn EPERM\n" }),
    );
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.reason).toContain("exit 1");
    expect(result.reason).toContain("spawn EPERM");
    expect(result.reason).not.toMatch(/[\n\r]/u);
    expect(result.reason).toContain("first client start");
  });

  it("reports a timeout failure without command output facts", async () => {
    const result = await materializeRegistrationRunnerCache(
      ["npx", "-y", specifier, "mcp"],
      {},
      async () => launch({ exitCode: null, timedOut: true }),
    );
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.reason).toContain("timed out");
  });

  it("reports a spawn failure", async () => {
    const result = await materializeRegistrationRunnerCache(
      ["npx", "-y", specifier, "mcp"],
      {},
      async () => launch({ exitCode: null, spawnError: "spawn npx ENOENT" }),
    );
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.reason).toContain("spawn npx ENOENT");
  });

  it("reports a forwarded interrupt as a failure", async () => {
    const result = await materializeRegistrationRunnerCache(
      ["npx", "-y", specifier, "mcp"],
      {},
      async () => launch({ exitCode: null, interruptedSignal: "SIGINT" }),
    );
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.reason).toContain("stopped by SIGINT");
  });
});

describe("launchRegistrationRunnerCommand", () => {
  it("captures a successful command exit", async () => {
    const result = await launchRegistrationRunnerCommand(
      process.execPath,
      ["--version"],
      {
        env: process.env,
        cwd: process.cwd(),
        timeoutMs: 30_000,
        platform: process.platform,
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  it("stops the runner tree at the deadline and reports the timeout", async () => {
    const startedAt = Date.now();
    const result = await launchRegistrationRunnerCommand(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        env: process.env,
        cwd: process.cwd(),
        timeoutMs: 300,
        platform: process.platform,
      },
    );
    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  });
});
