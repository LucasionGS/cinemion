# Translating Cinemion

Every line of Cinemion's interface lives in one file per language, in `client/src/i18n/locales/`. English
(`en.json`) is the template: other languages have exactly the same keys, with their own text. A line that isn't
translated yet shows in English, so a language can be added a bit at a time.

## Adding a language

You need [Deno](https://deno.com) and a copy of the repository.

1. Start the file. Use the language's tag, like `de`, `fr`, `nl` or `pt-BR`:
   ```sh
   deno task i18n new de
   ```
   This makes `client/src/i18n/locales/de.json` with every line from English, all empty.
2. Fill in the lines. Keep the file's shape: only change the text between the quotes on the right.
3. Add the language to the list near the top of `client/src/i18n/I18n.ts`. `deno task i18n new` prints the exact line,
   for example:
   ```ts
   { code: "de", name: "Deutsch", load: () => import("./locales/de.json", { with: { type: "json" } }).then((m) => m.default) },
   ```
   `name` is the language's name in itself, as people look for it in the language picker.
4. Check it:
   ```sh
   deno task i18n
   ```
   It says how much is translated and lists anything to fix. Then try it in Cinemion: Settings › Your profile ›
   Language.

When English gains or loses lines later, `deno task i18n sync de` adds the new lines (empty) and drops the old ones,
in the same order as English, keeping everything already translated.

## What's in a line

- **Placeholders** like `{name}`, `{count}` or `{version}` are filled in by Cinemion. Keep them exactly as they are,
  but move them wherever your language needs them: `"Cinemion {version} is out"` → `"Cinemion {version} ist da"`.
- **Tags** like `<link>here's how</link>` or `<code>?mode=tv</code>` mark a part that's drawn differently (a link, a
  piece of code). Keep the tags and translate the words between them, unless the part is code, which stays as it is.
- **Plurals** are groups with one line per form:
  ```json
  "clips": { "one": "{count} clip", "other": "{count} clips" }
  ```
  Languages have different forms (Polish has `one`, `few`, `many` and `other`; Japanese only `other`), and
  `deno task i18n new` and `sync` make the forms your language needs. The rules are
  [the CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html).
  A form may leave out `{count}` ("a clip") when the language says it that way.
- Keys like `settings.about.title` say where a line shows up. Don't change them.
- Dates, numbers and sizes are written your language's way by themselves.

## Tone

Cinemion talks like a friendly person, not a manual: short, plain sentences, no technical words where an everyday one
works ("converted", not "transcoded"). Please keep that feel in your language, and use the informal "you" where your
language has a choice (like German "du").

## Messages from the server

The server speaks English: error messages, task names, the activity feed and so on. They're lines too, in the
`server` group of the English file, collected straight from the server's code. Translate them like any other line;
Cinemion recognises each English message when it arrives and shows your line instead, with the values (names,
numbers, paths) carried over into your `{placeholders}`.

The `server` group is made by a tool, so don't edit it in `en.json` by hand. When the server's messages change, run
`deno task i18n server` to collect them again (`deno task i18n` says when that's needed), then
`deno task i18n sync <CODE>` for each language. The keys come from the first words and a short hash of the English
text, so a changed message becomes a new line to translate.

Push notifications and emails are worded by the server in each profile's own language (Settings › Your profile ›
Language), from the `notifications` group.

## What isn't translated

Titles, plots and artwork come from the metadata sources in the language set in Settings › Metadata. The server log
(Settings › Logs) stays in English, so it reads the same in bug reports.
