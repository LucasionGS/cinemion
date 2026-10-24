import type { EmailSettings, EmailSettingsUpdate } from "@shared/notifications.ts";
import { Setting } from "../models/index.ts";
import AppSystem from "../AppSystem.ts";

/**
 * Sends email through an SMTP server, with TLS from the start, STARTTLS, or neither, and AUTH PLAIN or LOGIN.
 */
export namespace Mailer {
  const SETTING = "email";
  const TIMEOUT_MS = 20_000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  interface Stored {
    host: string;
    port: number;
    security: EmailSettings["security"];
    username: string | null;
    password: string | null;
    from: string;
  }

  export interface Message {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }

  async function stored(): Promise<Stored | null> {
    return await Setting.get<Stored | null>(SETTING, null);
  }

  export async function isConfigured() {
    return !!(await stored())?.host;
  }

  export async function settings(): Promise<EmailSettings | null> {
    const s = await stored();
    return s ? { host: s.host, port: s.port, security: s.security, username: s.username, hasPassword: !!s.password, from: s.from } : null;
  }

  /**
   * Save the SMTP settings. An empty host turns email off.
   * @throws When a value isn't usable.
   */
  export async function update(changes: EmailSettingsUpdate) {
    const current = await stored();
    if (changes.host !== undefined && !changes.host?.trim()) {
      await Setting.set(SETTING, null);
      return;
    }
    const next: Stored = {
      host: changes.host?.trim() ?? current?.host ?? "",
      port: changes.port ?? current?.port ?? 587,
      security: changes.security ?? current?.security ?? "starttls",
      username: changes.username !== undefined ? changes.username?.trim() || null : current?.username ?? null,
      password: changes.password !== undefined ? changes.password || null : current?.password ?? null,
      from: changes.from?.trim() ?? current?.from ?? "",
    };
    if (!next.host) throw new Error("Enter the address of the mail server, like smtp.example.com.");
    if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) throw new Error("The port must be a number from 1 to 65535.");
    if (!["tls", "starttls", "none"].includes(next.security)) throw new Error("Pick how the connection is encrypted.");
    if (!/^([^<>]*<)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(next.from)) throw new Error("Enter the address emails come from, like cinemion@example.com.");
    await Setting.set(SETTING, next);
  }

  /**
   * Lines from the server, one reply (which may span several lines) at a time.
   */
  class Connection {
    private _buffer = "";
    constructor(private _conn: Deno.Conn | Deno.TlsConn) { }

    public get conn() {
      return this._conn;
    }

    public upgrade(conn: Deno.TlsConn) {
      this._conn = conn;
      this._buffer = "";
    }

    public async reply(): Promise<{ code: number; text: string }> {
      const lines: string[] = [];
      const until = Date.now() + TIMEOUT_MS;
      while (true) {
        const end = this._buffer.indexOf("\r\n");
        if (end !== -1) {
          const line = this._buffer.slice(0, end);
          this._buffer = this._buffer.slice(end + 2);
          lines.push(line);
          // Example: 250-SIZE 35882577 (more lines follow) or 250 OK (the last one)
          if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) return { code: Number(line.slice(0, 3)), text: lines.map((l) => l.slice(4)).join("\n") };
          continue;
        }
        if (Date.now() > until) throw new Error("The mail server stopped answering.");
        const chunk = new Uint8Array(4096);
        const read = await this._conn.read(chunk);
        if (read === null) throw new Error("The mail server closed the connection.");
        this._buffer += decoder.decode(chunk.subarray(0, read));
      }
    }

    public async send(line: string) {
      const bytes = encoder.encode(line + "\r\n");
      let at = 0;
      while (at < bytes.length) at += await this._conn.write(bytes.subarray(at));
    }

    /**
     * Send a command and check the reply's code.
     */
    public async command(line: string, expect: number[], what: string) {
      await this.send(line);
      const reply = await this.reply();
      if (!expect.includes(reply.code)) throw new Error(`The mail server refused ${what}: ${reply.code} ${reply.text}`);
      return reply;
    }
  }

  function address(from: string) {
    return from.match(/<([^>]+)>/)?.[1] ?? from;
  }

  function encodeHeader(text: string) {
    // Only plain ASCII may go in a header as is
    return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${btoa(String.fromCharCode(...encoder.encode(text)))}?=`;
  }

  function base64Lines(text: string) {
    let binary = "";
    for (const byte of encoder.encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/(.{76})/g, "$1\r\n");
  }

  function build(settings: Stored, message: Message) {
    const boundary = `cinemion-${crypto.randomUUID()}`;
    const headers = [
      `From: ${settings.from.includes("<") ? settings.from : `${AppSystem.APP_NAME} <${settings.from}>`}`,
      `To: ${message.to}`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@${address(settings.from).split("@")[1]}>`,
      "MIME-Version: 1.0",
    ];
    const parts = message.html
      ? [
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        base64Lines(message.text),
        `--${boundary}`,
        "Content-Type: text/html; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        base64Lines(message.html),
        `--${boundary}--`,
      ]
      : ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(message.text)];
    return [...headers, ...parts].join("\r\n");
  }

  /**
   * Send one email.
   * @throws With the mail server's own words when it refuses.
   */
  export async function send(message: Message) {
    const settings = await stored();
    if (!settings?.host) throw new Error("Email isn't set up on this server. An admin can set it up in Settings › Integrations.");

    let raw: Deno.Conn | Deno.TlsConn;
    try {
      raw = settings.security === "tls"
        ? await Deno.connectTls({ hostname: settings.host, port: settings.port })
        : await Deno.connect({ hostname: settings.host, port: settings.port });
    } catch (error) {
      throw new Error(`Could not reach the mail server at ${settings.host}:${settings.port}: ${(error as Error).message}`);
    }
    const conn = new Connection(raw);
    try {
      const greeting = await conn.reply().catch((error) => {
        // A TLS handshake with a server that talks plain text first
        if (settings.security === "tls" && /corrupt message|InvalidContentType|handshake/i.test((error as Error).message)) {
          throw new Error(`The mail server at port ${settings.port} doesn't start with encryption. Pick STARTTLS, or the port for TLS (usually 465).`);
        }
        throw error;
      });
      if (greeting.code !== 220) throw new Error(`The mail server didn't say hello: ${greeting.code} ${greeting.text}`);
      const name = "cinemion.local";
      let hello = await conn.command(`EHLO ${name}`, [250], "the greeting");
      if (settings.security === "starttls") {
        if (!/STARTTLS/i.test(hello.text)) throw new Error("The mail server doesn't offer STARTTLS. Pick another kind of encryption or port.");
        await conn.command("STARTTLS", [220], "to encrypt the connection");
        conn.upgrade(await Deno.startTls(conn.conn as Deno.TcpConn, { hostname: settings.host }));
        hello = await conn.command(`EHLO ${name}`, [250], "the greeting");
      }
      if (settings.username) {
        if (/AUTH[ =][^\n]*PLAIN/i.test(hello.text)) {
          const token = btoa(String.fromCharCode(...encoder.encode(`\0${settings.username}\0${settings.password ?? ""}`)));
          await conn.command(`AUTH PLAIN ${token}`, [235], "the user name or password");
        }
        else {
          await conn.command("AUTH LOGIN", [334], "to sign in");
          await conn.command(btoa(String.fromCharCode(...encoder.encode(settings.username))), [334], "the user name");
          await conn.command(btoa(String.fromCharCode(...encoder.encode(settings.password ?? ""))), [235], "the user name or password");
        }
      }
      await conn.command(`MAIL FROM:<${address(settings.from)}>`, [250], "the sender address");
      await conn.command(`RCPT TO:<${message.to}>`, [250, 251], `the address ${message.to}`);
      await conn.command("DATA", [354], "the message");
      // Lines starting with a dot get another one, so they don't end the message
      await conn.send(build(settings, message).split("\r\n").map((l) => l.startsWith(".") ? `.${l}` : l).join("\r\n") + "\r\n.");
      const done = await conn.reply();
      if (done.code !== 250) throw new Error(`The mail server refused the message: ${done.code} ${done.text}`);
      await conn.send("QUIT").catch(() => { });
    } finally {
      try {
        conn.conn.close();
      } catch {
        // Already closed
      }
    }
  }
}

export default Mailer;
