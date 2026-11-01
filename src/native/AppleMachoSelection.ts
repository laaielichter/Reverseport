import { MachoLoadCommandCursor } from "../domain/apple/machoLoadCommands.js";
import { createHash } from "node:crypto";

import type { FixupCommands } from "./AppleMachoFixups.js";
import { decodeMachoName } from "./AppleMachoNames.js";
import {
  MACHO_ARCHITECTURE_POLICIES,
  machoSubtypeRank,
} from "./MachoArchitectureSelection.js";
import { machoCpuSubtypeBase } from "../domain/apple/machoCpuIdentity.js";
import {
  readFatSliceDeclarations,
  validateFatSlice,
  validateFatSliceIdentity,
  type FatSliceDeclaration,
} from "../domain/apple/machoContainer.js";

/** One mapped Mach-O segment with file-backed VA range. */
export interface Segment {
  address: bigint;
  size: bigint;
  offset: number;
  executable: boolean;
}

/** Named Mach-O section within a loaded segment. */
export interface Section {
  name: string;
  address: bigint;
  size: number;
}

/** Selected thin slice bounds inside a Mach-O or FAT container. */
export interface MachoSlice {
  slice: number;
  sliceEnd: number;
  /** FAT table identity, absent for a thin image. */
  fatDeclaration?: FatSliceDeclaration & { readonly tableEnd: number };
}

/** Parsed little-endian 64-bit Mach-O layout for the selected architecture slice. */
export interface MachoLayout {
  segments: Segment[];
  sections: Section[];
  /** CPU identity and exact byte range selected from this source artifact. */
  selectedImage: {
    readonly container: "thin" | "fat";
    readonly offset: number;
    readonly byteLength: number;
    readonly cpuType: number;
    readonly cpuSubtype: number;
    readonly containerTableSha256: string | null;
  };
  /** Fixup load commands and dependent dylibs of the selected slice. */
  fixups: FixupCommands;
  /** VM address of the segment that maps file offset 0 (the preferred load address). */
  baseAddress: bigint;
  /** Map a virtual address range onto a file offset within the selected slice. */
  offset(address: bigint, size?: number): number;
}

const hex = (value: bigint) => `0x${value.toString(16)}`;

/** Classify a FAT magic word; thin Mach-O returns null. */
export const fatHeaderFormat = (
  magic: number,
): { readonly littleEndian: boolean; readonly fat64: boolean } | null => {
  switch (magic) {
    case 0xcafebabe:
      return { littleEndian: false, fat64: false };
    case 0xcafebabf:
      return { littleEndian: false, fat64: true };
    case 0xbebafeca:
      return { littleEndian: true, fat64: false };
    case 0xbfbafeca:
      return { littleEndian: true, fat64: true };
    default:
      return null;
  }
};

/** Select the thin Mach-O slice for `architecture` inside a FAT or thin container. */
export const selectMachoSlice = (
  bytes: Buffer,
  architecture: string,
): MachoSlice => {
  const magic = bytes.readUInt32BE(0);
  const header = fatHeaderFormat(magic);
  if (header === null) return { slice: 0, sliceEnd: bytes.length };
  const { littleEndian, fat64 } = header;
  const stride = fat64 ? 32 : 20;
  const readUInt32 = littleEndian
    ? (offset: number) => bytes.readUInt32LE(offset)
    : (offset: number) => bytes.readUInt32BE(offset);
  const byteOrder = littleEndian ? "little-endian" : "big-endian";
  const malformed = (reason: string) =>
    new RangeError(`${reason} (FAT header byte order: ${byteOrder})`);
  const invalid = (reason: string) =>
    new TypeError(`${reason} (FAT header byte order: ${byteOrder})`);
  if (bytes.length < 8) throw malformed("Malformed FAT architecture table");
  const count = readUInt32(4);
  const headerEnd = 8 + count * stride;
  if (count > 128 || headerEnd > bytes.length)
    throw malformed("Malformed FAT architecture table");
  const policy = MACHO_ARCHITECTURE_POLICIES[architecture];
  if (policy === undefined)
    throw invalid("Requested FAT architecture is absent");
  const declarations = readFatSliceDeclarations(bytes.subarray(8, headerEnd), {
    count,
    wide: fat64,
    littleEndian,
  });
  if (declarations.status !== "parsed") throw malformed(declarations.reason);
  let best: FatSliceDeclaration | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  let ambiguous = false;
  for (const declaration of declarations.slices) {
    const issue = validateFatSlice(declaration, bytes.length, headerEnd);
    if (issue !== null) throw malformed(issue);
    if (declaration.cpuType !== policy.cpuType) continue;
    const rank = machoSubtypeRank(policy, declaration.cpuSubtype);
    if (best !== undefined && rank >= bestRank) {
      // Equal ranks keep FAT table order unless the slices share a subtype.
      if (
        rank === bestRank &&
        machoCpuSubtypeBase(declaration.cpuSubtype) ===
          machoCpuSubtypeBase(best.cpuSubtype)
      )
        ambiguous = true;
      continue;
    }
    best = declaration;
    bestRank = rank;
    ambiguous = false;
  }
  if (best === undefined) throw invalid("Requested FAT architecture is absent");
  if (ambiguous) throw invalid("Ambiguous FAT architecture slice");
  const selected: MachoSlice = {
    slice: best.offset,
    sliceEnd: best.offset + best.size,
    fatDeclaration: { ...best, tableEnd: headerEnd },
  };
  return selected;
};

