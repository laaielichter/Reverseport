import type {
  BinaryArchitecture,
  ElfFamilyMetadata,
  HeaderArchitecture,
  MipsElfMetadata,
  PeCodeViewRecord,
  RiscvElfMetadata,
  PowerPcElfMetadata,
  UniversalMachOSlice,
} from "./binaryTargetTypes.js";
import { err, ok, type Result } from "./result.js";
import { readElfFixedHeader } from "./elfFixedHeader.js";
import {
  mzWindowsHeaderLayoutLimitation,
  parseMzHeaderEvidence,
  type MzWindowsHeaderSignatureEvidence,
} from "./dosMz.js";
import { decodePeMachine, readPeOptionalHeader } from "./peMachine.js";
import {
  classifyFatContainerIdentity,
  readFatContainerHeader,
  readMachoHeaderPrefixFacts,
  validateFatSliceIdentity,
  type FatSliceHeaderEvidence,
} from "./apple/machoContainer.js";
import {
  MachoLoadCommandCursor,
  readMachoLoadCommandTableHeader,
} from "./apple/machoLoadCommands.js";

/** Format and architecture facts recovered from an executable header. */
export type ExecutableMetadata =
  | {
      readonly format: "elf";
      readonly architecture: "mips";
      readonly availableArchitectures: readonly "mips"[];
      readonly mips: MipsElfMetadata;
    }
  | {
      readonly format: "elf";
      readonly architecture: "riscv";
      readonly availableArchitectures: readonly "riscv"[];
      readonly riscv: RiscvElfMetadata;
    }
  | {
      readonly format: "elf";
      readonly architecture: "powerpc";
      readonly availableArchitectures: readonly "powerpc"[];
      readonly powerpc: PowerPcElfMetadata;
    }
  | {
      readonly format: "elf";
      readonly architecture: "hexagon";
      readonly availableArchitectures: readonly "hexagon"[];
    }
  | {
      readonly format: "mach-o";
      readonly architecture: "arm64_32";
      readonly availableArchitectures: readonly "arm64_32"[];
      readonly universalSlice?: never;
    }
  | {
      readonly format: "mach-o" | "elf" | "dos-mz" | "dos-com";
      readonly architecture: HeaderArchitecture;
      readonly availableArchitectures: readonly HeaderArchitecture[];
      readonly universalSlice?: never;
    }
  | {
      readonly format: "mach-o-universal";
      readonly architecture: HeaderArchitecture;
      readonly availableArchitectures: readonly HeaderArchitecture[];
      readonly universalSlice: UniversalMachOSlice;
    }
  | {
      readonly format: "pe";
      /** Original unsigned COFF machine, before CPU-family normalization. */
      readonly peMachine: number;
      readonly architecture: HeaderArchitecture;
      readonly availableArchitectures: readonly HeaderArchitecture[];
      readonly executableRole:
        | "application"
        | "shared-library"
        | "non-executable";
      readonly managed: boolean;
      readonly codeView?: PeCodeViewRecord;
    };

/**
 * Whether leading bytes begin an executable header family that
 * `parseExecutableHeader` interprets, whether or not that header is valid.
 */
export const claimsExecutableHeader = (
  bytes: Buffer,
  fileSize = bytes.length,
): boolean =>
  (bytes.length >= 4 &&
    (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(
        bytes.readUInt32BE(0),
      ))) ||
  (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) ||
  readFatContainerHeader(bytes, fileSize).state !== "not-fat";

/**
 * Parse supported executable headers without I/O. The caller supplies the host
 * architecture that FAT Mach-O slice selection prefers; a container without a
 * host slice selects its first declared supported slice.
 */
export const parseExecutableHeader = (
  bytes: Buffer,
  hostArchitecture: NodeJS.Architecture,
  fileSize = bytes.length,
  mzWindowsHeaderSignature?: MzWindowsHeaderSignatureEvidence,
  fatEvidence?: FatSliceHeaderEvidence,
): Result<ExecutableMetadata, string> => {
  if (
    bytes.length >= 4 &&
    bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  )
    return parseElf(bytes, fileSize);
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a)
    return parseMz(bytes, fileSize, mzWindowsHeaderSignature);
  if (bytes.length < 8) return err("truncated or unsupported binary header");
  const magic = bytes.readUInt32BE(0);
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magic))
    return parseThinMachO(bytes, fileSize);
  const fatHeader =
    fatEvidence?.header ?? readFatContainerHeader(bytes, fileSize);
  if (fatHeader.state !== "not-fat")
    return parseFatMachO(bytes, hostArchitecture, fatHeader, fatEvidence);
  return err("unsupported binary format");
};

