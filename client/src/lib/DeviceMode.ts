import Controller from "./Controller.ts";

export type Mode = "desktop" | "mobile" | "tv";
export type ModeSetting = Mode | "auto";

const STORAGE_KEY = "cn-device-mode";
const HOST_KEY = "cn-host";
// User agents of smart TVs, TV sticks and TV-style browsers
const TV_AGENTS = /SMART-TV|SmartTV|Tizen|Web0S|webOS|NetCast|HbbTV|BRAVIA|AFT[A-Z]|CrKey|GoogleTV|Android TV|AppleTV/i;

function storageGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice just won't be remembered
  }
}

/**
 * Picks the Desktop, Mobile or TV layout for this device, and remembers a manual choice.
 */
export class DeviceModeController extends Controller {
  public mode: Mode = "desktop";
  public setting: ModeSetting = "auto";
  /**
   * `mediahub` when running inside MediaHub, which turns its controller into key presses for us.
   */
  public host: "browser" | "mediahub" = "browser";

  constructor() {
    super();
    const query = new URLSearchParams(location.search);

    // `?mode=tv` (or desktop/mobile) is remembered, so a TV only needs the link once
    const fromQuery = query.get("mode");
    if (fromQuery === "tv" || fromQuery === "desktop" || fromQuery === "mobile" || fromQuery === "auto") {
      storageSet(STORAGE_KEY, fromQuery);
    }
    const stored = storageGet(STORAGE_KEY);
    this.setting = stored === "tv" || stored === "desktop" || stored === "mobile" ? stored : "auto";

    const host = query.get("host") ?? storageGet(HOST_KEY);
    if (host === "mediahub") {
      this.host = "mediahub";
      storageSet(HOST_KEY, "mediahub");
    }

    addEventListener("resize", () => this.update());
    this.update();
  }

  private detect(): Mode {
    if (this.host === "mediahub" || TV_AGENTS.test(navigator.userAgent)) return "tv";
    const coarse = matchMedia("(pointer: coarse)").matches;
    if (innerWidth < 720 || (coarse && innerWidth < 1024)) return "mobile";
    return "desktop";
  }

  private update() {
    const mode = this.setting === "auto" ? this.detect() : this.setting;
    if (mode === this.mode && document.documentElement.dataset.mode === mode) return;
    this.mode = mode;
    document.documentElement.dataset.mode = mode;
    this.notify();
  }

  /**
   * Choose a layout for this device, or `auto` to detect it.
   */
  public setSetting(setting: ModeSetting) {
    this.setting = setting;
    storageSet(STORAGE_KEY, setting);
    this.update();
  }

  public isTv() {
    return this.mode === "tv";
  }
}

export const deviceMode = new DeviceModeController();
