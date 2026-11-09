/**
 * The bridge the Cinemion Android TV app puts on `window` (`android/`). Every method may be missing on older apps, so
 * callers go through the helpers below instead of touching it directly.
 */
interface CinemionTvBridge {
  version?(): string;
  showServers?(): void;
  exit?(): void;
  keepAwake?(on: boolean): void;
}

function bridge(): CinemionTvBridge | null {
  return (globalThis as { CinemionTV?: CinemionTvBridge }).CinemionTV ?? null;
}

/**
 * Talks to the Android TV app when Cinemion runs inside it. Outside the app every call does nothing.
 */
export namespace TvApp {
  /**
   * Whether this page is running inside the Cinemion Android TV app.
   */
  export function isAvailable() {
    return bridge() !== null;
  }

  /**
   * The TV app's version, like `1.0.0`, or `null` outside the app.
   */
  export function version() {
    try {
      return bridge()?.version?.() ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Whether the app can take the viewer back to its server list.
   */
  export function canSwitchServer() {
    return typeof bridge()?.showServers === "function";
  }

  /**
   * Leave this server and show the app's list of servers.
   */
  export function showServers() {
    bridge()?.showServers?.();
  }

  /**
   * Keep the TV's screen on (while a video plays) or let it dim again.
   */
  export function keepAwake(on: boolean) {
    try {
      bridge()?.keepAwake?.(on);
    } catch {
      // An app without this just follows the TV's own screen saver
    }
  }
}

export default TvApp;
