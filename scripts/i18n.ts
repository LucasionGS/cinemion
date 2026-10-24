/**
 * Keeps translations in step with the English file, which is the template every language follows.
 *
 * Usage: deno task i18n [command]
 *   check            Compare every language with English (the default)
 *   new <CODE>       Start a language: a copy of English with empty lines to fill in
 *   sync <CODE>      Add lines English gained (empty) and drop ones it lost, in English's order
 *   help             Show this
 */
import fs from "node:fs";
import Path from "node:path";

type Entry = string | Plural | Group;
interface Plural {
  [form: string]: string;
}
interface Group {
  [key: string]: Entry;
}

const LOCALES_DIR = Path.join(import.meta.dirname!, "..", "client", "src", "i18n", "locales");
const SOURCE_DIR = Path.join(import.meta.dirname!, "..", "client", "src");
const PLURAL_FORMS = ["zero", "one", "two", "few", "many", "other"];

function isPlural(entry: Entry): entry is Plural {
  return typeof entry === "object" && typeof entry.other === "string";
}

function read(code: string): Group {
  return JSON.parse(fs.readFileSync(Path.join(LOCALES_DIR, `${code}.json`), "utf8"));
}

function write(code: string, messages: Group) {
  fs.writeFileSync(Path.join(LOCALES_DIR, `${code}.json`), `${JSON.stringify(messages, null, 2)}\n`);
}

/**
 * Every line as `key → entry`, with plurals kept whole.
 */
function flatten(group: Group, prefix = "", into = new Map<string, string | Plural>()) {
  for (const [key, entry] of Object.entries(group)) {
    if (typeof entry === "string" || isPlural(entry)) into.set(`${prefix}${key}`, entry);
    else flatten(entry, `${prefix}${key}.`, into);
  }
  return into;
}

/**
 * The `{placeholders}` and `<tags>` of a line, sorted, so two languages can be compared.
 */
function markers(text: string) {
  const placeholders = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const tags = [...text.matchAll(/<(\w+)>/g)].map((m) => m[1]);
  return { placeholders: [...new Set(placeholders)].sort().join(","), tags: [...new Set(tags)].sort().join(",") };
}

/**
 * The plural forms a language needs, like `one, other` for English or `one, few, many, other` for Polish.
 */
function formsFor(code: string) {
  const forms = new Intl.PluralRules(code).resolvedOptions().pluralCategories as string[];
  return PLURAL_FORMS.filter((f) => forms.includes(f));
}

function languages() {
  return fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).filter((c) => c !== "en").sort();
}

/**
 * A copy of `template` in `code`'s shape: lines from `existing` where it has them, else empty.
 */
function shape(template: Group, existing: Group | undefined, code: string): Group {
  const result: Group = {};
  for (const [key, entry] of Object.entries(template)) {
    const have = existing?.[key];
    if (typeof entry === "string") {
      result[key] = typeof have === "string" ? have : "";
    }
    else if (isPlural(entry)) {
      const plural: Plural = {};
      for (const form of formsFor(code)) plural[form] = have && isPlural(have) && typeof have[form] === "string" ? have[form] : "";
      result[key] = plural;
    }
    else {
      result[key] = shape(entry, have && typeof have === "object" && !isPlural(have) ? have as Group : undefined, code);
    }
  }
  return result;
}

//#region Commands

function check() {
  const english = flatten(read("en"));
  let errors = 0;

  // Lines nobody uses any more make the template longer for every translator
  const source = sourceText();
  const unused = [...english.keys()].filter((key) => !source.includes(`"${key}"`));
  console.log(`English: ${english.size} lines.`);
  if (unused.length > 0) {
    console.log(`  ${unused.length} not used anywhere in the client:`);
    for (const key of unused) console.log(`    ${key}`);
  }

  for (const code of languages()) {
    const lines = flatten(read(code));
    const problems: string[] = [];
    let missing = 0;
    for (const [key, entry] of english) {
      const theirs = lines.get(key);
      if (theirs === undefined || theirs === "" || (typeof theirs === "object" && Object.values(theirs).every((form) => form === ""))) {
        missing++;
        continue;
      }
      if (typeof entry === "string") {
        if (typeof theirs !== "string") {
          problems.push(`${key}: should be one line, not plural forms.`);
          continue;
        }
        compare(key, entry, theirs, problems);
      }
      else {
        if (typeof theirs === "string") {
          problems.push(`${key}: should have plural forms (${formsFor(code).join(", ")}).`);
          continue;
        }
        for (const form of formsFor(code)) {
          if (!theirs[form]) problems.push(`${key}: the "${form}" form is missing.`);
          else compare(`${key}.${form}`, entry.other, theirs[form], problems, true);
        }
      }
    }
    for (const key of lines.keys()) {
      if (!english.has(key)) problems.push(`${key}: English doesn't have this line. Run "deno task i18n sync ${code}" to drop it.`);
    }
    const done = english.size - missing;
    console.log(`\n${code}: ${done} of ${english.size} lines translated (${Math.floor(done / english.size * 100)}%).`);
    if (missing > 0) console.log(`  ${missing} still to translate; English shows in their place until then.`);
    for (const problem of problems) console.log(`  ${problem}`);
    errors += problems.length;
  }

  if (errors > 0) {
    console.log(`\n${errors} ${errors === 1 ? "problem" : "problems"} to fix.`);
    return 1;
  }
  console.log("\nDone! Every language matches English.");
  return 0;
}

