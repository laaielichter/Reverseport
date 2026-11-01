import {
  declaredFileRange,
  BinaryFormatFailure,
  BinaryReader,
  type BinaryContainer,
  type FileMapping,
  type ImageSection,
  type LoadRegion,
  type ZeroFillMapping,
} from "./BinaryContainer.js";
import { MachoLoadCommandCursor } from "../../domain/apple/machoLoadCommands.js";

/** Read thin Mach-O images, retaining the slice's exact file-backed mappings. */
export const readMachoImage = (bytes: Buffer): BinaryContainer => {
  const magic = bytes.readUInt32BE(0);
  const little = magic === 0xcefaedfe || magic === 0xcffaedfe;
  const bits = magic === 0xfeedfacf || magic === 0xcffaedfe ? 64 : 32;
  const reader = new BinaryReader(bytes, little);
  const headerSize = bits === 64 ? 32 : 28;
  reader.range(0, headerSize, "Mach-O header");
  const count = reader.u32(16);
  const commandBytes = reader.u32(20);
  const commandStart = reader.table(
    BigInt(headerSize),
    commandBytes,
    1,
    "Mach-O load commands",
  );
  const mappings: FileMapping[] = [];
  const loadRegions: LoadRegion[] = [];
  const executableMappings: FileMapping[] = [];
  const zeroFills: ZeroFillMapping[] = [];
  const sections: ImageSection[] = [];
  let chainedFixups = false;
  const commands = new MachoLoadCommandCursor({
    wide: bits === 64,
    littleEndian: little,
    commandCount: count,
    commandBytes,
  });
  while (commands.nextOffset !== null) {
    const offset = commandStart + commands.nextOffset;
    const frame = commands.read(bytes.subarray(offset, offset + 8));
    if (!frame.ok) throw new BinaryFormatFailure("malformed", frame.error);
    const { command, size } = frame.value;
    if (command === 0x80000034) chainedFixups = true;
    if (command === 1 || command === 0x19) {
      const wide = command === 0x19;
      if (wide !== (bits === 64))
        throw new BinaryFormatFailure(
          "malformed",
          "Mach-O segment command does not match the header width",
        );
      const segmentHeader = wide ? 72 : 56;
      const sectionWidth = wide ? 80 : 68;
      if (size < segmentHeader)
        throw new BinaryFormatFailure(
          "malformed",
          "Mach-O segment header is truncated",
        );
      const address = reader.word(offset + 24, bits);
      const memorySize = reader.word(offset + (wide ? 32 : 28), bits);
      const fileOffset = reader.word(offset + (wide ? 40 : 32), bits);
      const fileSize = reader.word(offset + (wide ? 48 : 36), bits);
      const maxProtection = reader.u32(offset + (wide ? 56 : 40));
      const protection = reader.u32(offset + (wide ? 60 : 44));
      const sectionCount = reader.u32(offset + (wide ? 64 : 48));
      const unmapped = memorySize === 0n && protection === 0;
      if (
        (!unmapped && fileSize > memorySize) ||
        address + memorySize > 1n << BigInt(bits)
      )
        throw new BinaryFormatFailure(
          "malformed",
          "Mach-O segment addresses or sizes are invalid",
        );
      if (sectionCount > Math.floor((size - segmentHeader) / sectionWidth))
        throw new BinaryFormatFailure(
          "malformed",
          "Mach-O section table exceeds its segment command",
        );
      const fileRange =
        fileSize === 0n
          ? undefined
          : reader.fileRange(fileOffset, fileSize, "Mach-O segment");
      const mapping =
        unmapped || fileRange === undefined
          ? undefined
          : { ...fileRange, address };
      const name = fixedName(
        reader.range(offset + 8, 16, "Mach-O segment name"),
      );
      if (mapping !== undefined && name !== "__PAGEZERO") {
        mappings.push(mapping);
        loadRegions.push({
          mapping,
          memory_size: memorySize,
          read: (protection & 1) !== 0,
          write: (protection & 2) !== 0,
          execute: (protection & 4) !== 0,
          protection_masks: {
            current: protection,
            maximum: maxProtection,
          },
        });
        if ((protection & 4) !== 0) executableMappings.push(mapping);
      }
      if (memorySize > fileSize && name !== "__PAGEZERO")
        zeroFills.push({
          address: address + fileSize,
          size: memorySize - fileSize,
        });
      for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
        const section = offset + segmentHeader + sectionIndex * sectionWidth;
        const sectionName = fixedName(
          reader.range(section, 16, "Mach-O section name"),
        );
        sections.push(
          machoImageSection({
            reader,
            bits,
            wide,
            header: section,
            name: `${fixedName(reader.range(section + 16, 16, "Mach-O section segment"))},${sectionName}`,
            protection,
            sectionName,
            segmentMapping: mapping ?? null,
            segmentUnmapped: unmapped,
            unmapped: unmapped || mapping === undefined,
            segmentAddress: address,
            segmentMemorySize: memorySize,
            segmentFileOffset: fileOffset,
            segmentFileSize: fileSize,
          }),
        );
      }
    }
  }
  const complete = commands.finish();
  if (!complete.ok) throw new BinaryFormatFailure("malformed", complete.error);
  const cpu = reader.u32(4);
  const names = new Map([
    [7, "386"],
    [0x01000007, "amd64"],
    [12, "arm"],
    [0x0100000c, "arm64"],
    [0x0200000c, "arm64_32"],
    [18, "ppc"],
    [0x01000012, "ppc64"],
  ]);
  return {
    format: "macho",
    macho_chained_fixups: chainedFixups,
    architecture: names.get(cpu) ?? `macho-cpu-${cpu}`,
    bits,
    byte_order: little ? "little" : "big",
    mappings,
    load_regions: loadRegions,
    executable_mappings: executableMappings,
    zero_fills: zeroFills,
    sections,
  };
};

