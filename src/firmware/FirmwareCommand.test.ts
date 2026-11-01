import { EventEmitter } from "node:events";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { expect, it as test, vi } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { AnalysisCapabilityUnavailableError } from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { FIRMWARE_LIMITS } from "./FirmwareRelease.js";
import { FirmwareFileAccess } from "./FirmwareFiles.js";
import {
  resolveFirmwareCommand,
  runFirmwareCommand,
} from "./FirmwareCommand.js";
import {
  spawnOwnedProviderProcess,
  type ProviderProcessHandle,
  type OwnedProviderProcessSpawnOptions,
} from "../process/ProviderProcess.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { ExecFileOutputCancelledError } from "../process/ExecFileOutput.js";

const it = test.skipIf(process.platform !== "linux");

it.each([
  { source: "analysis", wrapped: false },
  { source: "caller", wrapped: false },
  { source: "analysis", wrapped: true },
  { source: "caller", wrapped: true },
] as const)(
  "classifies $source cancellation during launcher admission (wrapped: $wrapped)",
  async ({ source, wrapped }) => {
    const analysis = new AbortController();
    const caller = new AbortController();
    const reason =
      source === "analysis"
        ? new DOMException("selected deadline", "TimeoutError")
        : { caller: "opaque admission cancellation" };
    const retainCleanup = vi.fn();
    const failure: unknown = await runFirmwareCommand({
      fileSizeCeiling: Number.MAX_SAFE_INTEGER,
      engine: "binwalk",
      operation: "inspect_firmware_regions",
      command: "/usr/bin/true",
      limiter: "/usr/bin/true",
      args: ["--version"],
      cwd: await createTestTempDirectory("rea-firmware-admission-"),
      environment: process.env,
      signal: AbortSignal.any([analysis.signal, caller.signal]),
      deadline: {
        phase: "analysis",
        signal: analysis.signal,
        timeoutMs: 1234,
        expiresAtMs: performance.now() + 1234,
      },
      launcher: async (options) => {
        // Real launcher is paused at its first ownership-preparation await;
        // it must reject before acquiring a child after this cancellation.
        const admission = wrapped
          ? undefined
          : spawnOwnedProviderProcess(options);
        (source === "analysis" ? analysis : caller).abort(reason);
        if (admission !== undefined) return admission;
        throw new ExecFileOutputCancelledError(reason);
      },
      retainCleanup,
    }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(AnalysisError);
    if (!(failure instanceof AnalysisError))
      throw new Error("Expected typed admission interruption");
    expect(failure.cause).toBe(reason);
    expect(projectAnalysisError(failure)).toMatchObject(
      source === "analysis"
        ? {
            code: "provider_timeout",
            details: { timeout_ms: 1234, diagnostics: { phase: "analysis" } },
            remediation: {
              action: expect.stringContaining("analysis_timeout_ms"),
            },
          }
        : { code: "cancelled" },
    );
    expect(retainCleanup).not.toHaveBeenCalled();
  },
);

it("does not relabel an unrelated launch failure when a deadline also fires", async () => {
  const analysis = new AbortController();
  const failure = new Error("distinct launch refusal");
  await expect(
    runFirmwareCommand({
      fileSizeCeiling: Number.MAX_SAFE_INTEGER,
      engine: "binwalk",
      operation: "inspect_firmware_regions",
      command: "/usr/bin/true",
      limiter: "/usr/bin/true",
      args: [],
      cwd: await createTestTempDirectory("rea-firmware-admission-error-"),
      environment: process.env,
      signal: analysis.signal,
      deadline: {
        phase: "analysis",
        signal: analysis.signal,
        timeoutMs: 1234,
        expiresAtMs: performance.now() + 1234,
      },
      launcher: async () => {
        analysis.abort();
        throw failure;
      },
      retainCleanup: vi.fn(),
    }),
  ).rejects.toBe(failure);
});

test("names the host and tool requirement of an unconfigured engine", async () => {
  const refusal: unknown = await resolveFirmwareCommand(
    {},
    "binwalk",
    "inspect_firmware_regions",
    new FirmwareFileAccess(),
  ).catch((cause: unknown) => cause);

  expect(refusal).toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
  });
  if (!(refusal instanceof AnalysisCapabilityUnavailableError))
    throw new Error("Expected a capability refusal");
  expect(projectAnalysisError(refusal)).toMatchObject({
    code: "capability_unavailable",
    message: refusal.reason,
    remediation: { action: refusal.reason },
  });
  expect(refusal.reason).toContain("REA_BINWALK_COMMAND");
});

it("rejects a directory configured as the firmware engine executable", async () => {
  const root = await createTestTempDirectory("rea-firmware-command-");
  const command = join(root, "binwalk");
  const limiter = await executableFixture(root, "prlimit");
  await mkdir(command);

  await expect(
    resolveFirmwareCommand(
      {
        REA_BINWALK_COMMAND: command,
        REA_FIRMWARE_PRLIMIT_COMMAND: limiter,
      },
      "binwalk",
      "inspect_firmware_regions",
      new FirmwareFileAccess(),
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    reason: expect.stringContaining(command),
  });
});

