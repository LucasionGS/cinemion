/**
 * Just enough ASN.1 DER to write certificates and certificate requests, and to read the parts of a certificate the
 * settings page shows (names, dates, issuer).
 */
export namespace Der {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  export const TAGS = {
    BOOLEAN: 0x01,
    INTEGER: 0x02,
    BIT_STRING: 0x03,
    OCTET_STRING: 0x04,
    NULL: 0x05,
    OID: 0x06,
    UTF8_STRING: 0x0c,
    PRINTABLE_STRING: 0x13,
    IA5_STRING: 0x16,
    UTC_TIME: 0x17,
    GENERALIZED_TIME: 0x18,
    SEQUENCE: 0x30,
    SET: 0x31,
  } as const;

  export function concat(parts: Uint8Array[]) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  function lengthBytes(length: number) {
    if (length < 0x80) return new Uint8Array([length]);
    const bytes: number[] = [];
    for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n & 0xff);
    return new Uint8Array([0x80 | bytes.length, ...bytes]);
  }

  /**
   * A tag, its length and its content.
   */
  export function tlv(tag: number, content: Uint8Array) {
    return concat([new Uint8Array([tag]), lengthBytes(content.length), content]);
  }

  export const sequence = (...items: Uint8Array[]) => tlv(TAGS.SEQUENCE, concat(items));
  export const set = (...items: Uint8Array[]) => tlv(TAGS.SET, concat(items));
  export const nil = () => tlv(TAGS.NULL, new Uint8Array(0));
  export const boolean = (value: boolean) => tlv(TAGS.BOOLEAN, new Uint8Array([value ? 0xff : 0]));
  export const octetString = (bytes: Uint8Array) => tlv(TAGS.OCTET_STRING, bytes);
  export const utf8 = (text: string) => tlv(TAGS.UTF8_STRING, encoder.encode(text));
  export const ia5 = (text: string) => tlv(TAGS.IA5_STRING, encoder.encode(text));

  /**
   * A bit string of whole bytes, or with `unused` bits at the end of the last one.
   */
  export function bitString(bytes: Uint8Array, unused = 0) {
    return tlv(TAGS.BIT_STRING, concat([new Uint8Array([unused]), bytes]));
  }

  /**
   * A positive integer, from its big-endian bytes or a small number.
   */
  export function integer(value: Uint8Array | number) {
    let bytes = typeof value === "number" ? new Uint8Array(value === 0 ? [0] : [...Array(4)].map((_, i) => (value >> (8 * (3 - i))) & 0xff)) : value;
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    bytes = bytes.slice(start);
    // A set top bit would make it negative
    if (bytes[0] & 0x80) bytes = concat([new Uint8Array([0]), bytes]);
    return tlv(TAGS.INTEGER, bytes);
  }

  export function oid(dotted: string) {
    const parts = dotted.split(".").map(Number);
    const bytes = [40 * parts[0] + parts[1]];
    for (const part of parts.slice(2)) {
      const chunk: number[] = [];
      let n = part;
      do {
        chunk.unshift(n & 0x7f);
        n = Math.floor(n / 128);
      } while (n > 0);
      for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80;
      bytes.push(...chunk);
    }
    return tlv(TAGS.OID, new Uint8Array(bytes));
  }

  /**
   * UTCTime until 2049, GeneralizedTime after, as certificates must use.
   */
  export function time(date: Date) {
    const iso = date.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";
    return date.getUTCFullYear() < 2050 ? tlv(TAGS.UTC_TIME, encoder.encode(iso.slice(2))) : tlv(TAGS.GENERALIZED_TIME, encoder.encode(iso));
  }

  /**
   * `[n]` wrapped around a whole value, as in `[0] EXPLICIT`.
   */
  export const explicit = (n: number, content: Uint8Array) => tlv(0xa0 | n, content);

  /**
   * `[n] IMPLICIT`: the value's own tag replaced. `constructed` for values that hold other values.
   */
  export const implicit = (n: number, content: Uint8Array, constructed = false) => tlv((constructed ? 0xa0 : 0x80) | n, content);

  //#region Reading

  export interface Node {
    tag: number;
    /**
     * The content bytes.
     */
    content: Uint8Array;
    /**
     * The whole value, tag and length included.
     */
    raw: Uint8Array;
    children: Node[];
  }

  /**
   * Read one value (and, for constructed ones, everything inside it).
   * @throws When the bytes aren't valid DER.
   */
  export function read(bytes: Uint8Array, offset = 0): Node {
    if (offset + 2 > bytes.length) throw new Error("The certificate is cut short.");
    const tag = bytes[offset];
    let length = bytes[offset + 1];
    let header = 2;
    if (length & 0x80) {
      const count = length & 0x7f;
      length = 0;
      for (let i = 0; i < count; i++) length = length * 256 + bytes[offset + 2 + i];
      header += count;
    }
    const start = offset + header;
    if (start + length > bytes.length) throw new Error("The certificate is cut short.");
    const content = bytes.subarray(start, start + length);
    const children: Node[] = [];
    // Constructed values hold others; BIT STRINGs and OCTET STRINGs of extensions are read by the caller
    if (tag & 0x20) {
      let at = 0;
      while (at < content.length) {
        const child = read(content, at);
        children.push(child);
        at += child.raw.length;
      }
    }
    return { tag, content, raw: bytes.subarray(offset, start + length), children };
  }

  export function readOid(node: Node) {
    const bytes = node.content;
    const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
    let n = 0;
    for (const byte of bytes.subarray(1)) {
      n = n * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) {
        parts.push(n);
        n = 0;
      }
    }
    return parts.join(".");
  }

  export function readText(node: Node) {
    return decoder.decode(node.content);
  }

  export function readTime(node: Node) {
    const text = readText(node);
    // Example: 261025093000Z (UTCTime) or 20261025093000Z (GeneralizedTime)
    const full = node.tag === TAGS.UTC_TIME ? `${Number(text.slice(0, 2)) < 50 ? "20" : "19"}${text}` : text;
    return new Date(`${full.slice(0, 4)}-${full.slice(4, 6)}-${full.slice(6, 8)}T${full.slice(8, 10)}:${full.slice(10, 12)}:${full.slice(12, 14)}Z`);
  }

  //#endregion

  //#region PEM

  export function toPem(label: string, der: Uint8Array) {
    let binary = "";
    for (const byte of der) binary += String.fromCharCode(byte);
    const base64 = btoa(binary).replace(/(.{64})/g, "$1\n").trimEnd();
    return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
  }

  /**
   * Every block with `label` in a PEM text, in order (a certificate chain has several).
   */
  export function fromPem(pem: string, label: string): Uint8Array[] {
    const blocks: Uint8Array[] = [];
    const pattern = new RegExp(`-----BEGIN ${label}-----([\\s\\S]*?)-----END ${label}-----`, "g");
    for (const match of pem.matchAll(pattern)) {
      const binary = atob(match[1].replace(/\s+/g, ""));
      blocks.push(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    }
    return blocks;
  }

  //#endregion
}

export default Der;
