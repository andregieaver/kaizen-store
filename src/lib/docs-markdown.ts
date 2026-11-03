/**
 * The docs' Markdown (wave 14 unit E2, D442): a safe subset read into a tree, never into HTML. Pure.
 *
 * What an article may hold: headings `##` to `####` (the title is the front matter's, so no `#`), paragraphs with **strong**, *emphasis*,
 * `code` and links, lists (`-`, `*`, `+`, `1.`, nested by indenting), tables (`| a | b |` with a `|---|` line), fenced code with its language
 * (coloured by `highlightCode()`), callouts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`), quotes, a rule (`---`) and
 * pictures from the repository on a line of their own (`![What it shows](/kaizen/docs/…)`, files under `public/kaizen/docs/`, served on every
 * host).
 *
 * What it may not: HTML of any kind (`<b>`, `<script>`) is kept as the characters typed and reported, and a link goes only to another docs
 * page (`/docs/owners/…#anchor`, written as on Kaizena Flow's own site; `docsPath()` makes it the docs host's when they have one), a heading
 * of the page (`#anchor`), Kaizena Flow's own site (`/status`, `/sign-up`; the admin as `/admin/{store}/…`, checked against the admin map) or
 * an `https://`, `http://` or `mailto:` address. Anything else (`javascript:`, `data:`, `//host`, a relative path) is refused: its words stay,
 * as text, and the problem is reported, so the content check (`docs-content.test.ts`) fails on it.
 *
 * The tree is drawn by React (`DocsMarkdown`), which escapes every text: nothing here is ever HTML.
 */

import { highlightCode, knownCodeLanguage, type CodeToken } from "./docs-highlight";

export type DocHref =
  /** Another docs page (`path` "" is the docs' front page, "changelog" the changelog), as `/docs/…` on Kaizena Flow's own site. */
  | { kind: "doc"; path: string; anchor: string | null }
  /** A heading of the same page. */
  | { kind: "anchor"; id: string }
  /** A page of Kaizena Flow's own site (`/status`, `/sign-up?x=1`). */
  | { kind: "site"; path: string }
  /** A page of the admin as the admin map names it (`/admin/{store}/products`), the store left as `{store}`. */
  | { kind: "admin"; path: string }
  | { kind: "external"; url: string };

export type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: DocHref; children: Inline[] }
  | { type: "break" };

export const CALLOUT_TONES = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];
export type TableAlign = "left" | "center" | "right" | null;

export type Block =
  | { type: "heading"; depth: 2 | 3 | 4; id: string; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "code"; lang: string | null; value: string; tokens: CodeToken[] }
  | { type: "table"; align: TableAlign[]; head: Inline[][]; rows: Inline[][][] }
  | { type: "callout"; tone: CalloutTone; children: Block[] }
  | { type: "quote"; children: Block[] }
  | { type: "image"; src: string; alt: string }
  | { type: "rule" };

export type DocHeading = { depth: 2 | 3 | 4; id: string; text: string };
export type MarkdownProblem = { line: number; message: string };

export type MarkdownDoc = {
  blocks: Block[];
  /** Every heading, in order, with its id (for *On this page*: the h2s and h3s). */
  headings: DocHeading[];
  /** Every link with the line it is on, for the content check. */
  links: { href: DocHref; line: number }[];
  images: { src: string; line: number }[];
  problems: MarkdownProblem[];
};

type Line = { text: string; line: number };

type Ctx = {
  problems: MarkdownProblem[];
  headings: DocHeading[];
  links: { href: DocHref; line: number }[];
  images: { src: string; line: number }[];
  ids: Map<string, number>;
};

/** The article's body read into blocks; `firstLine` is the file's line of its first line, for the problems. */
export function parseMarkdown(body: string, firstLine = 1): MarkdownDoc {
  const ctx: Ctx = { problems: [], headings: [], links: [], images: [], ids: new Map() };
  const lines = body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((text, i) => ({ text: text.replace(/\t/g, "    ").replace(/\s+$/, ""), line: firstLine + i }));
  const blocks = parseBlocks(lines, ctx);
  return { blocks, headings: ctx.headings, links: ctx.links, images: ctx.images, problems: ctx.problems };
}

// ---------------------------------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------------------------------

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const TABLE_SEP = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/;
const IMAGE_LINE = /^ *!\[([^\]]*)\]\(\s*([^\s)]*)\s*\) *$/;
const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;
const IMAGE_SRC = /^\/kaizen\/docs\/[a-z0-9][a-z0-9/_.-]*\.(?:png|jpe?g|webp|avif|gif|svg)$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;

