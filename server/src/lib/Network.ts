import type { Context } from "hono";
import { getConnInfo } from "hono/deno";

/**
 * Works out whether a request comes from the local network.
 */
export namespace Network {
  /**
   * Whether `address` is a loopback, private or link-local address.
   */
  export function isPrivate(address: string) {
    let ip = address.trim().toLowerCase();
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);
    if (ip === "::1" || ip === "localhost") return true;
    if (ip.includes(":")) return ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:");

    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) return false;
    const [a, b] = parts;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }

  /**
   * The viewer's address. Behind a reverse proxy on the local network, the forwarded address is used.
   */
  export function clientAddress(c: Context): string | null {
    let peer: string | null = null;
    try {
      peer = getConnInfo(c).remote.address ?? null;
    } catch {
      peer = null;
    }
    if (!peer || !isPrivate(peer)) return peer;

    // Only trust X-Forwarded-For from a proxy on the local network, and take the last hop it didn't add itself
    const forwarded = c.req.header("X-Forwarded-For")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    for (let i = forwarded.length - 1; i >= 0; i--) {
      if (!isPrivate(forwarded[i])) return forwarded[i];
    }
    return forwarded[0] ?? peer;
  }

  /**
   * Whether the request comes from outside the local network.
   */
  export function isRemote(c: Context) {
    const address = clientAddress(c);
    return address !== null && !isPrivate(address);
  }
}

export default Network;
