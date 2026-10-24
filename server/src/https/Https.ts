import fsp from "node:fs/promises";
import Path from "node:path";
import os from "node:os";
import type { CertificateInfo, HttpsSettings, HttpsSettingsUpdate, HttpsStatus } from "@shared/https.ts";
import AppSystem from "../AppSystem.ts";
import { Setting } from "../models/index.ts";
import Certificates from "./Certificates.ts";
import Acme from "./Acme.ts";
import { errorMessage } from "../lib/http.ts";
import log from "../lib/Logger.ts";

type Handler = (request: Request, info: Deno.ServeHandlerInfo<Deno.NetAddr>) => Response | Promise<Response>;

/**
 * Built-in HTTPS: a second listener next to the plain http one, with a certificate Cinemion makes and signs itself
 * (devices trust its certificate authority once), one from Let's Encrypt for a domain of your own, or one you bring.
 * Certificates are renewed by themselves before they run out.
 */
export namespace Https {
  const RENEW_DAYS = 30;
  const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
  const SETTINGS_KEY = "https";

  interface Stored extends HttpsSettings {
    error: string | null;
  }

  const DEFAULTS: Stored = {
    enabled: false,
    port: AppSystem.config.HTTPS_PORT,
    kind: "cinemion",
    redirect: false,
    domain: null,
    email: null,
    extraNames: [],
    error: null,
  };

  let _handler: Handler | null = null;
  let _server: Deno.HttpServer | null = null;
  let _step: string | null = null;
  let _timer: ReturnType<typeof setInterval> | null = null;
  let _redirect = false;
  let _port = 0;
  let _busy: Promise<void> = Promise.resolve();
  /**
   * A problem that didn't stop https, like a renewal that failed while the certificate is still good.
   */
  let _warning: string | null = null;

  const dir = () => Path.join(AppSystem.config.CONFIG_DIR, "tls");
  const file = (name: string) => Path.join(dir(), name);
  const FILES = {
    authority: ["ca.pem", "ca-key.pem"],
    cinemion: ["cinemion.pem", "cinemion-key.pem"],
    letsencrypt: ["letsencrypt.pem", "letsencrypt-key.pem"],
    own: ["own.pem", "own-key.pem"],
  } as const;

  async function stored(): Promise<Stored> {
    return { ...DEFAULTS, ...await Setting.get<Partial<Stored>>(SETTINGS_KEY, {}) };
  }

  async function store(changes: Partial<Stored>) {
    await Setting.set(SETTINGS_KEY, { ...await stored(), ...changes });
  }

  async function readPair(names: readonly [string, string]): Promise<Certificates.Issued | null> {
    const [cert, key] = await Promise.all(names.map((n) => fsp.readFile(file(n), "utf8").catch(() => null)));
    return cert && key ? { cert, key } : null;
  }

  async function writePair(names: readonly [string, string], pair: Certificates.Issued) {
    await fsp.mkdir(dir(), { recursive: true, mode: 0o700 });
    await fsp.writeFile(file(names[0]), pair.cert);
    await fsp.writeFile(file(names[1]), pair.key, { mode: 0o600 });
  }

  function info(pem: string | null): CertificateInfo | null {
    if (!pem) return null;
    try {
      const { subject, issuer, names, notBefore, notAfter } = Certificates.read(pem);
      return { subject, issuer, names, notBefore, notAfter };
    } catch {
      return null;
    }
  }

  function expiresSoon(pem: string) {
    return Date.parse(Certificates.read(pem).notAfter) - Date.now() < RENEW_DAYS * 24 * 60 * 60 * 1000;
  }

