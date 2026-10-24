/**
 * Password protection for files of any size, as streams: AES-256-GCM in 1 MiB pieces with a key made from the
 * password with PBKDF2. Every piece is checked when it's read, and the last one is marked, so a file that was changed
 * or cut short is noticed.
 *
 * Layout: "CNBK", a version byte, the PBKDF2 iterations (4 bytes), a 16-byte salt and a 4-byte nonce prefix, then
 * pieces of a 4-byte length and the encrypted bytes. A piece's nonce is the prefix plus its number.
 */
export namespace Encryption {
  const MAGIC = new TextEncoder().encode("CNBK");
  const VERSION = 1;
  const HEADER_SIZE = 4 + 1 + 4 + 16 + 4;
  const PIECE_SIZE = 1024 * 1024;
  const ITERATIONS = 600_000;
  const MORE = new Uint8Array([0]);
  const LAST = new Uint8Array([1]);

  async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  function nonce(prefix: Uint8Array, counter: number) {
    const bytes = new Uint8Array(12);
    bytes.set(prefix);
    new DataView(bytes.buffer).setBigUint64(4, BigInt(counter));
    return bytes;
  }

  /**
   * Whether `bytes` (the start of a file) look like a password-protected file.
   */
  export function isEncrypted(bytes: Uint8Array) {
    return bytes.length >= MAGIC.length && MAGIC.every((byte, i) => bytes[i] === byte);
  }

  /**
   * Whether the file at `path` is password protected.
   */
  export async function isEncryptedFile(path: string) {
    const file = await Deno.open(path, { read: true });
    try {
      const start = new Uint8Array(MAGIC.length);
      const read = await file.read(start);
      return read === MAGIC.length && isEncrypted(start);
    } finally {
      file.close();
    }
  }

  /**
   * A stream that protects what goes through it with `password`.
   */
  export async function encrypt(password: string): Promise<TransformStream<Uint8Array, Uint8Array>> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const prefix = crypto.getRandomValues(new Uint8Array(4));
    const key = await deriveKey(password, salt, ITERATIONS);
    let buffer = new Uint8Array(PIECE_SIZE);
    let filled = 0;
    let counter = 0;

    const piece = async (plain: Uint8Array, last: boolean) => {
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce(prefix, counter++), additionalData: last ? LAST : MORE }, key, plain as BufferSource));
      const out = new Uint8Array(4 + sealed.length);
      new DataView(out.buffer).setUint32(0, sealed.length);
      out.set(sealed, 4);
      return out;
    };

    return new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        const header = new Uint8Array(HEADER_SIZE);
        header.set(MAGIC);
        header[4] = VERSION;
        new DataView(header.buffer).setUint32(5, ITERATIONS);
        header.set(salt, 9);
        header.set(prefix, 25);
        controller.enqueue(header);
      },
      async transform(chunk, controller) {
        let at = 0;
        while (at < chunk.length) {
          const take = Math.min(PIECE_SIZE - filled, chunk.length - at);
          buffer.set(chunk.subarray(at, at + take), filled);
          filled += take;
          at += take;
          if (filled === PIECE_SIZE) {
            controller.enqueue(await piece(buffer, false));
            buffer = new Uint8Array(PIECE_SIZE);
            filled = 0;
          }
        }
      },
      async flush(controller) {
        controller.enqueue(await piece(buffer.slice(0, filled), true));
      },
    });
  }

  /**
   * A stream that opens what `encrypt()` made.
   * @throws Through the stream, when the password is wrong or the file was changed or cut short.
   */
  export function decrypt(password: string): TransformStream<Uint8Array, Uint8Array> {
    let pending = new Uint8Array(0);
    let key: CryptoKey | null = null;
    let prefix: Uint8Array | null = null;
    let counter = 0;
    let finished = false;

    const open = async (sealed: Uint8Array) => {
      const iv = nonce(prefix!, counter++);
      try {
        return { plain: new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: MORE }, key!, sealed as BufferSource)), last: false };
      } catch {
        // Only the last piece is sealed as the last one
      }
      try {
        return { plain: new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: LAST }, key!, sealed as BufferSource)), last: true };
      } catch {
        throw new Error(counter === 1 ? "The password is wrong." : "The file is damaged: part of it doesn't match its checksum.");
      }
    };

    return new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        const joined = new Uint8Array(pending.length + chunk.length);
        joined.set(pending);
        joined.set(chunk, pending.length);
        pending = joined;

        if (!key) {
          if (pending.length < HEADER_SIZE) return;
          if (!isEncrypted(pending)) throw new Error("This file isn't password protected.");
          if (pending[4] !== VERSION) throw new Error("This file was protected by a newer Cinemion. Update Cinemion to open it.");
          const view = new DataView(pending.buffer, pending.byteOffset);
          key = await deriveKey(password, pending.slice(9, 25), view.getUint32(5));
          prefix = pending.slice(25, 29);
          pending = pending.slice(HEADER_SIZE);
        }

        while (pending.length >= 4) {
          const length = new DataView(pending.buffer, pending.byteOffset).getUint32(0);
          if (pending.length < 4 + length) break;
          if (finished) throw new Error("The file is damaged: there's data after its end.");
          const { plain, last } = await open(pending.slice(4, 4 + length));
          pending = pending.slice(4 + length);
          finished = last;
          if (plain.length > 0) controller.enqueue(plain);
        }
      },
      flush() {
        if (!finished) throw new Error("The file is cut short.");
      },
    });
  }
}

export default Encryption;
