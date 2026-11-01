import { BinaryReader, BinaryFormatFailure } from "./BinaryContainer.js";
/** Raw ELF symbol fields; GPU and other consumers own the meaning of processor-specific flags. */
export const readElfSymbol = (
  bytes: Buffer,
  bits: 32 | 64,
  little: boolean,
) => {
  const r = new BinaryReader(bytes, little);
  const wide = bits === 64;
  const info = r.range(wide ? 4 : 12, 1, "ELF symbol info")[0]!;
  return {
    name_offset: r.u32(0),
    binding: info >>> 4,
    type: info & 15,
    other: r.range(wide ? 5 : 13, 1, "ELF symbol other")[0]!,
    section_index: r.u16(wide ? 6 : 14),
    value: r.word(wide ? 8 : 4, bits),
    size: r.word(wide ? 16 : 8, bits),
  };
};
export const readElfString = (bytes: Buffer, offset: number): string => {
  return readElfStringBytes(bytes, offset).toString("latin1");
};

/** Read exact string-table bytes; ELF does not prescribe a character encoding. */
export const readElfStringBytes = (bytes: Buffer, offset: number): Buffer => {
  if (offset >= bytes.length)
    throw new BinaryFormatFailure(
      "malformed",
      "ELF string offset is outside its string table",
    );
  const end = bytes
    .subarray(offset, Math.min(bytes.length, offset + 65536))
    .indexOf(0);
  if (end < 0)
    throw new BinaryFormatFailure(
      "malformed",
      "ELF string is unterminated or exceeds the string budget",
    );
  return bytes.subarray(offset, offset + end);
};
