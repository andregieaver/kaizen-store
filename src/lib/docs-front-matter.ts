/**
 * The front matter of a docs article (wave 14 unit E2, D442): the small part of YAML the articles use, parsed by hand rather than by a YAML
 * library, so nothing an article holds can do more than name a few values. Pure.
 *
 * Between a first line `---` and the next `---`:
 *
 * - `key: value`, one a line; a key is lower case (`a-z`, digits, `_`, `-`) and appears once;
 * - a value is a plain scalar (`How-to`, `40`, `2026-11-03`, `/admin/{store}/products`), a quoted one (`"a: b"`, `'it''s'`) or a list written
 *   on its line (`[products, orders]`, `[]`, `["a, b", c]`); a plain scalar of digits alone is a number;
 * - `#` starts a comment: a whole line, or after a space at the end of a plain value or a list;
 * - nothing else: no block lists (`- a`), no nested maps, no multi-line values, no anchors or tags. Each is reported with its line.
 */

export type FrontMatterValue = string | number | string[];

export type FrontMatterProblem = { line: number; message: string };

export type FrontMatter = {
  /** Null when the file has no front matter at all. */
  data: Record<string, FrontMatterValue> | null;
  /** The Markdown after the front matter. */
  body: string;
  /** The line of the file the body starts on (1-based), so problems in it can name the file's own line. */
  bodyLine: number;
  problems: FrontMatterProblem[];
};

const KEY = /^([a-z][a-z0-9_-]*)\s*:(?:\s+(.*)|\s*)$/;

/** A file's front matter and body; a file that does not start with `---` has none. */
export function readFrontMatter(source: string): FrontMatter {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return { data: null, body: text, bodyLine: 1, problems: [] };
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end < 0) return { data: null, body: "", bodyLine: lines.length + 1, problems: [{ line: 1, message: "The front matter is not closed with a line ---." }] };
  const { data, problems } = parseFrontMatter(lines.slice(1, end), 2);
  return { data, body: lines.slice(end + 1).join("\n"), bodyLine: end + 2, problems };
}

/** The values of front matter lines; `firstLine` is the file's line of the first one, for the problems. */
export function parseFrontMatter(lines: readonly string[], firstLine = 1): { data: Record<string, FrontMatterValue>; problems: FrontMatterProblem[] } {
  const data: Record<string, FrontMatterValue> = {};
  const problems: FrontMatterProblem[] = [];
  lines.forEach((raw, i) => {
    const line = firstLine + i;
    const text = raw.replace(/\s+$/, "");
    if (text.trim() === "" || text.trimStart().startsWith("#")) return;
    if (/^\s/.test(text)) {
      problems.push({ line, message: "Front matter is one `key: value` a line, with nothing indented: write a list as [a, b]." });
      return;
    }
    const match = KEY.exec(text);
    if (!match) {
      problems.push({ line, message: `Not a \`key: value\` line: ${JSON.stringify(text.slice(0, 60))}.` });
      return;
    }
    const [, key, rest = ""] = match;
    if (Object.hasOwn(data, key)) {
      problems.push({ line, message: `The key ${key} is given twice.` });
      return;
    }
    const value = parseValue(rest);
    if (typeof value === "object" && !Array.isArray(value)) {
      problems.push({ line, message: `${key}: ${value.problem}` });
      return;
    }
    data[key] = value;
  });
  return { data, problems };
}

type Parsed = FrontMatterValue | { problem: string };

/** One value, from the text after `key:`. */
export function parseValue(input: string): Parsed {
  const text = input.trim();
  if (text === "" || text.startsWith("#")) return { problem: "has no value (leave the key out, or write [] for no list)." };
  if (text.startsWith("[")) return parseList(text);
  if (text.startsWith('"') || text.startsWith("'")) {
    const quoted = readQuoted(text, 0);
    if ("problem" in quoted) return quoted;
    const after = text.slice(quoted.end).trim();
    if (after !== "" && !after.startsWith("#")) return { problem: "has text after its closing quote." };
    return quoted.value;
  }
  if (/^[|>&*!{-](?:\s|$)|^[&*!{]/.test(text)) return { problem: "uses YAML this front matter does not read (block values, anchors, tags, maps): write a plain value." };
  const plain = text.replace(/\s+#.*$/, "").trim();
  return /^\d+$/.test(plain) ? Number(plain) : plain;
}

/** `[a, b, "c, d"]`: plain or quoted strings, separated by commas; `[]` is none. */
function parseList(text: string): Parsed {
  const items: string[] = [];
  let i = 1;
  const skip = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  skip();
  if (text[i] === "]") {
    i++;
  } else {
    for (;;) {
      skip();
      let item: string;
      if (text[i] === '"' || text[i] === "'") {
        const quoted = readQuoted(text, i);
        if ("problem" in quoted) return quoted;
        item = quoted.value;
        i = quoted.end;
      } else {
        const start = i;
        while (i < text.length && text[i] !== "," && text[i] !== "]") i++;
        item = text.slice(start, i).trim();
        if (/[[{]/.test(item)) return { problem: "is a list inside a list, which front matter does not hold." };
      }
      if (item === "") return { problem: "has an empty item in its list." };
      items.push(item);
      skip();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        break;
      }
      return { problem: "is a list without its closing ]." };
    }
  }
  const after = text.slice(i).trim();
  if (after !== "" && !after.startsWith("#")) return { problem: "has text after its list." };
  return items;
}

/** A quoted string from `start`: `"…"` with `\"` and `\\`, or `'…'` with `''` for a quote. */
function readQuoted(text: string, start: number): { value: string; end: number } | { problem: string } {
  const quote = text[start];
  let value = "";
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (quote === '"' && char === "\\") {
      const next = text[i + 1];
      if (next === '"' || next === "\\") {
        value += next;
        i++;
        continue;
      }
      return { problem: "has an escape other than \\\" or \\\\ in a quoted value." };
    }
    if (char === quote) {
      if (quote === "'" && text[i + 1] === "'") {
        value += "'";
        i++;
        continue;
      }
      return { value, end: i + 1 };
    }
    value += char;
  }
  return { problem: "has a quoted value without its closing quote." };
}
