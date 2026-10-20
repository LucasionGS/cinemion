import fsp from "node:fs/promises";
import Path from "node:path";
import os from "node:os";
import type { SystemStats as Stats } from "@shared/admin.ts";
import type { HardwareAcceleration as Kind } from "@shared/playback.ts";

/**
 * CPU, memory, GPU and disk usage for the dashboard. Linux gives the most detail; elsewhere some parts are `null`.
 */
export namespace SystemStats {
  interface CpuSample {
    busy: number;
    total: number;
    at: number;
  }

  interface GpuIdleSample {
    idleMs: number;
    at: number;
  }

  let _lastCpu: CpuSample | null = null;
  let _lastCpuUsage: number | null = null;
  const _lastGpuIdle = new Map<string, GpuIdleSample>();
  let _storage: { key: string; value: Stats["storage"]; at: number } | null = null;
  const STORAGE_CACHE_MS = 60_000;

  // Example first line of /proc/stat:
  // cpu  119155 268351 42133 4480212 7320 17742 7649 0 0 0
  export function parseProcStat(text: string): Omit<CpuSample, "at"> | null {
    const line = text.split("\n").find((l) => l.startsWith("cpu "));
    if (!line) return null;
    const values = line.trim().split(/\s+/).slice(1).map(Number);
    if (values.length < 4 || values.some((v) => !Number.isFinite(v))) return null;
    // Guest time is already counted in user time
    const total = values.slice(0, 8).reduce((a, b) => a + b, 0);
    const idle = values[3] + (values[4] ?? 0);
    return { busy: total - idle, total };
  }

  async function readCpu(): Promise<CpuSample | null> {
    const text = await fsp.readFile("/proc/stat", "utf8").catch(() => null);
    const sample = text ? parseProcStat(text) : null;
    return sample ? { ...sample, at: Date.now() } : null;
  }

