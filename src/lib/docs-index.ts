/**
 * The docs' search index as rows (wave 14 unit E3, D443): what `commerce.docs_index` holds, made from the compiled docs (`compileDocs()`)
 * and from unit A's contracts (D438, read by `docs-reference.ts` and handed in, so a docs page that makes its own articles' rows never loads
 * the catalogues). Pure: `src/server/docs-search.ts` writes the rows when their fingerprint differs from the one it stored, so a deploy that
 * changed an article, a contract or how rows are made rewrites the index, and one that did not leaves it alone.
 *
 * One row per part of an article: its start (the summary and the words before the first heading) and each `##` and `###` heading with the
 * words below it (a `####` stays in its part); the changelog's the same way; and one row per reference item: each Admin API operation,
 * webhook topic, owner MCP tool, shopping agent's tool, error code and Admin API scope. A page in one language, or one reference item, is a
 * document (`doc`): search finds rows and answers documents, each at its best part.
 *
 * A reference item leads to its heading in the generated reference (unit E4, `DocsIndex.reference`), whose pages are documents of their
 * own where their words are no item's; the reference, items and pages, is one section of the developers' track (`developers/reference`).
 * In an index without the reference, an item leads to the page that documents it (an article whose front matter names it in `operations`
 * or `tools`), else to the part of the developers' overview about its kind (`REFERENCE_PAGES`); a test holds each of those to a page and
 * heading that exist.
 */

import { DOC_TRACK_LANGS, DOC_TRACKS, DOCS_REFERENCE_SECTION, docsOrder, type DocArea, type DocKind, type DocLang, type DocPage, type DocRefPage, type DocsIndex, type DocTrack } from "./docs-content";
import { plainText, type Block } from "./docs-markdown";
import type { DocsItem } from "./docs-search";

/** Moved when the rows are made differently in a way their contents would not show (their fingerprint holds it). */
export const DOCS_INDEX_VERSION = 1;

/** The most characters a row's words keep: a part longer than this is cut at a word. */
export const ROW_TEXT_MAX = 4000;
/** The most characters of a reference item's or page's summary. */
const SUMMARY_MAX = 300;

export type DocsIndexRow = {
  /** Unique: `en:owners/getting-started/create-your-store#sign-up`, `ref:operation:products.get`. */
  key: string;
  /** The document the row belongs to: `en:owners/getting-started/create-your-store`, `ref:operation:products.get`. */
  doc: string;
  item: DocsItem;
  track: DocTrack;
  kind: DocKind;
  lang: DocLang;
  areas: DocArea[];
  features: string[];
  plans: string[];
  /** The page's section (`owners/getting-started`) and its title in the page's language; none for the changelog and the reference. */
  section: string | null;
  sectionTitle: string | null;
  /** The page's path, which its reads are counted under; none for a reference item. */
  path: string | null;
  /** Where the row leads, as a sub-path for `docsPath()`: the page and the heading's anchor. */
  url: string;
  title: string;
  /** The headings down to this part; none for a page's start or a reference item. */
  headings: string[];
  /** A reference item's name as code. */
  code: string | null;
  summary: string;
  text: string;
  /** The part's place in its page (0 is the start). */
  position: number;
  /** The document's place in the docs' reading order (the tracks, sections and pages in order, then the changelog, then the reference). */
  reading: number;
  /** `YYYY-MM-DD`; none for a reference item and the changelog. */
  checked: string | null;
};

/** One item of unit A's contracts, as the index keeps it. */
export type DocsReferenceItem = { item: Exclude<DocsItem, "section" | "changelog">; id: string; title: string; code: string; text: string; areas: DocArea[] };

/** Where each kind of reference item is explained in an index without the generated reference (E4); held to real headings by a test. */
export const REFERENCE_PAGES: Record<DocsReferenceItem["item"], string> = {
  operation: "developers/overview/introduction#admin-api",
  topic: "developers/overview/introduction#webhooks",
  tool: "developers/overview/introduction#mcp",
  "agent-tool": "developers/overview/introduction#mcp",
  error: "developers/overview/authentication#errors",
  scope: "developers/overview/authentication#scopes",
};

/** Words cut to at most `max` characters, at a word, with an ellipsis. */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The words of blocks, one block a line: paragraphs, lists, tables' cells, code, callouts and quotes, pictures' descriptions. */
export function blocksText(blocks: readonly Block[]): string {
  const lines: string[] = [];
  const walk = (list: readonly Block[]) => {
    for (const block of list) {
      switch (block.type) {
        case "heading":
        case "paragraph":
          lines.push(plainText(block.children));
          break;
        case "list":
          for (const item of block.items) walk(item);
          break;
        case "code":
          lines.push(block.value);
          break;
        case "table":
          lines.push(block.head.map(plainText).join(" "));
          for (const row of block.rows) lines.push(row.map(plainText).join(" "));
          break;
        case "callout":
        case "quote":
          walk(block.children);
          break;
        case "image":
          lines.push(block.alt);
          break;
        case "rule":
          break;
      }
    }
  };
  walk(blocks);
  return lines.filter((line) => line.trim() !== "").join("\n");
}

