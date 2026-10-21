/**
 * Makes a small sample Photos library with ffmpeg: folders and subfolders as albums, photos with EXIF (dates,
 * cameras, GPS, a photo stored sideways), names that carry the date, a PNG screenshot, a HEIC when heif-enc is
 * there, a panorama, a phone video, and NAS thumbnail and hidden files that a scan must skip.
 *
 * Usage: deno run -A scripts/sample-photos.ts [FOLDER]   (default data/media/photos)
 * The EXIF writer is also used by server/src/test.ts.
 */
import fsp from "node:fs/promises";
import Path from "node:path";

export interface SampleExif {
  make?: string;
  model?: string;
  orientation?: number;
  /**
   * `YYYY:MM:DD HH:MM:SS`, like cameras write it.
   */
  taken?: string;
  offset?: string;
  exposure?: [number, number];
  fNumber?: [number, number];
  iso?: number;
  focalLength?: [number, number];
  lens?: string;
  /**
   * Decimal degrees; negative is south or west.
   */
  latitude?: number;
  longitude?: number;
}

type Entry = { tag: number; type: number; count: number; data: Uint8Array };

function ascii(text: string): Entry["data"] {
  return new TextEncoder().encode(`${text}\0`);
}

function u16(value: number) {
  return new Uint8Array([value >> 8, value & 255]);
}

function u32(value: number) {
  return new Uint8Array([value >>> 24, (value >> 16) & 255, (value >> 8) & 255, value & 255]);
}

function rationals(values: [number, number][]) {
  const out = new Uint8Array(values.length * 8);
  values.forEach(([num, den], i) => {
    out.set(u32(num), i * 8);
    out.set(u32(den), i * 8 + 4);
  });
  return out;
}

function dms(degrees: number): [number, number][] {
  const abs = Math.abs(degrees);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = Math.round(((abs - d) * 60 - m) * 60 * 100);
  return [[d, 1], [m, 1], [s, 100]];
}

/**
 * A big-endian TIFF block with IFD0, an EXIF IFD and a GPS IFD, as found in a JPEG's APP1 segment after "Exif\0\0".
 */
export function buildTiff(exif: SampleExif): Uint8Array {
  const ifd0: Entry[] = [];
  const exifIfd: Entry[] = [];
  const gps: Entry[] = [];
  if (exif.make) ifd0.push({ tag: 0x010F, type: 2, count: exif.make.length + 1, data: ascii(exif.make) });
  if (exif.model) ifd0.push({ tag: 0x0110, type: 2, count: exif.model.length + 1, data: ascii(exif.model) });
  if (exif.orientation) ifd0.push({ tag: 0x0112, type: 3, count: 1, data: new Uint8Array([...u16(exif.orientation), 0, 0]) });
  if (exif.exposure) exifIfd.push({ tag: 0x829A, type: 5, count: 1, data: rationals([exif.exposure]) });
  if (exif.fNumber) exifIfd.push({ tag: 0x829D, type: 5, count: 1, data: rationals([exif.fNumber]) });
  if (exif.iso) exifIfd.push({ tag: 0x8827, type: 3, count: 1, data: new Uint8Array([...u16(exif.iso), 0, 0]) });
  if (exif.taken) exifIfd.push({ tag: 0x9003, type: 2, count: 20, data: ascii(exif.taken) });
  if (exif.offset) exifIfd.push({ tag: 0x9011, type: 2, count: 7, data: ascii(exif.offset) });
  if (exif.focalLength) exifIfd.push({ tag: 0x920A, type: 5, count: 1, data: rationals([exif.focalLength]) });
  if (exif.lens) exifIfd.push({ tag: 0xA434, type: 2, count: exif.lens.length + 1, data: ascii(exif.lens) });
  if (exif.latitude !== undefined && exif.longitude !== undefined) {
    gps.push({ tag: 1, type: 2, count: 2, data: ascii(exif.latitude < 0 ? "S" : "N") });
    gps.push({ tag: 2, type: 5, count: 3, data: rationals(dms(exif.latitude)) });
    gps.push({ tag: 3, type: 2, count: 2, data: ascii(exif.longitude < 0 ? "W" : "E") });
    gps.push({ tag: 4, type: 5, count: 3, data: rationals(dms(exif.longitude)) });
  }

  // Lay out: header, IFD0, EXIF IFD, GPS IFD, then values that don't fit in 4 bytes
  const ifdSize = (entries: Entry[]) => 2 + entries.length * 12 + 4;
  const pointers = (exifIfd.length ? 1 : 0) + (gps.length ? 1 : 0);
  const ifd0Size = ifdSize(ifd0) + pointers * 12;
  const exifAt = 8 + ifd0Size;
  const gpsAt = exifAt + (exifIfd.length ? ifdSize(exifIfd) : 0);
  let dataAt = gpsAt + (gps.length ? ifdSize(gps) : 0);
  const chunks: Uint8Array[] = [];

  const write = (entries: Entry[], extra: Entry[]) => {
    const all = [...entries, ...extra].sort((a, b) => a.tag - b.tag);
    const out = new Uint8Array(ifdSize(all));
    out.set(u16(all.length), 0);
    all.forEach((e, i) => {
      const at = 2 + i * 12;
      out.set(u16(e.tag), at);
      out.set(u16(e.type), at + 2);
      out.set(u32(e.count), at + 4);
      if (e.data.length <= 4) out.set(e.data, at + 8);
      else {
        out.set(u32(dataAt), at + 8);
        chunks.push(e.data.length % 2 ? new Uint8Array([...e.data, 0]) : e.data);
        dataAt += e.data.length + (e.data.length % 2);
      }
    });
    return out;
  };

  const extra: Entry[] = [];
  if (exifIfd.length) extra.push({ tag: 0x8769, type: 4, count: 1, data: u32(exifAt) });
  if (gps.length) extra.push({ tag: 0x8825, type: 4, count: 1, data: u32(gpsAt) });
  const parts = [new Uint8Array([0x4D, 0x4D, 0, 42, 0, 0, 0, 8]), write(ifd0, extra)];
  if (exifIfd.length) parts.push(write(exifIfd, []));
  if (gps.length) parts.push(write(gps, []));
  parts.push(...chunks);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const tiff = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    tiff.set(part, pos);
    pos += part.length;
  }
  return tiff;
}

