import { err, ok, type Result } from "./result.js";

/** Raw data-directory words; entry 4 names file bytes, while resource entry 2 names an RVA. */
export interface PeDataDirectory {
  readonly address: number;
  readonly size: number;
  /** Byte offset of this entry relative to the optional header. */
  readonly offset: number;
}

/** Structural facts copied from one declared PE optional header. */
export interface PeOptionalHeaderStructure {
  readonly magic: 0x10b | 0x20b;
  readonly bits: 32 | 64;
  readonly format: "pe32" | "pe32-plus";
  readonly sizeOfHeaders: number;
  readonly directoryOffset: number;
  readonly directoryCount: number;
  readonly dataDirectories: readonly PeDataDirectory[];
}

export interface PeOptionalHeaderFailure {
  readonly kind: "malformed" | "unsupported";
  readonly reason:
    | "truncated-magic"
    | "unsupported-magic"
    | "truncated-fixed-fields"
    | "truncated-directory-table";
  readonly message: string;
}

/** Decode structural declarations without admitting a machine, file extent, or directory address. */
export const readPeOptionalHeaderStructure = (
  bytes: Uint8Array,
): Result<PeOptionalHeaderStructure, PeOptionalHeaderFailure> => {
  if (bytes.byteLength < 2)
    return err({
      kind: "malformed",
      reason: "truncated-magic",
      message: "truncated PE optional header",
    });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint16(0, true);
  if (magic !== 0x10b && magic !== 0x20b)
    return err({
      kind: "unsupported",
      reason: "unsupported-magic",
      message: "Only PE32 and PE32+ image optional headers are supported",
    });
  const bits = magic === 0x20b ? 64 : 32;
  const directoryOffset = bits === 64 ? 112 : 96;
  if (bytes.byteLength < directoryOffset)
    return err({
      kind: "malformed",
      reason: "truncated-fixed-fields",
      message: "truncated PE optional header",
    });
  const directoryCount = view.getUint32(directoryOffset - 4, true);
  if (directoryCount > Math.floor((bytes.byteLength - directoryOffset) / 8))
    return err({
      kind: "malformed",
      reason: "truncated-directory-table",
      message: "truncated PE data-directory table",
    });
  const dataDirectories = Array.from({ length: directoryCount }, (_, index) => {
    const offset = directoryOffset + index * 8;
    return {
      address: view.getUint32(offset, true),
      size: view.getUint32(offset + 4, true),
      offset,
    };
  });
  return ok({
    magic,
    bits,
    format: bits === 64 ? "pe32-plus" : "pe32",
    sizeOfHeaders: view.getUint32(60, true),
    directoryOffset,
    directoryCount,
    dataDirectories,
  });
};
