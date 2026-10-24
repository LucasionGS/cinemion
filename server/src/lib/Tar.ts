/**
 * Writes and reads tar archives (ustar, with pax headers for long names) as streams, so archives of any size never
 * have to fit in memory. Used for backups; gzip and encryption are layered on top by the caller.
 */
export namespace Tar {
  const BLOCK = 512;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  export interface Entry {
    /**
     * Path inside the archive, with `/` between folders.
     */
    name: string;
    /**
     * Unit is in bytes.
     */
    size: number;
    /**
     * Modification time. Unit is in milliseconds.
     */
    mtime: number;
  }

  function octal(value: number, length: number) {
    return value.toString(8).padStart(length - 1, "0") + "\0";
  }

  function header(name: string, size: number, mtime: number, type: string) {
    const block = new Uint8Array(BLOCK);
    const put = (text: string, offset: number, length: number) => block.set(encoder.encode(text).slice(0, length), offset);
    put(name, 0, 100);
    put(octal(0o644, 8), 100, 8);
    put(octal(0, 8), 108, 8);
    put(octal(0, 8), 116, 8);
    put(octal(size, 12), 124, 12);
    put(octal(Math.floor(mtime / 1000), 12), 136, 12);
    put("        ", 148, 8);
    put(type, 156, 1);
    put("ustar\0", 257, 6);
    put("00", 263, 2);
    let sum = 0;
    for (const byte of block) sum += byte;
    put(octal(sum, 7) + " ", 148, 8);
    return block;
  }

  /**
   * A pax record: "<length> path=<name>\n", where the length counts itself.
   */
  function paxRecord(key: string, value: string) {
    const body = encoder.encode(` ${key}=${value}\n`).length;
    let length = body + 1;
    while (body + String(length).length !== length) length = body + String(length).length;
    return `${length} ${key}=${value}\n`;
  }

  /**
   * Adds files to an archive, one after another. Call `finish()` at the end; it closes the writer.
   */
  export class Writer {
    constructor(private _out: WritableStreamDefaultWriter<Uint8Array>) { }

    private async _header(name: string, size: number, mtime: number) {
      // Names that don't fit the 100 bytes of the header get a pax header in front
      if (encoder.encode(name).length > 99) {
        const pax = encoder.encode(paxRecord("path", name));
        await this._out.write(header("PaxHeader", pax.length, mtime, "x"));
        await this._write(pax);
        await this._pad(pax.length);
      }
      await this._out.write(header(name, size, mtime, "0"));
    }

    private async _write(bytes: Uint8Array) {
      await this._out.ready;
      await this._out.write(bytes);
    }

    private async _pad(size: number) {
      const rest = size % BLOCK;
      if (rest > 0) await this._write(new Uint8Array(BLOCK - rest));
    }

    public async addBytes(name: string, bytes: Uint8Array, mtime = Date.now()) {
      await this._header(name, bytes.length, mtime);
      await this._write(bytes);
      await this._pad(bytes.length);
    }

    /**
     * Add a file from disk. A file that grows or shrinks while it's read is cut or padded to the size it had when it
     * was looked at, so the archive stays readable.
     * @returns `false` when the file is gone.
     */
    public async addFile(name: string, path: string): Promise<boolean> {
      let file: Deno.FsFile;
      try {
        file = await Deno.open(path, { read: true });
      } catch {
        return false;
      }
      try {
        const stat = await file.stat();
        const size = stat.size;
        await this._header(name, size, stat.mtime?.getTime() ?? Date.now());
        let written = 0;
        const buffer = new Uint8Array(256 * 1024);
        while (written < size) {
          const read = await file.read(buffer.subarray(0, Math.min(buffer.length, size - written)));
          if (read === null) break;
          await this._write(buffer.slice(0, read));
          written += read;
        }
        if (written < size) await this._write(new Uint8Array(size - written));
        await this._pad(size);
        return true;
      } finally {
        file.close();
      }
    }

    /**
     * Write the end of the archive and close the stream.
     */
    public async finish() {
      await this._write(new Uint8Array(BLOCK * 2));
      await this._out.close();
    }
  }

