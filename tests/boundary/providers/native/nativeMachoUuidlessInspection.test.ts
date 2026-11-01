import { expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { machoImage } from "../../../../src/artifacts/apple/MachoImage.fixture.js";
import { createServer } from "../../../../src/server/createServer.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  NativeCommandFailure,
  type NativeCommandCapture,
  type NativeCommandOptions,
  type NativeCommandRunner,
} from "../../../../src/native/CommandRunner.js";
import { err, ok } from "../../../../src/domain/result.js";
import { createTestBinarySession } from "../../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import {
  NativeFixtureRunner,
  nativeFixture,
  nativeMachoTarget,
  withOtoolMachHeader,
} from "../../../fixtures/nativeCommands.js";

const missingUuidDiagnostic = "missing LC_UUID load command";

const dyldDiagnosticOutput = (path: string, diagnostic: string): string =>
  `${path} [arm64]:\n   ${diagnostic}\n`;

const otoolOutputWithoutUuid = async () => {
  const otool = await nativeFixture("otool-load.txt");
  const commandOutput = otool.slice(otool.indexOf("Load command 0\n"));
  let commandIndex = 0;
  const withoutUuidCommands = commandOutput
    .replace(
      /Load command 1\n\s*cmd LC_UUID\n\s*cmdsize 24\n\s*uuid [^\n]+\n/u,
      "",
    )
    .replace(/^Load command \d+$/gmu, () => `Load command ${commandIndex++}`);
  return withOtoolMachHeader(withoutUuidCommands);
};

class UuidlessDyldRunner implements NativeCommandRunner {
  readonly fixture: NativeFixtureRunner;
  readonly commands: {
    readonly tool: string;
    readonly args: readonly string[];
  }[] = [];

  constructor(
    otool: string,
    readonly diagnostic = missingUuidDiagnostic,
    readonly stderr = "",
    readonly signal: string | null = null,
  ) {
    this.fixture = new NativeFixtureRunner({
      "otool:-h": otool,
      dwarfdump: "",
    });
  }

  async run(
    tool: string,
    arguments_: readonly string[],
    options: NativeCommandOptions,
  ) {
    this.commands.push({ tool, args: arguments_ });
    if (tool !== "dyld_info") return this.fixture.run(tool, arguments_);
    const capture: NativeCommandCapture = {
      tool,
      executable: "/usr/bin/dyld_info",
      executableSha256: "a".repeat(64),
      toolVersion: null,
      versionReason: null,
      arguments: [...arguments_],
      stdout: dyldDiagnosticOutput(arguments_.at(-1) ?? "", this.diagnostic),
      stderr: this.stderr,
      stdoutBytes: Buffer.byteLength(
        dyldDiagnosticOutput(arguments_.at(-1) ?? "", this.diagnostic),
      ),
      stderrBytes: Buffer.byteLength(this.stderr),
      exitCode: 1,
      signal: this.signal,
    };
    if (options.acceptNonZero) return ok(capture);
    return err(
      new NativeCommandFailure(tool, "nonzero-exit", 1, undefined, {
        stdout: capture.stdout,
        stderr: capture.stderr,
        stdoutBytes: capture.stdoutBytes,
        stderrBytes: capture.stderrBytes,
        exitCode: capture.exitCode,
        signal: capture.signal,
        truncated: false,
      }),
    );
  }
}