/** CPU_TYPE_ARM64_32: AArch64 instructions with 32-bit pointers (watchOS). */
const CPU_TYPE_ARM64_32 = 0x0200000c;

const parseThinMachO = (
  bytes: Buffer,
  fileSize: number,
): Result<ExecutableMetadata, string> => {
  const table = readMachoLoadCommandTableHeader(bytes, fileSize);
  if (!table.ok) return table;
  if (table.value === null) return err("unsupported binary format");
  const identity = readMachoHeaderPrefixFacts(bytes.subarray(0, 12)).identity;
  if (identity === null) return err("unsupported Mach-O architecture");
  const architecture =
    identity.cpuType === CPU_TYPE_ARM64_32
      ? "arm64_32"
      : machArchitecture(identity.cpuType);
  if (architecture === undefined) return err("unsupported Mach-O architecture");
  const commands = new MachoLoadCommandCursor(table.value);
  while (commands.nextOffset !== null) {
    const offset = table.value.headerSize + commands.nextOffset;
    // Header-only callers may retain a prefix. File-backed admission walks
    // every remaining command header through its bounded reader.
    if (
      offset + 8 > bytes.length &&
      commands.nextOffset + 8 <= table.value.commandBytes
    )
      break;
    const frame = commands.read(bytes.subarray(offset, offset + 8));
    if (!frame.ok) return frame;
  }
  if (commands.nextOffset === null) {
    const complete = commands.finish();
    if (!complete.ok) return complete;
  }
  if (architecture === "arm64_32")
    return ok({
      format: "mach-o",
      architecture,
      availableArchitectures: [architecture],
    });
  return ok({
    format: "mach-o",
    architecture,
    availableArchitectures: [architecture],
  });
};

/** One FAT declaration whose CPU type is a supported Mach-O family. */
interface FatDeclaration {
  readonly architecture: HeaderArchitecture;
  readonly offset: number;
  readonly size: number;
}

/** Validate a FAT table and its slice identities without selecting a slice. */
const validatedFatDeclarations = (
  bytes: Buffer,
  header: Exclude<
    ReturnType<typeof readFatContainerHeader>,
    { state: "not-fat" }
  >,
  fatEvidence?: FatSliceHeaderEvidence,
): Result<readonly FatDeclaration[], string> => {
  if (header.state === "needs-data")
    return err("truncated or invalid FAT architecture table");
  if (header.state === "malformed") return err(header.reason);
  const identityError = fatIdentityError(
    bytes,
    header,
    fatEvidence?.sliceHeadersByOffset,
  );
  if (identityError !== null) return err(identityError);
  const sliceIdentityError = fatSliceIdentityError(
    bytes,
    header,
    fatEvidence?.sliceHeadersByOffset,
  );
  if (sliceIdentityError !== null) return err(sliceIdentityError);
  return ok(
    header.slices.flatMap((declaration) => {
      const architecture = machArchitecture(declaration.cpuType);
      return architecture === undefined
        ? []
        : [
            {
              architecture,
              offset: declaration.offset,
              size: declaration.size,
            },
          ];
    }),
  );
};

const declaredFamilies = (
  declarations: readonly FatDeclaration[],
): HeaderArchitecture[] => [
  ...new Set(declarations.map(({ architecture }) => architecture)),
];

/**
 * The supported CPU families a validated FAT Mach-O table declares, or null for
 * a non-FAT input. Unlike header parsing, it selects no slice, so it can show
 * that a table excludes a host even when no slice is selectable.
 */
export const readFatArchitectureFamilies = (
  bytes: Buffer,
  fileSize = bytes.length,
): Result<readonly HeaderArchitecture[], string> | null => {
  const header = readFatContainerHeader(bytes, fileSize);
  if (header.state === "not-fat") return null;
  const declarations = validatedFatDeclarations(bytes, header);
  return declarations.ok
    ? ok(declaredFamilies(declarations.value))
    : declarations;
};

