import { isCustomPicture } from "./custom-picture";
import { cssProblem } from "./custom-css";
import { withoutRecipients } from "./forms";
import { withoutUses } from "./global-parts";
import { ownProducts, type BlockType, type PageBlock, type PageColumn, type PageRow, type RichTextDoc } from "./page-content";
import { layoutBlocks, type PageLayout } from "./page-layout";
import type { SavedPartKind } from "./saved-parts";
import { summaryText } from "./templates";

/**
 * Using a template (D125) puts a copy of another owner's saved row, column or component on a store's page, or (D127,
 * a whole page layout) on a page of the same kind. What
 * belongs to the other owner must not come along: this is the pure half of that, shared by the server and its
 * tests. The server copies the pictures and videos into the store's own media library (`mapTemplateMedia` names
 * every one, and takes the addresses it got back), and nothing here reads a database.
 *
 * What is left out: global marks (the copy is the store's own), form recipients, links and ids that point into
 * the other store (pages, products, categories, tags, menus, custom fields), the publisher's contact details (email
 * addresses and phone numbers in links, social profiles), the other owner's code (an HTML component, unless the
 * template is Kaizen's), and every address in Storage until it has been copied.
 */

export type PartContent = PageRow | PageColumn | PageBlock | PageLayout;

/** The most pictures and videos one use copies into the store's library, and the most bytes they may add up to. */
export const TEMPLATE_MEDIA_MAX = 30;
export const TEMPLATE_MEDIA_BYTES_MAX = 80 * 1024 * 1024;

/** What a block is called in a template's summary. */
export const BLOCK_WORDS: Record<BlockType, string> = {
  richText: "text",
  heading: "heading",
  image: "picture",
  button: "button",
  contentGrid: "grid",
  product: "product part",
  site: "site part",
  menu: "menu",
  search: "search",
  plans: "plans",
  customField: "custom fields",
  fieldLoop: "field loop",
  storePart: "shop page",
  separator: "line",
  dualButton: "two buttons",
  accordion: "accordion",
  tabs: "tabs",
  faq: "FAQs",
  video: "video",
  html: "HTML",
  testimonials: "testimonials",
  socialLinks: "social links",
  iconList: "icon list",
  emailForm: "email form",
  newsletter: "newsletter",
};

/** The blocks a saved part holds, in reading order. */
export function partBlocks(kind: SavedPartKind, content: PartContent): PageBlock[] {
  if (kind === "page") return layoutBlocks(content as PageLayout);
  if (kind === "row") return (content as PageRow).columns.flatMap((column) => column.blocks);
  if (kind === "column") return (content as PageColumn).blocks;
  return [content as PageBlock];
}

/** What is in a saved part, in a few words: "2 columns: heading, text, button". */
export function templateSummary(kind: SavedPartKind, content: PartContent): string {
  const columns =
    kind === "page"
      ? (content as PageLayout).rows.length
      : kind === "row"
        ? (content as PageRow).columns.length
        : kind === "column"
          ? 1
          : 0;
  return summaryText(
    kind,
    columns,
    partBlocks(kind, content).map((block) => BLOCK_WORDS[block.type]),
  );
}

// ---------------------------------------------------------------------------
// Where things are stored
// ---------------------------------------------------------------------------

const STORAGE_PATH = "/storage/v1/object/public/";

/** Whether an address is a file in Supabase Storage's public buckets: a site's own upload, which a copy must not point at. */
export function isStorageUrl(value: string): boolean {
  try {
    return new URL(value).pathname.startsWith(STORAGE_PATH);
  } catch {
    return false;
  }
}

/** The other store a template came from, so what points into it can be found: its id, slug and hosts (`storeOrigins()`). */
export type ForeignStore = { id: string | null; slug: string | null; hosts: readonly string[] };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * A link as the copy may keep it, or "" for one that has to go: an address on the other store's site, a link
 * carrying an id, a file in Storage, or the other business's email address or phone number. Anchors, paths on the
 * site (`/about`) and other websites stay, as they are what a template is for.
 */
export function cleanHref(href: string, from: ForeignStore): string {
  const value = href.trim();
  if (value === "" || value.startsWith("#")) return value;
  if (/^(mailto|tel):/i.test(value)) return "";
  if (UUID.test(value)) return "";
  const slugPath = from.slug ? new RegExp(`^/s/${from.slug.replace(/[^a-z0-9-]/gi, "")}(?:[/?#]|$)`) : null;
  if (value.startsWith("/")) return slugPath?.test(value) ? "" : value;
  try {
    const url = new URL(value);
    if (from.hosts.includes(url.host)) return "";
    if (slugPath?.test(url.pathname)) return "";
    if (url.pathname.startsWith(STORAGE_PATH)) return "";
  } catch {
    return "";
  }
  return value;
}

// ---------------------------------------------------------------------------
// Walking a part
// ---------------------------------------------------------------------------

