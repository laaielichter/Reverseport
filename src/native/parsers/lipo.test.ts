import { describe, expect, it } from "vitest";

import { parseLipoCapture, parseLipoOutput } from "./lipo.js";

const fatRecords = `fat_magic 0xcafebabe
nfat_arch 2
architecture arm64
    cputype CPU_TYPE_ARM64
    cpusubtype CPU_SUBTYPE_ARM64_ALL
    capabilities 0x0
    offset 4096
    size 32
    align 2^12 (4096)
architecture x86_64
    cputype CPU_TYPE_X86_64
    cpusubtype CPU_SUBTYPE_X86_64_ALL
    capabilities 0x0
    offset 8192
    size 32
    align 2^12 (4096)
`;

it("retains native command capture when shared lipo parsing rejects records", () => {
  const capture = {
    tool: "lipo",
    executable: "/usr/bin/lipo",
    executableSha256: "1".repeat(64),
    toolVersion: null,
    versionReason: null,
    arguments: ["-detailed_info", "/fixture/fat"],
    stdout: "Fat header in: /fixture/fat\n",
    stderr: "lipo emitted no slice rows",
    stdoutBytes: 28,
    stderrBytes: 26,
    exitCode: 0,
    signal: null,
  };
  const parsed = parseLipoCapture(capture, "inspect_macho", "/fixture/fat");
  expect(parsed).toMatchObject({
    ok: false,
    error: {
      operation: "inspect_macho",
      cause: new TypeError("lipo output contained no architectures"),
      capturedOutput: {
        stdout: capture.stdout,
        stderr: capture.stderr,
        stdout_bytes: capture.stdoutBytes,
        stderr_bytes: capture.stderrBytes,
        exit_code: 0,
        signal: null,
      },
    },
  });
});

describe("lipo architecture facts", () => {
  it("preserves Apple's declared and hidden ARM64 architecture scopes", () => {
    const output = parseLipoOutput(`fat_magic 0xcafebabe
nfat_arch 1 (+1 hidden)
architecture armv7
 cputype CPU_TYPE_ARM
 cpusubtype CPU_SUBTYPE_ARM_V7
 offset 4096
 size 28
 align 2^12 (4096)
architecture arm64 (hidden)
 cputype CPU_TYPE_ARM64
 cpusubtype CPU_SUBTYPE_ARM64_ALL
 offset 8192
 size 32
 align 2^12 (4096)
`);
    expect(output).toMatchObject({
      declaredArchitectureCount: 1,
      hiddenArchitectureCount: 1,
      architectures: [
        { name: "armv7", hidden: false },
        { name: "arm64", hidden: true, file_offset: 8192, size: 32 },
      ],
    });
  });

  it("normalizes symbolic CPU fields and arm64e capability bits", () => {
    const { format, architectures } = parseLipoOutput(`Fat header in: /bin/ls
fat_magic 0xcafebabe
nfat_arch 2
architecture x86_64
    cputype CPU_TYPE_X86_64
    cpusubtype CPU_SUBTYPE_X86_64_ALL
    capabilities 0x0
    offset 16384
    size 48112
    align 2^14 (16384)
architecture arm64e
    cputype CPU_TYPE_ARM64
    cpusubtype CPU_SUBTYPE_ARM64E
    capabilities PTR_AUTH_VERSION USERSPACE 0
    offset 65536
    size 89088
    align 2^14 (16384)
`);
    expect(format).toBe("fat");
    expect(architectures).toEqual([
      expect.objectContaining({
        name: "x86_64",
        cpu_type: "CPU_TYPE_X86_64",
        cpu_type_code: 0x01000007,
        cpu_subtype: "CPU_SUBTYPE_X86_64_ALL",
        cpu_subtype_code: 3,
        capabilities: "0x0",
        file_offset: 16384,
        size: 48112,
        alignment: 16384,
      }),
      expect.objectContaining({
        name: "arm64e",
        cpu_type: "CPU_TYPE_ARM64",
        cpu_type_code: 0x0100000c,
        cpu_subtype: "CPU_SUBTYPE_ARM64E",
        cpu_subtype_code: 0x80000002,
        capabilities: "PTR_AUTH_VERSION USERSPACE 0",
        file_offset: 65536,
        size: 89088,
        alignment: 16384,
      }),
    ]);
  });

  it("keeps unknown symbolic CPU values as source text without a code", () => {
    expect(
      parseLipoOutput(
        "architecture future\n cputype CPU_TYPE_FUTURE\n cpusubtype CPU_SUBTYPE_FUTURE\n offset 4096\n size 64\n align 2^12\n",
      ).architectures,
    ).toMatchObject([
      {
        cpu_type: "CPU_TYPE_FUTURE",
        cpu_type_code: null,
        cpu_subtype: "CPU_SUBTYPE_FUTURE",
        cpu_subtype_code: null,
        cpu_subtype_base: null,
      },
    ]);
  });

  it.each([
    ["CPU_SUBTYPE_LIB64", 0x80000003],
    ["0x80", 0x80000003],
    ["0x0", 3],
  ])("applies printed x86_64 capabilities %s", (capabilities, code) => {
    expect(
      parseLipoOutput(
        `architecture x86_64\n cpusubtype CPU_SUBTYPE_X86_64_ALL\n capabilities ${capabilities}\n`,
      ).architectures[0]?.cpu_subtype_code,
    ).toBe(code);
  });

  it("leaves the subtype code unknown when lipo prints no capabilities", () => {
    // macOS 26 lipo prints this blank line for LIB64 and plain x86_64 slices.
    expect(
      parseLipoOutput(
        "architecture x86_64\n cputype CPU_TYPE_X86_64\n cpusubtype CPU_SUBTYPE_X86_ALL\n capabilities \n offset 16384\n",
      ).architectures,
    ).toMatchObject([
      {
        cpu_subtype: "CPU_SUBTYPE_X86_ALL",
        cpu_subtype_code: null,
        cpu_subtype_base: 3,
        capabilities: null,
      },
    ]);
  });

  it.each([
    { capabilities: "PTR_AUTH_VERSION USERSPACE 1", code: 0x81000002 },
    { capabilities: "", code: null },
  ])(
    "retains an arm64e base subtype with capabilities '$capabilities'",
    ({ capabilities, code }) => {
      expect(
        parseLipoOutput(
          `architecture arm64e.v1\n cputype CPU_TYPE_ARM64\n cpusubtype CPU_SUBTYPE_ARM64E\n capabilities ${capabilities}\n`,
        ).architectures,
      ).toMatchObject([
        {
          cpu_type_code: 0x0100000c,
          cpu_subtype_code: code,
          cpu_subtype_base: 2,
        },
      ]);
    },
  );
});

