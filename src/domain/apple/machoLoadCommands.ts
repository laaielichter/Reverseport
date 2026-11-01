import { err, ok, type Result } from "../result.js";
import { machoLoadCommandAlignment } from "./machoContainer.js";

/** Header commitments needed to walk commands without retaining their payloads. */
export interface MachoLoadCommandTableHeader {
  readonly headerSize: 28 | 32;
  readonly wide: boolean;
  readonly littleEndian: boolean;
  readonly commandCount: number;
  readonly commandBytes: number;
}

/** Read only the thin header's load-command framing; other formats return null. */
export const readMachoLoadCommandTableHeader = (
  bytes: Uint8Array,
  fileSize: number,
): Result<MachoLoadCommandTableHeader | null, string> => {
  if (bytes.byteLength < 4) return ok(null);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, false);
  if (![0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magic))
    return ok(null);
  const wide = magic === 0xfeedfacf || magic === 0xcffaedfe;
  const headerSize = wide ? 32 : 28;
  if (bytes.byteLength < headerSize)
    return err(
      `truncated Mach-O header: a ${wide ? 64 : 32}-bit header needs ${headerSize} bytes; the file has ${fileSize}`,
    );
  const littleEndian = magic === 0xcefaedfe || magic === 0xcffaedfe;
  const commandBytes = view.getUint32(20, littleEndian);
  if (commandBytes > fileSize - headerSize)
    return err(
      `truncated Mach-O load commands: the header declares ${commandBytes} bytes after its ${headerSize}-byte header; the file has ${fileSize}`,
    );
  return ok({
    headerSize,
    wide,
    littleEndian,
    commandCount: view.getUint32(16, littleEndian),
    commandBytes,
  });
};

/** One owner's count, alignment and extent proof for a sequential command walk. */
export class MachoLoadCommandCursor {
  #index = 0;
  #offset = 0;

  constructor(
    private readonly table: Pick<
      MachoLoadCommandTableHeader,
      "wide" | "littleEndian" | "commandCount" | "commandBytes"
    >,
  ) {}

  /** Offset relative to the command table; null when every declared row was read. */
  get nextOffset(): number | null {
    return this.#index < this.table.commandCount ? this.#offset : null;
  }

  /** Consume exactly one command's eight-byte header, leaving its payload to callers. */
  read(bytes: Uint8Array): Result<
    {
      readonly index: number;
      readonly offset: number;
      readonly command: number;
      readonly size: number;
    },
    string
  > {
    const { commandBytes, littleEndian, wide } = this.table;
    if (this.#offset + 8 > commandBytes || bytes.byteLength < 8)
      return err(`load command ${this.#index} starts beyond sizeofcmds`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = view.getUint32(4, littleEndian);
    if (
      size < 8 ||
      size % machoLoadCommandAlignment(wide) !== 0 ||
      size > commandBytes - this.#offset
    )
      return err(
        `load command ${this.#index} at offset ${this.#offset} has invalid cmdsize ${size}`,
      );
    const frame = {
      index: this.#index,
      offset: this.#offset,
      command: view.getUint32(0, littleEndian),
      size,
    };
    this.#index += 1;
    this.#offset += size;
    return ok(frame);
  }

  /** A successful walk must exhaust both ncmds and sizeofcmds. */
  finish(): Result<null, string> {
    return this.#index === this.table.commandCount &&
      this.#offset === this.table.commandBytes
      ? ok(null)
      : err(
          `load commands declare ${this.table.commandCount} commands but sizeofcmds holds ${this.table.commandBytes} bytes`,
        );
  }
}