const parseFatMachO = (
  bytes: Buffer,
  host: NodeJS.Architecture,
  header: Exclude<
    ReturnType<typeof readFatContainerHeader>,
    { state: "not-fat" }
  >,
  fatEvidence?: FatSliceHeaderEvidence,
): Result<ExecutableMetadata, string> => {
  const validated = validatedFatDeclarations(bytes, header, fatEvidence);
  if (!validated.ok) return validated;
  const declarations = validated.value;
  // Prefer the slice the host would load; a malformed host slice is an error.
  // A container without one still declares its images, so select the first
  // that can hold its Mach-O header, as a thin foreign image would be. A
  // family declared more than once, such as arm64 and arm64e, has no
  // provider-neutral choice and is not selected.
  const preferred = fatHostArchitecture(host);
  const hostSlice = declarations.find(
    ({ architecture }) => architecture === preferred,
  );
  const unambiguous = declarations.filter(
    ({ architecture }) =>
      declarations.filter((other) => other.architecture === architecture)
        .length === 1,
  );
  const candidates = hostSlice === undefined ? unambiguous : [hostSlice];
  const selected = candidates.find(
    ({ architecture, size }) =>
      size >= (architecture === "arm64" || architecture === "x86_64" ? 32 : 28),
  );
  if (selected === undefined) {
    const first = candidates[0];
    if (first !== undefined)
      return err(
        `FAT slice for ${first.architecture} is shorter than its Mach-O header`,
      );
    return err(
      declarations.length === 0
        ? "FAT binary declares no supported Mach-O architecture"
        : `FAT binary has no ${host} slice and no foreign architecture declared exactly once`,
    );
  }
  return ok({
    format: "mach-o-universal",
    architecture: selected.architecture,
    availableArchitectures: declaredFamilies(declarations),
    universalSlice: { offset: selected.offset, size: selected.size },
  });
};

const fatSliceIdentityError = (
  bytes: Buffer,
  header: Extract<
    ReturnType<typeof readFatContainerHeader>,
    { state: "parsed" }
  >,
  sliceHeadersByOffset?: ReadonlyMap<
    number,
    ReturnType<typeof readMachoHeaderPrefixFacts>
  >,
): string | null => {
  for (let index = 0; index < header.slices.length; index += 1) {
    const declaration = header.slices[index];
    if (declaration === undefined || header.rangeIssues[index] !== null)
      continue;
    let facts: ReturnType<typeof readMachoHeaderPrefixFacts> | undefined;
    if (sliceHeadersByOffset?.has(declaration.offset)) {
      facts = sliceHeadersByOffset.get(declaration.offset);
    } else if (
      declaration.size >= 12 &&
      declaration.offset <= bytes.length - 12
    ) {
      facts = readMachoHeaderPrefixFacts(
        bytes.subarray(declaration.offset, declaration.offset + 12),
      );
    }
    const identity = facts?.identity;
    if (identity === null || identity === undefined)
      return `FAT architecture ${declaration.index} thin Mach-O CPU identity is outside the bounded header`;
    const identityError = validateFatSliceIdentity(declaration, identity);
    if (identityError !== null) return identityError;
  }
  return null;
};

const fatHostArchitecture = (
  host: NodeJS.Architecture,
): HeaderArchitecture | undefined => {
  switch (host) {
    case "arm64":
      return "arm64";
    case "x64":
      return "x86_64";
    case "ia32":
      return "x86";
    case "arm":
      return "arm";
    default:
      return undefined;
  }
};

const fatIdentityError = (
  bytes: Buffer,
  header: Extract<
    ReturnType<typeof readFatContainerHeader>,
    { state: "parsed" }
  >,
  sliceHeadersByOffset?: ReadonlyMap<
    number,
    ReturnType<typeof readMachoHeaderPrefixFacts>
  >,
): string | null => {
  const identity = classifyFatContainerIdentity(header, (offset) => {
    if (sliceHeadersByOffset?.has(offset))
      return sliceHeadersByOffset.get(offset)?.magic;
    const slice = header.slices.find(
      (candidate) => candidate.offset === offset,
    );
    if (slice === undefined || offset >= bytes.length) return undefined;
    const available = Math.max(
      0,
      Math.min(slice.size, bytes.length - offset, 12),
    );
    return readMachoHeaderPrefixFacts(
      bytes.subarray(offset, offset + available),
    ).magic;
  });
  if (identity.state === "needs-slice-header")
    return "FAT slice identity is outside the bounded prefix";
  if (identity.state === "not-mach-o") return "unsupported binary format";
  if (identity.state === "malformed") return identity.reason;
  return null;
};