const indentOf = (text: string) => /^ */.exec(text)?.[0].length ?? 0;
const blank = (line: Line | undefined) => !line || line.text.trim() === "";
const isTable = (lines: Line[], i: number) => lines[i].text.includes("|") && Boolean(lines[i + 1] && TABLE_SEP.test(lines[i + 1].text) && lines[i + 1].text.includes("-"));

/** Whether a line starts a block of its own, which ends a paragraph. */
function startsBlock(lines: Line[], i: number): boolean {
  const text = lines[i].text;
  if (FENCE.test(text) || HEADING.test(text) || QUOTE.test(text) || RULE.test(text)) return true;
  const list = LIST.exec(text);
  if (list && list[1].length <= 3 && list[4] !== "") return true;
  return isTable(lines, i);
}

function parseBlocks(lines: Line[], ctx: Ctx): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const { text, line } = lines[i];
    if (text.trim() === "") {
      i++;
      continue;
    }

    const fence = FENCE.exec(text);
    if (fence) {
      const [, marks, rawLang] = fence;
      const body: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        const close = lines[i].text.trim();
        if (close.startsWith(marks[0].repeat(marks.length)) && /^(`+|~+)$/.test(close) && close[0] === marks[0]) {
          closed = true;
          i++;
          break;
        }
        body.push(lines[i].text);
        i++;
      }
      if (!closed) ctx.problems.push({ line, message: "A code block is not closed with its fence." });
      const lang = rawLang ? rawLang.toLowerCase() : null;
      if (lang && !knownCodeLanguage(lang)) ctx.problems.push({ line, message: `The code language ${JSON.stringify(rawLang)} is not one the docs know (bash, json, js, ts, python, php, http, yaml, text).` });
      const value = body.join("\n");
      blocks.push({ type: "code", lang, value, tokens: highlightCode(value, lang) });
      continue;
    }

    const heading = HEADING.exec(text);
    if (heading) {
      const hashes = heading[1].length;
      let words = heading[2] ?? "";
      let explicit: string | null = null;
      const own = /\s*\{#([^}]*)\}$/.exec(words);
      if (own) {
        words = words.slice(0, own.index);
        if (ID.test(own[1])) explicit = own[1];
        else ctx.problems.push({ line, message: `The heading id {#${own[1]}} is not lower-case letters, digits and hyphens.` });
      }
      if (hashes === 1) ctx.problems.push({ line, message: "A page's title is its front matter's: start its headings at ##." });
      if (hashes > 4) ctx.problems.push({ line, message: "Headings go to #### at most." });
      if (words.trim() === "") ctx.problems.push({ line, message: "A heading has no words." });
      const children = parseInline(words.trim(), line, ctx);
      const depth = Math.min(4, Math.max(2, hashes)) as 2 | 3 | 4;
      const id = uniqueId(explicit ?? headingId(plainText(children)), ctx, line, explicit !== null);
      ctx.headings.push({ depth, id, text: plainText(children) });
      blocks.push({ type: "heading", depth, id, children });
      i++;
      continue;
    }

    if (RULE.test(text)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    if (QUOTE.test(text)) {
      const inner: Line[] = [];
      while (i < lines.length && QUOTE.test(lines[i].text)) {
        inner.push({ text: (QUOTE.exec(lines[i].text) as RegExpExecArray)[1], line: lines[i].line });
        i++;
      }
      const callout = inner.length > 0 ? CALLOUT.exec(inner[0].text.trim()) : null;
      if (callout) {
        blocks.push({ type: "callout", tone: callout[1].toLowerCase() as CalloutTone, children: parseBlocks(inner.slice(1), ctx) });
      } else {
        if (/^\[![A-Za-z]+\]/.test(inner[0]?.text.trim() ?? "")) ctx.problems.push({ line, message: "A callout is one of [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or [!CAUTION], alone on its first line." });
        blocks.push({ type: "quote", children: parseBlocks(inner, ctx) });
      }
      continue;
    }

    const list = LIST.exec(text);
    if (list && list[1].length <= 3) {
      const parsed = parseList(lines, i, ctx);
      blocks.push(parsed.block);
      i = parsed.next;
      continue;
    }

    if (isTable(lines, i)) {
      const parsed = parseTable(lines, i, ctx);
      blocks.push(parsed.block);
      i = parsed.next;
      continue;
    }

    const image = IMAGE_LINE.exec(text);
    if (image) {
      const [, alt, src] = image;
      if (!IMAGE_SRC.test(src)) {
        ctx.problems.push({ line, message: `A picture comes from the repository, under /kaizen/docs/ (public/kaizen/docs/): ${JSON.stringify(src)} is refused.` });
      } else {
        if (alt.trim() === "") ctx.problems.push({ line, message: "A picture says what it shows: write it between the brackets ![…]." });
        ctx.images.push({ src, line });
        blocks.push({ type: "image", src, alt: alt.trim() });
      }
      i++;
      continue;
    }

    // A paragraph: lines up to a blank one or the start of another block.
    const para: Line[] = [lines[i]];
    i++;
    while (i < lines.length && !blank(lines[i]) && !startsBlock(lines, i)) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", children: inlineLines(para, ctx) });
  }
  return blocks;
}

/** A paragraph's lines as inline content: a line break where a line ends in two spaces or a backslash, else a space. */
function inlineLines(lines: Line[], ctx: Ctx): Inline[] {
  const out: Inline[] = [];
  lines.forEach((entry, i) => {
    const last = i === lines.length - 1;
    // The line's own trailing spaces are already gone (`parseMarkdown()`): a hard break is written with a backslash at its end.
    const hard = !last && /\\$/.test(entry.text);
    const text = (hard ? entry.text.slice(0, -1) : entry.text).trim();
    out.push(...parseInline(text, entry.line, ctx));
    if (!last) out.push(hard ? { type: "break" } : { type: "text", value: " " });
  });
  return mergeText(out);
}

function parseList(lines: Line[], start: number, ctx: Ctx): { block: Block; next: number } {
  const first = LIST.exec(lines[start].text) as RegExpExecArray;
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: Block[][] = [];
  let i = start;
  while (i < lines.length) {
    const marker = LIST.exec(lines[i].text);
    if (!marker || marker[1].length !== base || /\d/.test(marker[2]) !== ordered) break;
    const spaces = marker[3].length;
    const content = base + marker[2].length + (spaces === 0 || spaces > 4 ? 1 : spaces);
    const item: Line[] = [{ text: marker[4], line: lines[i].line }];
    i++;
    while (i < lines.length) {
      const entry = lines[i];
      if (blank(entry)) {
        // A blank line stays in the item only when what follows is indented under it.
        let j = i;
        while (j < lines.length && blank(lines[j])) j++;
        if (j < lines.length && indentOf(lines[j].text) > base) {
          for (; i < j; i++) item.push({ text: "", line: lines[i].line });
          continue;
        }
        break;
      }
      const indent = indentOf(entry.text);
      if (indent > base) {
        item.push({ text: entry.text.slice(Math.min(indent, content)), line: entry.line });
        i++;
        continue;
      }
      if (startsBlock(lines, i)) break;
      // A lazy line continues the item's paragraph.
      item.push({ text: entry.text.trim(), line: entry.line });
      i++;
    }
    items.push(parseBlocks(item, ctx));
    // A blank line between two items of the list keeps the list going.
    let j = i;
    while (j < lines.length && blank(lines[j])) j++;
    const again = j < lines.length ? LIST.exec(lines[j].text) : null;
    if (again && again[1].length === base && /\d/.test(again[2]) === ordered) i = j;
    else break;
  }
  return { block: { type: "list", ordered, start: ordered ? Number.parseInt(first[2], 10) : 1, items }, next: i };
}

function parseTable(lines: Line[], start: number, ctx: Ctx): { block: Block; next: number } {
  const head = splitRow(lines[start].text);
  const align: TableAlign[] = splitRow(lines[start + 1].text).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
  if (align.length !== head.length) ctx.problems.push({ line: lines[start + 1].line, message: "A table's dividing line has a different number of columns from its head." });
  const width = head.length;
  const rows: Inline[][][] = [];
  let i = start + 2;
  while (i < lines.length && !blank(lines[i]) && lines[i].text.includes("|")) {
    const cells = splitRow(lines[i].text);
    if (cells.length > width) ctx.problems.push({ line: lines[i].line, message: `A table row has ${cells.length} cells for ${width} columns.` });
    const filled = Array.from({ length: width }, (_, c) => cells[c] ?? "");
    rows.push(filled.map((cell) => parseInline(cell, lines[i].line, ctx)));
    i++;
  }
  return {
    block: {
      type: "table",
      align: Array.from({ length: width }, (_, c) => align[c] ?? null),
      head: head.map((cell) => parseInline(cell, lines[start].line, ctx)),
      rows,
    },
    next: i,
  };
}

/** A table row's cells: split on `|` outside code spans; `\|` is a `|` in a cell, in a code span too (as GitHub reads a table). */
function splitRow(text: string): string[] {
  let row = text.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let code = 0;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === "\\" && row[i + 1] === "|") {
      // In code the backslash is no escape of its own, so it goes here; outside, the inline parser reads `\|` as `|`.
      cell += code > 0 ? "|" : "\\|";
      i++;
      continue;
    }
    if (char === "`") {
      let run = 1;
      while (row[i + run] === "`") run++;
      code = code === 0 ? run : code === run ? 0 : code;
      cell += "`".repeat(run);
      i += run - 1;
      continue;
    }
    if (char === "|" && code === 0) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

// ---------------------------------------------------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------------------------------------------------

const ESCAPABLE = "\\`*_{}[]()#+-.!|<>~";

/** What HTML would read as markup: a tag (`<b>`, `</div>`, `<img src=x>`), a comment, a declaration or an instruction. `a<b` is text. */
const HTML_TAG = /^(?:<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>|<!--|<![A-Za-z[]|<\?)/;

function parseInline(text: string, line: number, ctx: Ctx, inLink = false): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ type: "text", value: buffer });
    buffer = "";
  };
  let html = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\" && i + 1 < text.length && ESCAPABLE.includes(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (char === "`") {
      let run = 1;
      while (text[i + run] === "`") run++;
      const close = findRun(text, "`", run, i + run);
      if (close >= 0) {
        flush();
        let value = text.slice(i + run, close);
        if (value.length > 2 && value.startsWith(" ") && value.endsWith(" ") && value.trim() !== "") value = value.slice(1, -1);
        out.push({ type: "code", value });
        i = close + run;
        continue;
      }
      buffer += "`".repeat(run);
      i += run;
      continue;
    }
    if (char === "!" && text[i + 1] === "[") {
      const image = readLink(text, i + 1);
      if (image) {
        ctx.problems.push({ line, message: "A picture stands on a line of its own: ![What it shows](/kaizen/docs/…)." });
        buffer += image.label;
        i = image.end;
        continue;
      }
    }
    if (char === "[" && !inLink) {
      const link = readLink(text, i);
      if (link) {
        flush();
        const href = classifyHref(link.href);
        const children = parseInline(link.label, line, ctx, true);
        if (href) {
          out.push({ type: "link", href, children });
          ctx.links.push({ href, line });
        } else {
          ctx.problems.push({ line, message: `The link ${JSON.stringify(link.href)} is refused: a link goes to /docs/…, #a-heading, a page of Kaizena Flow's site (/…) or an https, http or mailto address.` });
          out.push(...children);
        }
        i = link.end;
        continue;
      }
    }
    if (char === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(text.slice(i));
      if (auto && !inLink) {
        const href = classifyHref(auto[1]);
        if (href) {
          flush();
          out.push({ type: "link", href, children: [{ type: "text", value: auto[1].replace(/^mailto:/i, "") }] });
          ctx.links.push({ href, line });
          i += auto[0].length;
          continue;
        }
      }
      if (!html && HTML_TAG.test(text.slice(i))) {
        html = true;
        ctx.problems.push({ line, message: "HTML is not allowed in the docs: it is shown as the characters typed. Write it in `code` if it is an example." });
      }
    }
    if (char === "*" || char === "_") {
      const emphasis = readEmphasis(text, i);
      if (emphasis) {
        flush();
        out.push({ type: emphasis.strong ? "strong" : "em", children: parseInline(emphasis.inner, line, ctx, inLink) });
        i = emphasis.end;
        continue;
      }
    }
    buffer += char;
    i++;
  }
  flush();
  return mergeText(out);
}