it.each([
  { fileType: "4", diagnostic: "unknown mh.filetype 4" },
  { fileType: "CORE", diagnostic: "unknown mh.filetype 4" },
  { fileType: "3", diagnostic: "unknown mh.filetype 3" },
  { fileType: "4", diagnostic: "unknown filetype 4" },
  { fileType: "3", diagnostic: "unknown filetype 3" },
  {
    fileType: "10",
    diagnostic:
      "section '__TEXT/__text' has offset=0 but is not a zero-fill section type",
  },
])(
  "classifies $diagnostic for Mach-O type $fileType before nm fallback",
  async ({ fileType, diagnostic }) => {
    const otool = [
      "Mach header",
      "magic cputype cpusubtype caps filetype ncmds sizeofcmds flags",
      `0xfeedfacf 16777228 0 0x00 ${fileType} 0 0 0x0`,
    ].join("\n");
    const runner = new UuidlessDyldRunner(otool, diagnostic);
    const path = "/fixture/refused-type";
    const result = await new NativeMacOSProvider({}, runner, "darwin")
      .createClient(nativeMachoTarget(path))
      .execute("inspect_macho", {});

    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisUnsupportedTargetError",
        path,
        reason: expect.stringContaining(
          fileType === "10" ? "dSYM" : diagnostic,
        ),
        remediationAction: expect.stringContaining("linked Mach-O"),
        capturedOutput: {
          stdout: dyldDiagnosticOutput(path, diagnostic),
          exit_code: 1,
          signal: null,
          truncated: false,
        },
      },
    });
    expect(runner.commands.filter(({ tool }) => tool === "nm")).toEqual([
      expect.objectContaining({
        args: expect.arrayContaining(["--no-dyldinfo"]),
      }),
    ]);
  },
);

it.each([
  { fileType: "2", signal: null, diagnostic: "unknown mh.filetype 4" },
  { fileType: "UNKNOWN", signal: null, diagnostic: "unknown mh.filetype 4" },
  { fileType: "4", signal: "SIGTERM", diagnostic: "unknown mh.filetype 4" },
  { fileType: "2", signal: null, diagnostic: "unknown filetype 4" },
  { fileType: "4", signal: "SIGTERM", diagnostic: "unknown filetype 4" },
])(
  "keeps $diagnostic as a failure for header $fileType and signal $signal",
  async ({ fileType, signal, diagnostic }) => {
    const otool = [
      "Mach header",
      "magic cputype cpusubtype caps filetype ncmds sizeofcmds flags",
      `0xfeedfacf 16777228 0 0x00 ${fileType} 0 0 0x0`,
    ].join("\n");
    const runner = new UuidlessDyldRunner(otool, diagnostic, "", signal);
    const result = await new NativeMacOSProvider({}, runner, "darwin")
      .createClient(nativeMachoTarget("/fixture/conflicting-type"))
      .execute("inspect_macho", {});

    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: signal === null ? "AnalysisOutputError" : "ProviderAdapterError",
        capturedOutput: { exit_code: 1, signal },
      },
    });
  },
);

it("returns readable Mach-O Evidence when dyld_info identifies a missing UUID", async () => {
  const withoutUuid = await otoolOutputWithoutUuid();
  const runner = new UuidlessDyldRunner(withoutUuid);
  const result = await new NativeMacOSProvider({}, runner, "darwin")
    .createClient(nativeMachoTarget("/fixture/no-uuid"))
    .execute("inspect_macho", {});

  expect(result.ok, JSON.stringify(result.ok ? null : result.error)).toBe(true);
  if (!result.ok) return;
  expect(result.value.result).toMatchObject({
    uuid: null,
    load_commands: { exhaustive: true },
    imports: { items: [], total: null, exhaustive: false },
    exports: {
      items: expect.arrayContaining([
        expect.objectContaining({ name: "_main", source: "nm" }),
      ]),
      total: null,
      exhaustive: false,
    },
    provenance: expect.arrayContaining([
      expect.objectContaining({
        tool: "dyld_info",
        exit: { code: 1, signal: null },
        stdout_bytes: Buffer.byteLength(
          dyldDiagnosticOutput("/fixture/no-uuid", missingUuidDiagnostic),
        ),
      }),
    ]),
  });
  expect(result.value.limitations).toContain(
    "dyld_info -imports reported 'missing LC_UUID load command'; import observations are unavailable.",
  );
  expect(result.value.limitations).toContain(
    "dyld_info -exports reported 'missing LC_UUID load command'; exports include nm symbol-table observations only.",
  );
});

