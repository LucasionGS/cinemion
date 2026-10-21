/**
 * Reads zip files straight from disk, one entry at a time, so a season pack of many gigabytes never has to fit in
 * memory. Handles zip64 (files and archives over 4 GB), stored and deflated entries, and checks every entry's CRC.
 */
export class ZipReader {
  private constructor(
    private _file: Deno.FsFile,
    /**
     * Size of the zip file. Unit is in bytes.
     */
    public readonly size: number,
    /**
     * Every file and folder in the zip, in the order of its central directory.
     */
    public readonly entries: ZipReader.Entry[],
  ) { }

  /**
   * Open a zip file and read its list of entries.
   * @throws When the file isn't a zip file, or is cut short.
   */
  public static async open(path: string): Promise<ZipReader> {
    const file = await Deno.open(path, { read: true });
    try {
      const size = (await file.stat()).size;
      const entries = await ZipReader._readDirectory(file, size);
      return new ZipReader(file, size, entries);
    } catch (error) {
      file.close();
      throw error;
    }
  }

  /**
   * The unpacked contents of `entry`. The stream errors when the data doesn't match its checksum or size.
   * Read one entry at a time; they share the file handle.
   * @throws When the entry is encrypted or packed with a method other than store or deflate.
   */
  public async stream(entry: ZipReader.Entry): Promise<ReadableStream<Uint8Array>> {
    if (entry.isEncrypted) throw new Error(`"${entry.name}" is password-protected.`);
    if (!ZipReader.isSupported(entry)) throw new Error(`"${entry.name}" is packed in a way Cinemion can't unpack (method ${entry.method}). Zip it again with normal compression.`);

    // The local header repeats the name and has its own extra field, so the data starts after both
    const local = await this._read(entry.localHeaderOffset, 30);
    const view = new DataView(local.buffer, local.byteOffset, local.byteLength);
    if (view.getUint32(0, true) !== ZipReader.LOCAL_HEADER) throw new Error(`The zip file is damaged near "${entry.name}".`);
    const start = entry.localHeaderOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
    if (start + entry.compressedSize > this.size) throw new Error(`The zip file is cut short; "${entry.name}" is incomplete.`);

    const raw = this._range(start, entry.compressedSize);
    const unpacked = entry.method === 8 ? raw.pipeThrough(new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>) : raw;
    return unpacked.pipeThrough(ZipReader._verify(entry));
  }

  public close() {
    try {
      this._file.close();
    } catch {
      // Already closed
    }
  }

  /**
   * Whether `entry` can be unpacked: stored or deflated, and not encrypted.
   */
  public static isSupported(entry: ZipReader.Entry) {
    return !entry.isEncrypted && (entry.method === 0 || entry.method === 8);
  }

  private static readonly LOCAL_HEADER = 0x04034b50;
  private static readonly CENTRAL_HEADER = 0x02014b50;
  private static readonly END = 0x06054b50;
  private static readonly END64 = 0x06064b50;
  private static readonly END64_LOCATOR = 0x07064b50;

  private _read(position: number, length: number) {
    return ZipReader._readAt(this._file, position, length);
  }

