/**
 * Languages Cinemion knows by name. Video files tag tracks with ISO 639-2 codes ("por"), subtitle sites and
 * file names use ISO 639-1 ("pt") or the English name ("Portuguese"); this table connects them.
 */

export interface Language {
  /**
   * ISO 639-1 code, or a region variant like "pt-br".
   */
  code: string;
  name: string;
  /**
   * Other codes and spellings for the same language: ISO 639-2/B and /T codes, native names.
   */
  aliases: string[];
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", aliases: ["eng"] },
  { code: "nl", name: "Dutch", aliases: ["nld", "dut", "nederlands", "flemish"] },
  { code: "de", name: "German", aliases: ["deu", "ger", "deutsch"] },
  { code: "fr", name: "French", aliases: ["fra", "fre", "francais", "français"] },
  { code: "es", name: "Spanish", aliases: ["spa", "espanol", "español", "castellano"] },
  { code: "pt", name: "Portuguese", aliases: ["por", "portugues", "português"] },
  { code: "pt-br", name: "Portuguese (Brazil)", aliases: ["pob", "pb", "ptbr", "brazilian"] },
  { code: "it", name: "Italian", aliases: ["ita", "italiano"] },
  { code: "da", name: "Danish", aliases: ["dan", "dansk"] },
  { code: "sv", name: "Swedish", aliases: ["swe", "svenska"] },
  { code: "no", name: "Norwegian", aliases: ["nor", "nob", "nno", "nb", "nn", "norsk"] },
  { code: "fi", name: "Finnish", aliases: ["fin", "suomi"] },
  { code: "is", name: "Icelandic", aliases: ["isl", "ice"] },
  { code: "pl", name: "Polish", aliases: ["pol", "polski"] },
  { code: "cs", name: "Czech", aliases: ["ces", "cze", "cesky"] },
  { code: "sk", name: "Slovak", aliases: ["slk", "slo"] },
  { code: "hu", name: "Hungarian", aliases: ["hun", "magyar"] },
  { code: "ro", name: "Romanian", aliases: ["ron", "rum"] },
  { code: "bg", name: "Bulgarian", aliases: ["bul"] },
  { code: "hr", name: "Croatian", aliases: ["hrv"] },
  { code: "sr", name: "Serbian", aliases: ["srp"] },
  { code: "sl", name: "Slovenian", aliases: ["slv"] },
  { code: "el", name: "Greek", aliases: ["ell", "gre"] },
  { code: "tr", name: "Turkish", aliases: ["tur"] },
  { code: "ru", name: "Russian", aliases: ["rus"] },
  { code: "uk", name: "Ukrainian", aliases: ["ukr"] },
  { code: "et", name: "Estonian", aliases: ["est"] },
  { code: "lv", name: "Latvian", aliases: ["lav"] },
  { code: "lt", name: "Lithuanian", aliases: ["lit"] },
  { code: "ar", name: "Arabic", aliases: ["ara"] },
  { code: "he", name: "Hebrew", aliases: ["heb"] },
  { code: "fa", name: "Persian", aliases: ["fas", "per", "farsi"] },
  { code: "hi", name: "Hindi", aliases: ["hin"] },
  { code: "th", name: "Thai", aliases: ["tha"] },
  { code: "vi", name: "Vietnamese", aliases: ["vie"] },
  { code: "id", name: "Indonesian", aliases: ["ind"] },
  { code: "ms", name: "Malay", aliases: ["msa", "may"] },
  { code: "zh-cn", name: "Chinese (Simplified)", aliases: ["zh", "zho", "chi", "chs", "zh-hans"] },
  { code: "zh-tw", name: "Chinese (Traditional)", aliases: ["cht", "zh-hant"] },
  { code: "ja", name: "Japanese", aliases: ["jpn"] },
  { code: "ko", name: "Korean", aliases: ["kor"] },
];

const _lookup = new Map<string, Language>();
for (const language of LANGUAGES) {
  for (const key of [language.code, language.name, ...language.aliases]) _lookup.set(key.toLowerCase(), language);
}

/**
 * The language for any code or English name ("por", "pt", "Portuguese"), or `null` when unknown.
 */
export function findLanguage(value: string | null | undefined): Language | null {
  if (!value) return null;
  return _lookup.get(value.trim().toLowerCase().replace("_", "-")) ?? null;
}

/**
 * The English name of a language code, or the code itself in capitals when unknown.
 */
export function languageName(value: string | null | undefined): string | null {
  if (!value) return null;
  return findLanguage(value)?.name ?? value.toUpperCase();
}
