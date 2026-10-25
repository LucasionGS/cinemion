import { encodeBase64Url } from "@std/encoding/base64url";
import Certificates from "./Certificates.ts";
import Der from "./Der.ts";
import log from "../lib/Logger.ts";

/**
 * A small ACME client (RFC 8555) for free certificates from Let's Encrypt, proving control of a domain with HTTP-01
 * challenges: Let's Encrypt asks `http://<domain>/.well-known/acme-challenge/<token>`, which Cinemion answers.
 */
export namespace Acme {
  export const LETS_ENCRYPT = "https://acme-v02.api.letsencrypt.org/directory";
  /**
   * Polls for a challenge or an order give up after this long.
   */
  const POLL_TIMEOUT_MS = 2 * 60 * 1000;

  /**
   * The account key and its URL at the certificate authority, kept between runs.
   */
  export interface Account {
    directory: string;
    jwk: JsonWebKey;
    url: string | null;
  }

  interface Directory {
    newNonce: string;
    newAccount: string;
    newOrder: string;
  }

  interface Order {
    status: "pending" | "ready" | "processing" | "valid" | "invalid";
    authorizations: string[];
    finalize: string;
    certificate?: string;
    error?: Problem;
  }

  interface Problem {
    type?: string;
    detail?: string;
  }

  interface Authorization {
    status: "pending" | "valid" | "invalid" | "deactivated" | "expired" | "revoked";
    identifier: { value: string };
    challenges: { type: string; url: string; token: string; status: string; error?: Problem }[];
  }

  /**
   * Answers to challenges being checked, by token.
   */
  const _challenges = new Map<string, string>();

  /**
   * What to answer for `/.well-known/acme-challenge/<token>`, or `null`.
   */
  export function challengeAnswer(token: string) {
    return _challenges.get(token) ?? null;
  }

  const b64 = (bytes: Uint8Array | string) => encodeBase64Url(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes);

  /**
   * A new account key, to keep with `Account`.
   */
  export async function newAccount(directory: string): Promise<Account> {
    const keys = await Certificates.generateKey();
    return { directory, jwk: await crypto.subtle.exportKey("jwk", keys.privateKey), url: null };
  }

  /**
   * Talks to one certificate authority with one account.
   */
  class Client {
    private _directory: Directory | null = null;
    private _nonce: string | null = null;
    private _key: CryptoKey | null = null;

    constructor(public account: Account) { }

    private async _dir() {
      if (this._directory) return this._directory;
      const res = await fetch(this.account.directory, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`The certificate authority didn't answer (${res.status}).`);
      this._directory = await res.json() as Directory;
      return this._directory;
    }

