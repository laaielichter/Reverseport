import { readElfTableDeclarations } from "../../domain/elfDeclaredRanges.js";
import { readPeOptionalHeaderStructure } from "../../domain/peOptionalHeader.js";
import {
  BinaryFormatFailure,
  BinaryReader,
  BinaryResourceFailure,
  declaredFileRange,
  type ElfDynamicSegment,
} from "./BinaryContainer.js";
import { decodeElfSectionNameTable } from "./ElfSectionNameTable.js";

/** A borrowed positional source. Drivers own admission, cancellation and file identity. */
export interface NativeReadRequest {
  readonly offset: number;
  readonly size: number;
}
export interface NativeSection {
  readonly index: number;
  readonly name: string | null;
  readonly name_state: "known" | "unavailable" | "truncated";
  readonly header_offset: number;
  readonly offset: bigint;
  readonly size: bigint;
  readonly address: bigint;
  readonly type: number;
  readonly flags: bigint;
  readonly link: number;
  readonly info: number;
  readonly entry_size: bigint;
  readonly file_backed: boolean;
}
/** Raw relevant program declarations; consumers own load/dynamic admission. */
export type ElfProgramDeclaration =
  | {
      readonly type: 1;
      readonly flags: number;
      readonly file_offset: bigint;
      readonly file_size: bigint;
      readonly virtual_address: bigint;
      readonly memory_size: bigint;
    }
  | ({ readonly type: 2 } & ElfDynamicSegment);

export interface NativeSectionDirectory {
  readonly format: "elf" | "pe";
  readonly bits: 32 | 64;
  readonly little: boolean;
  readonly machine: number;
  readonly elf_os_abi: number | null;
  readonly flags: number;
  readonly section_names_limitation?: string;
  readonly programs: readonly ElfProgramDeclaration[];
  readonly sections: readonly NativeSection[];
}
const STRUCTURE_BYTES = 16 * 1024 * 1024;
const reject = (message: string): never => {
  throw new BinaryFormatFailure("malformed", message);
};
const exact = (value: bigint): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    reject("Native offset exceeds exact host precision");
  return Number(value);
};
const request = (
  fileSize: number,
  offset: bigint,
  size: bigint,
): NativeReadRequest => {
  if (
    offset < 0n ||
    size < 0n ||
    offset > BigInt(fileSize) ||
    size > BigInt(fileSize) - offset
  )
    reject("Native directory range is truncated or outside the file");
  if (size > BigInt(STRUCTURE_BYTES))
    throw new BinaryResourceFailure(
      "structure",
      STRUCTURE_BYTES,
      "Native directory exceeds the 16777216-byte (16 MiB) structural decoding budget. This release has no runtime override.",
    );
  return { offset: exact(offset), size: exact(size) };
};

