import { fillWords } from "./admin-fill";

/**
 * Analytics' notes in the admin's language (D152, D312). A report writes its notes once, in English, from the templates of
 * `screens.analyticsNotes` (`src/lib/admin-messages/screens.en.ts`), because the AI manager's tools and the exports read the same report;
 * a page in another language says each note in its own with `noteIn()`, which knows a note by the English template it was written from and
 * fills the same template of the other language with the values it carried. A value that is itself a template without placeholders (a
 * phrase) is said in the other language too, and a number written the English way is written the way of the page's locale. A note no
 * template knows is shown as written: never dropped. Pure.
 */

export type NoteTree = { readonly [key: string]: string | NoteTree };

/** What a page does with a report's note before it draws it. */
export type Say = (note: string) => string;

/** English, as the report wrote it. */
export const asWritten: Say = (note) => note;

type Pattern = { path: string; re: RegExp; names: string[]; literal: number };

function leaves(tree: NoteTree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[path, value] as [string, string]] : leaves(value, path);
  });
}

function at(tree: NoteTree, path: string): string | null {
  let node: string | NoteTree | undefined = tree;
  for (const key of path.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = node[key];
  }
  return typeof node === "string" ? node : null;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PATTERNS = new WeakMap<NoteTree, Pattern[]>();

/** Each template as a pattern that matches the notes written from it, the most specific (most fixed text) first. */
function patternsOf(tree: NoteTree): Pattern[] {
  const known = PATTERNS.get(tree);
  if (known) return known;
  const patterns = leaves(tree)
    .map(([path, template]) => {
      const names: string[] = [];
      const parts = template.split(/\{(\w+)\}/g);
      const source = parts.map((part, i) => (i % 2 === 1 ? (names.push(part), "(.+?)") : escape(part))).join("");
      const literal = parts.filter((_, i) => i % 2 === 0).join("").length;
      return { path, re: new RegExp(`^${source}$`, "s"), names, literal };
    })
    .sort((a, b) => b.literal - a.literal);
  PATTERNS.set(tree, patterns);
  return patterns;
}

/** A number written the English way (`1,234`, `4.5%`), written the locale's way; anything else as it is. */
function numberIn(value: string, locale: string): string {
  const percent = /^(-?\d{1,3}(?:,\d{3})*|-?\d+)(?:\.(\d+))?[\s\u00a0]?%$/.exec(value);
  if (percent) {
    const decimals = percent[2]?.length ?? 0;
    const n = Number(`${percent[1].replace(/,/g, "")}${percent[2] ? `.${percent[2]}` : ""}`) / 100;
    return new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
  }
  if (/^-?\d{1,3}(?:,\d{3})+$/.test(value)) return new Intl.NumberFormat(locale).format(Number(value.replace(/,/g, "")));
  return value;
}

/**
 * `note`, written from one of `from`'s templates, in the language of `to` (the same tree in another language); as written when no
 * template matches or `to` lacks the template.
 */
export function noteIn(note: string, from: NoteTree, to: NoteTree, locale = "en"): string {
  if (from === to) return note;
  const patterns = patternsOf(from);
  for (const pattern of patterns) {
    const match = pattern.re.exec(note);
    if (!match) continue;
    const target = at(to, pattern.path);
    if (target === null) return note;
    const values: Record<string, string> = {};
    pattern.names.forEach((name, i) => {
      const value = match[i + 1];
      const phrase = patterns.find((p) => p.names.length === 0 && p.re.test(value));
      values[name] = phrase ? (at(to, phrase.path) ?? value) : numberIn(value, locale);
    });
    return fillWords(target, values);
  }
  return note;
}

/** A page's `Say`: every note into `to`'s language, or as written when the page is in English (`to` is `from`). */
export function sayIn(from: NoteTree, to: NoteTree, locale: string): Say {
  return from === to ? asWritten : (note) => noteIn(note, from, to, locale);
}
