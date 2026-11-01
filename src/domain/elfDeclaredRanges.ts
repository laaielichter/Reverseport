import { readElfFixedHeader, type ElfFixedHeader } from "./elfFixedHeader.js";
import { err, ok, type Result } from "./result.js";

/** Positional source requests; the caller owns the descriptor and cancellation. */
export interface ElfDeclarationRead {
  readonly offset: number;
  readonly size: number;
}

interface ElfDeclaredTable {
  readonly offset: bigint;
  readonly count: number;
  readonly width: number;
}

export interface ElfTableDeclarations {
  readonly header: ElfFixedHeader;
  readonly programs: ElfDeclaredTable;
  readonly sections: ElfDeclaredTable & { readonly namesIndex: number };
}

const reader = (bytes: Buffer, header: ElfFixedHeader) => {
  const little = header.byteOrder === "little";
  const u16 = (at: number) =>
    little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at);
  const u32 = (at: number) =>
    little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at);
  const word = (at: number) =>
    header.elfClass === 32
      ? BigInt(u32(at))
      : little
        ? bytes.readBigUInt64LE(at)
        : bytes.readBigUInt64BE(at);
  return { u16, u32, word };
};

/** Zero-sized/inactive declarations own no file bytes. Arithmetic stays exact. */
const rangeFailure = (
  label: string,
  offset: bigint,
  size: bigint,
  fileSize: number,
): string | undefined =>
  size !== 0n && (offset > BigInt(fileSize) || size > BigInt(fileSize) - offset)
    ? `truncated ELF ${label}: declared file range ${String(offset)}..${String(offset + size)} exceeds the ${String(fileSize)}-byte file`
    : undefined;

interface RawTableDeclaration {
  readonly offset: bigint;
  readonly count: bigint;
  readonly width: number;
}

const tableFailure = (
  kind: "program" | "section",
  table: RawTableDeclaration,
  header: ElfFixedHeader,
  fileSize: number,
): string | undefined => {
  if (table.count === 0n) return undefined;
  const wide = header.elfClass === 64;
  const minimumWidth = kind === "program" ? (wide ? 56 : 32) : wide ? 64 : 40;
  const label = `${kind} header table`;
  if (table.width < minimumWidth) return `invalid ELF ${label} entry width`;
  if (table.offset < BigInt(wide ? 64 : 52))
    return `ELF ${label} overlaps the fixed header`;
  return rangeFailure(
    label,
    table.offset,
    table.count * BigInt(table.width),
    fileSize,
  );
};

interface TableCounts {
  programCount: bigint;
  sectionCount: bigint;
  namesIndex: number;
}

const extendedCounts = (
  first: Buffer,
  header: ElfFixedHeader,
  initial: TableCounts,
): Result<TableCounts, string> => {
  const wide = header.elfClass === 64;
  if (first.length !== (wide ? 64 : 40))
    return err("truncated ELF extended section-zero header");
  const zero = reader(first, header);
  if (zero.u32(4) !== 0)
    return err(
      "ELF extended numbering requires an inactive SHT_NULL section zero",
    );
  const counts = { ...initial };
  if (counts.sectionCount === 0n) {
    counts.sectionCount = zero.word(wide ? 32 : 20);
    if (counts.sectionCount < 0xff00n)
      return err("invalid ELF extended section count");
  }
  if (counts.namesIndex === 0xffff) {
    counts.namesIndex = zero.u32(wide ? 40 : 24);
    if (counts.namesIndex < 0xff00)
      return err("invalid ELF extended section-name index");
  }
  if (counts.programCount === 0xffffn) {
    counts.programCount = BigInt(zero.u32(wide ? 44 : 28));
    if (counts.programCount < 0xffffn)
      return err("invalid ELF extended program count");
  }
  return ok(counts);
};

const TABLE_FIELDS = {
  32: {
    programOffset: 28,
    sectionOffset: 32,
    programWidth: 42,
    programCount: 44,
    sectionWidth: 46,
    sectionCount: 48,
    namesIndex: 50,
    sectionHeaderSize: 40,
  },
  64: {
    programOffset: 32,
    sectionOffset: 40,
    programWidth: 54,
    programCount: 56,
    sectionWidth: 58,
    sectionCount: 60,
    namesIndex: 62,
    sectionHeaderSize: 64,
  },
} as const;