const parseElf = (
  bytes: Buffer,
  fileSize: number,
): Result<ExecutableMetadata, string> => {
  const fixedHeader = readElfFixedHeader(bytes, fileSize);
  if (!fixedHeader.ok) return fixedHeader;
  const { elfClass, byteOrder, architecture } = fixedHeader.value;
  const little = byteOrder === "little";
  if (architecture === null) return err("unsupported ELF architecture");
  if (
    architecture === "mips" ||
    architecture === "riscv" ||
    architecture === "powerpc"
  ) {
    const flagsOffset = elfClass === 32 ? 36 : 48;
    const metadata: ElfFamilyMetadata = {
      elfClass,
      byteOrder: little ? "little" : "big",
      type: little ? bytes.readUInt16LE(16) : bytes.readUInt16BE(16),
      flags: little
        ? bytes.readUInt32LE(flagsOffset)
        : bytes.readUInt32BE(flagsOffset),
    };
    if (architecture === "powerpc")
      return ok({
        format: "elf",
        architecture,
        availableArchitectures: [architecture],
        powerpc: metadata,
      });
    return architecture === "mips"
      ? ok({
          format: "elf",
          architecture,
          availableArchitectures: [architecture],
          mips: metadata,
        })
      : ok({
          format: "elf",
          architecture,
          availableArchitectures: [architecture],
          riscv: metadata,
        });
  }
  if (architecture === "hexagon")
    return ok({
      format: "elf",
      architecture,
      availableArchitectures: [architecture],
    });
  return ok({
    format: "elf",
    architecture,
    availableArchitectures: [architecture],
  });
};

const parseMz = (
  bytes: Buffer,
  fileSize: number,
  signatureAtOffset?: MzWindowsHeaderSignatureEvidence,
): Result<ExecutableMetadata, string> => {
  const evidence = parseMzHeaderEvidence(bytes, fileSize, signatureAtOffset);
  const { windowsHeader } = evidence;
  if (
    windowsHeader.state === "header-needed" ||
    windowsHeader.state === "signature-needed"
  )
    return err(
      "Windows new-header pointer or signature is outside the bounded prefix",
    );
  if (windowsHeader.state === "candidate")
    return err("MZ Windows new-header candidate is unresolved");
  if (windowsHeader.state === "declared") {
    const { offset } = windowsHeader;
    const limitation = mzWindowsHeaderLayoutLimitation(windowsHeader);
    if (limitation !== undefined) return err(limitation);
    if (offset > bytes.length - 24)
      return err("invalid or truncated Windows executable header in MZ image");
    if (["NE", "LE", "LX"].includes(windowsHeader.signature))
      return err(
        `unsupported ${windowsHeader.signature} executable in MZ image`,
      );
    if (windowsHeader.signature !== "PE")
      return err("invalid or truncated Windows executable header in MZ image");
    const codeView = parsePeCodeViewFromBuffer(bytes, offset);
    return parsePeRecord(bytes.subarray(offset), codeView);
  }
  const parsed = evidence.dos;
  return parsed.ok
    ? ok({
        format: "dos-mz",
        architecture: "x86",
        availableArchitectures: ["x86"],
      })
    : parsed;
};