/** Where a run of exactly `length` `char`s starts at or after `from`, or -1. */
function findRun(text: string, char: string, length: number, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] !== char) continue;
    let run = 1;
    while (text[i + run] === char) run++;
    if (run === length) return i;
    i += run - 1;
  }
  return -1;
}

/** `[label](href)` or `[label](href "title")` from `start` (the `[`); the title is dropped. */
function readLink(text: string, start: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let j = start;
  for (; j < text.length; j++) {
    const char = text[j];
    if (char === "\\") {
      j++;
      continue;
    }
    if (char === "`") {
      let run = 1;
      while (text[j + run] === "`") run++;
      const close = findRun(text, "`", run, j + run);
      if (close >= 0) j = close + run - 1;
      continue;
    }
    if (char === "[") depth++;
    if (char === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (j >= text.length || text[j + 1] !== "(") return null;
  const target = /^\(\s*(<[^<>\n]*>|[^\s()<>]*(?:\([^\s()<>]*\)[^\s()<>]*)*)(?:\s+"[^"]*")?\s*\)/.exec(text.slice(j + 1));
  if (!target) return null;
  return { label: text.slice(start + 1, j), href: target[1].replace(/^<|>$/g, ""), end: j + 1 + target[0].length };
}

/** `**strong**`, `__strong__`, `*em*` or `_em_` from `start`; an underscore inside a word (`snake_case`) is a character. */
function readEmphasis(text: string, start: number): { strong: boolean; inner: string; end: number } | null {
  const char = text[start];
  const word = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
  if (char === "_" && word(text[start - 1])) return null;
  const strong = text[start + 1] === char;
  const size = strong ? 2 : 1;
  const open = start + size;
  if (open >= text.length || /\s/.test(text[open]) || text[open] === char) return null;
  for (let j = open + 1; j < text.length; j++) {
    if (text[j] === "\\") {
      j++;
      continue;
    }
    if (text[j] === "`") {
      let run = 1;
      while (text[j + run] === "`") run++;
      const close = findRun(text, "`", run, j + run);
      if (close >= 0) j = close + run - 1;
      continue;
    }
    if (text[j] !== char) continue;
    let run = 1;
    while (text[j + run] === char) run++;
    if (!strong && run >= 2) {
      // A strong inside emphasis: past its pair.
      const close = findRun(text, char, 2, j + 2);
      if (close >= 0 && run === 2) {
        j = close + 1;
        continue;
      }
    }
    const closes = strong ? run >= 2 : run === 1 || run === 3;
    if (closes && !/\s/.test(text[j - 1]) && !(char === "_" && word(text[j + size]))) {
      return { strong, inner: text.slice(open, j), end: j + size };
    }
    j += run - 1;
  }
  return null;
}

function mergeText(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (node.type === "text" && last?.type === "text") last.value += node.value;
    else out.push(node.type === "text" ? { ...node } : node);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Links, ids and text
// ---------------------------------------------------------------------------------------------------------------------

const DOC_PATH = /^(?:[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)?$/;
const SITE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*(?:\?[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*)?(?:#[a-z0-9][a-z0-9-]*)?$/;
const ADMIN_PATH = /^\/admin(?:\/(?:[a-z0-9][a-z0-9.-]*|\{[a-z][A-Za-z]*\}))*$/;

/**
 * What a link may go to, or null when it is refused. Nothing is decoded first: `java&#115;cript:` and `%6Aavascript:` are not a scheme the
 * docs know, so they are refused as written.
 */
export function classifyHref(raw: string): DocHref | null {
  const href = raw.trim();
  if (href === "" || /[\s\u0000-\u001f\u007f<>"'`\\]/.test(href)) return null;
  if (href.startsWith("#")) {
    const id = href.slice(1);
    return ID.test(id) ? { kind: "anchor", id } : null;
  }
  if (href.startsWith("/") && !href.startsWith("//")) {
    const hash = href.indexOf("#");
    const path = hash < 0 ? href : href.slice(0, hash);
    const anchor = hash < 0 ? null : href.slice(hash + 1);
    if (path === "/docs" || path.startsWith("/docs/") || path.startsWith("/docs?")) {
      const sub = path.slice("/docs".length).replace(/^\//, "").replace(/\/$/, "");
      if (!DOC_PATH.test(sub) || (anchor !== null && !ID.test(anchor))) return null;
      return { kind: "doc", path: sub, anchor };
    }
    if (path === "/admin" || path.startsWith("/admin/")) return anchor === null && ADMIN_PATH.test(path) ? { kind: "admin", path } : null;
    return SITE_PATH.test(href) ? { kind: "site", path: href } : null;
  }
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || !url.hostname) return null;
      return { kind: "external", url: href };
    } catch {
      return null;
    }
  }
  if (/^mailto:[^@\s/?#]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/i.test(href)) return { kind: "external", url: href };
  return null;
}

/** A heading's id from its words: lower case, Norwegian letters spelled out, anything else a hyphen. */
export function headingId(text: string): string {
  const id = text
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || "section";
}

function uniqueId(base: string, ctx: Ctx, line: number, explicit: boolean): string {
  const seen = ctx.ids.get(base) ?? 0;
  ctx.ids.set(base, seen + 1);
  if (seen === 0) return base;
  if (explicit) ctx.problems.push({ line, message: `The heading id {#${base}} is used twice on the page.` });
  return `${base}-${seen + 1}`;
}

/** The words of inline content, without its marks. */
export function plainText(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "code") return node.value;
      if (node.type === "break") return " ";
      return plainText(node.children);
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
