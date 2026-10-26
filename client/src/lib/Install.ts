import Controller from "./Controller.ts";

/**
 * How Cinemion can be installed in this browser:
 * - `installed`: it's open as an installed app
 * - `prompt`: the browser offered to install it, so a button can ask
 * - `ios`: Safari on iPhone or iPad, where it's added from the Share menu
 * - `insecure`: only https pages (or localhost) can be installed
 * - `browser`: the browser decides by itself, from its own menu, or can't install apps
 */
export type InstallState = "installed" | "prompt" | "ios" | "insecure" | "browser";

// Chrome and Edge only; not in the DOM types yet
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Installing Cinemion as an app. The browser offers it once, early on, so this is made when the page loads and holds
 * on to the offer until someone presses Install.
 */
export class InstallController extends Controller {
  public state: InstallState = "browser";

  private _offer: BeforeInstallPromptEvent | null = null;
  private readonly _standalone = matchMedia("(display-mode: standalone)");

  constructor() {
    super();
    addEventListener("beforeinstallprompt", (event) => {
      // Cinemion asks from its settings instead of the browser's own banner
      event.preventDefault();
      this._offer = event as BeforeInstallPromptEvent;
      this._update();
    });
    addEventListener("appinstalled", () => {
      this._offer = null;
      this._update();
    });
    this._standalone.addEventListener("change", () => this._update());
    this._update();
  }

  /**
   * Ask the browser to install Cinemion. Returns whether it was installed.
   */
  public async install() {
    const offer = this._offer;
    if (!offer) return false;
    // An offer can only be used once
    this._offer = null;
    await offer.prompt();
    const { outcome } = await offer.userChoice;
    this._update();
    return outcome === "accepted";
  }

  private _update() {
    const state = this._detect();
    if (state === this.state) return;
    this.state = state;
    this.notify();
  }

  private _detect(): InstallState {
    // `standalone` is Safari's own flag for a page opened from the home screen
    if (this._standalone.matches || (navigator as Navigator & { standalone?: boolean }).standalone) return "installed";
    if (this._offer) return "prompt";
    if (!isSecureContext) return "insecure";
    // iPads say they're Macs, but Macs have no touch screen
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios) return "ios";
    return "browser";
  }
}

export const install = new InstallController();

export default install;
