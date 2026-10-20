import fsp from "node:fs/promises";
import Path from "node:path";
import { encodeHex } from "@std/encoding/hex";
import { AVATAR_SIZES, type AvatarSize } from "@shared/profiles.ts";
import AppSystem from "../AppSystem.ts";
import Ffmpeg from "./Ffmpeg.ts";

/**
 * Stores profile pictures. Uploads are cropped to a square and saved in every size in `AVATAR_SIZES` as WebP.
 */
export namespace Avatars {
  export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
  const MAX_DIMENSION = 12000;

  export function pathFor(userId: number, version: string, size: AvatarSize) {
    return Path.join(AppSystem.avatarsDir, `${userId}-${version}-${size}.webp`);
  }

  /**
   * Process an uploaded image and store it for `userId`, replacing any earlier picture.
   * @returns The new picture's version, to store on the user.
   * @throws When the upload isn't a usable image.
   */
  export async function save(userId: number, bytes: Uint8Array): Promise<string> {
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("The picture is too large. The limit is 10 MB.");

    const tempFile = Path.join(AppSystem.tempDir, `avatar-${crypto.randomUUID()}`);
    await fsp.writeFile(tempFile, bytes);
    try {
      const probe = await Ffmpeg.probe(tempFile).catch(() => null);
      const image = probe?.streams.find((s) => s.codec_type === "video");
      if (!image?.width || !image?.height) throw new Error("That file isn't an image Cinemion can read. Try a JPG, PNG or WebP.");
      if (image.width > MAX_DIMENSION || image.height > MAX_DIMENSION) {
        throw new Error(`The picture is too large. Images can be at most ${MAX_DIMENSION} pixels wide or tall.`);
      }

      const version = encodeHex(crypto.getRandomValues(new Uint8Array(6)));
      for (const size of AVATAR_SIZES) {
        // Center-crop to a square in case the client didn't, then scale down
        const filter = `crop='min(iw,ih)':'min(iw,ih)',scale=${size}:${size}:flags=lanczos`;
        const result = await Ffmpeg.run(["-y", "-i", tempFile, "-vf", filter, "-frames:v", "1", "-c:v", "libwebp", "-quality", "85", pathFor(userId, version, size)]);
        if (result.code !== 0) throw new Error(`Could not convert the picture: ${result.stderr.trim()}`);
      }

      await removeExcept(userId, version);
      return version;
    } finally {
      await fsp.rm(tempFile, { force: true });
    }
  }

  /**
   * Delete every stored picture of `userId`.
   */
  export function remove(userId: number) {
    return removeExcept(userId, null);
  }

  async function removeExcept(userId: number, keepVersion: string | null) {
    const prefix = `${userId}-`;
    for (const file of await fsp.readdir(AppSystem.avatarsDir)) {
      if (file.startsWith(prefix) && (keepVersion === null || !file.startsWith(`${prefix}${keepVersion}-`))) {
        await fsp.rm(Path.join(AppSystem.avatarsDir, file), { force: true });
      }
    }
  }
}

export default Avatars;