  /**
   * Reads exactly the bytes asked for from a stream.
   */
  class ByteReader {
    private _buffer = new Uint8Array(0);
    private _reader: ReadableStreamDefaultReader<Uint8Array>;

    constructor(stream: ReadableStream<Uint8Array>) {
      this._reader = stream.getReader();
    }

    /**
     * The next `length` bytes, or fewer at the end of the stream.
     */
    public async read(length: number): Promise<Uint8Array> {
      while (this._buffer.length < length) {
        const { value, done } = await this._reader.read();
        if (done) break;
        const joined = new Uint8Array(this._buffer.length + value.length);
        joined.set(this._buffer);
        joined.set(value, this._buffer.length);
        this._buffer = joined;
      }
      const result = this._buffer.slice(0, length);
      this._buffer = this._buffer.slice(result.length);
      return result;
    }

    public cancel() {
      this._reader.cancel().catch(() => { });
    }
  }

  /**
   * One file in an archive being read. Read its contents before asking for the next one, or they're skipped.
   */
  export interface ReadEntry extends Entry {
    /**
     * The contents in pieces.
     */
    chunks(): AsyncGenerator<Uint8Array>;
    bytes(): Promise<Uint8Array>;
    text(): Promise<string>;
  }

  function field(block: Uint8Array, offset: number, length: number) {
    const bytes = block.subarray(offset, offset + length);
    const end = bytes.indexOf(0);
    return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end));
  }

  function parsePax(text: string) {
    const values: Record<string, string> = {};
    // Example: 30 path=files/images/ab/cd.img\n
    for (const match of text.matchAll(/(\d+) ([^=]+)=([^\n]*)\n/g)) values[match[2]] = match[3];
    return values;
  }

  /**
   * Every file in the archive, in order. Folders and links are skipped.
   * @throws When the archive is damaged or cut short.
   */
  export async function* read(stream: ReadableStream<Uint8Array>): AsyncGenerator<ReadEntry> {
    const reader = new ByteReader(stream);
    let pax: Record<string, string> = {};
    try {
      while (true) {
        const block = await reader.read(BLOCK);
        if (block.length < BLOCK) throw new Error("The archive is cut short.");
        if (block.every((byte) => byte === 0)) return;
        if (field(block, 257, 5) !== "ustar") throw new Error("This isn't a tar archive, or it's damaged.");

        const size = parseInt(field(block, 124, 12).trim() || "0", 8);
        const type = field(block, 156, 1) || "0";
        const prefix = field(block, 345, 155);
        const name = pax.path ?? (prefix ? `${prefix}/${field(block, 0, 100)}` : field(block, 0, 100));
        const mtime = parseInt(field(block, 136, 12).trim() || "0", 8) * 1000;
        const padded = Math.ceil(size / BLOCK) * BLOCK;

        if (type === "x") {
          pax = parsePax(decoder.decode((await reader.read(padded)).subarray(0, size)));
          continue;
        }
        pax = {};
        if (type !== "0") {
          await reader.read(padded);
          continue;
        }

        let left = size;
        const chunks = async function* () {
          while (left > 0) {
            const piece = await reader.read(Math.min(left, 256 * 1024));
            if (piece.length === 0) throw new Error(`The archive is cut short; "${name}" is incomplete.`);
            left -= piece.length;
            yield piece;
          }
        };
        const bytes = async () => {
          const result = new Uint8Array(size);
          let at = 0;
          for await (const piece of chunks()) {
            result.set(piece, at);
            at += piece.length;
          }
          return result;
        };
        yield { name, size, mtime, chunks, bytes, text: async () => decoder.decode(await bytes()) };

        // Whatever the caller didn't read is skipped, plus the padding
        while (left > 0) {
          const piece = await reader.read(Math.min(left, 256 * 1024));
          if (piece.length === 0) throw new Error(`The archive is cut short; "${name}" is incomplete.`);
          left -= piece.length;
        }
        await reader.read(padded - size);
      }
    } finally {
      reader.cancel();
    }
  }
}

export default Tar;
