import Controller from "./Controller.ts";

/**
 * What the speakers on this device can play.
 * `auto` guesses from the layout (surround on TVs, stereo elsewhere); `passthrough` hands Dolby Digital to the device
 * (or a receiver behind it) instead of converting it.
 */
export type Speakers = "auto" | "stereo" | "surround51" | "surround71" | "passthrough";

/**
 * What happens at an intro: a "Skip intro" button, skipping it right away, or nothing.
 */
export type SkipIntros = "button" | "auto" | "off";

interface Stored {
  speakers: Speakers;
  skipIntros: SkipIntros;
}

const DEFAULTS: Stored = { speakers: "auto", skipIntros: "button" };

/**
 * Playback preferences of this device, kept in this browser like the layout.
 */
export class DevicePrefsController extends Controller {
  public speakers: Speakers = DEFAULTS.speakers;
  public skipIntros: SkipIntros = DEFAULTS.skipIntros;

  private static readonly KEY = "cn-device-prefs";

  constructor() {
    super();
    try {
      const saved = JSON.parse(localStorage.getItem(DevicePrefsController.KEY) ?? "null") as Partial<Stored> | null;
      if (saved) Object.assign(this, { ...DEFAULTS, ...saved });
    } catch {
      // Defaults are fine
    }
  }

  public set(patch: Partial<Stored>) {
    Object.assign(this, patch);
    try {
      localStorage.setItem(DevicePrefsController.KEY, JSON.stringify({ speakers: this.speakers, skipIntros: this.skipIntros }));
    } catch {
      // Storage blocked: the choice lasts until the tab closes
    }
    this.notify();
  }
}

export const devicePrefs = new DevicePrefsController();

export default devicePrefs;
