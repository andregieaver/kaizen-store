import { z } from "zod";

import { DESCRIPTION_MAX, TITLE_MAX, summarize } from "./seo";
import { slugify } from "./slug";

/**
 * A page built from blocks (D42): its title, address, picture, search texts,
 * whether search engines and AI assistants may use it, and its content, a
 * list of blocks. For now the only block is rich text. Shared by the admin
 * editor (in the browser) and the server, which checks everything again.
 */

export const PAGE_TITLE_MAX = 200;
export const PAGE_SLUG_MAX = 80;
export const ALT_MAX = 300;
export const BLOCKS_MAX = 100;
/** Characters of text in one rich-text block. */
export const RICH_TEXT_MAX = 50_000;

/** Kept in step with the `pages_slug_not_reserved` check: the platform's own routes at the root. */
export const RESERVED_PAGE_SLUGS: readonly string[] = [
  "account",
  "admin",
  "api",
  "app",
  "auth",
  "forgot-password",
  "help",
  "mail",
  "platform",
  "robots",
  "s",
  "setup",
  "sign-in",
  "sign-up",
  "sitemap",
  "status",
  "stores",
  "support",
  "unsubscribe",
  "www",
];

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

/** Text marks the editor offers. */
export type Mark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "link"; attrs: { href: string } };

export type TextNode = { type: "text"; text: string; marks?: Mark[] };
export type InlineNode = TextNode | { type: "hardBreak" };

export type BlockNode =
  | { type: "paragraph"; content?: InlineNode[] }
  | { type: "heading"; attrs: { level: 2 | 3 | 4 }; content?: InlineNode[] }
  | { type: "bulletList"; content: ListItemNode[] }
  | { type: "orderedList"; attrs?: { start?: number }; content: ListItemNode[] }
  | { type: "blockquote"; content: BlockNode[] }
  | { type: "horizontalRule" };

export type ListItemNode = { type: "listItem"; content: BlockNode[] };

/** A rich-text document as the editor (Tiptap, ProseMirror JSON) writes it, limited to what Kaizen shows. */
export type RichTextDoc = { type: "doc"; content: BlockNode[] };

export const EMPTY_DOC: RichTextDoc = { type: "doc", content: [{ type: "paragraph" }] };

/**
 * A link's address: http(s), mailto:, tel:, a path on the site or an anchor
 * on the page. Nothing else, so no `javascript:`.
 */
