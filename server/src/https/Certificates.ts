import Der from "./Der.ts";

/**
 * Making and reading X.509 certificates with WebCrypto: Cinemion's own certificate authority, server certificates
 * signed by it, certificate requests for Let's Encrypt, and the facts the settings page shows about any certificate.
 * Keys are ECDSA P-256.
 */
export namespace Certificates {
  const OIDS = {
    EC_PUBLIC_KEY: "1.2.840.10045.2.1",
    ECDSA_SHA256: "1.2.840.10045.4.3.2",
    COMMON_NAME: "2.5.4.3",
    ORGANIZATION: "2.5.4.10",
    SUBJECT_KEY_ID: "2.5.29.14",
    KEY_USAGE: "2.5.29.15",
    SUBJECT_ALT_NAME: "2.5.29.17",
    BASIC_CONSTRAINTS: "2.5.29.19",
    AUTHORITY_KEY_ID: "2.5.29.35",
    EXT_KEY_USAGE: "2.5.29.37",
    SERVER_AUTH: "1.3.6.1.5.5.7.3.1",
    EXTENSION_REQUEST: "1.2.840.113549.1.9.14",
  };
  const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
  const SIGNING = { name: "ECDSA", hash: "SHA-256" } as const;

  export interface KeyPair {
    privateKey: CryptoKey;
    publicKey: CryptoKey;
  }

  /**
   * A certificate and its key, as PEM.
   */
  export interface Issued {
    cert: string;
    key: string;
  }

  /**
   * What a certificate says about itself.
   */
  export interface Info {
    subject: string | null;
    issuer: string | null;
    /**
     * Host names and addresses it's valid for.
     */
    names: string[];
    notBefore: string;
    notAfter: string;
    isCa: boolean;
  }

