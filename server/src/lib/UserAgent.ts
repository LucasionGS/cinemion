import type { Context } from "hono";

/**
 * Short device names, like "TV · Chrome" or "Phone · Safari", for the dashboard and the activity feed.
 */
export namespace UserAgent {
  /**
   * Header the web client sends with the layout it uses (desktop, mobile or tv).
   */
  export const MODE_HEADER = "X-Cinemion-Device-Mode";

  export function browser(ua: string) {
    // Order matters: Edge and Opera say "Chrome", Chrome says "Safari"
    if (/Edg\//.test(ua)) return "Edge";
    if (/OPR\/|Opera/.test(ua)) return "Opera";
    if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
    if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
    if (/Chrome\/|CriOS\//.test(ua)) return "Chrome";
    if (/Safari\//.test(ua)) return "Safari";
    return null;
  }

  function guessKind(ua: string): string {
    if (/SmartTV|SMART-TV|Tizen|Web0S|webOS|AFT[A-Z]|BRAVIA|GoogleTV|Android TV|CrKey/i.test(ua)) return "TV";
    if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "Tablet";
    if (/Mobile|iPhone|Android/i.test(ua)) return "Phone";
    return "Desktop";
  }

  /**
   * Name a device from its user agent and the layout the client reported.
   * @param mode The client's layout. Without it, the kind of device is guessed from the user agent.
   */
  export function describe(ua: string, mode?: string | null) {
    let kind = guessKind(ua);
    if (mode === "tv") kind = "TV";
    else if (mode === "mobile" && kind !== "Tablet") kind = "Phone";
    else if (mode === "desktop" && kind === "TV") kind = "Desktop";
    const name = browser(ua);
    return name ? `${kind} · ${name}` : kind;
  }

  /**
   * A device name for sentences: "TV · Chrome" becomes "a TV with Chrome".
   */
  export function phrase(device: string) {
    const [kind, name] = device.split(" · ");
    const noun = kind === "TV" ? "TV" : kind.toLowerCase();
    return name ? `a ${noun} with ${name}` : `a ${noun}`;
  }

  export function fromRequest(c: Context) {
    return describe(c.req.header("User-Agent") ?? "", c.req.header(MODE_HEADER));
  }
}

export default UserAgent;