type Edits = {
  block?: (block: PageBlock) => PageBlock;
  column?: (column: PageColumn) => PageColumn;
  row?: (row: PageRow) => PageRow;
};

/** A part with each block, column and row passed through `edits`, the inner ones first. */
function editPart(kind: SavedPartKind, content: PartContent, edits: Edits): PartContent {
  const block = (b: PageBlock) => (edits.block ? edits.block(b) : b);
  const column = (c: PageColumn) => {
    const next = { ...c, blocks: c.blocks.map(block) };
    return edits.column ? edits.column(next) : next;
  };
  const editRow = (r: PageRow) => {
    const next = { ...r, columns: r.columns.map(column) };
    return edits.row ? edits.row(next) : next;
  };
  if (kind === "block") return block(content as PageBlock);
  if (kind === "column") return column(content as PageColumn);
  if (kind === "page") return { ...(content as PageLayout), rows: (content as PageLayout).rows.map(editRow) };
  return editRow(content as PageRow);
}

/** Links in a rich-text document through `fn`; a link that goes leaves its words. */
function editDoc(doc: RichTextDoc, fn: (href: string) => string): RichTextDoc {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (typeof node !== "object" || node === null) return node;
    const object = node as Record<string, unknown>;
    const { marks, ...rest } = object;
    if (Array.isArray(marks)) {
      const kept = (marks as { type?: string; attrs?: { href?: string } }[]).flatMap((mark) => {
        if (mark.type !== "link") return [mark];
        const href = fn(String(mark.attrs?.href ?? ""));
        return href === "" ? [] : [{ ...mark, attrs: { ...mark.attrs, href } }];
      });
      return {
        ...Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, visit(value)])),
        ...(kept.length > 0 ? { marks: kept } : {}),
      };
    }
    return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, visit(value)]));
  };
  return visit(doc) as RichTextDoc;
}

const without = <T extends object, K extends string>(value: T, keys: readonly K[]): Omit<T, K> => {
  const next = { ...value } as Record<string, unknown>;
  for (const key of keys) delete next[key];
  return next as Omit<T, K>;
};

/** One block made ready for another store: nothing in it points into the store it came from. */
function sanitizeBlock(block: PageBlock, from: ForeignStore, trusted: boolean): PageBlock {
  const href = (value: string) => cleanHref(value, from);
  switch (block.type) {
    case "richText":
      return { ...without(block, ["bind"]), doc: editDoc(block.doc, href) } as PageBlock;
    case "heading":
    case "image":
      return without(block, ["bind"]) as PageBlock;
    case "button":
      return { ...without(block, ["bind"]), href: href(block.href) };
    case "dualButton":
      return {
        ...block,
        first: { ...block.first, href: href(block.first.href) },
        second: { ...block.second, href: href(block.second.href) },
      };
    case "iconList":
      return { ...block, items: block.items.map((item) => ({ ...item, href: href(item.href) })) };
    case "socialLinks":
      // Someone's own profiles: the owner of the store adds theirs.
      return { ...block, links: block.links.map((link) => ({ ...link, href: "" })) };
    case "accordion":
    case "tabs":
    case "faq":
      return { ...block, items: block.items.map((item) => ({ ...item, body: editDoc(item.body, href) })) } as PageBlock;
    case "contentGrid":
      return {
        ...without(block, ["tileFields"]),
        source: ownProducts(block.source),
        categories: [],
        tags: [],
        // A custom item's link is by slug (a page, a product, a category) and needs no swapping; a web address or a path goes
        // through the same check as any link, and a link that has to go leaves the item without one (D155).
        ...(block.items && {
          items: block.items.map((item) => ({
            ...item,
            link: item.link?.kind === "url" ? (href(item.link.url) === "" ? null : { kind: "url" as const, url: href(item.link.url) }) : item.link,
            // A picture on another site (never one the library or this site holds) does not come along: the page would not be saved with it.
            picture: item.picture && isCustomPicture(item.picture.url) ? item.picture : null,
          })),
        }),
      };
    case "menu":
      return without(block, ["menuId"]) as PageBlock;
    case "plans":
      // Kaizen's own plans (D142): the highlighted one is an id of Kaizen's.
      return { ...without(block, ["highlightId"]), buttonHref: href(block.buttonHref) } as PageBlock;
    case "customField":
      return without(block, ["groupId", "fieldId", "source"]) as PageBlock;
    case "fieldLoop":
      return without(block, ["fieldId", "groupId", "slots"]) as PageBlock;
    case "product":
      return {
        ...without(block, ["groupId", "fieldId", "source", "loop"]),
        ...(block.loop ? { loop: without(block.loop, ["slots"]) } : {}),
      } as PageBlock;
    case "emailForm":
    case "newsletter":
      return { ...block, recipients: [] };
    case "html":
      // Code from another owner does not run on this store's pages unless it is Kaizen's.
      return trusted ? block : { ...block, html: "" };
    default:
      return block;
  }
}

