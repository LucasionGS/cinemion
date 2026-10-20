import fs from "node:fs";
import fsp from "node:fs/promises";
import Path from "node:path";
import type { HardwareAcceleration as Kind, HardwareDevice, HardwareTestResult, PlaybackSettings } from "@shared/playback.ts";
import { Setting } from "../models/index.ts";
import Ffmpeg from "../lib/Ffmpeg.ts";

/**
 * GPU video conversion: which devices exist, testing them, and the server's playback settings.
 */
export namespace HardwareAcceleration {
  export const DEFAULT_SETTINGS: PlaybackSettings = {
    hardwareAcceleration: "none",
    device: "/dev/dri/renderD128",
    hardwareDecodeCodecs: ["h264", "hevc", "vp9", "av1"],
    maxConversions: 4,
    preset: "balanced",
    toneMapping: true,
    remoteMaxBitrate: 8_000_000,
    allowRemoteConversion: true,
  };

  export async function settings(): Promise<PlaybackSettings> {
    return { ...DEFAULT_SETTINGS, ...await Setting.get<Partial<PlaybackSettings>>(Setting.Keys.PLAYBACK, {}) };
  }

  export async function saveSettings(next: PlaybackSettings) {
    await Setting.set(Setting.Keys.PLAYBACK, next);
  }

  /**
   * How to install the VA-API driver on this machine, for error messages.
   */
  function driverHint(vendor: string | null) {
    const intel = vendor === "0x8086";
    if (fs.existsSync("/etc/arch-release")) return intel ? "Install the driver with: sudo pacman -S intel-media-driver vpl-gpu-rt" : "Install the driver with: sudo pacman -S libva-mesa-driver";
    if (fs.existsSync("/etc/debian_version")) return intel ? "Install the driver with: sudo apt install intel-media-va-driver-non-free" : "Install the driver with: sudo apt install mesa-va-drivers";
    return "Install the VA-API driver for your GPU.";
  }

  async function vendorOf(renderNode: string) {
    const name = Path.basename(renderNode);
    return (await fsp.readFile(`/sys/class/drm/${name}/device/vendor`, "utf8").catch(() => "")).trim() || null;
  }

  /**
   * GPUs this machine (or container) can see, and which conversion methods could use them.
   */
  export async function detect(): Promise<HardwareDevice[]> {
    const devices: HardwareDevice[] = [];
    const nodes = (await fsp.readdir("/dev/dri").catch(() => [] as string[])).filter((n) => n.startsWith("renderD")).map((n) => `/dev/dri/${n}`);

    for (const node of nodes) {
      const vendor = await vendorOf(node);
      const name = vendor === "0x8086" ? "Intel" : vendor === "0x1002" ? "AMD" : vendor === "0x10de" ? "NVIDIA" : "GPU";
      devices.push({ kind: "vaapi", label: `VA-API (${name})`, device: node, available: true, detail: `${name} graphics on ${node}` });
      if (vendor === "0x8086") devices.push({ kind: "qsv", label: "Intel Quick Sync", device: node, available: true, detail: `Intel graphics on ${node}` });
    }
    if (nodes.length === 0) {
      devices.push({ kind: "vaapi", label: "VA-API", device: null, available: false, detail: "No GPU found. In Docker, pass it in with --device /dev/dri." });
      devices.push({ kind: "qsv", label: "Intel Quick Sync", device: null, available: false, detail: "No Intel GPU found." });
    }

    const nvidia = fs.existsSync("/dev/nvidia0") || fs.existsSync("/dev/nvidiactl");
    devices.push({
      kind: "nvenc",
      label: "NVIDIA NVENC",
      device: null,
      available: nvidia,
      detail: nvidia ? "NVIDIA GPU found" : "No NVIDIA GPU found. In Docker it needs the NVIDIA container runtime.",
    });
    return devices;
  }

  /**
   * ffmpeg options that open the hardware device for `kind`.
   */
  export function deviceArgs(kind: Kind, device: string): string[] {
    switch (kind) {
      case "vaapi":
        return ["-init_hw_device", `vaapi=hw:${device}`, "-filter_hw_device", "hw"];
      case "qsv":
        return ["-init_hw_device", `qsv=hw:${device}`, "-filter_hw_device", "hw"];
      case "nvenc":
        return ["-init_hw_device", "cuda=hw", "-filter_hw_device", "hw"];
      default:
        return [];
    }
  }

  /**
   * The H.264 encoder for `kind`.
   */
  export function encoder(kind: Kind) {
    return { none: "libx264", vaapi: "h264_vaapi", qsv: "h264_qsv", nvenc: "h264_nvenc" }[kind];
  }

  /**
   * Filters that move software frames onto the GPU for the encoder. Empty for software and NVENC,
   * which take ordinary frames.
   */
  export function uploadFilters(kind: Kind) {
    switch (kind) {
      case "vaapi":
        return ["format=nv12", "hwupload"];
      case "qsv":
        return ["format=nv12", "hwupload=extra_hw_frames=64", "format=qsv"];
      default:
        return ["format=yuv420p"];
    }
  }

  /**
   * Convert a few seconds of 1080p test video with `kind` and report how fast it went.
   */
  export async function test(kind: Kind, device: string): Promise<HardwareTestResult> {
    const seconds = 5;
    const args = [
      ...deviceArgs(kind, device),
      "-f", "lavfi", "-i", `testsrc2=size=1920x1080:rate=24:duration=${seconds}`,
      "-vf", [...uploadFilters(kind)].join(","),
      "-c:v", encoder(kind), "-b:v", "8M",
      "-f", "null", "-",
    ];
    const started = performance.now();
    const result = await Ffmpeg.run(args).catch((error: Error) => ({ code: 1, stderr: error.message, stdout: new Uint8Array() }));
    const elapsed = (performance.now() - started) / 1000;

    if (result.code !== 0) {
      const stderr = result.stderr.trim();
      let message = `The test conversion failed: ${stderr.split("\n").pop()}`;
      if (/VAAPI|libva|vaInitialize/i.test(stderr)) message = `The GPU's video driver couldn't be loaded. ${driverHint(await vendorOf(device))}`;
      else if (/permission denied/i.test(stderr)) message = `Cinemion isn't allowed to use ${device}. Add its user to the "render" and "video" groups.`;
      else if (/cuda|nvenc/i.test(stderr)) message = "NVENC couldn't be used. Check the NVIDIA driver (and the NVIDIA container runtime in Docker).";
      return { ok: false, speed: null, message };
    }
    const speed = Math.round((seconds / elapsed) * 10) / 10;
    return { ok: true, speed, message: `Converted ${seconds} s of 1080p video in ${elapsed.toFixed(1)} s (${speed}× real time).` };
  }
}

export default HardwareAcceleration;