  /**
   * CPU use since the last call, or over a short moment when there was no recent call.
   */
  async function cpuUsage(): Promise<number | null> {
    let previous = _lastCpu;
    if (!previous || Date.now() - previous.at > 30_000) {
      previous = await readCpu();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const current = await readCpu();
    if (!previous || !current) {
      // No /proc (Windows, macOS): the load average is the closest thing
      const load = os.loadavg()[0];
      return load > 0 ? Math.min(1, load / os.cpus().length) : null;
    }
    // Calls closer together than the kernel's tick give nothing new; keep the last answer
    if (current.total - previous.total < 10 && _lastCpuUsage !== null) return _lastCpuUsage;
    _lastCpu = current;
    const total = current.total - previous.total;
    _lastCpuUsage = total > 0 ? Math.max(0, Math.min(1, (current.busy - previous.busy) / total)) : null;
    return _lastCpuUsage;
  }

  function memory(): Stats["memory"] {
    try {
      const info = Deno.systemMemoryInfo();
      return { used: info.total - info.available, total: info.total };
    } catch {
      return null;
    }
  }

  async function run(command: string, args: string[]) {
    const result = await new Deno.Command(command, { args, stdout: "piped", stderr: "null" }).output().catch(() => null);
    return result?.success ? new TextDecoder().decode(result.stdout) : null;
  }

  async function nvidia(): Promise<{ name: string; usage: number | null } | null> {
    // Example: NVIDIA GeForce RTX 4070, 37, 13
    const out = await run("nvidia-smi", ["--query-gpu=name,utilization.gpu,utilization.encoder", "--format=csv,noheader,nounits"]);
    const [name, gpu, encoder] = out?.split("\n")[0]?.split(",").map((s) => s.trim()) ?? [];
    if (!name) return null;
    const usage = Math.max(Number(gpu), Number(encoder));
    return { name: name.replace(/^NVIDIA\s+/, ""), usage: Number.isFinite(usage) ? usage / 100 : null };
  }

  /**
   * Intel drivers report how long the GPU has been idle; usage is the rest of the time since the last look.
   */
  async function intelUsage(deviceDir: string): Promise<number | null> {
    const cards = (await fsp.readdir(Path.join(deviceDir, "drm")).catch(() => [] as string[])).filter((n) => n.startsWith("card"));
    const candidates = [
      ...cards.map((card) => Path.join(deviceDir, "drm", card, "gt", "gt0", "rc6_residency_ms")), // i915
      Path.join(deviceDir, "tile0", "gt0", "gtidle", "idle_residency_ms"), // xe
    ];
    for (const file of candidates) {
      const idleMs = Number((await fsp.readFile(file, "utf8").catch(() => "")).trim());
      if (!idleMs) continue;
      const previous = _lastGpuIdle.get(file);
      const now = Date.now();
      _lastGpuIdle.set(file, { idleMs, at: now });
      if (!previous || now - previous.at > 60_000 || now === previous.at) return null;
      return Math.max(0, Math.min(1, 1 - (idleMs - previous.idleMs) / (now - previous.at)));
    }
    return null;
  }

  async function gpu(kind: Kind, device: string, conversions: number): Promise<Stats["gpu"]> {
    if (kind === "none") return null;
    if (kind === "nvenc") {
      const info = await nvidia();
      return { name: info?.name ?? "NVIDIA", usage: info?.usage ?? null, conversions };
    }

    const deviceDir = Path.join("/sys/class/drm", Path.basename(device), "device");
    const vendor = (await fsp.readFile(Path.join(deviceDir, "vendor"), "utf8").catch(() => "")).trim();
    if (vendor === "0x1002") {
      const busy = Number((await fsp.readFile(Path.join(deviceDir, "gpu_busy_percent"), "utf8").catch(() => "")).trim());
      return { name: "AMD", usage: Number.isFinite(busy) && busy >= 0 ? busy / 100 : null, conversions };
    }
    if (vendor === "0x8086") return { name: "Intel", usage: await intelUsage(deviceDir), conversions };
    if (vendor === "0x10de") {
      const info = await nvidia();
      return { name: info?.name ?? "NVIDIA", usage: info?.usage ?? null, conversions };
    }
    return { name: "GPU", usage: null, conversions };
  }

  // Example output of df -P -k:
  // Filesystem     1024-blocks       Used Available Capacity Mounted on
  // /dev/nvme1n1p2  1921208612 1654136812 169405956      91% /
  export function parseDf(text: string): Stats["storage"] {
    const drives = new Map<string, { used: number; total: number; mount: string }>();
    for (const line of text.split("\n").slice(1)) {
      const match = line.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/);
      if (!match) continue;
      const [, filesystem, , used, available, mount] = match;
      // Reserved blocks count as neither used nor available, so the total is what's actually usable
      drives.set(`${filesystem} ${mount}`, { used: Number(used) * 1024, total: (Number(used) + Number(available)) * 1024, mount: mount.trim() });
    }
    if (drives.size === 0) return null;
    const list = [...drives.values()];
    return { used: list.reduce((a, d) => a + d.used, 0), total: list.reduce((a, d) => a + d.total, 0), mounts: list.map((d) => d.mount) };
  }

  async function storage(paths: string[]): Promise<Stats["storage"]> {
    const key = paths.join("\n");
    if (_storage && _storage.key === key && Date.now() - _storage.at < STORAGE_CACHE_MS) return _storage.value;
    const existing: string[] = [];
    for (const path of paths) {
      if (await fsp.stat(path).then(() => true).catch(() => false)) existing.push(path);
    }
    const out = existing.length > 0 ? await run("df", ["-P", "-k", ...existing]) : null;
    const value = out ? parseDf(out) : null;
    _storage = { key, value, at: Date.now() };
    return value;
  }

  /**
   * Everything the dashboard tiles show.
   * @param mediaPaths Folders of the libraries, for the storage tile.
   */
  export async function read(opts: { mediaPaths: string[]; hardware: Kind; device: string; conversions: number }): Promise<Stats> {
    const [usage, gpuStats, storageStats] = await Promise.all([
      cpuUsage(),
      gpu(opts.hardware, opts.device, opts.conversions),
      storage(opts.mediaPaths),
    ]);
    return {
      cpu: { usage, cores: navigator.hardwareConcurrency || os.cpus().length },
      memory: memory(),
      gpu: gpuStats,
      storage: storageStats,
    };
  }
}

export default SystemStats;