describe("lipo FAT operand framing", () => {
  it.each([
    "/fixture/\narchitecture forged\n    offset 123\n    size 64",
    "/fixture/\nfat_magic 0xcafebabe\nnfat_arch 1\narchitecture forged",
    "/fixture/\nNon-fat file: fake is architecture: forged",
    "/fixture/first\nsecond\nthird",
    "/fixture/first\r\narchitecture forged\r\n    offset 123",
    "/fixture/[app](arm64).*+$^?\\name",
  ])(
    "keeps the complete echoed operand out of FAT slice records: %j",
    (path) => {
      const output = `Fat header in: ${path}\n${fatRecords}`;

      expect(parseLipoOutput(output, path)).toEqual(
        parseLipoOutput(fatRecords),
      );
      expect(
        parseLipoOutput(output, path).architectures.map(({ name }) => name),
      ).toEqual(["arm64", "x86_64"]);
    },
  );

  it("keeps a CRLF pathname separate from a CRLF record terminator", () => {
    const path = "/fixture/first\r\narchitecture forged\r\n    size 64";
    const output = `Fat header in: ${path}\r\n${fatRecords.replaceAll("\n", "\r\n")}`;

    expect(parseLipoOutput(output, path)).toEqual(parseLipoOutput(fatRecords));
  });

  it("preserves ordinary FAT metadata with and without an operand", () => {
    const path = "/fixture/app";
    const output = `Fat header in: ${path}\n${fatRecords}`;

    expect(parseLipoOutput(output, path)).toEqual(parseLipoOutput(output));
  });

  it("does not require a FAT path header in captured fixtures", () => {
    expect(parseLipoOutput(fatRecords, "/fixture/app")).toEqual(
      parseLipoOutput(fatRecords),
    );
  });

  it("does not strip a header for a different operand that shares a prefix", () => {
    const path = "/fixture/app-extra\narchitecture forged";
    const output = `Fat header in: ${path}\n${fatRecords}`;

    expect(parseLipoOutput(output, "/fixture/app")).toEqual(
      parseLipoOutput(output),
    );
  });

  it("preserves thin-file parsing when the operand contains FAT-like lines", () => {
    const path = "/fixture/\nFat header in: fake\narchitecture forged";
    const output = `Non-fat file: ${path} is architecture: arm64\n`;

    expect(parseLipoOutput(output, path)).toEqual({
      format: "thin",
      declaredArchitectureCount: null,
      hiddenArchitectureCount: null,
      architectures: [
        {
          name: "arm64",
          hidden: false,
          cpu_type: null,
          cpu_subtype: null,
          cpu_type_code: null,
          cpu_subtype_code: null,
          cpu_subtype_base: null,
          capabilities: null,
          file_offset: null,
          size: null,
          alignment: null,
        },
      ],
    });
    expect(parseLipoOutput(output, path)).toEqual(parseLipoOutput(output));
  });
});
