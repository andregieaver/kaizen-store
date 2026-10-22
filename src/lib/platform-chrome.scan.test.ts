import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { platformEn } from "./messages/platform-en";
import { platformNb } from "./messages/platform-nb";

/**
 * Kaizena Flow's own site in every language (D312 P2): the words of its chrome (header, footer, menu, the routes' own words, the language
 * switch and bar) come from the catalogues (`platformText(lang)`), never written into a component, so a Norwegian page has no English in it.
 * The scan reads the files and fails on words between tags or in a prop a person reads; names are allowed.
 */

const ROOT = join(process.cwd(), "src/components");
const CHROME = [
  "platform-layout.tsx",
  "platform-root.tsx",
  "language-switch.tsx",
  ...readdirSync(join(ROOT, "platform-routes")).filter((f) => f.endsWith(".tsx")).map((f) => `platform-routes/${f}`),
];

/** Words that are the same in every language. */
const NAMES = new Set(["Kaizena Flow", "Kaizen Life"]);

const JSX_TEXT = />\s*([^<>{}]*[A-Za-zÆØÅæøå]{2,}[^<>{}]*?)\s*</g;
const READ_PROPS = /\b(label|title|description|placeholder|alt|aria-label|legend|hint|byline|siteName)=\s*"([^"]+)"/g;
const READ_KEYS = /\b(label|title|description|alt|byline|siteName):\s*"([^"]+)"/g;

function englishIn(source: string): string[] {
  const found: string[] = [];
  for (const re of [JSX_TEXT, READ_PROPS, READ_KEYS]) {
    for (const match of source.matchAll(re)) {
      const words = (match[2] ?? match[1]).trim();
      if (!/[A-Za-z]{2,}/.test(words) || NAMES.has(words)) continue;
      // Code between tags (a generic, an arrow), not words.
      if (/[=;()]|=>|&&/.test(words)) continue;
      found.push(words);
    }
  }
  return found;
}

describe("the platform's chrome (D312 P2)", () => {
  it("has no words of its own: every word comes from a catalogue", () => {
    const found = CHROME.flatMap((file) => englishIn(readFileSync(join(ROOT, file), "utf8")).map((words) => `${file}: ${words}`));
    expect(found).toEqual([]);
  });

  it("catches words written into a component", () => {
    expect(englishIn('<p className="x">Start your store</p>')).toEqual(["Start your store"]);
    expect(englishIn('<Image alt="A shop" />')).toEqual(["A shop"]);
    expect(englishIn("<h1>Kaizena Flow</h1><b>{m.title}</b>")).toEqual([]);
  });

  it("has Norwegian for every English text, and the Norwegian is not the English", () => {
    const same: string[] = [];
    const walk = (en: unknown, nb: unknown, path: string) => {
      if (typeof en === "string") {
        expect(typeof nb, path).toBe("string");
        if (en === nb && /[a-z]{3,} [a-z]{3,}/i.test(en)) same.push(path);
        return;
      }
      if (typeof en === "function") return expect(typeof nb, path).toBe("function");
      for (const key of Object.keys(en as object)) walk((en as Record<string, unknown>)[key], (nb as Record<string, unknown>)?.[key], `${path}.${key}`);
    };
    walk(platformEn, platformNb, "platform");
    expect(same).toEqual([]);
  });
});
