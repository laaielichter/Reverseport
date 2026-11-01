/** A dyld byte name projected losslessly as UTF-8, or retained exactly. */
export type MachoName = string | { readonly bytes_base64: string };

/** NUL terminators and source bounds are validated by the owning format reader. */
export const decodeMachoName = (bytes: Buffer): MachoName => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return { bytes_base64: bytes.toString("base64") };
  }
};