/** Parse a bounded PE signature, COFF record, and optional header without I/O. */
export const parsePeRecord = (
  record: Buffer,
  codeView: PeCodeViewRecord | undefined,
): Result<ExecutableMetadata, string> => {
  if (
    record.length < 24 ||
    record.toString("binary", 0, 4) !== "PE\u0000\u0000"
  )
    return err("invalid or truncated PE header");
  const machineType = record.readUInt16LE(4);
  const machine = decodePeMachine(machineType);
  if (machine === undefined)
    return err(
      `unsupported PE architecture (COFF machine 0x${machineType.toString(16).padStart(4, "0")})`,
    );
  const optionalHeaderSize = record.readUInt16LE(20);
  if (optionalHeaderSize > 4096 || record.length < 24 + optionalHeaderSize)
    return err("invalid or truncated PE optional header");
  const optionalHeader = record.subarray(24, 24 + optionalHeaderSize);
  const facts = readPeOptionalHeader(optionalHeader, machineType);
  if (!facts.ok) return err(facts.error.message);
  if (facts.value.machine === null) return err("unsupported PE architecture");
  const { architecture } = facts.value.machine;
  const characteristics = record.readUInt16LE(22);
  return ok({
    format: "pe",
    peMachine: machineType,
    architecture,
    availableArchitectures: [architecture],
    executableRole:
      (characteristics & 0x0002) === 0
        ? "non-executable"
        : (characteristics & 0x2000) === 0
          ? "application"
          : "shared-library",
    managed: facts.value.managed,
    ...(codeView !== undefined ? { codeView } : {}),
  });
};

/** Parse CodeView record data (RSDS or NB10) from raw data bytes. */
export const parseCodeViewData = (
  buffer: Buffer,
  sizeOfData: number,
): PeCodeViewRecord | undefined => {
  if (sizeOfData < 16 || buffer.length < 16) return undefined;
  const magic = buffer.subarray(0, 4).toString("binary");
  const pathOffset = magic === "RSDS" ? 24 : magic === "NB10" ? 16 : undefined;
  if (
    pathOffset === undefined ||
    sizeOfData <= pathOffset ||
    buffer.length <= pathOffset
  )
    return undefined;
  const end = buffer.indexOf(0, pathOffset);
  if (end <= pathOffset || end >= sizeOfData) return undefined;
  const pdbPath = buffer.toString("utf8", pathOffset, end);
  const pdbFileName = pdbPath.split(/[/\\]/u).pop() ?? pdbPath;
  if (magic === "RSDS" && sizeOfData >= 24 && buffer.length >= 24) {
    const part1 = buffer.readUInt32LE(4).toString(16).padStart(8, "0");
    const part2 = buffer.readUInt16LE(8).toString(16).padStart(4, "0");
    const part3 = buffer.readUInt16LE(10).toString(16).padStart(4, "0");
    const part4 = buffer.subarray(12, 14).toString("hex");
    const part5 = buffer.subarray(14, 20).toString("hex");
    const guid = `${part1}-${part2}-${part3}-${part4}-${part5}`;
    const age = buffer.readUInt32LE(20);
    return { pdbPath, pdbFileName, guid, age };
  }
  if (magic === "NB10") {
    const age = buffer.readUInt32LE(12);
    return { pdbPath, pdbFileName, guid: null, age };
  }
  return undefined;
};

/** Locate the debug directory RVA and size from a PE optional header. */
export const peDebugDirectoryEntry = (
  optionalHeader: Buffer,
):
  | {
      readonly debugRva: number;
      readonly debugSize: number;
      readonly sizeOfHeaders: number;
    }
  | undefined => {
  if (optionalHeader.length < 2) return undefined;
  const magic = optionalHeader.readUInt16LE(0);
  if (magic !== 0x10b && magic !== 0x20b) return undefined;
  const directoryOffset = magic === 0x20b ? 112 : 96;
  const directoryCountOffset = directoryOffset - 4;
  if (optionalHeader.length < directoryCountOffset + 4) return undefined;
  const directoryCount = optionalHeader.readUInt32LE(directoryCountOffset);
  if (directoryCount <= 6) return undefined;
  const debugEntryOffset = directoryOffset + 6 * 8;
  if (optionalHeader.length < debugEntryOffset + 8) return undefined;
  const debugRva = optionalHeader.readUInt32LE(debugEntryOffset);
  const debugSize = optionalHeader.readUInt32LE(debugEntryOffset + 4);
  if (debugRva === 0 || debugSize < 28) return undefined;
  return {
    debugRva,
    debugSize,
    sizeOfHeaders: optionalHeader.readUInt32LE(60),
  };
};