const MH_MAGIC = 0xfeedface;
const MH_CIGAM = 0xcefaedfe;
const MH_CIGAM_64 = 0xcffaedfe;

/** A recognized Mach-O class outside this metadata reader's supported formats. */
export class UnsupportedMachoMetadataFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedMachoMetadataFormatError";
  }
}

/** Parse segments/sections for a little-endian 64-bit Mach-O architecture slice. */
export const parseMachoLayout = (
  bytes: Buffer,
  architecture: string,
): MachoLayout => {
  if (bytes.length < 4) throw new RangeError("Truncated Mach-O header");
  const selection = selectMachoSlice(bytes, architecture);
  const { slice, sliceEnd } = selection;
  if (slice + 4 > sliceEnd) throw new RangeError("Truncated Mach-O header");
  const selectedMagic = bytes.readUInt32LE(slice);
  const is32Bit = selectedMagic === MH_MAGIC || selectedMagic === MH_CIGAM;
  const isBigEndian =
    selectedMagic === MH_CIGAM || selectedMagic === MH_CIGAM_64;
  const headerSize = is32Bit ? 28 : 32;
  const recognizedMagic =
    is32Bit || selectedMagic === 0xfeedfacf || selectedMagic === MH_CIGAM_64;
  if (!recognizedMagic && slice + 32 > sliceEnd)
    throw new RangeError("Truncated Mach-O header");
  if (!recognizedMagic)
    throw new TypeError(
      "Only little-endian 64-bit Mach-O metadata is supported",
    );
  if (slice + headerSize > sliceEnd)
    throw new RangeError("Truncated Mach-O header");
  const readHeaderUInt32 = isBigEndian
    ? (offset: number) => bytes.readUInt32BE(offset)
    : (offset: number) => bytes.readUInt32LE(offset);
  const cpuType = readHeaderUInt32(slice + 4);
  const cpuSubtype = readHeaderUInt32(slice + 8);
  const fat = selection.fatDeclaration;
  if (fat !== undefined) {
    const issue = validateFatSliceIdentity(fat, {
      cpuType,
      cpuSubtype,
    });
    if (issue !== null) throw new TypeError(issue);
  }
  if (selectedMagic === MH_CIGAM_64) {
    if (cpuType !== 0x01000012)
      throw new TypeError("Unsupported big-endian Mach-O CPU type");
    throw new UnsupportedMachoMetadataFormatError(
      "Unsupported big-endian 64-bit PowerPC Mach-O metadata",
    );
  }
  // A thin image has no FAT declaration to bind the requested CPU family.
  // Admit its parsed header before consumers attach the caller's architecture.
  if (MACHO_ARCHITECTURE_POLICIES[architecture]?.cpuType !== cpuType)
    throw new TypeError(
      `Mach-O CPU type does not match requested architecture ${architecture}`,
    );
  if (is32Bit)
    throw new UnsupportedMachoMetadataFormatError(
      `Unsupported 32-bit Mach-O metadata for requested CPU type ${architecture}`,
    );
  const commands = bytes.readUInt32LE(slice + 16);
  const commandEnd = slice + 32 + bytes.readUInt32LE(slice + 20);
  if (commands > 4096 || commandEnd > sliceEnd)
    throw new RangeError("Malformed Mach-O command bounds");
  const state: LayoutState = {
    slice,
    sliceEnd,
    segments: [],
    sections: [],
    dylibs: [],
    binds: [],
    rebases: [],
    chained: null,
    baseAddress: undefined,
  };
  const framing = new MachoLoadCommandCursor({
    wide: true,
    littleEndian: true,
    commandCount: commands,
    commandBytes: commandEnd - slice - 32,
  });
  while (framing.nextOffset !== null) {
    const cursor = slice + 32 + framing.nextOffset;
    const frame = framing.read(bytes.subarray(cursor, cursor + 8));
    if (!frame.ok) throw new RangeError(frame.error);
    const command = {
      cursor,
      kind: frame.value.command,
      size: frame.value.size,
    };
    if (command.kind === 0x19) collectSegment(bytes, command, state);
    else collectFixupCommand(bytes, command, state);
  }
  const complete = framing.finish();
  if (!complete.ok) throw new RangeError(complete.error);
  const { segments, sections, chained, binds, rebases, dylibs } = state;
  const offset = (address: bigint, size = 1): number => {
    const matches = segments.filter(
      (segment) =>
        address >= segment.address &&
        address + BigInt(size) <= segment.address + segment.size,
    );
    if (matches.length !== 1)
      throw new RangeError(
        `Unmapped or ambiguous metadata pointer ${hex(address)}`,
      );
    const segment = matches[0];
    if (segment === undefined) throw new RangeError("Missing metadata segment");
    return segment.offset + Number(address - segment.address);
  };
  return {
    segments,
    sections,
    selectedImage: {
      container: fat === undefined ? "thin" : "fat",
      offset: slice,
      byteLength: sliceEnd - slice,
      cpuType,
      cpuSubtype,
      containerTableSha256:
        fat === undefined
          ? null
          : createHash("sha256")
              .update(bytes.subarray(0, fat.tableEnd))
              .digest("hex"),
    },
    offset,
    fixups: { chained, binds, rebases, dylibs },
    baseAddress: state.baseAddress ?? 0n,
  };
};

