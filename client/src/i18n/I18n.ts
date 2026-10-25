import { createElement, Fragment, type ReactNode } from "react";
import Controller from "../lib/Controller.ts";
import en from "./locales/en.json" with { type: "json" };

//#region Types

/**
 * A line that changes with a number: `{ "one": "{count} clip", "other": "{count} clips" }`. The forms are the CLDR
 * plural categories of the language; `other` is always there.
 */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends PluralForms ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/**
 * Every line in the English file, like `"settings.about.title"`. English is the template: other languages have the
 * same keys.
 */
export type TranslationKey = Leaves<typeof en>;

/**
 * A language's file: nested groups of lines, with plurals as `PluralForms`.
 */
export interface Messages {
  [key: string]: string | PluralForms | Messages;
}

/**
 * Values for `{placeholders}`. Numbers are written the language's way.
 */
export type Values = Record<string, string | number>;

/**
 * Values for `rich()`: placeholders can also be elements, and `<tag>…</tag>` pairs are drawn by the function of the
 * same name.
 */
export type RichValues = Record<string, ReactNode | ((text: string) => ReactNode)>;

export interface Language {
  /**
   * The language's code, like `en` or `pt-BR`.
   */
  code: string;
  /**
   * The language's name in itself, like "Deutsch".
   */
  name: string;
  load: () => Promise<Messages>;
}

//#endregion

/**
 * Every language Cinemion has. To add one, put its file next to `en.json` and add a line here.
 */
export const LANGUAGES: Language[] = [
  { code: "en", name: "English", load: () => Promise.resolve(en) },
  { code: "da", name: "Dansk", load: () => import("./locales/da.json", { with: { type: "json" } }).then((m) => m.default) },
  { code: "de", name: "Deutsch", load: () => import("./locales/de.json", { with: { type: "json" } }).then((m) => m.default) },
  { code: "es", name: "Español", load: () => import("./locales/es.json", { with: { type: "json" } }).then((m) => m.default) },
  { code: "fr", name: "Français", load: () => import("./locales/fr.json", { with: { type: "json" } }).then((m) => m.default) },
  { code: "nl", name: "Nederlands", load: () => import("./locales/nl.json", { with: { type: "json" } }).then((m) => m.default) },
];

const STORAGE_KEY = "cn-language";
const ENGLISH_PLURALS = new Intl.PluralRules("en");

/**
 * The language the interface is in. Changing it re-renders the whole app (see `main.tsx`), so `t()` can be called
 * anywhere without subscribing to anything.
 */
export class I18nController extends Controller {
  /**
   * The language in use, one of `LANGUAGES`.
   */
  public language = "en";
  /**
   * The locale dates and numbers are written in. The browser's own when it speaks the same language, so English
   * dates follow the reader's country.
   */
  public locale = "en";
  private _messages: Messages = en;
  private _plurals = new Intl.PluralRules("en");
  private _numbers = new Intl.NumberFormat("en");
  private _wanted: string | null = null;