/**
 * A saved part as another store's page may hold it: no global marks (the copy is the store's own), and nothing
 * that points into the store it came from (see the top of this file). Pictures and videos are left for
 * `mapTemplateMedia`. `trusted` is Kaizen's own templates, whose HTML components stay.
 */
export function sanitizeTemplate(
  kind: SavedPartKind,
  content: PartContent,
  from: ForeignStore,
  trusted = false,
): PartContent {
  const plain =
    kind === "page"
      ? { ...(content as PageLayout), rows: (content as PageLayout).rows.map((row) => withoutUses("row", row)) }
      : withoutUses(kind, content as PageRow | PageColumn | PageBlock);
  const cleaned = editPart(kind, plain, {
    block: (block) => sanitizeBlock(block, from, trusted),
    column: (column) => {
      if (!column.link) return column;
      const href = cleanHref(column.link.href, from);
      return href === "" ? (without(column, ["link"]) as PageColumn) : { ...column, link: { ...column.link, href } };
    },
  });
  const safe = withoutRecipients(cleaned);
  if (kind !== "page") return safe;
  // A layout's own CSS stays when it is clean and does not reach into the other store's files; else it goes.
  const layout = safe as PageLayout;
  const css = layout.css ?? "";
  return { ...layout, css: css === "" || cssProblem(css) !== null || css.includes(STORAGE_PATH) ? "" : css };
}

// ---------------------------------------------------------------------------
// Pictures and videos
// ---------------------------------------------------------------------------

/** What to put where an address was: the address of the store's own copy (or the same, for a file that is not the site's), or null to leave it out. */
export type MediaResolver = (url: string) => string | null;

type Picture = { url: string; width: number; height: number };
const resolved = <T extends { url: string }>(value: T, resolve: MediaResolver): T | null => {
  const url = resolve(value.url);
  return url === null ? null : { ...value, url };
};

type Background = { type: string; image?: Picture; video?: { url: string }; poster?: Picture | null };

/**
 * A background with its pictures and video through `resolve`, or undefined when what it shows is left out. A colour or a
 * gradient (D128) holds no file and is returned as it is; so is the part's motion, which is only names.
 */
function editBackground<T extends Background | undefined>(background: T, resolve: MediaResolver): T | undefined {
  if (!background) return background;
  if (background.type === "image" && background.image) {
    const image = resolved(background.image, resolve);
    return image ? ({ ...background, image } as T) : undefined;
  }
  if (background.type === "video" && background.video) {
    const video = resolved(background.video, resolve);
    if (!video) return undefined;
    return { ...background, video, poster: background.poster ? resolved(background.poster, resolve) : null } as T;
  }
  return background;
}

/**
 * A part with each picture and video address (block pictures, video blocks and their stills, testimonials' and custom grid items' pictures,
 * row and column backgrounds) through `resolve`. What resolves to null is left out: a picture becomes none, a
 * background goes. The order the addresses are asked in is the order they are read, and one asked twice is asked twice.
 */
export function mapTemplateMedia(kind: SavedPartKind, content: PartContent, resolve: MediaResolver): PartContent {
  return editPart(kind, content, {
    block: (block) => {
      if (block.type === "image") return { ...block, image: block.image ? resolved(block.image, resolve) : null };
      if (block.type === "video") {
        return {
          ...block,
          video: block.video ? resolved(block.video, resolve) : null,
          poster: block.poster ? resolved(block.poster, resolve) : null,
        };
      }
      if (block.type === "contentGrid" && block.items) {
        return { ...block, items: block.items.map((item) => ({ ...item, picture: item.picture ? resolved(item.picture, resolve) : null })) };
      }
      if (block.type === "testimonials") {
        return {
          ...block,
          items: block.items.map((item) => ({
            ...item,
            picture: item.picture ? resolved(item.picture, resolve) : null,
          })),
        };
      }
      return block;
    },
    column: (column) => {
      const background = editBackground(column.background, resolve);
      return background
        ? { ...column, background: background as PageColumn["background"] }
        : (without(column, ["background", "backgroundMotion"]) as PageColumn);
    },
    row: (row) => {
      const background = editBackground(row.background, resolve);
      return background
        ? { ...row, background: background as PageRow["background"] }
        : (without(row, ["background", "backgroundMotion"]) as PageRow);
    },
  });
}

/** Every picture and video address a part holds, once each, in the order they are read. */
export function templateMediaUrls(kind: SavedPartKind, content: PartContent): string[] {
  const found = new Set<string>();
  mapTemplateMedia(kind, content, (url) => {
    found.add(url);
    return url;
  });
  return [...found];
}

/**
 * Addresses in Storage still in a part (a whole value that is one), as a last check that nothing points at another
 * site's files: with copies made, none but `allowed` should be left.
 */
export function leftoverStorageUrls(content: unknown, allowed: ReadonlySet<string> = new Set()): string[] {
  const left = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      if (isStorageUrl(value) && !allowed.has(value)) left.add(value);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(visit);
  };
  visit(content);
  return [...left];
}