const cutText = (text: string) => (text.length <= ROW_TEXT_MAX ? text : clip(text, ROW_TEXT_MAX));

type Part = { headings: string[]; anchor: string | null; blocks: Block[] };

/** A page's blocks cut at each `##` and `###`: its start, then each heading with what is below it. */
export function pageParts(blocks: readonly Block[]): Part[] {
  const parts: Part[] = [{ headings: [], anchor: null, blocks: [] }];
  let h2: string | null = null;
  for (const block of blocks) {
    if (block.type === "heading" && block.depth <= 3) {
      const text = plainText(block.children);
      if (block.depth === 2) h2 = text;
      parts.push({ headings: block.depth === 3 && h2 ? [h2, text] : [text], anchor: block.id, blocks: [] });
    } else {
      parts[parts.length - 1].blocks.push(block);
    }
  }
  return parts;
}

/**
 * Where a reference item leads: its heading in the generated reference (E4), else the page that documents it (an article whose front matter
 * names it), else the overview's part about its kind.
 */
function referenceUrl(index: DocsIndex, item: DocsReferenceItem, generated: ReadonlyMap<string, string>): string {
  const own = generated.get(`${item.item}:${item.id}`);
  if (own) return own;
  const names = (page: DocPage) => (item.item === "operation" ? page.operations : item.item === "tool" || item.item === "agent-tool" ? page.tools : []);
  const page = index.pages.find((p) => p.lang === "en" && names(p).includes(item.id));
  return page ? page.path : REFERENCE_PAGES[item.item];
}

/** Each reference item's place in the generated reference: `operation:products.get` → `reference/admin-api/products#products-get`. */
export function generatedItemUrls(index: DocsIndex): Map<string, string> {
  const out = new Map<string, string>();
  for (const page of index.reference.pages) for (const item of page.items) out.set(`${item.item}:${item.id}`, item.anchor ? `${page.path}#${item.anchor}` : page.path);
  return out;
}

/** The group of the reference a page is in (Admin API, Webhooks, MCP, Errors, …): the page under the reference's front page it is, or is below. */
export function referenceGroupOf(index: DocsIndex, page: DocRefPage): DocRefPage | null {
  let at: DocRefPage | undefined = page;
  for (let depth = 0; at && depth < 8; depth++) {
    const parent: DocRefPage | undefined = index.reference.pages.find((p) => p.path === at?.parent);
    if (!parent) return null;
    if (parent.parent === null) return at;
    at = parent;
  }
  return null;
}

/** The reference as the search's section (`developers/reference`), with its front page's title, while the docs have the reference. */
function referenceSection(index: DocsIndex): { section: string; title: string } | null {
  const front = index.reference.pages.find((p) => p.parent === null);
  return front ? { section: DOCS_REFERENCE_SECTION, title: front.title } : null;
}

/**
 * The parts of a generated reference page the index holds as the page's own: its start and every part that is no reference item's (an item
 * is a row of its own, so its heading and what is below it, down to the next `##`, are left to it). A page that is one item has none.
 */
function referenceParts(page: DocRefPage): (Part & { position: number })[] {
  if (page.items.some((item) => item.anchor === null)) return [];
  const itemAnchors = new Set(page.items.map((item) => item.anchor));
  const out: (Part & { position: number })[] = [];
  let h2: string | null = null;
  pageParts(page.blocks).forEach((part, position) => {
    const heading = page.headings.find((h) => h.id === part.anchor);
    if (heading?.depth === 2) h2 = heading.id;
    if (part.anchor && (itemAnchors.has(part.anchor) || (heading?.depth === 3 && h2 !== null && itemAnchors.has(h2)))) return;
    out.push({ ...part, position });
  });
  return out;
}