  /**
   * Start in the language used last on this device, so nothing flashes in English before the profile loads.
   */
  public async init() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private windows can refuse storage
    }
    await this.use(stored);
  }

  /**
   * Switch to `code`, or to the browser's language when it's `null` (or a language Cinemion doesn't have).
   */
  public async use(code: string | null) {
    this._wanted = code;
    const language = LANGUAGES.find((l) => l.code === code) ?? I18nController.fromBrowser();
    const messages = language.code === "en" ? en : await language.load().catch(() => null);
    // Another switch happened while this one was loading
    if (this._wanted !== code) return;
    if (!messages) return;
    try {
      localStorage.setItem(STORAGE_KEY, language.code);
    } catch {
      // Remembering it is only a nicety
    }
    if (language.code === this.language && messages === this._messages) return;
    this.language = language.code;
    this.locale = I18nController.localeFor(language.code);
    this._messages = messages;
    this._plurals = new Intl.PluralRules(this.locale);
    this._numbers = new Intl.NumberFormat(this.locale);
    document.documentElement.lang = language.code;
    this.notify();
  }

  /**
   * The first of the browser's languages Cinemion has, else English.
   */
  public static fromBrowser(): Language {
    const wanted = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language];
    for (const tag of wanted) {
      const exact = LANGUAGES.find((l) => l.code.toLowerCase() === tag.toLowerCase());
      if (exact) return exact;
      const base = LANGUAGES.find((l) => l.code.toLowerCase() === tag.split("-")[0].toLowerCase());
      if (base) return base;
    }
    return LANGUAGES[0];
  }

  private static localeFor(code: string) {
    const browser = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language];
    return browser.find((tag) => tag.split("-")[0].toLowerCase() === code.split("-")[0].toLowerCase()) ?? code;
  }

  /**
   * The text of a line, with `{placeholders}` filled in. A line the language doesn't have yet comes from English.
   */
  public t(key: TranslationKey, values?: Values): string {
    return this.fill(this.pick(key, values), values);
  }

  /**
   * Like `t()`, for lines with `<tag>…</tag>` pairs or elements in their placeholders:
   * `rich("about.license", { link: (text) => <a href="…">{text}</a> })`. Tags can't be nested.
   */
  public rich(key: TranslationKey, values: RichValues): ReactNode {
    const text = this.pick(key, values);
    const nodes: ReactNode[] = [];
    // Example: Open it with <code>?mode=tv</code>, {name}.
    const pattern = /<(\w+)>(.*?)<\/\1>|\{(\w+)\}/gs;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > last) nodes.push(text.slice(last, match.index));
      const [whole, tag, inner, name] = match;
      if (tag) {
        const draw = values[tag];
        // Plain values can sit inside a tag too: "<strong>{title}</strong>"
        const filled = inner.replace(/\{(\w+)\}/g, (all, name: string) => {
          const value = values[name];
          return typeof value === "number" ? this._numbers.format(value) : typeof value === "string" ? value : all;
        });
        nodes.push(typeof draw === "function" ? draw(filled) : filled);
      }
      else {
        const value = values[name];
        nodes.push(value === undefined ? whole : typeof value === "number" ? this._numbers.format(value) : typeof value === "function" ? whole : value);
      }
      last = match.index + whole.length;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return createElement(Fragment, null, ...nodes);
  }

  /**
   * Whether the language has its own text for `key`, rather than borrowing English.
   */
  public has(key: TranslationKey) {
    return !!this.choose(lookup(this._messages, key), 1, this._plurals);
  }

  private pick(key: TranslationKey, values?: Record<string, unknown>): string {
    const count = typeof values?.count === "number" ? values.count : 0;
    // Empty lines are ones nobody has translated yet
    return this.choose(lookup(this._messages, key), count, this._plurals) || this.choose(lookup(en, key), count, ENGLISH_PLURALS) || key;
  }

  private choose(entry: string | PluralForms | undefined, count: number, plurals: Intl.PluralRules) {
    if (entry === undefined || typeof entry === "string") return entry;
    return entry[plurals.select(count)] || entry.other;
  }

  private fill(text: string, values?: Values) {
    if (!values) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const value = values[name];
      if (value === undefined) return whole;
      return typeof value === "number" ? this._numbers.format(value) : value;
    });
  }
}

function lookup(messages: Messages, key: string): string | PluralForms | undefined {
  let node: string | PluralForms | Messages | undefined = messages;
  for (const part of key.split(".")) {
    if (!node || typeof node === "string") return undefined;
    node = (node as Messages)[part];
  }
  if (typeof node === "string") return node;
  if (node && typeof node.other === "string") return node as PluralForms;
  return undefined;
}

export const i18n = new I18nController();

//#region Server messages

interface ServerPattern {
  key: TranslationKey;
  regex: RegExp;
  names: string[];
  /**
   * Characters that aren't placeholders, so more specific patterns are tried first.
   */
  weight: number;
}

let _serverPatterns: ServerPattern[] | null = null;

/**
 * The English server messages (the "server" group, collected from the server's code by `deno task i18n server`) as
 * patterns that pick out the values in a message.
 */
function serverPatterns() {
  if (_serverPatterns) return _serverPatterns;
  const group = (en as unknown as { server?: Record<string, string> }).server ?? {};
  _serverPatterns = Object.entries(group).map(([key, template]) => {
    const names: string[] = [];
    const source = template.split(/(\{\w+\})/).map((part) => {
      const placeholder = part.match(/^\{(\w+)\}$/);
      if (!placeholder) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(placeholder[1]);
      return "([\\s\\S]+?)";
    }).join("");
    return { key: `server.${key}` as TranslationKey, regex: new RegExp(`^${source}$`), names, weight: template.replace(/\{\w+\}/g, "").length };
  }).sort((a, b) => b.weight - a.weight);
  return _serverPatterns;
}

/**
 * A message the server sent (an error, a task's status, an activity line) in the reader's language. The server
 * speaks English; its messages are matched to their line here, and the values in them carried over. Anything not
 * found stays as it is.
 */
export function serverText(message: string | null | undefined, depth = 0): string {
  if (!message) return message ?? "";
  // The server already speaks English
  if (i18n.language === "en") return message;
  for (const pattern of serverPatterns()) {
    const match = pattern.regex.exec(message);
    if (!match) continue;
    // A value can be a message of its own, like the reason in "The copy couldn't be made: …"
    const values = Object.fromEntries(pattern.names.map((name, i) => [name, depth < 2 ? serverText(match[i + 1], depth + 1) : match[i + 1]]));
    return i18n.t(pattern.key, values);
  }
  // Labels with the library after them: "Scanning · Movies"
  if (depth === 0 && message.includes(" · ")) return message.split(" · ").map((part) => serverText(part, 1)).join(" · ");
  return message;
}

//#endregion

/**
 * The text of a line in the current language. See `I18nController.t`.
 */
export function t(key: TranslationKey, values?: Values) {
  return i18n.t(key, values);
}

/**
 * A line with tags or elements in it. See `I18nController.rich`.
 */
export function rich(key: TranslationKey, values: RichValues) {
  return i18n.rich(key, values);
}

export default i18n;
