import fs from "node:fs";
import fsp from "node:fs/promises";
import Path from "node:path";
import os from "node:os";
import { encodeHex } from "@std/encoding/hex";

function env(key: string, fallback: string): string {
  const value = Deno.env.get(key);
  return value === undefined || value === "" ? fallback : value;
}

/**
 * App-wide constants, configuration and data folders.
 */
export namespace AppSystem {
  export const APP_NAME = "Cinemion";
  export const VERSION = "0.1.0";
  /**
   * When this server process started, for the dashboard's uptime.
   */
  export const startedAt = new Date();

  /**
   * `true` when running inside the official Docker image.
   */
  export const isDocker = Deno.env.get("CINEMION_DOCKER") === "1";

  function defaultConfigDir() {
    if (isDocker) return "/config";
    if (os.platform() === "win32") return Path.join(Deno.env.get("APPDATA") ?? os.homedir(), APP_NAME);
    // A system service running as root keeps its data in a system path
    if (os.platform() === "linux" && Deno.uid?.() === 0) return "/var/lib/cinemion";
    return Path.join(os.homedir(), ".cinemion");
  }

  const configDir = Path.resolve(env("CONFIG_DIR", defaultConfigDir()));

  export const config = {
    PORT: parseInt(env("PORT", "8600")),
    SITE_URL: env("SITE_URL", ""),
    APP_ENV: env("APP_ENV", "production"),
    VITE_DEV_URL: env("VITE_DEV_URL", "http://localhost:5173"),

    CONFIG_DIR: configDir,
    CACHE_DIR: Path.resolve(env("CACHE_DIR", isDocker ? "/cache" : Path.join(configDir, "cache"))),
    MEDIA_ROOTS: env("MEDIA_ROOTS", isDocker ? "/media" : os.homedir()).split(Path.delimiter).filter(Boolean).map((p) => Path.resolve(p)),

    DB_DIALECT: env("DB_DIALECT", "sqlite") as "sqlite" | "mariadb",
    DB_HOST: env("DB_HOST", "localhost"),
    DB_PORT: parseInt(env("DB_PORT", "3306")),
    DB_NAME: env("DB_NAME", "cinemion"),
    DB_USER: env("DB_USER", "cinemion"),
    DB_PASSWORD: env("DB_PASSWORD", ""),
    AUTO_MIGRATE: env("AUTO_MIGRATE", "true") === "true",

    JWT_SECRET: env("JWT_SECRET", ""),

    FFMPEG_PATH: env("FFMPEG_PATH", "ffmpeg"),
    FFPROBE_PATH: env("FFPROBE_PATH", "ffprobe"),
  };

  /**
   * Profile pictures, in every stored size.
   */
  export const avatarsDir = Path.join(config.CONFIG_DIR, "avatars");
  /**
   * Artwork for movies, shows and people, as downloaded plus resized copies.
   */
  export const imagesDir = Path.join(config.CONFIG_DIR, "metadata", "images");
  /**
   * Scratch space for uploads being processed.
   */
  export const tempDir = Path.join(config.CACHE_DIR, "tmp");
  /**
   * The SQLite database file, when `DB_DIALECT=sqlite`.
   */
  export const databaseFile = Path.join(config.CONFIG_DIR, "cinemion.db");
  /**
   * The built web client. Inside a compiled binary this resolves to the embedded copy.
   */
  export const clientDir = Path.resolve(import.meta.dirname!, "../../client/dist");

  let _jwtSecret = config.JWT_SECRET;

  export function isDev() {
    return config.APP_ENV === "development";
  }

  /**
   * Secret used to sign login tokens.
   */
  export function jwtSecret() {
    return _jwtSecret;
  }

  /**
   * Create the data folders and load or generate the token secret. Call once at startup.
   */
  export async function init() {
    for (const dir of [config.CONFIG_DIR, config.CACHE_DIR, avatarsDir, imagesDir, tempDir]) {
      await fsp.mkdir(dir, { recursive: true });
    }

    if (!_jwtSecret) {
      // Generated once and kept, so sign-ins survive restarts without any configuration
      const secretFile = Path.join(config.CONFIG_DIR, "secret.key");
      if (fs.existsSync(secretFile)) {
        _jwtSecret = (await fsp.readFile(secretFile, "utf8")).trim();
      }
      else {
        _jwtSecret = encodeHex(crypto.getRandomValues(new Uint8Array(32)));
        await fsp.writeFile(secretFile, _jwtSecret, { mode: 0o600 });
      }
    }
  }
}

export default AppSystem;