/** Every row of the index, in the docs' reading order. */
export function docsIndexRows(index: DocsIndex, items: readonly DocsReferenceItem[]): DocsIndexRow[] {
  const rows: DocsIndexRow[] = [];
  let reading = 0;
  for (const track of DOC_TRACKS) {
    // The reading order is the English one; each page's other language follows it.
    for (const english of docsOrder(index, track, "en")) {
      for (const lang of DOC_TRACK_LANGS[track]) {
        const page = index.pages.find((p) => p.path === english.path && p.lang === lang);
        if (!page) continue;
        const section = index.sections.find((s) => s.track === page.track && s.slug === page.section && s.lang === lang);
        const doc = `${lang}:${page.path}`;
        pageParts(page.blocks).forEach((part, position) => {
          const words = blocksText(part.blocks);
          rows.push({
            key: `${doc}#${part.anchor ?? ""}`,
            doc,
            item: "section",
            track: page.track,
            kind: page.kind,
            lang,
            areas: [...page.areas],
            features: [...page.features],
            plans: [...page.plans],
            section: `${page.track}/${page.section}`,
            sectionTitle: section?.title ?? null,
            path: page.path,
            url: part.anchor ? `${page.path}#${part.anchor}` : page.path,
            title: page.title,
            headings: part.headings,
            code: null,
            summary: clip(page.summary, SUMMARY_MAX),
            text: cutText(position === 0 ? [page.summary, words].filter(Boolean).join("\n") : words),
            position,
            reading,
            checked: page.checked,
          });
        });
        reading += 1;
      }
    }
  }
  const changelog = index.changelog;
  if (changelog) {
    const title = changelog.title ?? "Changelog";
    pageParts(changelog.blocks).forEach((part, position) => {
      const words = blocksText(part.blocks);
      rows.push({
        key: `en:changelog#${part.anchor ?? ""}`,
        doc: "en:changelog",
        item: "changelog",
        track: "developers",
        kind: "changelog",
        lang: "en",
        areas: ["admin-api", "storefront-api", "webhooks", "mcp"],
        features: [],
        plans: [],
        section: null,
        sectionTitle: null,
        path: "changelog",
        url: part.anchor ? `changelog#${part.anchor}` : "changelog",
        title,
        headings: part.headings,
        code: null,
        summary: clip(blocksText(changelog.blocks), SUMMARY_MAX),
        text: cutText(words),
        position,
        reading,
        checked: null,
      });
    });
    reading += 1;
  }
  // The generated reference's pages, in its reading order: what is not a reference item of its own. The reference is one section.
  const reference = referenceSection(index);
  for (const page of index.reference.pages) {
    const parts = referenceParts(page);
    if (parts.length === 0) continue;
    const doc = `en:${page.path}`;
    parts.forEach((part, at) => {
      const words = blocksText(part.blocks);
      rows.push({
        key: `${doc}#${part.anchor ?? ""}`,
        doc,
        item: "section",
        track: "developers",
        kind: "reference",
        lang: "en",
        areas: [...page.areas],
        features: [],
        plans: [],
        section: reference?.section ?? null,
        sectionTitle: reference?.title ?? null,
        path: page.path,
        url: part.anchor ? `${page.path}#${part.anchor}` : page.path,
        title: page.title,
        headings: part.headings,
        code: null,
        summary: clip(page.summary, SUMMARY_MAX),
        text: cutText(at === 0 && part.position === 0 ? [page.summary, words].filter(Boolean).join("\n") : words),
        position: at,
        reading,
        checked: null,
      });
    });
    reading += 1;
  }
  const generated = generatedItemUrls(index);
  for (const item of items) {
    const doc = `ref:${item.item}:${item.id}`;
    // An item on a page of the generated reference is in its section; one it lacks leads elsewhere and is in none.
    const inReference = reference !== null && generated.has(`${item.item}:${item.id}`);
    rows.push({
      key: doc,
      doc,
      item: item.item,
      track: "developers",
      kind: "reference",
      lang: "en",
      areas: item.areas,
      features: [],
      plans: [],
      section: inReference ? (reference?.section ?? null) : null,
      sectionTitle: inReference ? (reference?.title ?? null) : null,
      path: null,
      url: referenceUrl(index, item, generated),
      title: clip(item.title, 300),
      headings: [],
      code: item.code,
      summary: clip(item.text, SUMMARY_MAX),
      text: cutText(item.text),
      position: 0,
      reading,
      checked: null,
    });
    reading += 1;
  }
  return rows;
}

/** What a row's vector is made from (the platform's embedding model reads it). */
export function embedText(row: Pick<DocsIndexRow, "title" | "headings" | "code" | "text">): string {
  return [row.title, row.headings.join(" › "), row.code ?? "", row.text].filter(Boolean).join("\n").slice(0, 6000);
}

/** The rows as one text, for their fingerprint: the same rows always give the same text, and any change in a row changes it. */
export function docsIndexFingerprint(rows: readonly DocsIndexRow[]): string {
  return JSON.stringify({ version: DOCS_INDEX_VERSION, rows });
}