/** Translate an RVA to an absolute file offset using the PE section table. */
export const peRvaToFileOffset = (
  rva: number,
  sectionTable: Buffer,
  numberOfSections: number,
  sizeOfHeaders: number,
  size = 1,
): number | undefined => {
  if (rva < sizeOfHeaders && size <= sizeOfHeaders - rva) return rva;
  for (let i = 0; i < numberOfSections; i++) {
    const offset = i * 40;
    if (sectionTable.length < offset + 40) break;
    const virtualAddress = sectionTable.readUInt32LE(offset + 12);
    const sizeOfRawData = sectionTable.readUInt32LE(offset + 16);
    const pointerToRawData = sectionTable.readUInt32LE(offset + 20);
    if (
      pointerToRawData > 0 &&
      rva >= virtualAddress &&
      rva - virtualAddress < sizeOfRawData &&
      size <= sizeOfRawData - (rva - virtualAddress)
    ) {
      return pointerToRawData + (rva - virtualAddress);
    }
  }
  return undefined;
};

/** Parse CodeView metadata from a bounded in-memory PE image buffer. */
export const parsePeCodeViewFromBuffer = (
  fileBytes: Buffer,
  peOffset: number,
): PeCodeViewRecord | undefined => {
  if (fileBytes.length < peOffset + 24) return undefined;
  const numberOfSections = fileBytes.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = fileBytes.readUInt16LE(peOffset + 20);
  if (
    optionalHeaderSize > 4096 ||
    fileBytes.length < peOffset + 24 + optionalHeaderSize
  )
    return undefined;
  const optionalHeader = fileBytes.subarray(
    peOffset + 24,
    peOffset + 24 + optionalHeaderSize,
  );
  const debugDir = peDebugDirectoryEntry(optionalHeader);
  if (debugDir === undefined) return undefined;
  const sectionTableOffset = peOffset + 24 + optionalHeaderSize;
  const sectionTableSize = numberOfSections * 40;
  if (fileBytes.length < sectionTableOffset + sectionTableSize)
    return undefined;
  const sectionTable = fileBytes.subarray(
    sectionTableOffset,
    sectionTableOffset + sectionTableSize,
  );
  const debugFileOffset = peRvaToFileOffset(
    debugDir.debugRva,
    sectionTable,
    numberOfSections,
    debugDir.sizeOfHeaders,
    Math.min(debugDir.debugSize, 4096),
  );
  if (debugFileOffset === undefined || fileBytes.length < debugFileOffset + 28)
    return undefined;
  const maxDebugBytes = Math.min(
    debugDir.debugSize,
    fileBytes.length - debugFileOffset,
  );
  const numEntries = Math.floor(maxDebugBytes / 28);
  for (let j = 0; j < numEntries; j++) {
    const entryOffset = debugFileOffset + j * 28;
    const type = fileBytes.readUInt32LE(entryOffset + 12);
    if (type !== 2) continue; // IMAGE_DEBUG_TYPE_CODEVIEW
    const sizeOfData = fileBytes.readUInt32LE(entryOffset + 16);
    let pointerToRawData = fileBytes.readUInt32LE(entryOffset + 24);
    if (pointerToRawData === 0) {
      const addressOfRawData = fileBytes.readUInt32LE(entryOffset + 20);
      const mapped = peRvaToFileOffset(
        addressOfRawData,
        sectionTable,
        numberOfSections,
        debugDir.sizeOfHeaders,
        Math.min(sizeOfData, 4096),
      );
      if (mapped === undefined) continue;
      pointerToRawData = mapped;
    }
    if (
      sizeOfData < 16 ||
      fileBytes.length < pointerToRawData + Math.min(sizeOfData, 24)
    )
      continue;
    const codeViewData = fileBytes.subarray(
      pointerToRawData,
      Math.min(fileBytes.length, pointerToRawData + sizeOfData),
    );
    const parsed = parseCodeViewData(codeViewData, sizeOfData);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
};

const machArchitecture = (cpu: number): HeaderArchitecture | undefined => {
  switch (cpu) {
    case 7:
      return "x86";
    case 0x01000007:
      return "x86_64";
    case 12:
      return "arm";
    case 0x0100000c:
      return "arm64";
  }
  return undefined;
};