/** One ELF interpretation for in-memory images and bounded descriptor-backed inspections. */
export function* readElfSectionDirectory(
  fileSize: number,
): Generator<NativeReadRequest, NativeSectionDirectory, Buffer> {
  const prefix = yield request(fileSize, 0n, 16n);
  const headerSize = prefix[4] === 1 ? 52 : 64;
  const bytes = yield request(fileSize, 0n, BigInt(headerSize));
  const parsed = yield* readElfTableDeclarations(bytes, fileSize);
  if (!parsed.ok) return reject(parsed.error);
  const { header, programs, sections: sectionTable } = parsed.value;
  const { elfClass: bits, byteOrder, machine } = header;
  const little = byteOrder === "little";
  const wide = bits === 64;
  const r = new BinaryReader(bytes, little);
  const {
    offset: program_offset,
    width: program_width,
    count: program_count,
  } = programs;
  const {
    offset: sectionOffset,
    width: sectionWidth,
    count,
    namesIndex,
  } = sectionTable;
  const programDeclarations: ElfProgramDeclaration[] = [];
  if (program_count !== 0) {
    const programs = new BinaryReader(
      yield request(
        fileSize,
        program_offset,
        BigInt(program_count) * BigInt(program_width),
      ),
      little,
    );
    // At most one record per table entry, bounded before allocation by the
    // existing 16 MiB table allowance and minimum 32/56-byte ELF record width.
    for (let index = 0; index < program_count; index++) {
      const at = index * program_width;
      const type = programs.u32(at);
      if (type === 1)
        programDeclarations.push({
          type,
          flags: programs.u32(at + (wide ? 4 : 24)),
          file_offset: programs.word(at + (wide ? 8 : 4), bits),
          virtual_address: programs.word(at + (wide ? 16 : 8), bits),
          file_size: programs.word(at + (wide ? 32 : 16), bits),
          memory_size: programs.word(at + (wide ? 40 : 20), bits),
        });
      else if (type === 2)
        programDeclarations.push({
          type,
          offset: programs.word(at + (wide ? 8 : 4), bits),
          size: programs.word(at + (wide ? 32 : 16), bits),
        });
    }
  }
  const sections: NativeSection[] = [];
  let section_names_limitation: string | undefined;
  if (count !== 0) {
    const table = new BinaryReader(
      yield request(
        fileSize,
        sectionOffset,
        BigInt(count) * BigInt(sectionWidth),
      ),
      little,
    );
    let names: Buffer | null = null;
    if (namesIndex !== 0) {
      const h = namesIndex * sectionWidth;
      if (table.u32(h + 4) !== 3)
        reject("ELF section name table is not a string table");
      const rawNames = yield request(
        fileSize,
        table.word(h + (wide ? 24 : 16), bits),
        table.word(h + (wide ? 32 : 20), bits),
      );
      const decoded = decodeElfSectionNameTable(
        rawNames,
        table.word(h + 8, bits),
        bits,
        little,
        Math.max(0, STRUCTURE_BYTES - rawNames.length),
      );
      if (decoded.state === "malformed") return reject(decoded.message);
      if (decoded.state === "limit")
        throw new BinaryResourceFailure(
          "structure",
          STRUCTURE_BYTES,
          `Decoded ELF section names require ${String(decoded.requiredBytes)} bytes, above the ${String(decoded.maximumBytes)}-byte remaining structural budget`,
        );
      if (decoded.state === "unsupported")
        section_names_limitation = `ELF section names are unavailable because compression type ${String(decoded.compressionType)} is unsupported`;
      else names = decoded.bytes;
    } else if (count > 1) {
      section_names_limitation =
        "ELF section names are unavailable because no section-name string table is declared";
    }
    const decodedNames = new Map<
      number,
      { name: string | null; state: NativeSection["name_state"] }
    >();
    let nameBytes = 0;
    for (let index = 0; index < count; index++) {
      const h = index * sectionWidth;
      const nameOffset = table.u32(h);
      let name: string | null = null;
      let name_state: NativeSection["name_state"] = "unavailable";
      if (names !== null) {
        if (nameOffset >= names.length) {
          section_names_limitation ??=
            "ELF section names are incomplete because a name offset is outside its string table";
        } else {
          let decoded = decodedNames.get(nameOffset);
          if (decoded === undefined) {
            const window = names.subarray(
              nameOffset,
              Math.min(nameOffset + 65536, names.length),
            );
            const end = window.indexOf(0);
            nameBytes += end < 0 ? window.length : end + 1;
            if (nameBytes > STRUCTURE_BYTES)
              throw new BinaryResourceFailure(
                "structure",
                STRUCTURE_BYTES,
                "Decoded ELF section names exceed the 16 MiB structural budget",
              );
            decoded = {
              name: end < 0 ? null : window.toString("latin1", 0, end),
              state: end < 0 ? "truncated" : "known",
            };
            if (end < 0)
              section_names_limitation ??=
                "ELF section names are unavailable because a name is not NUL-terminated";
            decodedNames.set(nameOffset, decoded);
          }
          name_state = decoded.state;
          name = decoded.name;
        }
      }
      const type = table.u32(h + 4);
      const offset = table.word(h + (wide ? 24 : 16), bits);
      const size = table.word(h + (wide ? 32 : 20), bits);
      sections.push({
        index,
        name,
        name_state,
        header_offset: exact(sectionOffset) + h,
        offset,
        size,
        address: table.word(h + (wide ? 16 : 12), bits),
        type,
        flags: table.word(h + 8, bits),
        link: table.u32(h + (wide ? 40 : 24)),
        info: table.u32(h + (wide ? 44 : 28)),
        entry_size: table.word(h + (wide ? 56 : 36), bits),
        file_backed:
          type !== 8 && declaredFileRange(fileSize, offset, size).file_backed,
      });
    }
  }
  return {
    format: "elf",
    elf_os_abi: header.osAbi,
    bits,
    little,
    machine,
    flags: r.u32(wide ? 48 : 36),
    ...(section_names_limitation === undefined
      ? {}
      : { section_names_limitation }),
    programs: programDeclarations,
    sections,
  };
}