/**
 * A JPEG with an EXIF segment put in right after its start marker.
 */
export function withExif(jpeg: Uint8Array, exif: SampleExif): Uint8Array {
  const tiff = buildTiff(exif);
  const header = new TextEncoder().encode("Exif\0\0");
  const length = 2 + header.length + tiff.length;
  const segment = new Uint8Array([0xFF, 0xE1, length >> 8, length & 255, ...header, ...tiff]);
  return new Uint8Array([...jpeg.subarray(0, 2), ...segment, ...jpeg.subarray(2)]);
}

async function ffmpeg(args: string[]) {
  const result = await new Deno.Command("ffmpeg", { args: ["-loglevel", "error", "-y", ...args], stderr: "piped" }).output();
  if (!result.success) throw new Error(`ffmpeg failed: ${new TextDecoder().decode(result.stderr)}`);
}

/**
 * A made-up picture: a colour gradient (different per seed) with a label.
 */
async function picture(output: string, label: string, seed: number, width = 1600, height = 1200, exif?: SampleExif) {
  await fsp.mkdir(Path.dirname(output), { recursive: true });
  const colors = ["0x2b6cb0", "0xf6ad55", "0x38a169", "0xe53e3e", "0x805ad5", "0x319795", "0xd69e2e", "0x2c5282", "0xed64a6", "0x4a5568"];
  const c0 = colors[seed % colors.length];
  const c1 = colors[(seed * 3 + 1) % colors.length];
  const source = `gradients=s=${width}x${height}:c0=${c0}:c1=${c1}:seed=${seed}:duration=1:speed=0,drawtext=text='${label}':fontsize=${Math.round(height / 12)}:fontcolor=white:box=1:boxcolor=black@0.4:x=(w-text_w)/2:y=(h-text_h)/2`;
  const ext = Path.extname(output).toLowerCase();
  const temp = ext === ".jpg" ? `${output}.tmp.jpg` : output;
  await ffmpeg(["-f", "lavfi", "-i", source, "-frames:v", "1", "-update", "1", ...(ext === ".jpg" ? ["-q:v", "4"] : []), temp]);
  if (ext === ".jpg") {
    const bytes = await Deno.readFile(temp);
    await Deno.writeFile(output, exif ? withExif(bytes, exif) : bytes);
    await fsp.rm(temp);
  }
}

