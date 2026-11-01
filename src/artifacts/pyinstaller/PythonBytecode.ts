/**
 * Final CPython bytecode magics for the minor versions whose 16-byte `.pyc`
 * header this reader can reconstruct. Other magics leave the PYZ opaque.
 * Each value is the four-byte little-endian magic, including the trailing CR LF.
 */
const PYTHON_BYTECODE_MAGICS: Readonly<Record<string, string>> = {
  "420d0d0a": "3.7",
  "550d0d0a": "3.8",
  "610d0d0a": "3.9",
  "6f0d0d0a": "3.10",
  a70d0d0a: "3.11",
  cb0d0d0a: "3.12",
  f30d0d0a: "3.13",
  "2b0e0d0a": "3.14",
};

/** Limitation recorded when a member's digest covers a derived `.pyc` header. */
export const RECONSTRUCTED_PYTHON_HEADER_LIMITATION =
  "Python bytecode header was reconstructed from the archive Python magic; this digest covers the derived file.";

/** Dotted Python version for a supported bytecode magic, when one is known. */
export const pythonVersionForMagic = (magic: Buffer): string | undefined =>
  PYTHON_BYTECODE_MAGICS[magic.toString("hex")];

/**
 * 16-byte `.pyc` header used since Python 3.7: magic, zero flags, zero
 * timestamp, and zero source size. The flags word selects the timestamp form.
 */
export const reconstructedPycHeader = (magic: Buffer): Buffer => {
  const header = Buffer.alloc(16);
  magic.copy(header, 0, 0, 4);
  return header;
};

/** TYPE_CODE with or without FLAG_REF; a pyc magic takes precedence. */
export const isHeaderlessPythonCode = (prefix: Buffer): boolean =>
  prefix.length === 4 &&
  !(prefix[2] === 0x0d && prefix[3] === 0x0a) &&
  (prefix[0] === 0x63 || prefix[0] === 0xe3);

export interface CArchiveBytecodeHeader {
  readonly header: Buffer | undefined;
  readonly limitation: string | undefined;
}
