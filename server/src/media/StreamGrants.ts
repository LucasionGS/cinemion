import { encodeHex } from "@std/encoding/hex";

/**
 * Random ids for stream URLs. Video and audio elements and HLS players can't send headers, so stream URLs carry
 * one of these instead of a sign-in token. Anyone with the URL can load that one file while the id lives.
 */
export namespace StreamGrants {
  export interface Grant {
    fileId: number;
    userId: number;
    lastUsed: number;
  }

  /**
   * Stream ids stay valid this long after their last use.
   */
  const LIFETIME = 6 * 60 * 60 * 1000;
  const _grants = new Map<string, Grant>();

  /**
   * A new id that streams `fileId` for `userId`.
   */
  export function grant(fileId: number, userId: number) {
    for (const [token, g] of _grants) {
      if (Date.now() - g.lastUsed > LIFETIME) _grants.delete(token);
    }
    const token = encodeHex(crypto.getRandomValues(new Uint8Array(16)));
    _grants.set(token, { fileId, userId, lastUsed: Date.now() });
    return token;
  }

  /**
   * The grant behind `token`, keeping it alive, or `null` when it expired or never existed.
   */
  export function use(token: string) {
    const g = _grants.get(token);
    if (!g || Date.now() - g.lastUsed > LIFETIME) return null;
    g.lastUsed = Date.now();
    return g;
  }
}

export default StreamGrants;