/**
 * Placeholders and tags must be the same in both languages; a plural form may leave out `{count}` ("a clip").
 */
function compare(key: string, english: string, theirs: string, problems: string[], plural = false) {
  const a = markers(english);
  const b = markers(theirs);
  const placeholders = plural ? b.placeholders.split(",").filter(Boolean).every((p) => a.placeholders.split(",").includes(p)) : a.placeholders === b.placeholders;
  if (!placeholders) problems.push(`${key}: has the placeholders ${list(b.placeholders, "{", "}")} where English has ${list(a.placeholders, "{", "}")}.`);
  if (a.tags !== b.tags) problems.push(`${key}: has the tags ${list(b.tags, "<", ">")} where English has ${list(a.tags, "<", ">")}.`);
}

function list(names: string, open: string, close: string) {
  return names ? names.split(",").map((n) => `${open}${n}${close}`).join(" ") : "none";
}

function create(code: string | undefined) {
  if (!code || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) {
    console.log("Start a new language from the English file.\nUsage: deno task i18n new <CODE>\n\nCODE is a language tag like de, fr or pt-BR.");
    return 2;
  }
  if (fs.existsSync(Path.join(LOCALES_DIR, `${code}.json`))) {
    console.log(`${code}.json is already there. Use "deno task i18n sync ${code}" to bring it up to date.`);
    return 1;
  }
  write(code, shape(read("en"), undefined, code));
  const name = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  console.log(`Done! Made client/src/i18n/locales/${code}.json with every line empty.`);
  console.log(`Fill in the lines, then add it to LANGUAGES in client/src/i18n/I18n.ts:`);
  console.log(`  { code: "${code}", name: "${name}", load: () => import("./locales/${code}.json", { with: { type: "json" } }).then((m) => m.default) },`);
  return 0;
}

function sync(code: string | undefined) {
  if (!code) {
    console.log("Bring a language in step with English: add its new lines (empty) and drop the ones it lost.\nUsage: deno task i18n sync <CODE>");
    return 2;
  }
  if (!fs.existsSync(Path.join(LOCALES_DIR, `${code}.json`))) {
    console.log(`There's no ${code}.json yet. Start one with "deno task i18n new ${code}".`);
    return 1;
  }
  write(code, shape(read("en"), read(code), code));
  console.log(`Done! ${code}.json has the same lines as English, in the same order.`);
  return 0;
}

function sourceText() {
  let text = "";
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const path = Path.join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) text += fs.readFileSync(path, "utf8");
    }
  };
  walk(SOURCE_DIR);
  return text;
}

function help() {
  console.log(`Keeps translations in step with the English file.

  check            Compare every language with English (the default)
  new <CODE>       Start a language: a copy of English with empty lines to fill in
  sync <CODE>      Add lines English gained (empty) and drop ones it lost
  help             Show this

Run "deno task i18n help" for this list.`);
  return 0;
}

//#endregion

const [command, code] = Deno.args;
let exitCode: number;
switch (command ?? "check") {
  case "check":
    exitCode = check();
    break;
  case "new":
    exitCode = create(code);
    break;
  case "sync":
    exitCode = sync(code);
    break;
  case "help":
    exitCode = help();
    break;
  default:
    console.log(`Command not found: ${command}. Run "deno task i18n help" for the list.`);
    exitCode = 2;
}
Deno.exit(exitCode);