  /**
   * The names Cinemion's own certificate covers: this machine's names and addresses, `SITE_URL`'s host, and any added
   * by hand.
   */
  function ownNames(extra: string[]) {
    const names = new Set<string>(["localhost"]);
    const host = os.hostname();
    if (host) {
      names.add(host.toLowerCase());
      if (!host.includes(".")) names.add(`${host.toLowerCase()}.local`);
    }
    try {
      if (AppSystem.config.SITE_URL) names.add(new URL(AppSystem.config.SITE_URL).hostname);
    } catch {
      // Not a URL; nothing to add
    }
    names.add("127.0.0.1");
    for (const address of Deno.networkInterfaces()) {
      // Bridges for containers and virtual machines aren't addresses anyone opens Cinemion at
      if (/^(docker|br-|veth|virbr|vmnet|vboxnet|cni|podman|lxc|lxd)/.test(address.name)) continue;
      if (address.family === "IPv4" && !address.address.startsWith("127.")) names.add(address.address);
    }
    for (const name of extra) names.add(name.toLowerCase());
    return [...names];
  }

  /**
   * Cinemion's own authority and a server certificate for the names it should cover, made or remade as needed.
   */
  async function cinemionCertificate(settings: Stored): Promise<Certificates.Issued> {
    let authority = await readPair(FILES.authority);
    if (!authority) {
      authority = await Certificates.makeAuthority(await Setting.get(Setting.Keys.SERVER_NAME, AppSystem.APP_NAME));
      await writePair(FILES.authority, authority);
      log.info("Made a certificate authority for https");
    }
    const names = ownNames(settings.extraNames);
    const current = await readPair(FILES.cinemion);
    if (current) {
      const covered = new Set(Certificates.read(current.cert).names);
      if (names.every((n) => covered.has(n)) && !expiresSoon(current.cert)) return current;
    }
    const made = await Certificates.makeServer(authority, names);
    await writePair(FILES.cinemion, made);
    log.info("Made a certificate for https", { names });
    return made;
  }

  async function acmeAccount(): Promise<Acme.Account> {
    const directory = Deno.env.get("ACME_DIRECTORY") || Acme.LETS_ENCRYPT;
    const saved = await fsp.readFile(file("acme-account.json"), "utf8").then((t) => JSON.parse(t) as Acme.Account).catch(() => null);
    if (saved && saved.directory === directory) return saved;
    return await Acme.newAccount(directory);
  }

  async function letsEncryptCertificate(settings: Stored, force: boolean): Promise<Certificates.Issued> {
    if (!settings.domain) throw new Error("Enter the domain that points at this server first.");
    const current = await readPair(FILES.letsencrypt);
    if (current && !force) {
      const read = Certificates.read(current.cert);
      if (read.names.includes(settings.domain) && !expiresSoon(current.cert)) return current;
    }
    const account = await acmeAccount();
    try {
      const issued = await Acme.issue(account, [settings.domain], settings.email, (step) => _step = step);
      await writePair(FILES.letsencrypt, issued);
      return issued;
    } catch (error) {
      // A renewal that didn't work leaves the current certificate in use while it's still good
      if (current && Certificates.read(current.cert).names.includes(settings.domain) && Date.parse(Certificates.read(current.cert).notAfter) > Date.now()) {
        _warning = `Renewing the certificate didn't work, so the current one stays in use until it runs out: ${errorMessage(error)}`;
        log.warn(_warning);
        return current;
      }
      throw error;
    } finally {
      // The account is worth keeping even when this order failed
      if (account.url) {
        await fsp.mkdir(dir(), { recursive: true, mode: 0o700 });
        await fsp.writeFile(file("acme-account.json"), JSON.stringify(account), { mode: 0o600 });
      }
    }
  }

  async function certificateFor(settings: Stored, force = false): Promise<Certificates.Issued> {
    if (settings.kind === "letsencrypt") return await letsEncryptCertificate(settings, force);
    if (settings.kind === "own") {
      const own = await readPair(FILES.own);
      if (!own) throw new Error("Paste your certificate and its private key first.");
      return own;
    }
    return await cinemionCertificate(settings);
  }

  async function close() {
    const server = _server;
    _server = null;
    if (!server) return;
    // The port is free as soon as the server stops listening; streams still playing may finish in their own time
    await Promise.race([server.shutdown(), new Promise((r) => setTimeout(r, 2000))]);
  }