/** Canonical table declarations, including extended counts in inactive section zero. */
export function* readElfTableDeclarations(
  bytes: Buffer,
  fileSize: number,
): Generator<ElfDeclarationRead, Result<ElfTableDeclarations, string>, Buffer> {
  const fixed = readElfFixedHeader(bytes, fileSize);
  if (!fixed.ok) return fixed;
  const header = fixed.value;
  const r = reader(bytes, header);
  const fields = TABLE_FIELDS[header.elfClass];
  const programOffset = r.word(fields.programOffset);
  const sectionOffset = r.word(fields.sectionOffset);
  const programWidth = r.u16(fields.programWidth);
  const sectionWidth = r.u16(fields.sectionWidth);
  let programCount = BigInt(r.u16(fields.programCount));
  let sectionCount = BigInt(r.u16(fields.sectionCount));
  let namesIndex = r.u16(fields.namesIndex);
  if (
    sectionOffset === 0n &&
    (sectionCount !== 0n || namesIndex !== 0 || programCount === 0xffffn)
  )
    return err("ELF section table is missing");
  if (
    sectionOffset !== 0n &&
    (sectionCount === 0n || namesIndex === 0xffff || programCount === 0xffffn)
  ) {
    const failure = tableFailure(
      "section",
      { offset: sectionOffset, count: 1n, width: sectionWidth },
      header,
      fileSize,
    );
    if (failure !== undefined) return err(failure);
    const first = yield {
      offset: Number(sectionOffset),
      size: fields.sectionHeaderSize,
    };
    const counts = extendedCounts(first, header, {
      programCount,
      sectionCount,
      namesIndex,
    });
    if (!counts.ok) return counts;
    ({ programCount, sectionCount, namesIndex } = counts.value);
  }
  for (const [kind, offset, count, width] of [
    ["program", programOffset, programCount, programWidth],
    ["section", sectionOffset, sectionCount, sectionWidth],
  ] as const) {
    const failure = tableFailure(
      kind,
      { offset, count, width },
      header,
      fileSize,
    );
    if (failure !== undefined) return err(failure);
  }
  if (sectionCount !== 0n && BigInt(namesIndex) >= sectionCount)
    return err(
      "ELF section-name index lies outside the declared section table",
    );
  // A validated table fits the host-sized file, so its record count is exact.
  return ok({
    header,
    programs: {
      offset: programOffset,
      count: Number(programCount),
      width: programWidth,
    },
    sections: {
      offset: sectionOffset,
      count: Number(sectionCount),
      width: sectionWidth,
      namesIndex,
    },
  });
}

/** Examine only header records; referenced payloads are range-checked, never copied. */
function* inspectTableRanges(
  kind: "program" | "section",
  table: ElfDeclaredTable,
  header: ElfFixedHeader,
  fileSize: number,
): Generator<ElfDeclarationRead, Result<null, string>, Buffer> {
  const wide = header.elfClass === 64;
  const perRead = Math.max(1, Math.floor((64 * 1024) / table.width));
  for (let index = 0; index < table.count; index += perRead) {
    const count = Math.min(perRead, table.count - index);
    const size = count * table.width;
    const bytes = yield {
      offset: Number(table.offset) + index * table.width,
      size,
    };
    if (bytes.length !== size) return err(`truncated ELF ${kind} header table`);
    const r = reader(bytes, header);
    for (let item = 0; item < count; item++) {
      const at = item * table.width;
      const type = r.u32(at + (kind === "program" ? 0 : 4));
      if (type === 0 || (kind === "section" && type === 8)) continue;
      const offset = r.word(
        at + (kind === "program" ? (wide ? 8 : 4) : wide ? 24 : 16),
      );
      const length = r.word(
        at + (kind === "program" ? (wide ? 32 : 16) : wide ? 32 : 20),
      );
      const failure = rangeFailure(
        `${kind} ${String(index + item)}`,
        offset,
        length,
        fileSize,
      );
      if (failure !== undefined) return err(failure);
    }
  }
  return ok(null);
}

/** Physical extent admission, independent of section names, CPU lanes and decoder budgets. */
export function* validateElfDeclaredRanges(
  prefix: Buffer,
  fileSize: number,
): Generator<ElfDeclarationRead, Result<null, string>, Buffer> {
  const declarations = yield* readElfTableDeclarations(prefix, fileSize);
  if (!declarations.ok) return declarations;
  const { header, programs, sections } = declarations.value;
  for (const [kind, table] of [
    ["program", programs],
    ["section", sections],
  ] as const) {
    if (table.count === 0) continue;
    const inspected = yield* inspectTableRanges(kind, table, header, fileSize);
    if (!inspected.ok) return inspected;
  }
  return ok(null);
}
