import fs from "node:fs";
import Path from "node:path";
import type { InstallKind, ReleaseInfo, UpdateInfo } from "@shared/admin.ts";
import AppSystem from "../AppSystem.ts";
import { Activity, Setting } from "../models/index.ts";
import { errorMessage } from "./http.ts";
import log from "./Logger.ts";

/**
 * Looks on GitHub for a newer Cinemion now and then, so people who manage the server can be told about it. It only
 * reads the newest release's number; nothing about the server is sent, and nothing is downloaded or installed.
 */
export namespace UpdateCheck {
  /**
   * Drafts and prereleases are left out of this one.
   */
  const LATEST_RELEASE_URL = "https://api.github.com/repos/LucasionGS/cinemion/releases/latest";
  const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
  const FIRST_CHECK_MS = 60 * 1000;
  const TIMER_MS = 60 * 60 * 1000;
  const TIMEOUT_MS = 15_000;

  /**
   * What's kept between restarts, so the notice shows right away and GitHub isn't asked on every start.
   */
  interface Stored {
    enabled: boolean;
    latest: ReleaseInfo | null;
    checkedAt: string | null;
    error: string | null;
    /**
     * The newest version already put in the activity feed, so each release is mentioned once.
     */
    announced: string | null;
  }

  const DEFAULTS: Stored = { enabled: true, latest: null, checkedAt: null, error: null, announced: null };

  let _firstTimer: ReturnType<typeof setTimeout> | null = null;
  let _timer: ReturnType<typeof setInterval> | null = null;
  let _checking: Promise<UpdateInfo> | null = null;

  async function stored(): Promise<Stored> {
    return { ...DEFAULTS, ...await Setting.get<Partial<Stored>>(Setting.Keys.UPDATES, {}) };
  }

  async function store(changes: Partial<Stored>) {
    await Setting.set(Setting.Keys.UPDATES, { ...await stored(), ...changes });
  }

  /**
   * Check soon after startup, then every 12 hours while the check is on.
   */
  export function start() {
    _firstTimer = setTimeout(() => checkIfDue(), FIRST_CHECK_MS);
    _timer = setInterval(() => checkIfDue(), TIMER_MS);
  }

  export function stop() {
    if (_firstTimer !== null) clearTimeout(_firstTimer);
    if (_timer !== null) clearInterval(_timer);
    _firstTimer = _timer = null;
  }

  async function checkIfDue() {
    const state = await stored();
    if (!state.enabled || !AppSystem.config.UPDATE_CHECK) return;
    if (state.checkedAt && Date.now() - Date.parse(state.checkedAt) < CHECK_EVERY_MS) return;
    await check();
  }

  /**
   * Ask GitHub for the newest release now. A failed check is kept as `error` rather than thrown.
   */
  export function check(): Promise<UpdateInfo> {
    _checking ??= (async () => {
      try {
        const latest = await fetchLatest();
        const state = await stored();
        await store({ latest, checkedAt: new Date().toISOString(), error: null });
        if (latest && isNewer(latest.version, AppSystem.VERSION) && state.announced !== latest.version) {
          await store({ announced: latest.version });
          log.info(`Cinemion ${latest.version} is out`, { current: AppSystem.VERSION, url: latest.url });
          await Activity.record("update", `Cinemion ${latest.version} is out. This server has ${AppSystem.VERSION}.`);
        }
      } catch (error) {
        log.warn("Could not check for a new Cinemion", { error: errorMessage(error) });
        await store({ checkedAt: new Date().toISOString(), error: errorMessage(error) });
      }
      return await info();
    })().finally(() => _checking = null);
    return _checking;
  }

  async function fetchLatest(): Promise<ReleaseInfo | null> {
    const res = await fetch(LATEST_RELEASE_URL, {
      headers: { "Accept": "application/vnd.github+json", "User-Agent": AppSystem.APP_NAME },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // No releases yet
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) throw new Error("GitHub asked to slow down. Cinemion tries again later.");
    if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}.`);
    const release = await res.json() as { tag_name?: string; html_url?: string; published_at?: string };
    const version = release.tag_name ? parseVersion(release.tag_name) : null;
    if (!version) throw new Error(`The newest release has a name Cinemion doesn't understand: ${release.tag_name}`);
    return {
      version: release.tag_name!.replace(/^v/, ""),
      url: release.html_url ?? "https://github.com/LucasionGS/cinemion/releases",
      publishedAt: release.published_at ?? new Date().toISOString(),
    };
  }

  export async function info(): Promise<UpdateInfo> {
    const state = await stored();
    const enabled = state.enabled && AppSystem.config.UPDATE_CHECK;
    return {
      current: AppSystem.VERSION,
      latest: state.latest,
      available: enabled && !!state.latest && isNewer(state.latest.version, AppSystem.VERSION),
      enabled,
      disabledByEnv: !AppSystem.config.UPDATE_CHECK,
      checkedAt: state.checkedAt,
      error: state.error,
      install: installKind(),
    };
  }

  /**
   * Turn the check on or off. Turning it on checks right away.
   */
  export async function setEnabled(enabled: boolean): Promise<UpdateInfo> {
    await store({ enabled });
    if (enabled && AppSystem.config.UPDATE_CHECK) return await check();
    return await info();
  }

  function installKind(): InstallKind {
    if (AppSystem.isDocker) return "docker";
    const exec = Deno.execPath();
    // Running from the repository with `deno task start`
    if (/^deno(\.exe)?$/.test(Path.basename(exec))) return "source";
    // Where the AUR package puts the binary
    if (exec === "/usr/bin/cinemion" && fs.existsSync("/etc/arch-release")) return "aur";
    return "binary";
  }

  //#region Versions

  interface Version {
    core: [number, number, number];
    /**
     * The part after "-", like "beta.2", or `null` for a normal release.
     */
    pre: string | null;
  }

  /**
   * Read a version number, with or without a "v".
   */
  export function parseVersion(text: string): Version | null {
    // Example: v0.5.1, 0.6.0-beta.2
    const match = text.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!match) return null;
    return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null };
  }

  /**
   * Whether `candidate` comes after `current`, by semver rules (0.6.0-beta.1 comes before 0.6.0).
   */
  export function isNewer(candidate: string, current: string) {
    const a = parseVersion(candidate);
    const b = parseVersion(current);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) {
      if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i];
    }
    if (a.pre === b.pre) return false;
    if (a.pre === null) return true;
    if (b.pre === null) return false;
    return comparePre(a.pre, b.pre) > 0;
  }

  function comparePre(a: string, b: string) {
    const left = a.split(".");
    const right = b.split(".");
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if (left[i] === undefined) return -1;
      if (right[i] === undefined) return 1;
      const x = /^\d+$/.test(left[i]) ? Number(left[i]) : null;
      const y = /^\d+$/.test(right[i]) ? Number(right[i]) : null;
      if (x !== null && y !== null) {
        if (x !== y) return x - y;
      }
      // Numbers come before words
      else if (x !== null) return -1;
      else if (y !== null) return 1;
      else if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
    }
    return 0;
  }

  //#endregion
}

export default UpdateCheck;