/** Load commands and fixup ranges collected while walking one slice. */
interface LayoutState {
  readonly slice: number;
  readonly sliceEnd: number;
  readonly segments: Segment[];
  readonly sections: Section[];
  readonly dylibs: FixupCommands["dylibs"][number][];
  readonly binds: FixupCommands["binds"][number][];
  readonly rebases: FixupCommands["rebases"][number][];
  chained: FixupCommands["chained"];
  baseAddress: bigint | undefined;
}

/** One load command header inside the selected slice. */
interface LoadCommand {
  readonly cursor: number;
  readonly kind: number;
  readonly size: number;
}

/** Record an `LC_SEGMENT_64` and its section table. */
const collectSegment = (
  bytes: Buffer,
  { cursor, size }: LoadCommand,
  state: LayoutState,
): void => {
  if (size < 72) throw new RangeError("Truncated segment command");
  const address = bytes.readBigUInt64LE(cursor + 24),
    fileSize = bytes.readBigUInt64LE(cursor + 48),
    fileOffset = bytes.readBigUInt64LE(cursor + 40);
  if (fileOffset + fileSize > BigInt(state.sliceEnd - state.slice))
    throw new RangeError("Segment file range exceeds target bytes");
  state.segments.push({
    address,
    size: fileSize,
    offset: state.slice + Number(fileOffset),
    executable: (bytes.readUInt32LE(cursor + 60) & 4) !== 0,
  });
  if (fileOffset === 0n && fileSize > 0n) state.baseAddress ??= address;
  const count = bytes.readUInt32LE(cursor + 64);
  if (72 + count * 80 > size) throw new RangeError("Truncated section table");
  for (let section = 0; section < count; section++) {
    const position = cursor + 72 + section * 80;
    const sectionSize = bytes.readBigUInt64LE(position + 40);
    if (sectionSize > BigInt(Number.MAX_SAFE_INTEGER))
      throw new RangeError("Section size exceeds exact numeric range");
    state.sections.push({
      name: bytes
        .subarray(position, position + 16)
        // ASCII decoding masks high bits and can fabricate known metadata names.
        .toString("latin1")
        .replace(/\0.*$/u, ""),
      address: bytes.readBigUInt64LE(position + 32),
      size: Number(sectionSize),
    });
  }
};

const LC_DYLD_INFO = 0x22;
const LC_DYLD_INFO_ONLY = 0x80000022;
const LC_DYLD_CHAINED_FIXUPS = 0x80000034;
const DYLIB_COMMANDS: readonly number[] = [
  0xc, 0x80000018, 0x8000001f, 0x20, 0x80000023,
];

/** Record fixup data ranges and dylib install names from one load command. */
const collectFixupCommand = (
  bytes: Buffer,
  { cursor, kind, size }: LoadCommand,
  state: LayoutState,
): void => {
  const range = (at: number): { offset: number; size: number } => {
    const offset = state.slice + bytes.readUInt32LE(at);
    const length = bytes.readUInt32LE(at + 4);
    if (offset + length > state.sliceEnd)
      throw new RangeError("Fixup data exceeds the Mach-O slice");
    return { offset, size: length };
  };
  if (kind === LC_DYLD_CHAINED_FIXUPS) {
    if (size < 16) throw new RangeError("Truncated chained-fixups command");
    state.chained = range(cursor + 8);
  } else if (kind === LC_DYLD_INFO || kind === LC_DYLD_INFO_ONLY) {
    if (size < 48) throw new RangeError("Truncated dyld-info command");
    const rebase = range(cursor + 8);
    if (rebase.size > 0) state.rebases.push(rebase);
    for (const [at, stream] of [
      [cursor + 16, "bind"],
      [cursor + 24, "weak"],
      [cursor + 32, "lazy"],
    ] as const) {
      const bound = range(at);
      if (bound.size > 0) state.binds.push({ ...bound, stream });
    }
  } else if (DYLIB_COMMANDS.includes(kind)) {
    if (size < 24) throw new RangeError("Truncated dylib command");
    const nameOffset = bytes.readUInt32LE(cursor + 8);
    if (nameOffset < 24 || nameOffset >= size)
      throw new RangeError("Dylib install name is outside its load command");
    const end = bytes.indexOf(0, cursor + nameOffset);
    if (end < 0 || end >= cursor + size)
      throw new RangeError("Unterminated dylib install name");
    state.dylibs.push(
      decodeMachoName(bytes.subarray(cursor + nameOffset, end)),
    );
  }
};
