/**
 * Types for built-in HTTPS: a second address with a certificate made by Cinemion itself, one from Let's Encrypt, or
 * one of your own.
 */

export type CertificateKind = "cinemion" | "letsencrypt" | "own";

export interface HttpsSettings {
  enabled: boolean;
  /**
   * The port https listens on. The plain http port keeps working next to it.
   */
  port: number;
  kind: CertificateKind;
  /**
   * Send browsers that open the http address to the https one.
   */
  redirect: boolean;
  /**
   * For Let's Encrypt: the domain that points at this server, and an email address for expiry notices.
   */
  domain: string | null;
  email: string | null;
  /**
   * For certificates made by Cinemion: more host names or addresses it should be valid for, besides the ones Cinemion
   * finds by itself.
   */
  extraNames: string[];
}

export interface CertificateInfo {
  subject: string | null;
  issuer: string | null;
  /**
   * Host names and addresses it's valid for.
   */
  names: string[];
  notBefore: string;
  notAfter: string;
}

export interface HttpsStatus {
  settings: HttpsSettings;
  /**
   * Whether the https address is up.
   */
  running: boolean;
  /**
   * Why it isn't, or why getting or renewing the certificate failed. `null` when all is well.
   */
  error: string | null;
  certificate: CertificateInfo | null;
  /**
   * Cinemion's own certificate authority, which devices trust once. `null` until it's made.
   */
  authority: CertificateInfo | null;
  /**
   * Addresses to open Cinemion at over https, like "https://192.168.1.20:8443".
   */
  addresses: string[];
  /**
   * What's happening right now, like getting a certificate from Let's Encrypt.
   */
  step: string | null;
  /**
   * The plain http port, for the Let's Encrypt instructions.
   */
  httpPort: number;
}

export interface HttpsSettingsUpdate extends Partial<HttpsSettings> {
  /**
   * For your own certificate: the certificate (with its chain) and private key as PEM.
   */
  ownCertificate?: string;
  ownKey?: string;
}