const machoImageSection = ({
  reader,
  bits,
  wide,
  header,
  name,
  protection,
  sectionName,
  segmentMapping,
  segmentUnmapped,
  unmapped,
  segmentAddress,
  segmentMemorySize,
  segmentFileOffset,
  segmentFileSize,
}: {
  readonly reader: BinaryReader;
  readonly bits: 32 | 64;
  readonly wide: boolean;
  readonly header: number;
  readonly name: string;
  readonly protection: number;
  readonly sectionName: string;
  readonly segmentMapping: FileMapping | null;
  readonly segmentUnmapped: boolean;
  readonly unmapped: boolean;
  readonly segmentAddress: bigint;
  readonly segmentMemorySize: bigint;
  readonly segmentFileOffset: bigint;
  readonly segmentFileSize: bigint;
}): ImageSection => {
  const flags = reader.u32(header + (wide ? 64 : 56));
  const zeroFill = [1, 0xc, 0x12].includes(flags & 0xff);
  const sectionAddress = reader.word(header + 32, bits);
  const sectionSize = reader.word(header + (wide ? 40 : 36), bits);
  const sectionOffset = BigInt(reader.u32(header + (wide ? 48 : 40)));
  const addressDelta = sectionAddress - segmentAddress;
  const fileDelta = sectionOffset - segmentFileOffset;
  const inSegmentMemory =
    addressDelta >= 0n &&
    addressDelta <= segmentMemorySize &&
    sectionSize <= segmentMemorySize - addressDelta;
  const inSegmentFile =
    fileDelta >= 0n &&
    fileDelta <= segmentFileSize &&
    sectionSize <= segmentFileSize - fileDelta;
  const range = unmapped
    ? { offset: 0, size: 0, file_backed: false }
    : declaredFileRange(reader.bytes.length, sectionOffset, sectionSize);
  const fileBacked =
    range.file_backed && !zeroFill && inSegmentMemory && inSegmentFile;
  const readOnly =
    fileBacked &&
    (protection & 1) !== 0 &&
    (protection & 2) === 0 &&
    (flags & 0x80000400) === 0;
  return {
    format: "macho",
    name,
    section_name: sectionName,
    type: flags & 0xff,
    address: sectionAddress,
    declared_range: { offset: sectionOffset, size: sectionSize },
    segment_mapping: segmentMapping,
    segment_unmapped: segmentUnmapped,
    ...range,
    file_backed: fileBacked,
    read_only: readOnly,
    compressed: false,
  };
};

const fixedName = (bytes: Buffer): string => {
  const nul = bytes.indexOf(0);
  return bytes.subarray(0, nul < 0 ? bytes.length : nul).toString("latin1");
};