async function main() {
  const out = Path.resolve(Deno.args[0] ?? "data/media/photos");
  console.log(`Creating sample photos in ${out}...`);
  const pixel = { make: "Google", model: "Pixel 8 Pro", exposure: [1, 1200] as [number, number], fNumber: [17, 10] as [number, number], iso: 50, focalLength: [69, 10] as [number, number], lens: "Pixel 8 Pro back camera", offset: "+01:00" };
  const canon = { make: "Canon", model: "Canon EOS R5", exposure: [1, 160] as [number, number], fNumber: [28, 10] as [number, number], iso: 800, focalLength: [35, 1] as [number, number], lens: "RF35mm F1.8 MACRO IS STM" };
  const lisbon = { latitude: 38.7139, longitude: -9.1394 };
  const algarve = { latitude: 37.0896, longitude: -8.4127 };

  const holiday = Path.join(out, "Holiday 2024");
  await picture(Path.join(holiday, "Lisbon", "PXL_20240712_101503.jpg"), "Lisbon 1", 1, 1600, 1200, { ...pixel, ...lisbon, taken: "2024:07:12 11:15:03" });
  await picture(Path.join(holiday, "Lisbon", "PXL_20240712_102244.jpg"), "Lisbon 2", 2, 1600, 1200, { ...pixel, ...lisbon, taken: "2024:07:12 11:22:44" });
  // Stored sideways with orientation 6, like phones do: shows as a portrait photo
  await picture(Path.join(holiday, "Lisbon", "PXL_20240712_164010.jpg"), "Tram (upright)", 3, 1600, 1200, { ...pixel, ...lisbon, taken: "2024:07:12 17:40:10", orientation: 6 });
  await picture(Path.join(holiday, "Lisbon", "PXL_20240712_201502.jpg"), "Lisbon at night", 4, 1600, 1200, { ...pixel, ...lisbon, taken: "2024:07:12 21:15:02" });
  await picture(Path.join(holiday, "Algarve", "PXL_20240713_133210.jpg"), "Praia da Marinha", 5, 1600, 1200, { ...pixel, ...algarve, taken: "2024:07:13 14:32:10" });
  await picture(Path.join(holiday, "Algarve", "PXL_20240713_140112.jpg"), "Cliffs", 6, 1200, 1600, { ...pixel, ...algarve, taken: "2024:07:13 15:01:12" });
  await picture(Path.join(holiday, "Algarve", "PXL_20240714_090000.jpg"), "Breakfast", 7, 1600, 1200, { ...pixel, ...algarve, taken: "2024:07:14 10:00:00" });
  // A wide panorama
  await picture(Path.join(holiday, "Algarve", "PXL_20240714_191530.PANO.jpg"), "Sunset panorama", 8, 4000, 900, { ...pixel, ...algarve, taken: "2024:07:14 20:15:30" });
  // A phone video with its recording time
  await fsp.mkdir(Path.join(holiday, "Algarve"), { recursive: true });
  await ffmpeg([
    "-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30:duration=8,drawtext=text='Waves':fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2",
    "-f", "lavfi", "-i", "sine=frequency=330:duration=8",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-metadata", "creation_time=2024-07-13T14:40:00Z",
    Path.join(holiday, "Algarve", "PXL_20240713_144000.mp4"),
  ]);

  const party = Path.join(out, "Mira turns 8");
  await picture(Path.join(party, "IMG_0101.jpg"), "Cake", 9, 1600, 1067, { ...canon, taken: "2025:03:02 16:05:00" });
  await picture(Path.join(party, "IMG_0102.jpg"), "Candles", 10, 1600, 1067, { ...canon, taken: "2025:03:02 16:06:30" });
  await picture(Path.join(party, "IMG_0107.jpg"), "Presents", 11, 1067, 1600, { ...canon, taken: "2025:03:02 16:40:00" });
  // No EXIF: the date comes from the name
  await picture(Path.join(party, "Screenshot 2025-03-02 at 18.04.10.png"), "Video call with Gran", 12, 1170, 2532);

  // Loose photos in the library folder itself
  await picture(Path.join(out, "IMG_20261012_101500.jpg"), "Autumn walk", 13);
  await picture(Path.join(out, "IMG-20260930-WA0004.jpg"), "From the family chat", 14, 1280, 960);
  await picture(Path.join(out, "Snowman.jpg"), "Snowman", 15, 1600, 1200, { make: "Apple", model: "iPhone 13", taken: "2025:01:14 13:20:00", offset: "+01:00" });
  // A HEIC like iPhones take, made from a JPEG with EXIF so it keeps the date
  const heifEnc = await new Deno.Command("heif-enc", { args: ["--version"], stdout: "null", stderr: "null" }).output().then(() => true).catch(() => false);
  if (heifEnc) {
    const temp = Path.join(out, "heic-source.jpg");
    await picture(temp, "HEIC photo", 16, 1600, 1200, { make: "Apple", model: "iPhone 15", taken: "2025:05:20 19:45:00", offset: "+02:00", latitude: 52.3676, longitude: 4.9041 });
    await new Deno.Command("heif-enc", { args: ["-q", "70", "-o", Path.join(out, "IMG_4512.HEIC"), temp], stdout: "null", stderr: "null" }).output();
    await fsp.rm(temp);
  }
  else {
    console.log("heif-enc isn't installed, so there's no sample HEIC.");
  }

  // Must be skipped: a NAS thumbnail folder and a hidden file
  await picture(Path.join(out, "Holiday 2024", "@eaDir", "SYNOPHOTO_THUMB_XL.jpg"), "NAS thumbnail", 17, 320, 240);
  await picture(Path.join(out, ".hidden.jpg"), "Hidden", 18, 320, 240);
  console.log("Sample photos done.");
}

if (import.meta.main) await main();
