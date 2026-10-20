import Controller from "./Controller.ts";

export type Theme = "dark" | "light";
export type ThemeSetting = Theme | "system";

const STORAGE_KEY = "cn-theme";

/**
 * Picks the dark or light theme for this device, or follows the system setting. The page also reads the stored choice
 * in `index.html` before anything is drawn, so it never flashes the wrong theme.
 */
export class ThemeController extends Controller {
  public setting: ThemeSetting = "dark";
  public theme: Theme = "dark";

  private readonly _systemLight = matchMedia("(prefers-color-scheme: light)");

  constructor() {
    super();
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "system") this.setting = stored;
    } catch {
      // Dark it is
    }
    this._systemLight.addEventListener("change", () => this._apply());
    this._apply();
  }

  /**
   * Choose a theme for this device, or `system` to follow the device's own setting.
   */
  public setSetting(setting: ThemeSetting) {
    this.setting = setting;
    try {
      localStorage.setItem(STORAGE_KEY, setting);
    } catch {
      // The choice lasts until the tab closes
    }
    this._apply();
  }

  private _apply() {
    const theme: Theme = this.setting === "system" ? (this._systemLight.matches ? "light" : "dark") : this.setting;
    const changed = theme !== this.theme;
    this.theme = theme;
    document.documentElement.dataset.theme = theme;
    // Browser chrome (the address bar on phones) follows the page ground
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#F3F4F6" : "#08090B");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme);
    if (changed) this.notify();
  }
}

export const themes = new ThemeController();

export default themes;