it("keeps other dyld_info nonzero exits as command failures", async () => {
  const runner = new UuidlessDyldRunner(
    await nativeFixture("otool-load.txt"),
    "malformed load command table",
  );
  const result = await new NativeMacOSProvider({}, runner, "darwin")
    .createClient(nativeMachoTarget("/fixture/malformed"))
    .execute("inspect_macho", {});

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toMatchObject({
    _tag: "ProviderAdapterError",
    diagnostics: { tool: "dyld_info", reason: "nonzero-exit", exit_code: 1 },
    capturedOutput: {
      stdout: dyldDiagnosticOutput(
        "/fixture/malformed",
        "malformed load command table",
      ),
      exit_code: 1,
      truncated: false,
    },
  });
});

it("does not treat a newline in the echoed operand path as dyld_info evidence", async () => {
  const withoutUuid = await otoolOutputWithoutUuid();
  const path = "/fixture/\nmissing LC_UUID load command\n";
  const runner = new UuidlessDyldRunner(
    withoutUuid,
    "malformed load command table",
  );
  const result = await new NativeMacOSProvider({}, runner, "darwin")
    .createClient(nativeMachoTarget(path))
    .execute("inspect_macho", {});

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toMatchObject({
    _tag: "ProviderAdapterError",
    diagnostics: { tool: "dyld_info", reason: "nonzero-exit", exit_code: 1 },
  });
});

it("does not treat a newline in stderr's echoed operand path as dyld_info evidence", async () => {
  const withoutUuid = await otoolOutputWithoutUuid();
  const path = "/fixture/\nmissing LC_UUID load command\n";
  const runner = new UuidlessDyldRunner(
    withoutUuid,
    "malformed load command table",
    `${path}: file not found`,
  );
  const result = await new NativeMacOSProvider({}, runner, "darwin")
    .createClient(nativeMachoTarget(path))
    .execute("inspect_macho", {});

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toMatchObject({
    _tag: "ProviderAdapterError",
    diagnostics: { tool: "dyld_info", reason: "nonzero-exit", exit_code: 1 },
    capturedOutput: {
      stderr: `${path}: file not found`,
      exit_code: 1,
    },
  });
});

it("does not call a target UUID-less when otool observed LC_UUID", async () => {
  const runner = new UuidlessDyldRunner(await nativeFixture("otool-load.txt"));
  const result = await new NativeMacOSProvider({}, runner, "darwin")
    .createClient(nativeMachoTarget("/fixture/conflicting-uuid"))
    .execute("inspect_macho", {});

  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisOutputError",
      reason:
        "dyld_info reported a missing LC_UUID despite an observed LC_UUID load command",
      capturedOutput: {
        stdout: dyldDiagnosticOutput(
          "/fixture/conflicting-uuid",
          missingUuidDiagnostic,
        ),
        exit_code: 1,
        signal: null,
      },
    },
  });
});

it("delivers partial UUID-less inspection Evidence through production MCP", async () => {
  const directory = await createTestTempDirectory("rea-macho-no-uuid-mcp-");
  const path = join(directory, "probe");
  await writeFile(path, machoImage({}));
  const withoutUuid = await otoolOutputWithoutUuid();
  const session = createTestBinarySession(
    new NativeMacOSProvider({}, new UuidlessDyldRunner(withoutUuid), "darwin"),
  );
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "macho-uuidless-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path },
    });
    expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);

    const inspected = await client.callTool({
      name: "inspect_macho",
      arguments: {},
    });
    expect(inspected.isError, JSON.stringify(inspected.content)).not.toBe(true);
    expect(inspected.structuredContent).toMatchObject({
      normalized_result: {
        uuid: null,
        imports: { items: [], total: null, exhaustive: false },
        exports: {
          items: expect.arrayContaining([
            expect.objectContaining({ name: "_main", source: "nm" }),
          ]),
          total: null,
          exhaustive: false,
        },
        limitations: expect.arrayContaining([
          "dyld_info -imports reported 'missing LC_UUID load command'; import observations are unavailable.",
        ]),
      },
    });
  } finally {
    await Promise.all([client.close(), server.close(), session.close()]);
  }
});
