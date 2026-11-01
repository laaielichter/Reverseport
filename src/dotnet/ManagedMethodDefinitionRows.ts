import type { ManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import { metadataRowCursor, metadataToken } from "./ManagedMetadataHeaps.js";

/** Scalar MethodDef facts; consumers own heap admission and method selection. */
export const readMethodDefinitionRow = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  row: number,
): {
  readonly token: string;
  readonly rowOffset: number;
  readonly rva: number;
  readonly implFlags: number;
  readonly flags: number;
  readonly nameIndex: number;
  readonly signatureIndex: number;
} => {
  // Layout admission bounds the whole fixed-width row before a cursor is created.
  const cursor = metadataRowCursor(bytes, layout, 6, row);
  return {
    token: metadataToken(6, row),
    rowOffset: cursor.start,
    rva: cursor.readUInt32(),
    implFlags: cursor.readUInt16(),
    flags: cursor.readUInt16(),
    nameIndex: cursor.readIndex(layout.stringIndexSize),
    signatureIndex: cursor.readIndex(layout.blobIndexSize),
  };
};
