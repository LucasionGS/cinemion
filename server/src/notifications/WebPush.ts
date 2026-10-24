import { decodeBase64Url, encodeBase64Url } from "@std/encoding/base64url";
import { Setting } from "../models/index.ts";
import log from "../lib/Logger.ts";

/**
 * Browser push notifications without a helper package: messages are encrypted for each browser (RFC 8291,
 * `aes128gcm`) and signed for the push service with the server's VAPID key (RFC 8292).
 */
export namespace WebPush {
  const KEYS_SETTING = "pushKeys";
  const encoder = new TextEncoder();
  const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

  interface StoredKeys {
    /**
     * Public key as the 65 raw bytes, base64url.
     */
    publicKey: string;
    privateJwk: JsonWebKey;
  }

  export interface Target {
    endpoint: string;
    p256dh: string;
    auth: string;
  }

  export type Result = "sent" | "gone" | "failed";

  let _keys: Promise<StoredKeys> | null = null;

  /**
   * The server's VAPID key pair, made once and kept.
   */
  function keys(): Promise<StoredKeys> {
    _keys ??= (async () => {
      const stored = await Setting.get<StoredKeys | null>(KEYS_SETTING, null);
      if (stored) return stored;
      const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
      const made: StoredKeys = {
        publicKey: encodeBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
        privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
      };
      await Setting.set(KEYS_SETTING, made);
      return made;
    })();
    return _keys;
  }

  /**
   * The key browsers subscribe with (`applicationServerKey`).
   */
  export async function publicKey() {
    return (await keys()).publicKey;
  }

  function concat(...parts: Uint8Array[]) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
    const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, length * 8));
  }

  /**
   * A private ECDH key from its raw public half and its `d`, for the RFC's test vector.
   */
  function jwkFor(publicRaw: Uint8Array, d?: string): JsonWebKey {
    return { kty: "EC", crv: "P-256", x: encodeBase64Url(publicRaw.slice(1, 33)), y: encodeBase64Url(publicRaw.slice(33, 65)), ...(d ? { d } : {}) };
  }

  /**
   * Encrypt `payload` for one browser. `fixed` is only for checking against RFC 8291's example.
   */
  export async function encrypt(payload: Uint8Array, target: { p256dh: string; auth: string }, fixed?: { salt: Uint8Array; privateKey: string; publicKey: Uint8Array }) {
    const uaPublic = decodeBase64Url(target.p256dh);
    const authSecret = decodeBase64Url(target.auth);
    let asPublic: Uint8Array;
    let asPrivate: CryptoKey;
    if (fixed) {
      asPublic = fixed.publicKey;
      asPrivate = await crypto.subtle.importKey("jwk", jwkFor(fixed.publicKey, fixed.privateKey), ECDH, false, ["deriveBits"]);
    }
    else {
      const pair = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]) as CryptoKeyPair;
      asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
      asPrivate = pair.privateKey;
    }
    const uaKey = await crypto.subtle.importKey("raw", uaPublic as BufferSource, ECDH, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));

    const ikm = await hkdf(authSecret, shared, concat(encoder.encode("WebPush: info\0"), uaPublic, asPublic), 32);
    const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
    const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
    const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
    // One record, ended with the 0x02 delimiter
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, concat(payload, new Uint8Array([2])) as BufferSource));

    const header = new Uint8Array(16 + 4 + 1);
    header.set(salt);
    new DataView(header.buffer).setUint32(16, 4096);
    header[20] = asPublic.length;
    return concat(header, asPublic, sealed);
  }

  /**
   * The `Authorization` header for a push service: a JWT for its origin, signed with the VAPID key.
   */
  async function authorization(endpoint: string, subject: string) {
    const stored = await keys();
    const audience = new URL(endpoint).origin;
    const b64 = (value: unknown) => encodeBase64Url(encoder.encode(JSON.stringify(value)));
    const unsigned = `${b64({ typ: "JWT", alg: "ES256" })}.${b64({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject })}`;
    const key = await crypto.subtle.importKey("jwk", stored.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(unsigned)));
    return `vapid t=${unsigned}.${encodeBase64Url(signature)}, k=${stored.publicKey}`;
  }

  /**
   * Send one message to one browser.
   * @param subject A contact for the push service, a `mailto:` or `https:` URL.
   * @param topic Messages with the same topic replace each other while waiting for an offline device.
   * @returns `gone` when the browser unsubscribed, so it can be forgotten.
   */
  export async function send(target: Target, message: unknown, opts: { subject: string; topic?: string }): Promise<Result> {
    try {
      const body = await encrypt(encoder.encode(JSON.stringify(message)), target);
      const headers: Record<string, string> = {
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(24 * 60 * 60),
        Urgency: "normal",
        Authorization: await authorization(target.endpoint, opts.subject),
      };
      // Topics are at most 32 base64url characters
      if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
      const res = await fetch(target.endpoint, { method: "POST", headers, body: body as BodyInit, signal: AbortSignal.timeout(15_000) });
      await res.body?.cancel();
      if (res.status === 404 || res.status === 410) return "gone";
      if (!res.ok) {
        log.warn("A push service didn't take a notification", { status: res.status, service: new URL(target.endpoint).host });
        return "failed";
      }
      return "sent";
    } catch (error) {
      log.warn("Could not send a push notification", { error });
      return "failed";
    }
  }
}

export default WebPush;