  /**
   * `length` bytes from `position`, read in 1 MB pieces as the consumer asks for them.
   */
  private _range(position: number, length: number) {
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (offset >= length) {
          controller.close();
          return;
        }
        const piece = await this._read(position + offset, Math.min(1024 * 1024, length - offset));
        offset += piece.length;
        controller.enqueue(piece);
      },
    }, { highWaterMark: 0 });
  }

  private static async _readAt(file: Deno.FsFile, position: number, length: number) {
    const buffer = new Uint8Array(length);
    await file.seek(position, Deno.SeekMode.Start);
    let filled = 0;
    while (filled < length) {
      const read = await file.read(buffer.subarray(filled));
      if (read === null || read === 0) throw new Error("The zip file is cut short.");
      filled += read;
    }
    return buffer;
  }

  private static async _readDirectory(file: Deno.FsFile, size: number): Promise<ZipReader.Entry[]> {
    // The end record is the last 22 bytes plus a comment of up to 64 KB
    const tailLength = Math.min(size, 22 + 0xffff);
    if (tailLength < 22) throw new Error("This isn't a zip file.");
    const tailStart = size - tailLength;
    const tail = await ZipReader._readAt(file, tailStart, tailLength);
    const tailView = new DataView(tail.buffer);
    let end = -1;
    for (let i = tailLength - 22; i >= 0; i--) {
      if (tailView.getUint32(i, true) === ZipReader.END) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error("This isn't a zip file, or it's cut short. Check that the upload finished and that the file opens on your computer.");

    let count: number = tailView.getUint16(end + 10, true);
    let directorySize: number = tailView.getUint32(end + 12, true);
    let directoryOffset: number = tailView.getUint32(end + 16, true);

    if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      // Zip64: a locator right before the end record points to a bigger end record
      const locatorAt = tailStart + end - 20;
      if (locatorAt < 0) throw new Error("The zip file is damaged: its zip64 end record is missing.");
      const locator = new DataView((await ZipReader._readAt(file, locatorAt, 20)).buffer);
      if (locator.getUint32(0, true) !== ZipReader.END64_LOCATOR) throw new Error("The zip file is damaged: its zip64 end record is missing.");
      const end64At = Number(locator.getBigUint64(8, true));
      const end64 = new DataView((await ZipReader._readAt(file, end64At, 56)).buffer);
      if (end64.getUint32(0, true) !== ZipReader.END64) throw new Error("The zip file is damaged: its zip64 end record is unreadable.");
      count = Number(end64.getBigUint64(32, true));
      directorySize = Number(end64.getBigUint64(40, true));
      directoryOffset = Number(end64.getBigUint64(48, true));
    }
    if (directoryOffset + directorySize > size) throw new Error("The zip file is cut short. Check that the upload finished and that the file opens on your computer.");

    const directory = await ZipReader._readAt(file, directoryOffset, directorySize);
    const view = new DataView(directory.buffer);
    const utf8 = new TextDecoder("utf-8");
    const entries: ZipReader.Entry[] = [];
    let at = 0;
    for (let i = 0; i < count; i++) {
      if (at + 46 > directorySize || view.getUint32(at, true) !== ZipReader.CENTRAL_HEADER) throw new Error("The zip file's list of contents is damaged.");
      const flags = view.getUint16(at + 8, true);
      const method = view.getUint16(at + 10, true);
      const crc32 = view.getUint32(at + 16, true);
      let compressedSize = view.getUint32(at + 20, true);
      let uncompressedSize = view.getUint32(at + 24, true);
      const nameLength = view.getUint16(at + 28, true);
      const extraLength = view.getUint16(at + 30, true);
      const commentLength = view.getUint16(at + 32, true);
      const externalAttributes = view.getUint32(at + 38, true);
      let localHeaderOffset = view.getUint32(at + 42, true);
      // Names are UTF-8 when flag bit 11 is set; older tools write CP437, which matches for plain ASCII names
      const name = utf8.decode(directory.subarray(at + 46, at + 46 + nameLength));

      // Zip64 extra field: the 64-bit values for whichever of the three fields are maxed out, in this order
      let extraAt = at + 46 + nameLength;
      const extraEnd = extraAt + extraLength;
      while (extraAt + 4 <= extraEnd) {
        const id = view.getUint16(extraAt, true);
        const length = view.getUint16(extraAt + 2, true);
        if (id === 0x0001) {
          let field = extraAt + 4;
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = Number(view.getBigUint64(field, true));
            field += 8;
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = Number(view.getBigUint64(field, true));
            field += 8;
          }
          if (localHeaderOffset === 0xffffffff) localHeaderOffset = Number(view.getBigUint64(field, true));
        }
        extraAt += 4 + length;
      }

      // MS-DOS directory attribute, for tools that don't end folder names with a slash
      const isDirectory = name.endsWith("/") || name.endsWith("\\") || (externalAttributes & 0x10) !== 0;
      entries.push({ name, isDirectory, method, isEncrypted: (flags & 1) !== 0, compressedSize, size: uncompressedSize, crc32, localHeaderOffset });
      at = extraEnd + commentLength;
    }
    return entries;
  }

  /**
   * Passes data through, and errors at the end when the size or CRC-32 doesn't match the entry.
   */
  private static _verify(entry: ZipReader.Entry) {
    let crc = 0xffffffff;
    let length = 0;
    return new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        crc = ZipReader.crc32(chunk, crc);
        length += chunk.length;
        if (length > entry.size) {
          controller.error(new Error(`"${entry.name}" in the zip file is damaged: it unpacks bigger than it should.`));
          return;
        }
        controller.enqueue(chunk);
      },
      flush(controller) {
        if (length !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc32) {
          controller.error(new Error(`"${entry.name}" in the zip file is damaged: its checksum doesn't match.`));
        }
      },
    });
  }

  private static _crcTable: Uint32Array | null = null;

  /**
   * Continue a CRC-32 over `data`. Start with `0xffffffff` and XOR the end result with `0xffffffff`.
   */
  public static crc32(data: Uint8Array, crc: number) {
    let table = ZipReader._crcTable;
    if (!table) {
      table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
      ZipReader._crcTable = table;
    }
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return crc >>> 0;
  }
}

export namespace ZipReader {
  export interface Entry {
    /**
     * Path inside the zip, with `/` between folders, as the zip has it. Not checked for `..` or absolute paths.
     */
    name: string;
    isDirectory: boolean;
    /**
     * 0 = stored, 8 = deflate. Others can't be unpacked.
     */
    method: number;
    isEncrypted: boolean;
    /**
     * Unit is in bytes.
     */
    compressedSize: number;
    /**
     * Unpacked size. Unit is in bytes.
     */
    size: number;
    crc32: number;
    localHeaderOffset: number;
  }
}

export default ZipReader;