  export async function generateKey(): Promise<KeyPair> {
    return await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]) as CryptoKeyPair;
  }

  export async function keyToPem(key: CryptoKey) {
    return Der.toPem("PRIVATE KEY", new Uint8Array(await crypto.subtle.exportKey("pkcs8", key)));
  }

  /**
   * Read a key made by `generateKey()` back from PEM.
   */
  export async function keyFromPem(pem: string): Promise<KeyPair> {
    const der = Der.fromPem(pem, "PRIVATE KEY")[0];
    if (!der) throw new Error("There's no private key in that text.");
    const privateKey = await crypto.subtle.importKey("pkcs8", der as BufferSource, ALGORITHM, true, ["sign"]);
    // The public half comes back through a JWK, which carries both
    const jwk = await crypto.subtle.exportKey("jwk", privateKey);
    const publicKey = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, ALGORITHM, true, ["verify"]);
    return { privateKey, publicKey };
  }

  /**
   * WebCrypto signs as `r || s`; certificates want `SEQUENCE { INTEGER r, INTEGER s }`.
   */
  function signatureToDer(raw: Uint8Array) {
    return Der.sequence(Der.integer(raw.slice(0, 32)), Der.integer(raw.slice(32)));
  }

  async function sign(key: CryptoKey, data: Uint8Array) {
    return signatureToDer(new Uint8Array(await crypto.subtle.sign(SIGNING, key, data as BufferSource)));
  }

  function name(commonName: string, organization?: string) {
    const parts = [Der.set(Der.sequence(Der.oid(OIDS.COMMON_NAME), Der.utf8(commonName)))];
    if (organization) parts.unshift(Der.set(Der.sequence(Der.oid(OIDS.ORGANIZATION), Der.utf8(organization))));
    return Der.sequence(...parts);
  }

  function extension(id: string, value: Uint8Array, critical = false) {
    return critical ? Der.sequence(Der.oid(id), Der.boolean(true), Der.octetString(value)) : Der.sequence(Der.oid(id), Der.octetString(value));
  }

  async function keyId(publicKey: CryptoKey) {
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
    return new Uint8Array(await crypto.subtle.digest("SHA-1", raw)).slice(0, 20);
  }

  function isIp(value: string) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(value) || value.includes(":");
  }

  function ipBytes(value: string) {
    if (!value.includes(":")) return new Uint8Array(value.split(".").map(Number));
    // Expand "::" so there are eight groups
    const [head, tail] = value.split("::");
    const left = head ? head.split(":") : [];
    const right = tail !== undefined && tail !== "" ? tail.split(":") : [];
    const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
    return new Uint8Array(groups.flatMap((g) => {
      const n = parseInt(g || "0", 16);
      return [n >> 8, n & 0xff];
    }));
  }

  function altNames(names: string[]) {
    return Der.sequence(...names.map((n) => isIp(n) ? Der.implicit(7, ipBytes(n)) : Der.implicit(2, new TextEncoder().encode(n))));
  }

  function serial() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[0] &= 0x7f;
    return Der.integer(bytes);
  }

  async function certificate(opts: {
    subject: Uint8Array;
    issuer: Uint8Array;
    publicKey: CryptoKey;
    signingKey: CryptoKey;
    notAfter: Date;
    extensions: Uint8Array[];
  }) {
    const algorithm = Der.sequence(Der.oid(OIDS.ECDSA_SHA256));
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", opts.publicKey));
    // A little in the past, for devices whose clocks run slow
    const notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tbs = Der.sequence(
      Der.explicit(0, Der.integer(2)),
      serial(),
      algorithm,
      opts.issuer,
      Der.sequence(Der.time(notBefore), Der.time(opts.notAfter)),
      opts.subject,
      spki,
      Der.explicit(3, Der.sequence(...opts.extensions)),
    );
    return Der.toPem("CERTIFICATE", Der.sequence(tbs, algorithm, Der.bitString(await sign(opts.signingKey, tbs))));
  }

  /**
   * A certificate authority for this server, valid for 10 years. Devices that trust it trust every certificate it
   * signs.
   */
  export async function makeAuthority(serverName: string): Promise<Issued> {
    const keys = await generateKey();
    const subject = name(`${serverName} (Cinemion)`, "Cinemion");
    const id = await keyId(keys.publicKey);
    const cert = await certificate({
      subject,
      issuer: subject,
      publicKey: keys.publicKey,
      signingKey: keys.privateKey,
      notAfter: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000),
      extensions: [
        extension(OIDS.BASIC_CONSTRAINTS, Der.sequence(Der.boolean(true), Der.integer(0)), true),
        // keyCertSign and cRLSign
        extension(OIDS.KEY_USAGE, Der.bitString(new Uint8Array([0x06]), 1), true),
        extension(OIDS.SUBJECT_KEY_ID, Der.octetString(id)),
      ],
    });
    return { cert, key: await keyToPem(keys.privateKey) };
  }

  /**
   * A server certificate for `names` (host names and IP addresses), signed by `authority`. Valid for 397 days, the
   * longest Apple devices accept.
   */
  export async function makeServer(authority: Issued, names: string[]): Promise<Issued> {
    const ca = await keyFromPem(authority.key);
    const caInfo = read(authority.cert);
    // The issuer of the new certificate is the authority's subject, byte for byte
    const caSubject = tbsFields(Der.fromPem(authority.cert, "CERTIFICATE")[0])[4].raw;
    const keys = await generateKey();
    const cert = await certificate({
      subject: name(names[0] ?? "cinemion", "Cinemion"),
      issuer: caSubject,
      publicKey: keys.publicKey,
      signingKey: ca.privateKey,
      notAfter: new Date(Math.min(Date.now() + 397 * 24 * 60 * 60 * 1000, Date.parse(caInfo.notAfter))),
      extensions: [
        extension(OIDS.BASIC_CONSTRAINTS, Der.sequence(), true),
        // digitalSignature
        extension(OIDS.KEY_USAGE, Der.bitString(new Uint8Array([0x80]), 7), true),
        extension(OIDS.EXT_KEY_USAGE, Der.sequence(Der.oid(OIDS.SERVER_AUTH))),
        extension(OIDS.SUBJECT_ALT_NAME, altNames(names)),
        extension(OIDS.SUBJECT_KEY_ID, Der.octetString(await keyId(keys.publicKey))),
        extension(OIDS.AUTHORITY_KEY_ID, Der.sequence(Der.implicit(0, await keyId(ca.publicKey)))),
      ],
    });
    return { cert, key: await keyToPem(keys.privateKey) };
  }

  /**
   * A certificate request (PKCS #10) for `names`, for Let's Encrypt.
   */
  export async function makeRequest(keys: KeyPair, names: string[]) {
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
    const extensions = Der.sequence(extension(OIDS.SUBJECT_ALT_NAME, altNames(names)));
    const info = Der.sequence(
      Der.integer(0),
      name(names[0]),
      spki,
      Der.implicit(0, Der.sequence(Der.oid(OIDS.EXTENSION_REQUEST), Der.set(extensions)), true),
    );
    return Der.sequence(info, Der.sequence(Der.oid(OIDS.ECDSA_SHA256)), Der.bitString(await sign(keys.privateKey, info)));
  }

  function commonName(node: Der.Node) {
    for (const rdn of node.children) {
      for (const pair of rdn.children) {
        if (Der.readOid(pair.children[0]) === OIDS.COMMON_NAME) return Der.readText(pair.children[1]);
      }
    }
    return null;
  }

  /**
   * The fields of a certificate without the optional version: serial, algorithm, issuer, validity, subject, key.
   */
  function tbsFields(der: Uint8Array) {
    const tbs = Der.read(der).children[0];
    return tbs.children[0].tag === 0xa0 ? tbs.children.slice(1) : tbs.children;
  }

  /**
   * The first certificate in `pem`, read.
   * @throws When there's no certificate or it can't be read.
   */
  export function read(pem: string): Info {
    const der = Der.fromPem(pem, "CERTIFICATE")[0];
    if (!der) throw new Error("There's no certificate in that text. It should start with -----BEGIN CERTIFICATE-----.");
    let tbs: Der.Node;
    try {
      tbs = Der.read(der).children[0];
    } catch {
      throw new Error("That certificate can't be read.");
    }
    const fields = tbs.children[0].tag === 0xa0 ? tbs.children.slice(1) : tbs.children;
    const [, , issuer, validity, subject] = fields;
    const names: string[] = [];
    let isCa = false;
    const extensions = tbs.children.find((c) => c.tag === 0xa3)?.children[0]?.children ?? [];
    for (const ext of extensions) {
      const id = Der.readOid(ext.children[0]);
      const value = Der.read(ext.children[ext.children.length - 1].content);
      if (id === OIDS.SUBJECT_ALT_NAME) {
        for (const entry of value.children) {
          if (entry.tag === 0x82) names.push(new TextDecoder().decode(entry.content));
          else if (entry.tag === 0x87 && entry.content.length === 4) names.push([...entry.content].join("."));
          else if (entry.tag === 0x87 && entry.content.length === 16) {
            const groups = [...Array(8)].map((_, i) => ((entry.content[i * 2] << 8) | entry.content[i * 2 + 1]).toString(16));
            names.push(groups.join(":").replace(/(^|:)0(:0)+(:|$)/, "::"));
          }
        }
      }
      if (id === OIDS.BASIC_CONSTRAINTS) isCa = value.children[0]?.tag === Der.TAGS.BOOLEAN && value.children[0].content[0] !== 0;
    }
    return {
      subject: commonName(subject),
      issuer: commonName(issuer),
      names,
      notBefore: Der.readTime(validity.children[0]).toISOString(),
      notAfter: Der.readTime(validity.children[1]).toISOString(),
      isCa,
    };
  }
}

export default Certificates;