export function isLinkAddress(value: string): boolean {
  if (value.length === 0 || value.length > 2000 || /\s/.test(value)) return false;
  if (/^\/(?![/\\])/.test(value) || /^#[\w-]+$/.test(value)) return true;
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(value)) return true;
  if (/^tel:\+?[\d-]{3,20}$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Why a rich-text document was refused. */
class RichTextProblem extends Error {}

const MAX_DEPTH = 12;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function children(node: Json): unknown[] {
  if (node.content === undefined) return [];
  if (!Array.isArray(node.content)) throw new RichTextProblem("A text block could not be read.");
  return node.content;
}

function cleanMarks(value: unknown): Mark[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new RichTextProblem("A text block could not be read.");
  const marks: Mark[] = [];
  for (const mark of value) {
    if (!isObject(mark)) throw new RichTextProblem("A text block could not be read.");
    switch (mark.type) {
      case "bold":
      case "italic":
      case "underline":
        marks.push({ type: mark.type });
        break;
      case "link": {
        const href = isObject(mark.attrs) && typeof mark.attrs.href === "string" ? mark.attrs.href.trim() : "";
        if (!isLinkAddress(href)) {
          throw new RichTextProblem(
            `"${href.slice(0, 60)}" is not a link address. Use https://…, mailto:, tel: or a path starting with /.`,
          );
        }
        marks.push({ type: "link", attrs: { href } });
        break;
      }
      default:
        throw new RichTextProblem(`Text formatting "${String(mark.type)}" is not supported.`);
    }
  }
  return marks.length > 0 ? marks : undefined;
}

function cleanInline(value: unknown, budget: { chars: number }): InlineNode {
  if (!isObject(value)) throw new RichTextProblem("A text block could not be read.");
  if (value.type === "hardBreak") return { type: "hardBreak" };
  if (value.type !== "text" || typeof value.text !== "string") {
    throw new RichTextProblem(`"${String(value.type)}" is not supported inside a paragraph.`);
  }
  budget.chars -= value.text.length;
  if (budget.chars < 0) throw new RichTextProblem(`Keep each text block under ${RICH_TEXT_MAX.toLocaleString("en")} characters.`);
  const marks = cleanMarks(value.marks);
  return marks ? { type: "text", text: value.text, marks } : { type: "text", text: value.text };
}

function cleanListItem(value: unknown, depth: number, budget: { chars: number }): ListItemNode {
  if (!isObject(value) || value.type !== "listItem") throw new RichTextProblem("A list could not be read.");
  return { type: "listItem", content: children(value).map((child) => cleanBlock(child, depth + 1, budget)) };
}

function cleanBlock(value: unknown, depth: number, budget: { chars: number }): BlockNode {
  if (depth > MAX_DEPTH) throw new RichTextProblem("Lists and quotes are nested too deeply.");
  if (!isObject(value)) throw new RichTextProblem("A text block could not be read.");
  const inline = () => {
    const content = children(value).map((child) => cleanInline(child, budget));
    return content.length > 0 ? { content } : {};
  };
  switch (value.type) {
    case "paragraph":
      return { type: "paragraph", ...inline() };
    case "heading": {
      const level = isObject(value.attrs) ? Number(value.attrs.level) : NaN;
      if (level !== 2 && level !== 3 && level !== 4) throw new RichTextProblem("Headings in a page are level 2 to 4.");
      return { type: "heading", attrs: { level }, ...inline() };
    }
    case "bulletList":
      return { type: "bulletList", content: children(value).map((c) => cleanListItem(c, depth, budget)) };
    case "orderedList": {
      const start = isObject(value.attrs) ? Number(value.attrs.start ?? 1) : 1;
      const content = children(value).map((c) => cleanListItem(c, depth, budget));
      return Number.isInteger(start) && start !== 1 && start > 0 && start < 100_000
        ? { type: "orderedList", attrs: { start }, content }
        : { type: "orderedList", content };
    }
    case "blockquote":
      return { type: "blockquote", content: children(value).map((c) => cleanBlock(c, depth + 1, budget)) };
    case "horizontalRule":
      return { type: "horizontalRule" };
    default:
      throw new RichTextProblem(`"${String(value.type)}" is not supported in a text block.`);
  }
}

/**
 * The document with only what Kaizen shows: known blocks and marks, safe
 * link addresses, and nothing else (unknown attributes are dropped).
 */
export function cleanRichText(value: unknown): { ok: true; doc: RichTextDoc } | { ok: false; problem: string } {
  try {
    if (!isObject(value) || value.type !== "doc") throw new RichTextProblem("A text block could not be read.");
    const budget = { chars: RICH_TEXT_MAX };
    const content = children(value).map((child) => cleanBlock(child, 0, budget));
    return { ok: true, doc: { type: "doc", content: content.length > 0 ? content : EMPTY_DOC.content } };
  } catch (error) {
    if (error instanceof RichTextProblem) return { ok: false, problem: error.message };
    throw error;
  }
}

/** The document's words, one line per block, for excerpts and search. */
export function richTextPlain(doc: RichTextDoc): string {
  const lines: string[] = [];
  const inline = (nodes: InlineNode[] = []) =>
    nodes.map((node) => (node.type === "text" ? node.text : " ")).join("");
  const walk = (nodes: BlockNode[]) => {
    for (const node of nodes) {
      switch (node.type) {
        case "paragraph":
        case "heading":
          lines.push(inline(node.content));
          break;
        case "bulletList":
        case "orderedList":
          for (const item of node.content) walk(item.content);
          break;
        case "blockquote":
          walk(node.content);
          break;
        case "horizontalRule":
          break;
      }
    }
  };
  walk(doc.content);
  return lines.map((line) => line.trim()).filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export type RichTextBlock = { id: string; type: "richText"; doc: RichTextDoc };
/** One piece of a page's content. More kinds (pictures, products, …) come later. */
export type PageBlock = RichTextBlock;

export type PageThumbnail = { url: string; width: number; height: number; alt: string };

export type PageContent = {
  title: string;
  slug: string;
  /** Shown at the top of the page, in lists and when the page is shared. */
  thumbnail: PageThumbnail | null;
  /** Search texts; empty uses the title and the start of the content. */
  seo: { title: string; description: string };
  /** Search engines may list it (else `noindex`, and left out of the sitemap). */
  searchEngines: boolean;
  /** AI assistants and AI crawlers may read it (else left out of llms.txt and closed to them in robots.txt). */
  aiAssistants: boolean;
  blocks: PageBlock[];
};

/** Why an address cannot be used, or null if it is fine. */
export function pageSlugProblem(slug: string): string | null {
  if (slug.length === 0) return "Give the page an address.";
  if (slug.length > PAGE_SLUG_MAX) return `Keep the address under ${PAGE_SLUG_MAX} characters.`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return "An address is lowercase letters and digits, with single hyphens between words.";
  }
  if (RESERVED_PAGE_SLUGS.includes(slug)) return `The address /${slug} is used by Kaizen itself. Choose another.`;
  return null;
}

/** The address suggested from a title: "Om oss & priser" becomes "om-oss-priser". */
export function pageSlugFromTitle(title: string): string {
  const slug = slugify(title, PAGE_SLUG_MAX);
  return RESERVED_PAGE_SLUGS.includes(slug) ? `${slug}-page` : slug;
}

const blockId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "A block could not be read. Reload the page and try again.");

const richTextBlock = z.object({
  id: blockId,
  type: z.literal("richText"),
  doc: z.unknown().transform((value, ctx) => {
    const cleaned = cleanRichText(value);
    if (cleaned.ok) return cleaned.doc;
    ctx.addIssue({ code: "custom", message: cleaned.problem });
    return z.NEVER;
  }),
});

/** What the editor sends, with the checks shown to the admin. */
export const pageInput = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the page a title.")
    .max(PAGE_TITLE_MAX, `Keep the title under ${PAGE_TITLE_MAX} characters.`),
  slug: z
    .string()
    .trim()
    .superRefine((slug, ctx) => {
      const problem = pageSlugProblem(slug);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  thumbnail: z
    .object({
      url: z.url({ protocol: /^https?$/, error: "The picture has an invalid address." }).max(1000),
      width: z.number().int().min(1).max(10_000),
      height: z.number().int().min(1).max(10_000),
      alt: z.string().trim().max(ALT_MAX, `Keep the picture's description under ${ALT_MAX} characters.`),
    })
    .nullable(),
  seo: z.object({
    title: z.string().trim().max(TITLE_MAX, `Keep the search title under ${TITLE_MAX} characters.`),
    description: z
      .string()
      .trim()
      .max(DESCRIPTION_MAX, `Keep the search description under ${DESCRIPTION_MAX} characters.`),
  }),
  searchEngines: z.boolean(),
  aiAssistants: z.boolean(),
  blocks: z
    .array(z.discriminatedUnion("type", [richTextBlock]))
    .max(BLOCKS_MAX, `A page takes at most ${BLOCKS_MAX} blocks.`)
    .refine((blocks) => new Set(blocks.map((b) => b.id)).size === blocks.length, {
      message: "Two blocks have the same id. Reload the page and try again.",
    }),
});

/** A new page: nothing written yet, open to search engines and AI assistants. */
export function newPageContent(): PageContent {
  return {
    title: "",
    slug: "",
    thumbnail: null,
    seo: { title: "", description: "" },
    searchEngines: true,
    aiAssistants: true,
    blocks: [],
  };
}

/** A stored page, or null if it cannot be read (then it is not shown). */
export function parsePageContent(value: unknown): PageContent | null {
  const parsed = pageInput.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The page's words, for the description when none is written. */
export function pageExcerpt(content: Pick<PageContent, "blocks">, max?: number): string {
  return summarize(content.blocks.map((block) => richTextPlain(block.doc)).join(" "), max);
}

/** Whether two versions of a page say the same (the draft and what is published). */
export function samePageContent(a: PageContent, b: PageContent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
