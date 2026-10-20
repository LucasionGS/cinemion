import fs from "node:fs";
import AppSystem from "../AppSystem.ts";

/**
 * Runs the ffmpeg and ffprobe binaries.
 */
export namespace Ffmpeg {
  export interface RunResult {
    code: number;
    stdout: Uint8Array;
    stderr: string;
  }

  export interface ProbeStream {
    index: number;
    codec_type: "video" | "audio" | "subtitle" | "attachment" | "data";
    codec_name?: string;
    width?: number;
    height?: number;
  }

  export interface ProbeResult {
    streams: ProbeStream[];
    format: {
      format_name: string;
      duration?: string;
      size?: string;
    };
  }

  async function exec(binary: string, args: string[]): Promise<RunResult> {
    try {
      const output = await new Deno.Command(binary, { args, stdin: "null", stdout: "piped", stderr: "piped" }).output();
      return { code: output.code, stdout: output.stdout, stderr: new TextDecoder().decode(output.stderr) };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(`Could not find "${binary}". ${installHint()}`);
      }
      throw error;
    }
  }

  /**
   * How to get ffmpeg on this machine, for error messages.
   */
  export function installHint() {
    if (fs.existsSync("/etc/arch-release")) return "Install it with: sudo pacman -S ffmpeg";
    if (fs.existsSync("/etc/debian_version")) return "Install it with: sudo apt install ffmpeg";
    return "Install ffmpeg, or set FFMPEG_PATH and FFPROBE_PATH to where it is installed.";
  }

  /**
   * Run ffmpeg with `args`. `-hide_banner` and `-loglevel error` are added in front.
   */
  export function run(args: string[]) {
    return exec(AppSystem.config.FFMPEG_PATH, ["-hide_banner", "-loglevel", "error", ...args]);
  }

  /**
   * Read the streams and container info of a media file.
   * @throws When the file can't be read as media.
   */
  export async function probe(path: string): Promise<ProbeResult> {
    const result = await exec(AppSystem.config.FFPROBE_PATH, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path]);
    if (result.code !== 0) throw new Error(`Could not read the file as media: ${result.stderr.trim() || `ffprobe exited with ${result.code}`}`);
    return JSON.parse(new TextDecoder().decode(result.stdout));
  }

  /**
   * Get the installed ffmpeg version, or `null` when ffmpeg can't be run.
   */
  export async function version(): Promise<string | null> {
    try {
      const result = await exec(AppSystem.config.FFMPEG_PATH, ["-version"]);
      return new TextDecoder().decode(result.stdout).match(/ffmpeg version (\S+)/)?.[1] ?? null;
    } catch {
      return null;
    }
  }
}

export default Ffmpeg;