  /**
   * Bring the https listener in line with the settings: start, restart with a new certificate, or stop.
   */
  function apply(opts?: { force?: boolean }): Promise<void> {
    _busy = _busy.catch(() => { }).then(async () => {
      const settings = await stored();
      _redirect = settings.enabled && settings.redirect;
      await close();
      if (!settings.enabled || !_handler) return;
      _warning = null;
      try {
        const pair = await certificateFor(settings, opts?.force);
        _step = "Starting https";
        const handler = _handler;
        _server = Deno.serve({
          port: settings.port,
          hostname: "0.0.0.0",
          cert: pair.cert,
          key: pair.key,
          onListen: ({ port }) => log.info(`https is on at port ${port}`),
          onError: (error) => {
            log.error("An https request failed", { error });
            return new Response("Something went wrong on the server.", { status: 500 });
          },
        }, (request, info) => handler(request, info as Deno.ServeHandlerInfo<Deno.NetAddr>));
        _port = settings.port;
        if (settings.error !== _warning) await store({ error: _warning });
      } catch (error) {
        _server = null;
        const message = (error as { code?: string }).code === "EADDRINUSE" || error instanceof Deno.errors.AddrInUse
          ? `Port ${settings.port} is already in use by another program. Pick another port.`
          : errorMessage(error);
        log.warn("https couldn't start", { error: message });
        await store({ error: message });
        _redirect = false;
      } finally {
        _step = null;
      }
    });
    return _busy;
  }

  /**
   * Start https when it's turned on, and check the certificate twice a day.
   * @param handler What answers requests, the same as for plain http.
   */
  export async function start(handler: Handler) {
    _handler = handler;
    await apply();
    _timer = setInterval(() => renewIfNeeded(), CHECK_EVERY_MS);
  }

  export async function stop() {
    if (_timer !== null) clearInterval(_timer);
    _timer = null;
    await close();
  }

  async function renewIfNeeded() {
    const settings = await stored();
    if (!settings.enabled || settings.kind === "own") return;
    const files = settings.kind === "letsencrypt" ? FILES.letsencrypt : FILES.cinemion;
    const current = await readPair(files);
    const due = !current || expiresSoon(current.cert) ||
      (settings.kind === "cinemion" && !ownNames(settings.extraNames).every((n) => Certificates.read(current.cert).names.includes(n)));
    if (due) await apply();
  }

  /**
   * Change the settings and apply them.
   * @throws When a value isn't allowed or the certificate given can't be used.
   */
  export async function update(changes: HttpsSettingsUpdate) {
    const next: Partial<Stored> = {};
    if (changes.enabled !== undefined) next.enabled = !!changes.enabled;
    if (changes.redirect !== undefined) next.redirect = !!changes.redirect;
    if (changes.port !== undefined) {
      if (!Number.isInteger(changes.port) || changes.port < 1 || changes.port > 65535) throw new Error("The port must be a number from 1 to 65535.");
      if (changes.port === AppSystem.config.PORT) throw new Error(`Port ${changes.port} is the plain http port. Pick another one for https, like 8443.`);
      next.port = changes.port;
    }
    if (changes.kind !== undefined) {
      if (!["cinemion", "letsencrypt", "own"].includes(changes.kind)) throw new Error("Pick where the certificate comes from.");
      next.kind = changes.kind;
    }
    if (changes.domain !== undefined) {
      const domain = changes.domain?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "") || null;
      if (domain && !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error(`"${changes.domain}" isn't a domain name. Enter one like cinemion.example.com.`);
      next.domain = domain;
    }
    if (changes.email !== undefined) {
      const email = changes.email?.trim() || null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("That email address doesn't look right.");
      next.email = email;
    }
    if (changes.extraNames !== undefined) {
      const names = changes.extraNames.map((n) => n.trim().toLowerCase()).filter(Boolean);
      const bad = names.find((n) => !/^[a-z0-9.:-]+$/.test(n));
      if (bad) throw new Error(`"${bad}" isn't a host name or an address.`);
      next.extraNames = [...new Set(names)].slice(0, 20);
    }
    if (changes.ownCertificate !== undefined || changes.ownKey !== undefined) {
      if (!changes.ownCertificate || !changes.ownKey) throw new Error("Paste both the certificate and its private key.");
      checkOwn(changes.ownCertificate, changes.ownKey);
      await writePair(FILES.own, { cert: changes.ownCertificate.trim() + "\n", key: changes.ownKey.trim() + "\n" });
    }
    await store(next);
    await apply();
  }