    private async _signingKey() {
      this._key ??= await crypto.subtle.importKey("jwk", this.account.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      return this._key;
    }

    private _publicJwk() {
      const { crv, kty, x, y } = this.account.jwk;
      return { crv, kty, x, y };
    }

    /**
     * The key's thumbprint (RFC 7638), which goes in every challenge answer.
     */
    public async thumbprint() {
      const { crv, kty, x, y } = this._publicJwk();
      // The members in this order, without spaces, as the RFC says
      const json = JSON.stringify({ crv, kty, x, y });
      return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json))));
    }

    private async _newNonce() {
      const res = await fetch((await this._dir()).newNonce, { method: "HEAD", signal: AbortSignal.timeout(20_000) });
      const nonce = res.headers.get("Replay-Nonce");
      if (!nonce) throw new Error("The certificate authority didn't hand out a nonce.");
      return nonce;
    }

    /**
     * A signed POST. `payload` `null` is a POST-as-GET.
     */
    public async post<T>(url: string, payload: unknown, opts?: { accept?: string; useJwk?: boolean }): Promise<{ status: number; headers: Headers; data: T; text: string }> {
      for (let attempt = 0; ; attempt++) {
        const nonce = this._nonce ?? await this._newNonce();
        this._nonce = null;
        const header: Record<string, unknown> = { alg: "ES256", nonce, url };
        if (opts?.useJwk || !this.account.url) header.jwk = this._publicJwk();
        else header.kid = this.account.url;
        const protectedPart = b64(JSON.stringify(header));
        const payloadPart = payload === null ? "" : b64(JSON.stringify(payload));
        // JWS signatures are the raw r || s, not DER
        const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await this._signingKey(), new TextEncoder().encode(`${protectedPart}.${payloadPart}`)));
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/jose+json", ...(opts?.accept ? { Accept: opts.accept } : {}) },
          body: JSON.stringify({ protected: protectedPart, payload: payloadPart, signature: b64(signature) }),
          signal: AbortSignal.timeout(30_000),
        });
        this._nonce = res.headers.get("Replay-Nonce");
        const text = await res.text();
        let data: unknown = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
        const problem = data as Problem | null;
        // A nonce can go stale; the RFC says to try again with the fresh one
        if (res.status === 400 && problem?.type?.endsWith(":badNonce") && attempt < 3) continue;
        if (res.status >= 400) throw new Error(problem?.detail ? `The certificate authority said: ${problem.detail}` : `The certificate authority answered ${res.status}.`);
        return { status: res.status, headers: res.headers, data: data as T, text };
      }
    }

    public async register(email: string | null) {
      if (this.account.url) return;
      const res = await this.post((await this._dir()).newAccount, { termsOfServiceAgreed: true, ...(email ? { contact: [`mailto:${email}`] } : {}) }, { useJwk: true });
      this.account.url = res.headers.get("Location");
      if (!this.account.url) throw new Error("The certificate authority didn't say where the account is.");
    }

    public async newOrder(domains: string[]) {
      const res = await this.post<Order>((await this._dir()).newOrder, { identifiers: domains.map((value) => ({ type: "dns", value })) });
      return { url: res.headers.get("Location")!, order: res.data };
    }
  }

  async function poll<T>(tooLong: Error, check: () => Promise<{ done: boolean; value: T }>) {
    const until = Date.now() + POLL_TIMEOUT_MS;
    for (let wait = 1000; Date.now() < until; wait = Math.min(wait * 2, 10_000)) {
      const { done, value } = await check();
      if (done) return value;
      await new Promise((r) => setTimeout(r, wait));
    }
    throw tooLong;
  }

  /**
   * Get a certificate for `domains`. The HTTP server must answer challenges through `challengeAnswer()` on port 80 of
   * each domain while this runs.
   * @param onStep Told what's happening, for the settings page.
   * @throws With the certificate authority's own explanation when it refuses.
   */
  export async function issue(account: Account, domains: string[], email: string | null, onStep?: (step: string) => void): Promise<Certificates.Issued> {
    const client = new Client(account);
    onStep?.("Signing up with Let's Encrypt");
    await client.register(email);
    onStep?.("Asking for a certificate");
    const { url: orderUrl, order } = await client.newOrder(domains);
    const thumbprint = await client.thumbprint();

    const tokens: string[] = [];
    try {
      for (const authUrl of order.authorizations) {
        const auth = (await client.post<Authorization>(authUrl, null)).data;
        if (auth.status === "valid") continue;
        const challenge = auth.challenges.find((c) => c.type === "http-01");
        if (!challenge) throw new Error(`Let's Encrypt didn't offer a way to check ${auth.identifier.value} over http.`);
        _challenges.set(challenge.token, `${challenge.token}.${thumbprint}`);
        tokens.push(challenge.token);
        onStep?.(`Checking that ${auth.identifier.value} leads here`);
        await client.post(challenge.url, {});
        await poll(new Error("The certificate authority took too long to check the domain."), async () => {
          const now = (await client.post<Authorization>(authUrl, null)).data;
          if (now.status === "invalid") {
            const reason = now.challenges.find((c) => c.type === "http-01")?.error?.detail;
            throw new Error(`Let's Encrypt couldn't reach ${auth.identifier.value} on port 80${reason ? `: ${reason}` : ""}. Make sure the domain points at this server and port 80 is forwarded to Cinemion.`);
          }
          return { done: now.status === "valid", value: null };
        });
      }
    } finally {
      for (const token of tokens) _challenges.delete(token);
    }

    onStep?.("Collecting the certificate");
    const keys = await Certificates.generateKey();
    const csr = await Certificates.makeRequest(keys, domains);
    await client.post(order.finalize, { csr: b64(csr) });
    const done = await poll(new Error("The certificate authority took too long to make the certificate."), async () => {
      const now = (await client.post<Order>(orderUrl, null)).data;
      if (now.status === "invalid") throw new Error(`Let's Encrypt refused the request${now.error?.detail ? `: ${now.error.detail}` : "."}`);
      return { done: now.status === "valid" && !!now.certificate, value: now };
    });
    const chain = (await client.post<null>(done.certificate!, null, { accept: "application/pem-certificate-chain" })).text;
    if (Der.fromPem(chain, "CERTIFICATE").length === 0) throw new Error("Let's Encrypt sent something that isn't a certificate.");
    log.info("Got a certificate from Let's Encrypt", { domains });
    return { cert: chain, key: await Certificates.keyToPem(keys.privateKey) };
  }
}

export default Acme;
