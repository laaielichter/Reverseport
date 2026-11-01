/** ELF note padding follows binutils: only a declared alignment of 8 uses 8. */
export const elfNoteAlignment = (declared: number | bigint): number =>
  declared === 8 || declared === 8n ? 8 : 4;

/** Descriptor and next-note offsets relative to the note's 12-byte header. */
export const elfNoteLayout = (
  namesz: number,
  descsz: number,
  alignment: number,
) => {
  const descriptor = Math.ceil((12 + namesz) / alignment) * alignment;
  return {
    descriptor,
    next: Math.ceil((descriptor + descsz) / alignment) * alignment,
  };
};