  /**
   * Check a certificate and key by starting a throwaway listener with them.
   */
  function checkOwn(cert: string, key: string) {
    const read = Certificates.read(cert);
    if (Date.parse(read.notAfter) < Date.now()) throw new Error(`That certificate ran out on ${read.notAfter.slice(0, 10)}.`);
    if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key)) throw new Error("There's no private key in that text. It should start with -----BEGIN PRIVATE KEY-----.");
    try {
      const listener = Deno.listenTls({ port: 0, hostname: "127.0.0.1", cert, key });
      listener.close();
    } catch (error) {
      const message = errorMessage(error);
      throw new Error(/KeyMismatch|not be consistent/i.test(message) ? "That private key doesn't belong to the certificate." : `The certificate and key can't be used together: ${message}`);
    }
  }

  /**
   * Get a new certificate now (Let's Encrypt) or make a new one (Cinemion's own), even when the current one is fine.
   */
  export async function renew() {
    const settings = await stored();
    if (settings.kind === "cinemion") await fsp.rm(file(FILES.cinemion[0]), { force: true });
    await apply({ force: true });
  }

  /**
   * Cinemion's certificate authority as PEM, for devices to trust. `null` before it's made.
   */
  export async function authorityCertificate() {
    return await fsp.readFile(file(FILES.authority[0]), "utf8").catch(() => null);
  }

  export async function status(host: string | null): Promise<HttpsStatus> {
    const settings = await stored();
    const { error, ...plain } = settings;
    const files = FILES[settings.kind];
    const cert = await fsp.readFile(file(files[0]), "utf8").catch(() => null);
    const certificate = info(cert);
    const running = _server !== null;
    const port = settings.port === 443 ? "" : `:${settings.port}`;
    const hosts = settings.kind === "letsencrypt" ? [settings.domain].filter((d): d is string => !!d) : certificate?.names.filter((n) => n !== "127.0.0.1" && !n.includes(":")) ?? [];
    // The address this page was opened at goes first, when the certificate covers it
    if (host && hosts.includes(host)) {
      hosts.splice(hosts.indexOf(host), 1);
      hosts.unshift(host);
    }
    return {
      settings: plain,
      running,
      error,
      certificate,
      authority: info(await authorityCertificate()),
      addresses: hosts.slice(0, 6).map((h) => `https://${h}${port}`),
      step: _step,
      httpPort: AppSystem.config.PORT,
    };
  }

  //#region Plain http

  /**
   * Where to send a browser that opened a page over plain http, or `null` to leave it. Only pages are sent over, never
   * the API, so apps and webhooks that use the http address keep working.
   */
  export function redirectFor(request: Request): string | null {
    if (!_redirect || !_server || (request.method !== "GET" && request.method !== "HEAD")) return null;
    const url = new URL(request.url);
    if (url.protocol === "https:" || request.headers.get("X-Forwarded-Proto") === "https") return null;
    // The API, Let's Encrypt's checks, and the apps that speak another media server's API (capitalised paths)
    if (url.pathname.startsWith("/api") || url.pathname.startsWith("/.well-known") || /^\/[A-Z]/.test(url.pathname) || url.pathname.startsWith("/web/")) return null;
    if (!(request.headers.get("Accept") ?? "").includes("text/html")) return null;
    return `https://${url.hostname.includes(":") ? `[${url.hostname}]` : url.hostname}${_port === 443 ? "" : `:${_port}`}${url.pathname}${url.search}`;
  }

  //#endregion
}

export default Https;