/** Shared COFF section fields; content extent excludes file-alignment padding. */
export const readPeSectionHeader = (bytes: Buffer) => {
  const r = new BinaryReader(bytes, true);
  const name = r.range(0, 8, "PE section name");
  const nul = name.indexOf(0);
  const virtual_size = r.u32(8);
  const raw_size = r.u32(16);
  return {
    name: name.toString("latin1", 0, nul < 0 ? name.length : nul),
    virtual_size,
    virtual_address: r.u32(12),
    raw_size,
    offset: r.u32(20),
    characteristics: r.u32(36),
    size: virtual_size === 0 ? raw_size : Math.min(virtual_size, raw_size),
  };
};

export function* readPeSectionDirectory(
  fileSize: number,
): Generator<NativeReadRequest, NativeSectionDirectory, Buffer> {
  const dos = new BinaryReader(yield request(fileSize, 0n, 64n), true);
  if (dos.u16(0) !== 0x5a4d) reject("Missing DOS MZ header");
  const pe = dos.u32(60);
  if (pe < 64) reject("PE signature overlaps the DOS header");
  const coff = new BinaryReader(yield request(fileSize, BigInt(pe), 24n), true);
  if (coff.u32(0) !== 0x4550) reject("PE signature is invalid");
  const optionalSize = coff.u16(20);
  const optional = readPeOptionalHeaderStructure(
    yield request(fileSize, BigInt(pe + 24), BigInt(optionalSize)),
  );
  if (!optional.ok) {
    switch (optional.error.reason) {
      case "truncated-magic":
        return reject("16-bit field range is truncated or outside the file");
      case "unsupported-magic":
        throw new BinaryFormatFailure(
          "unsupported",
          "Only PE32/PE32+ images are supported",
        );
      case "truncated-fixed-fields":
      case "truncated-directory-table":
        return reject("PE optional header or data directories are truncated");
    }
  }
  const { bits } = optional.value;
  const count = coff.u16(6);
  const start = pe + 24 + optionalSize;
  const table = yield request(fileSize, BigInt(start), BigInt(count) * 40n);
  const sections: NativeSection[] = [];
  for (let index = 0; index < count; index++) {
    const row = readPeSectionHeader(
      table.subarray(index * 40, (index + 1) * 40),
    );
    sections.push({
      index,
      name: row.name,
      name_state: "known",
      header_offset: start + index * 40,
      offset: BigInt(row.offset),
      size: BigInt(row.size),
      address: BigInt(row.virtual_address),
      type: 0,
      flags: BigInt(row.characteristics),
      link: 0,
      info: 0,
      entry_size: 0n,
      file_backed: declaredFileRange(
        fileSize,
        BigInt(row.offset),
        BigInt(row.size),
      ).file_backed,
    });
  }
  return {
    format: "pe",
    elf_os_abi: null,
    bits,
    little: true,
    machine: coff.u16(4),
    flags: coff.u16(22),
    programs: [],
    sections,
  };
}

/** Borrow ELF bytes; file drivers satisfy the identical requests without loading payloads. */
export const readElfDirectoryFromBuffer = (
  bytes: Buffer,
): NativeSectionDirectory => {
  const steps = readElfSectionDirectory(bytes.length);
  let next = steps.next();
  while (!next.done) {
    const { offset, size } = next.value;
    next = steps.next(bytes.subarray(offset, offset + size));
  }
  return next.value;
};
