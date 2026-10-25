import fs from "node:fs";
import Path from "node:path";

type Entry = string | Record<string, string> | Messages;
interface Messages {
  [key: string]: Entry;
}

/**
 * The client's language files, read by the server for the few things it words itself in a profile's language: push
 * notifications and emails. Lines a language doesn't have come from English, as in the client.
 */
export namespace Translations {
  /**
   * Next to the server in the repository, and compiled into the binary (`scripts/compile.sh`).
   */
  const DIR = Path.resolve(import.meta.dirname!, "../../../client/src/i18n/locales");
  const _loaded = new Map<string, Messages | null>();

  function load(code: string): Messages | null {
    if (_loaded.has(code)) return _loaded.get(code)!;
    let messages: Messages | null = null;
    // Only plain language tags, so a profile setting can't point anywhere else
    if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) {
      try {
        messages = JSON.parse(fs.readFileSync(Path.join(DIR, `${code}.json`), "utf8"));
      } catch {
        messages = null;
      }
    }
    _loaded.set(code, messages);
    return messages;
  }

  function lookup(messages: Messages | null, key: string): string | Record<string, string> | undefined {
    let node: Entry | undefined = messages ?? undefined;
    for (const part of key.split(".")) {
      if (!node || typeof node === "string") return undefined;
      node = (node as Messages)[part];
    }
    if (typeof node === "string") return node;
    if (node && typeof (node as Record<string, unknown>).other === "string") return node as Record<string, string>;
    return undefined;
  }

  function choose(entry: string | Record<string, string> | undefined, count: number, language: string) {
    if (entry === undefined || typeof entry === "string") return entry;
    return entry[new Intl.PluralRules(language).select(count)] || entry.other;
  }

  /**
   * A line in `language` (or English), with `{placeholders}` filled in. Numbers are written the language's way.
   */
  export function t(language: string | null, key: string, values?: Record<string, string | number>): string {
    const code = language ?? "en";
    const count = typeof values?.count === "number" ? values.count : 0;
    const text = choose(lookup(load(code), key), count, code) || choose(lookup(load("en"), key), count, "en") || key;
    if (!values) return text;
    const numbers = new Intl.NumberFormat(code);
    return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const value = values[name];
      return value === undefined ? whole : typeof value === "number" ? numbers.format(value) : value;
    });
  }
}

export default Translations;