it("classifies an unusable firmware engine as an unavailable capability", async () => {
  const root = await createTestTempDirectory("rea-firmware-command-");
  const command = join(root, "binwalk");
  const limiter = await executableFixture(root, "prlimit");
  await writeFile(command, "not executable", { mode: 0o600 });

  await expect(
    resolveFirmwareCommand(
      {
        REA_BINWALK_COMMAND: command,
        REA_FIRMWARE_PRLIMIT_COMMAND: limiter,
      },
      "binwalk",
      "inspect_firmware_regions",
      new FirmwareFileAccess(),
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    reason: expect.stringContaining(command),
  });
});

it("rejects a directory configured as the resource limiter executable", async () => {
  const root = await createTestTempDirectory("rea-firmware-limiter-");
  const command = await executableFixture(root, "binwalk");
  const limiter = join(root, "prlimit");
  await mkdir(limiter);

  await expect(
    resolveFirmwareCommand(
      {
        REA_BINWALK_COMMAND: command,
        REA_FIRMWARE_PRLIMIT_COMMAND: limiter,
      },
      "binwalk",
      "inspect_firmware_regions",
      new FirmwareFileAccess(),
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    reason: expect.stringContaining(limiter),
  });
});

it("keeps captured tool output when firmware stops on SIGXCPU", async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter();
  const child: ProviderProcessHandle = {
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    pid: 4242,
    stdout,
    stderr,
    exitCode: null,
    signalCode: "SIGXCPU",
    kill: () => false,
  };
  let ended = 0;
  const close = () => {
    ended += 1;
    if (ended === 2) emitter.emit("close", null, "SIGXCPU");
  };
  stdout.once("end", close);
  stderr.once("end", close);
  setTimeout(() => {
    stdout.end("partial scan\n");
    stderr.end("cpu limit\n");
  }, 15);
  const analysis = new AbortController();
  const failure: unknown = await runFirmwareCommand({
    fileSizeCeiling: Number.MAX_SAFE_INTEGER,
    engine: "binwalk",
    operation: "inspect_firmware_regions",
    command: "/opt/binwalk",
    limiter: "/usr/bin/prlimit",
    args: ["--quiet"],
    cwd: await createTestTempDirectory("rea-firmware-signal-"),
    environment: process.env,
    signal: analysis.signal,
    deadline: {
      phase: "analysis",
      signal: analysis.signal,
      timeoutMs: 30_000,
      expiresAtMs: performance.now() + 30_000,
    },
    launcher: () =>
      Promise.resolve({
        process: child,
        ownership: {
          runId: "rea-firmware-signal",
          leaderPid: 4242,
          processGroupId: 4242,
        },
        cleanup: () => Promise.resolve({ cleaned: true, signaled: false }),
      }),
    retainCleanup: vi.fn(),
  }).catch((cause: unknown) => cause);
  expect(failure).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    resource: "cpu",
    capturedOutput: {
      stdout: "partial scan\n",
      stderr: "cpu limit\n",
      signal: "SIGXCPU",
      exit_code: null,
      truncated: false,
    },
  });
  if (!(failure instanceof AnalysisError))
    throw new Error("Expected a firmware resource constraint");
  expect(projectAnalysisError(failure).details?.captured_output).toMatchObject({
    stdout: "partial scan\n",
    stderr: "cpu limit\n",
    signal: "SIGXCPU",
  });
});

const executableFixture = async (root: string, name: string) => {
  const path = join(root, name);
  await writeFile(path, "#!/bin/sh\n");
  await chmod(path, 0o700);
  return path;
};

test.each([
  {
    selected: 1,
    inherited: Number.MAX_SAFE_INTEGER,
    expected: 8 * 1024 * 1024,
  },
  {
    selected: 16 * 1024 * 1024,
    inherited: Number.MAX_SAFE_INTEGER,
    expected: 16 * 1024 * 1024,
  },
  { selected: 16 * 1024 * 1024, inherited: 1024, expected: 1024 },
])(
  "separates payload $selected from metadata file headroom and inherited ceiling $inherited",
  async ({ selected, inherited, expected }) => {
    const root = await createTestTempDirectory("rea-firmware-file-policy-");
    const refused = new Error("stop after inspecting launch policy");
    const launcher = vi.fn(
      async (options: OwnedProviderProcessSpawnOptions) => {
        expect(options.arguments).toContain(`--fsize=${expected}:${expected}`);
        expect(options.arguments).toContain(
          `--as=${FIRMWARE_LIMITS.addressSpaceBytes}:${FIRMWARE_LIMITS.addressSpaceBytes}`,
        );
        throw refused;
      },
    );
    await expect(
      runFirmwareCommand({
        engine: "unblob",
        operation: "extract_firmware",
        command: "/synthetic/unblob",
        limiter: "/synthetic/prlimit",
        fileSizeCeiling: inherited,
        args: [],
        cwd: root,
        environment: {},
        signal: new AbortController().signal,
        deadline: {
          phase: "analysis",
          signal: new AbortController().signal,
          timeoutMs: 120_000,
          expiresAtMs: performance.now() + 120_000,
        },
        launcher,
        outputBudget: { root, bytes: selected, entries: 10 },
        retainCleanup: vi.fn(),
      }),
    ).rejects.toBe(refused);
    expect(launcher).toHaveBeenCalledOnce();
  },
);
