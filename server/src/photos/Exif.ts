import type { PhotoMeta } from "@shared/photos.ts";

/**
 * Reads what cameras and phones write into photos: when it was taken, the camera, exposure, place, and the size.
 * Understands JPEG, PNG, WebP, TIFF and HEIC/HEIF/AVIF by reading only the start of the file (and the EXIF block of
 * a HEIC, wherever it is), so it's fast enough to run on every photo of a large library.
 */
export namespace Exif {
  /**
   * EXIF values by tag number, from IFD0, the EXIF IFD and the GPS IFD (GPS tags are offset by `GPS_BASE` so they
   * don't clash with the others).
   */
  export type Tags = Map<number, Value>;
  type Value = string | number[] | Uint8Array;

  const HEAD_BYTES = 512 * 1024;
  const MAX_EXIF_BYTES = 4 * 1024 * 1024;
  const GPS_BASE = 0x10000;
  // Byte sizes of the TIFF field types: BYTE, ASCII, SHORT, LONG, RATIONAL, SBYTE, UNDEFINED, SSHORT, SLONG, SRATIONAL
  const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8 };

  const TAG = {
    IMAGE_WIDTH: 0x0100,
    IMAGE_HEIGHT: 0x0101,
    MAKE: 0x010F,
    MODEL: 0x0110,
    ORIENTATION: 0x0112,
    DATE_TIME: 0x0132,
    EXIF_IFD: 0x8769,
    GPS_IFD: 0x8825,
    EXPOSURE_TIME: 0x829A,
    F_NUMBER: 0x829D,
    ISO: 0x8827,
    DATE_TIME_ORIGINAL: 0x9003,
    DATE_TIME_DIGITIZED: 0x9004,
    OFFSET_TIME_ORIGINAL: 0x9011,
    FOCAL_LENGTH: 0x920A,
    PIXEL_WIDTH: 0xA002,
    PIXEL_HEIGHT: 0xA003,
    LENS_MODEL: 0xA434,
    GPS_LATITUDE_REF: GPS_BASE + 1,
    GPS_LATITUDE: GPS_BASE + 2,
    GPS_LONGITUDE_REF: GPS_BASE + 3,
    GPS_LONGITUDE: GPS_BASE + 4,
  } as const;

  /**
   * What the file says, plus its stored size and orientation, before anything is turned upright.
   */
  interface Found {
    tags: Tags;
    width: number | null;
    height: number | null;
    /**
     * Quarter turns from HEIF's own rotation box, which wins over the EXIF orientation in those files.
     */
    heifTurns: number | null;
  }

  /**
   * Read a photo's details. Never throws: a file it can't read gives a `PhotoMeta` with only `orientation` set.
   */
  export async function read(path: string): Promise<PhotoMeta> {
    let found: Found = { tags: new Map(), width: null, height: null, heifTurns: null };
    try {
      using file = await Deno.open(path, { read: true });
      const head = await readAt(file, 0, HEAD_BYTES);
      found = await parse(head, (offset, length) => readAt(file, offset, Math.min(length, MAX_EXIF_BYTES)));
    } catch {
      // Unreadable or unknown: the scan falls back to the file name and date
    }
    return toMeta(found);
  }

  async function readAt(file: Deno.FsFile, offset: number, length: number) {
    await file.seek(offset, Deno.SeekMode.Start);
    const buffer = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const read = await file.read(buffer.subarray(filled));
      if (read === null || read === 0) break;
      filled += read;
    }
    return buffer.subarray(0, filled);
  }

  /**
   * Find the EXIF block and size in the start of a file.
   * @param readMore Reads bytes further into the file, for HEIC files whose EXIF sits past the start.
   */
  export async function parse(head: Uint8Array, readMore?: (offset: number, length: number) => Promise<Uint8Array>): Promise<Found> {
    const none: Found = { tags: new Map(), width: null, height: null, heifTurns: null };
    if (head.length < 12) return none;
    if (head[0] === 0xFF && head[1] === 0xD8) return fromJpeg(head);
    if (ascii(head, 0, 8) === "\x89PNG\r\n\x1a\n") return fromPng(head);
    if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return fromWebp(head);
    if (ascii(head, 0, 2) === "II" || ascii(head, 0, 2) === "MM") {
      const tags = parseTiff(head);
      return { ...none, tags, width: firstNumber(tags.get(TAG.IMAGE_WIDTH)), height: firstNumber(tags.get(TAG.IMAGE_HEIGHT)) };
    }
    if (ascii(head, 4, 4) === "ftyp") return await fromHeif(head, readMore);
    return none;
  }

  //#region Containers

  // Example: FF D8 | FF E1 <len> "Exif\0\0" <TIFF> | FF DB ... | FF C0 <len> <precision> <height> <width> ... | FF DA
  function fromJpeg(data: Uint8Array): Found {
    const found: Found = { tags: new Map(), width: null, height: null, heifTurns: null };
    let pos = 2;
    while (pos + 4 <= data.length) {
      if (data[pos] !== 0xFF) break;
      const marker = data[pos + 1];
      // Fill bytes and markers without a length
      if (marker === 0xFF) {
        pos++;
        continue;
      }
      if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
        pos += 2;
        continue;
      }
      const length = (data[pos + 2] << 8) | data[pos + 3];
      const start = pos + 4;
      if (marker === 0xE1 && ascii(data, start, 6) === "Exif\0\0" && found.tags.size === 0) {
        found.tags = parseTiff(data.subarray(start + 6, Math.min(pos + 2 + length, data.length)));
      }
      // Start-of-frame markers carry the size (C4, C8 and CC are other things)
      else if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC && start + 5 <= data.length) {
        found.height = (data[start + 1] << 8) | data[start + 2];
        found.width = (data[start + 3] << 8) | data[start + 4];
      }
      // The picture data comes next; everything we want is before it
      if (marker === 0xDA) break;
      pos += 2 + length;
    }
    return found;
  }

  // Example: 89 PNG | <len> "IHDR" <width> <height> ... | <len> "eXIf" <TIFF> | ... "IDAT"
  function fromPng(data: Uint8Array): Found {
    const found: Found = { tags: new Map(), width: null, height: null, heifTurns: null };
    const view = viewOf(data);
    let pos = 8;
    while (pos + 8 <= data.length) {
      const length = view.getUint32(pos);
      const type = ascii(data, pos + 4, 4);
      const start = pos + 8;
      if (type === "IHDR" && start + 8 <= data.length) {
        found.width = view.getUint32(start);
        found.height = view.getUint32(start + 4);
      }
      else if (type === "eXIf") found.tags = parseTiff(data.subarray(start, Math.min(start + length, data.length)));
      else if (type === "IEND") break;
      pos = start + length + 4;
    }
    return found;
  }

  // Example: "RIFF" <size> "WEBP" | "VP8X" <len> <flags> <width-1 (24 bit)> <height-1> | ... | "EXIF" <len> <TIFF>
  function fromWebp(data: Uint8Array): Found {
    const found: Found = { tags: new Map(), width: null, height: null, heifTurns: null };
    const view = viewOf(data);
    let pos = 12;
    while (pos + 8 <= data.length) {
      const type = ascii(data, pos, 4);
      const length = view.getUint32(pos + 4, true);
      const start = pos + 8;
      if (type === "VP8X" && start + 10 <= data.length) {
        found.width = 1 + (data[start + 4] | (data[start + 5] << 8) | (data[start + 6] << 16));
        found.height = 1 + (data[start + 7] | (data[start + 8] << 8) | (data[start + 9] << 16));
      }
      else if (type === "VP8 " && found.width === null && start + 10 <= data.length) {
        found.width = view.getUint16(start + 6, true) & 0x3FFF;
        found.height = view.getUint16(start + 8, true) & 0x3FFF;
      }
      else if (type === "VP8L" && found.width === null && start + 5 <= data.length) {
        const bits = view.getUint32(start + 1, true);
        found.width = (bits & 0x3FFF) + 1;
        found.height = ((bits >> 14) & 0x3FFF) + 1;
      }
      else if (type === "EXIF") {
        const block = data.subarray(start, Math.min(start + length, data.length));
        found.tags = parseTiff(ascii(block, 0, 6) === "Exif\0\0" ? block.subarray(6) : block);
      }
      // Chunks are padded to an even length
      pos = start + length + (length % 2);
    }
    return found;
  }

  interface Box {
    type: string;
    /**
     * Where the box's content starts and ends, in the buffer.
     */
    start: number;
    end: number;
  }

  function boxes(data: Uint8Array, start: number, end: number): Box[] {
    const view = viewOf(data);
    const result: Box[] = [];
    let pos = start;
    while (pos + 8 <= end) {
      let size = view.getUint32(pos);
      let header = 8;
      if (size === 1 && pos + 16 <= end) {
        size = Number(view.getBigUint64(pos + 8));
        header = 16;
      }
      else if (size === 0) size = end - pos;
      if (size < header) break;
      result.push({ type: ascii(data, pos + 4, 4), start: pos + header, end: Math.min(pos + size, end) });
      pos += size;
    }
    return result;
  }

  /**
   * HEIC, HEIF and AVIF: a `meta` box lists the items (the picture, its tiles, the EXIF block), where they are, and
   * their properties (size, rotation).
   */
  async function fromHeif(data: Uint8Array, readMore?: (offset: number, length: number) => Promise<Uint8Array>): Promise<Found> {
    const found: Found = { tags: new Map(), width: null, height: null, heifTurns: null };
    const view = viewOf(data);
    const meta = boxes(data, 0, data.length).find((b) => b.type === "meta");
    if (!meta) return found;
    // `meta` is a full box: version and flags come first
    const children = boxes(data, meta.start + 4, meta.end);
    const child = (type: string) => children.find((b) => b.type === type);

    let primary: number | null = null;
    const pitm = child("pitm");
    if (pitm) primary = data[pitm.start] === 0 ? view.getUint16(pitm.start + 4) : view.getUint32(pitm.start + 4);

    // Item types: the EXIF block is an item of type "Exif"
    let exifId: number | null = null;
    const iinf = child("iinf");
    if (iinf) {
      const countSize = data[iinf.start] === 0 ? 2 : 4;
      for (const infe of boxes(data, iinf.start + 4 + countSize, iinf.end)) {
        if (infe.type !== "infe") continue;
        const version = data[infe.start];
        if (version < 2) continue;
        const id = version === 2 ? view.getUint16(infe.start + 4) : view.getUint32(infe.start + 4);
        const typeAt = infe.start + 4 + (version === 2 ? 2 : 4) + 2;
        if (ascii(data, typeAt, 4) === "Exif") exifId = id;
      }
    }

    // Size and rotation of the primary picture
    const iprp = child("iprp");
    if (iprp && primary !== null) {
      const parts = boxes(data, iprp.start, iprp.end);
      const ipco = parts.find((b) => b.type === "ipco");
      const ipma = parts.find((b) => b.type === "ipma");
      if (ipco && ipma) {
        const properties = boxes(data, ipco.start, ipco.end);
        for (const index of associations(data, ipma, primary)) {
          const property = properties[index - 1];
          if (property?.type === "ispe") {
            found.width = view.getUint32(property.start + 4);
            found.height = view.getUint32(property.start + 8);
          }
          else if (property?.type === "irot") found.heifTurns = data[property.start] & 3;
        }
      }
    }

    // Where the EXIF block is in the file
    const iloc = child("iloc");
    const location = iloc && exifId !== null ? locate(data, iloc, exifId) : null;
    if (location) {
      let block: Uint8Array | null = null;
      if (location.inIdat) {
        const idat = child("idat");
        if (idat) block = data.subarray(idat.start + location.offset, idat.start + location.offset + location.length);
      }
      else if (location.offset + location.length <= data.length) block = data.subarray(location.offset, location.offset + location.length);
      else if (readMore) block = await readMore(location.offset, location.length);
      // The block starts with the offset of the TIFF header from just after these four bytes
      if (block && block.length > 4) {
        const skip = viewOf(block).getUint32(0);
        found.tags = parseTiff(block.subarray(4 + skip));
      }
    }
    return found;
  }

  /**
   * Property indexes (1-based) of `itemId` in an `ipma` box.
   */
  function associations(data: Uint8Array, ipma: Box, itemId: number) {
    const view = viewOf(data);
    const version = data[ipma.start];
    const wide = (data[ipma.start + 3] & 1) === 1;
    let pos = ipma.start + 4;
    const count = view.getUint32(pos);
    pos += 4;
    for (let i = 0; i < count && pos < ipma.end; i++) {
      const id = version < 1 ? view.getUint16(pos) : view.getUint32(pos);
      pos += version < 1 ? 2 : 4;
      const n = data[pos++];
      const indexes: number[] = [];
      for (let j = 0; j < n; j++) {
        indexes.push(wide ? view.getUint16(pos) & 0x7FFF : data[pos] & 0x7F);
        pos += wide ? 2 : 1;
      }
      if (id === itemId) return indexes;
    }
    return [];
  }

  /**
   * Where an item's data is, from an `iloc` box: a file offset, or an offset into the `idat` box.
   */
  function locate(data: Uint8Array, iloc: Box, itemId: number) {
    const view = viewOf(data);
    const version = data[iloc.start];
    let pos = iloc.start + 4;
    const offsetSize = data[pos] >> 4;
    const lengthSize = data[pos] & 15;
    const baseSize = data[pos + 1] >> 4;
    const indexSize = version === 1 || version === 2 ? data[pos + 1] & 15 : 0;
    pos += 2;
    const count = version < 2 ? view.getUint16(pos) : view.getUint32(pos);
    pos += version < 2 ? 2 : 4;
    const readSized = (size: number) => {
      const value = size === 8 ? Number(view.getBigUint64(pos)) : size === 4 ? view.getUint32(pos) : size === 2 ? view.getUint16(pos) : 0;
      pos += size;
      return value;
    };
    for (let i = 0; i < count && pos < iloc.end; i++) {
      const id = version < 2 ? view.getUint16(pos) : view.getUint32(pos);
      pos += version < 2 ? 2 : 4;
      const method = version === 1 || version === 2 ? view.getUint16(pos) & 15 : 0;
      if (version === 1 || version === 2) pos += 2;
      pos += 2; // data_reference_index
      const base = readSized(baseSize);
      const extents = view.getUint16(pos);
      pos += 2;
      let first: { offset: number; length: number } | null = null;
      for (let j = 0; j < extents; j++) {
        readSized(indexSize);
        const offset = readSized(offsetSize);
        const length = readSized(lengthSize);
        first ??= { offset, length };
      }
      if (id === itemId && first && method <= 1) return { offset: base + first.offset, length: first.length, inIdat: method === 1 };
    }
    return null;
  }
  //#endregion

  //#region TIFF

  /**
   * Read the tags of a TIFF structure (an EXIF block is one): IFD0, the EXIF IFD and the GPS IFD.
   */
  export function parseTiff(data: Uint8Array): Tags {
    const tags: Tags = new Map();
    if (data.length < 8) return tags;
    const order = ascii(data, 0, 2);
    if (order !== "II" && order !== "MM") return tags;
    const le = order === "II";
    const view = viewOf(data);
    if (view.getUint16(2, le) !== 42) return tags;

    const readIfd = (offset: number, base: number) => {
      if (offset < 8 || offset + 2 > data.length) return;
      const count = Math.min(view.getUint16(offset, le), 512);
      for (let i = 0; i < count; i++) {
        const entry = offset + 2 + i * 12;
        if (entry + 12 > data.length) return;
        const tag = view.getUint16(entry, le);
        const type = view.getUint16(entry + 2, le);
        const n = view.getUint32(entry + 4, le);
        const size = (TYPE_SIZES[type] ?? 0) * n;
        if (size === 0 || size > 65536) continue;
        const at = size <= 4 ? entry + 8 : view.getUint32(entry + 8, le);
        if (at + size > data.length) continue;
        tags.set(base + tag, value(type, n, at));
      }
    };

    const value = (type: number, n: number, at: number): Value => {
      if (type === 2) return new TextDecoder().decode(data.subarray(at, at + n)).replace(/\0[\s\S]*$/, "").trim();
      if (type === 1 || type === 6 || type === 7) return data.slice(at, at + n);
      const list: number[] = [];
      for (let i = 0; i < n; i++) {
        if (type === 3) list.push(view.getUint16(at + i * 2, le));
        else if (type === 8) list.push(view.getInt16(at + i * 2, le));
        else if (type === 4) list.push(view.getUint32(at + i * 4, le));
        else if (type === 9) list.push(view.getInt32(at + i * 4, le));
        else if (type === 5 || type === 10) {
          const signed = type === 10;
          const num = signed ? view.getInt32(at + i * 8, le) : view.getUint32(at + i * 8, le);
          const den = signed ? view.getInt32(at + i * 8 + 4, le) : view.getUint32(at + i * 8 + 4, le);
          list.push(den === 0 ? NaN : num / den);
        }
      }
      return list;
    };

    readIfd(view.getUint32(4, le), 0);
    const exifIfd = firstNumber(tags.get(TAG.EXIF_IFD));
    if (exifIfd) readIfd(exifIfd, 0);
    const gpsIfd = firstNumber(tags.get(TAG.GPS_IFD));
    if (gpsIfd) readIfd(gpsIfd, GPS_BASE);
    return tags;
  }
  //#endregion

  //#region Reading values

  /**
   * Turn what was found into a `PhotoMeta`, with the size as shown (after turning upright).
   */
  function toMeta(found: Found): PhotoMeta {
    const { tags } = found;
    const orientation = firstNumber(tags.get(TAG.ORIENTATION));
    let width = found.width ?? firstNumber(tags.get(TAG.PIXEL_WIDTH));
    let height = found.height ?? firstNumber(tags.get(TAG.PIXEL_HEIGHT));
    // HEIF turns the picture with its own box; elsewhere orientations 5 to 8 are a quarter turn
    const sideways = found.heifTurns !== null ? found.heifTurns % 2 === 1 : orientation !== null && orientation >= 5 && orientation <= 8;
    if (sideways) [width, height] = [height, width];

    const latitude = coordinate(tags.get(TAG.GPS_LATITUDE), tags.get(TAG.GPS_LATITUDE_REF), "S");
    const longitude = coordinate(tags.get(TAG.GPS_LONGITUDE), tags.get(TAG.GPS_LONGITUDE_REF), "W");
    return {
      width: width || null,
      height: height || null,
      orientation: found.heifTurns !== null ? 1 : orientation && orientation >= 1 && orientation <= 8 ? orientation : 1,
      takenAt: dateTime(tags.get(TAG.DATE_TIME_ORIGINAL)) ?? dateTime(tags.get(TAG.DATE_TIME_DIGITIZED)) ?? dateTime(tags.get(TAG.DATE_TIME)),
      offset: offset(tags.get(TAG.OFFSET_TIME_ORIGINAL)),
      camera: cameraName(text(tags.get(TAG.MAKE)), text(tags.get(TAG.MODEL))),
      lens: text(tags.get(TAG.LENS_MODEL)),
      fNumber: positive(tags.get(TAG.F_NUMBER)),
      exposureTime: positive(tags.get(TAG.EXPOSURE_TIME)),
      iso: positive(tags.get(TAG.ISO)),
      focalLength: positive(tags.get(TAG.FOCAL_LENGTH)),
      latitude: latitude !== null && latitude !== 0 && Math.abs(latitude) <= 90 ? latitude : null,
      longitude: longitude !== null && longitude !== 0 && Math.abs(longitude) <= 180 ? longitude : null,
    };
  }

  function firstNumber(value: Value | undefined): number | null {
    return Array.isArray(value) && value.length && Number.isFinite(value[0]) ? value[0] : null;
  }

  // Short exposures like 1/1200 s need the extra digits
  function positive(value: Value | undefined) {
    const n = firstNumber(value);
    return n !== null && n > 0 ? Math.round(n * 1e7) / 1e7 : null;
  }

  function text(value: Value | undefined) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  /**
   * EXIF dates look like "2024:07:13 14:32:10"; cameras that were never set write zeros or spaces.
   * @returns `YYYY-MM-DDTHH:MM:SS`, or `null` when it isn't a real date.
   */
  export function dateTime(value: Value | undefined): string | null {
    const match = typeof value === "string" ? value.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/) : null;
    if (!match) return null;
    const [, y, mo, d, h, mi, s] = match;
    const result = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
    return isRealDateTime(result) ? result : null;
  }

  /**
   * Whether `YYYY-MM-DDTHH:MM:SS` is a date that exists, from photography's first years on.
   */
  export function isRealDateTime(value: string) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return false;
    const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
    return y >= 1826 && date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && h < 24 && mi < 60 && s < 60;
  }

  function offset(value: Value | undefined) {
    return typeof value === "string" && /^[+-]\d{2}:\d{2}$/.test(value) ? value : null;
  }

  // Example: [37, 5, 22.56] with "N" -> 37.0896
  function coordinate(value: Value | undefined, ref: Value | undefined, negative: string): number | null {
    if (!Array.isArray(value) || value.length < 3 || value.some((v) => !Number.isFinite(v))) return null;
    const degrees = value[0] + value[1] / 60 + value[2] / 3600;
    const sign = typeof ref === "string" && ref.toUpperCase().startsWith(negative) ? -1 : 1;
    return Math.round(sign * degrees * 1e6) / 1e6;
  }

  /**
   * A camera name from the make and model: "Google" + "Pixel 8 Pro" is "Google Pixel 8 Pro", but "Canon" +
   * "Canon EOS R5" is just the model. Company words like "Corporation" are left out.
   */
  export function cameraName(make: string | null, model: string | null): string | null {
    const cleanMake = make?.replace(/[\s,]+(corporation|corp\.?|co\.?,?\s*ltd\.?|imaging corp\.?|company|electronics|inc\.?)$/i, "").trim() || null;
    if (!model) return cleanMake;
    if (!cleanMake) return model;
    const firstWord = cleanMake.split(/\s+/)[0].toLowerCase();
    return model.toLowerCase().startsWith(firstWord) ? model : `${cleanMake} ${model}`;
  }
  //#endregion

  function viewOf(data: Uint8Array) {
    return new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  function ascii(data: Uint8Array, start: number, length: number) {
    let result = "";
    for (let i = start; i < start + length && i < data.length; i++) result += String.fromCharCode(data[i]);
    return result;
  }
}

export default Exif;
