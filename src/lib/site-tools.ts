import { z } from "zod";

import { findClaims } from "./claims";
import { LEGAL_ROLES, LEGAL_ROLE_COPY, isLegalRole } from "./legal-roles";
import { LABEL_MAX, MENU_MAX_DEPTH, MENU_MAX_ITEMS, MENU_NAME_MAX, menuLinkSchema, platformMenuLinkSchema, type AnyMenuLink, type MegaMenu, type MenuPicture } from "./navigation";
import { PLATFORM_ROLE_COPY, SPECIAL_ROLES, type SpecialRole } from "./platform-roles";
import { PAGE_JOB_STATUSES } from "./page-jobs";
import { PATTERNS, pageBrief, type PageBrief, type PatternKey } from "./page-ai";
import { ROWS_MAX, pageBlocks, richTextPlain, type PageContent, type PageRow, type PageText } from "./page-content";
import { FIND_MAX, replaceInPage } from "./page-find-replace";
import { PAGE_ROLES, ROLE_COPY } from "./page-roles";
import { insertRow, moveRow, removeRow } from "./page-rows";
import { isSharedBlock } from "./inline-edit";
import { mapBlockTexts, mapTexts, pageTextLabels, pageTexts } from "./page-translation";
import { textToRichText } from "./simple-rich-text";
import { defaultFooter, defaultHeader } from "./site-layout";

/**
 * The AI manager's website tools for pages (D308, `docs/ai-autopilot.md` 4): the arguments the model gives, and the pure parts of
 * reading a page for it and changing one. Every change is made on the page's draft with the builder's own functions (`mapTexts()`,
 * `replaceInPage()`, `insertRow()`, `moveRow()`, `removeRow()`) and saved by `savePage()`, so it is checked by `pageInput` as the builder's
 * save is and a version is kept (D305). Words the model writes pass the claims filter (`findClaims()`).
 */

/** A page by its id, or its address as `list_pages` gives it. */
const pageRef = z.string().trim().min(1).max(200).describe("The page's id, or its address (slug) as list_pages gives it.");
const pageType = z.enum(["page", "article"]).default("page").describe("A page, or a blog article.");

export const getPageInput = z.object({ page: pageRef, type: pageType });

/** At most this many texts are read out for one page, and at most this many characters of each. */
export const OUTLINE_TEXTS_MAX = 150;
export const OUTLINE_TEXT_CHARS = 300;

const line = (max: number) => z.string().trim().max(max);
const lines = (max: number, count: number) => z.array(z.string().trim().min(1).max(max)).max(count);

export const buildPageInput = z.object({
  title: line(200).min(1).describe("The page's title, as the owner would name it."),
  purpose: line(1000).min(1).describe("What the page is for, in a sentence or two."),
  audience: line(500).default("").describe("Who it is for."),
  key_points: lines(400, 12).default([]).describe("What it must say, point by point."),
  facts: lines(400, 20)
    .default([])
    .describe(
      "Facts the owner gave that the page may state (what they offer, how they work, opening hours, a YouTube or Vimeo address for a video): only these and the site's own are written. Never invent one, and never a price.",
    ),
  sections: lines(300, 12).default([]).describe("Sections the owner asked for, if any (the AI plans them otherwise)."),
  call_to_action: line(300).default("").describe("What visitors should do next."),
  tone: line(300).default("").describe("How it should sound."),
  pictures: z.boolean().default(true).describe("Whether the page has pictures made by the site's picture model, one at a time after it is built."),
  picture_style: line(500).default("").describe("What the pictures should show and look like."),
});
export type BuildPageArgs = z.output<typeof buildPageInput>;

const PATTERN_KEYS = Object.keys(PATTERNS) as [PatternKey, ...PatternKey[]];
const planPicture = z.object({
  prompt: z.string().trim().min(10).max(1500).describe("What the picture shows, as a photographer's brief, in English, with no words or logos in it."),
  alt: z.string().trim().min(3).max(300).describe("What it shows, in one short sentence in the page's language."),
});

/** One change to a page; several are made in order and saved together. */
export const pageChange = z.discriminatedUnion("do", [
  z.object({
    do: z.literal("set_text"),
    key: z.string().trim().min(1).max(200).describe("The text's key, as get_page gives it (title, seo.description, block.{id}.text, …)."),
    text: z
      .string()
      .max(20_000)
      .describe("The new words. A rich text takes paragraphs with a blank line between, lines starting \"- \" for a list, **bold** and [words](/address) for a link to the site's own address."),
  }),
  z.object({
    do: z.literal("replace"),
    find: z.string().min(1).max(FIND_MAX).describe("Words to find in every text of the page."),
    replace: z.string().max(FIND_MAX).describe("What to put in their place."),
    match_case: z.boolean().default(false),
    whole_words: z.boolean().default(false),
  }),
  z.object({
    do: z.literal("add_section"),
    pattern: z.enum(PATTERN_KEYS).describe(`The design: ${PATTERN_KEYS.map((key) => `${key} (${PATTERNS[key].label})`).join(", ")}. An opening (hero) only as the first row.`),
    variant: z.string().trim().max(40).optional(),
    name: z.string().trim().min(1).max(80).describe("What the section is called, for the owner."),
    brief: z.string().trim().min(1).max(1500).describe("What it says: the AI writes its words from this, the facts and the page."),
    facts: lines(400, 20).default([]).describe("Facts the owner gave for it (as build_page's)."),
    at: z.number().int().min(1).max(ROWS_MAX).optional().describe("Its place among the rows, as get_page numbers them (1 is the top); at the end when left out."),
    picture: planPicture.optional().describe("Its picture, for the designs that have one."),
    pictures: z.array(planPicture).max(4).optional().describe("A gallery's pictures."),
    links: z.array(z.string().trim().max(500)).max(2).optional().describe("Addresses its buttons go to: only the site's own."),
    category: z.string().trim().max(100).optional().describe("A product grid's category, by its address (slug)."),
  }),
  z.object({ do: z.literal("remove_row"), row: z.string().trim().min(1).max(100).describe("The row's id, as get_page gives it.") }),
  z.object({
    do: z.literal("move_row"),
    row: z.string().trim().min(1).max(100).describe("The row's id, as get_page gives it."),
    to: z.number().int().min(1).max(ROWS_MAX).describe("Its new place, 1 being the top."),
  }),
]);
export type PageChange = z.output<typeof pageChange>;

export const editPageInput = z.object({
  page: pageRef,
  type: pageType,
  changes: z.array(pageChange).min(1).max(20).describe("The changes, made in this order and saved together as the page's draft."),
});

export const publishPageInput = z.object({ page: pageRef, type: pageType });

export const pageBuildsInput = z.object({ limit: z.number().int().min(1).max(20).default(5).describe("How many at most (1–20).") });

export type PageJobStatusName = (typeof PAGE_JOB_STATUSES)[number];

// ---------------------------------------------------------------------------
// Reading a page for the model
// ---------------------------------------------------------------------------

/** Page-level texts: the title, excerpt and search texts and the page's own picture's description. */
const PAGE_KEYS = new Set(["title", "excerpt", "seo.title", "seo.description", "thumbnail.alt"]);

const plainOf = (value: PageText) => (typeof value === "string" ? value : richTextPlain(value));
const cut = (text: string) => (text.length > OUTLINE_TEXT_CHARS ? `${text.slice(0, OUTLINE_TEXT_CHARS - 1)}…` : text);

export type OutlineText = { key: string; label: string; text: string; max: number | null; rich: boolean };
export type OutlineRow = { row: string; number: number; modal: boolean; columns: number; parts: string[]; texts: OutlineText[] };
export type PageOutline = { texts: OutlineText[]; rows: OutlineRow[]; more_texts: number };

/** The texts of a part of the page (`mapTexts()` over just it), keyed as on the whole page. */
function textsOf(content: PageContent, labels: Map<string, string>, keep: (key: string) => boolean): OutlineText[] {
  const found: OutlineText[] = [];
  mapTexts(content, (key, value, max) => {
    if (keep(key)) {
      found.push({ key, label: labels.get(key) ?? key, text: cut(plainOf(value)), max: max > 0 ? max : null, rich: typeof value !== "string" });
    }
    return value;
  });
  return found;
}

/**
 * The page as the model reads it: its own texts, then each row in order with its number, the kinds of part it holds (an empty picture
 * says so) and its texts by the keys `set_text` takes. Texts are cut to `OUTLINE_TEXT_CHARS`, and after `OUTLINE_TEXTS_MAX` only counted.
 */
export function pageOutline(content: PageContent): PageOutline {
  const labels = pageTextLabels(content);
  let left = OUTLINE_TEXTS_MAX;
  let more = 0;
  const take = (texts: OutlineText[]) => {
    const kept = texts.slice(0, Math.max(0, left));
    more += texts.length - kept.length;
    left -= kept.length;
    return kept;
  };
  const texts = take(textsOf(content, labels, (key) => PAGE_KEYS.has(key)));
  const rows = content.rows.map((row, index): OutlineRow => {
    const only = { ...content, rows: [row] };
    const parts = pageBlocks(only).map((block) => (block.type === "image" && !block.image ? "image (no picture yet)" : block.type));
    return {
      row: row.id,
      number: index + 1,
      modal: Boolean(row.modal),
      columns: row.columns.length,
      parts,
      texts: take(textsOf(only, labels, (key) => !PAGE_KEYS.has(key))),
    };
  });
  return { texts, rows, more_texts: more };
}

// ---------------------------------------------------------------------------
// Changing a page
// ---------------------------------------------------------------------------

/** The phrases the claims filter finds in words the model wrote; a picture's description may name colours. */
export function claimsIn(text: string, { colours = true }: { colours?: boolean } = {}): string[] {
  return [...new Set(findClaims(text, colours ? {} : { colours: false }).map((claim) => claim.phrase))];
}

/** Why a text shared with other pages is not changed here: in the builder's words (D192). */
export const SHARED_TEXT = "This text is shared with other pages: change it in the page builder, where the pages it reaches are shown.";

/**
 * The keys of the texts in parts shared with other pages (a global part, D98, unless the page made a part its own): a page's save puts
 * a global's words back from the global, so they are changed in the builder, which changes every page using it.
 */
export function sharedTextKeys(content: PageContent): Set<string> {
  const keys = new Set<string>();
  for (const row of content.rows) {
    for (const column of row.columns) {
      const columnShared = (Boolean(row.global) && !column.local) || Boolean(column.global);
      if (columnShared && column.link) keys.add(`column.${column.id}.label`);
      for (const block of column.blocks) {
        if (!isSharedBlock({ row, column, block })) continue;
        mapBlockTexts(block, (key, value) => {
          keys.add(key);
          return value;
        });
      }
    }
  }
  return keys;
}

export type EditOutcome = { ok: true; content: PageContent; done: string[] } | { ok: false; problem: string };

/**
 * The page with the changes made in order, and what each did in words; the first that cannot be made refuses them all, saying why.
 * `sections` holds the rows each `add_section` (in order) was built into; `allowLink` says which addresses a rich text may link to.
 */
export function applyPageEdits(
  content: PageContent,
  changes: readonly PageChange[],
  { sections, allowLink }: { sections: readonly PageRow[][]; allowLink: (href: string) => boolean },
): EditOutcome {
  let page = content;
  const done: string[] = [];
  let added = 0;
  for (const [index, change] of changes.entries()) {
    const which = changes.length > 1 ? `Change ${index + 1}: ` : "";
    const refuse = (problem: string): EditOutcome => ({ ok: false, problem: `${which}${problem}` });
    switch (change.do) {
      case "set_text": {
        const texts = pageTexts(page);
        const current = texts.get(change.key);
        if (!current) return refuse(`The page has no text "${change.key}". get_page lists its texts by key.`);
        if (sharedTextKeys(page).has(change.key)) return refuse(SHARED_TEXT);
        const claims = claimsIn(change.text, { colours: !change.key.endsWith(".alt") });
        if (claims.length > 0) return refuse(`Rewrite without claims the site cannot back: ${claims.join(", ")}.`);
        let next: PageText;
        if (typeof current.value === "string") {
          next = change.text.trim();
          if (current.max > 0 && next.length > current.max) return refuse(`"${change.key}" takes at most ${current.max} characters; that is ${next.length}.`);
        } else {
          next = textToRichText(change.text, allowLink);
        }
        page = mapTexts(page, (key, value) => (key === change.key ? next : value));
        done.push(`Changed ${pageTextLabels(page).get(change.key) ?? change.key}.`);
        break;
      }
      case "replace": {
        const claims = claimsIn(change.replace);
        if (claims.length > 0) return refuse(`Rewrite without claims the site cannot back: ${claims.join(", ")}.`);
        const options = { matchCase: change.match_case, wholeWords: change.whole_words };
        const shared = sharedTextKeys(page);
        const own = new Set([...pageTexts(page).keys()].filter((key) => !shared.has(key)));
        const result = replaceInPage(page, change.find, change.replace, options, own);
        if (result.replaced === 0) {
          if (result.tooLong.length > 0) return refuse(`"${change.find}" was found, but every text would be too long with the change.`);
          return refuse(replaceInPage(page, change.find, change.replace, options).replaced > 0 ? `"${change.find}" is only in parts shared with other pages. ${SHARED_TEXT}` : `"${change.find}" is not on the page.`);
        }
        page = result.content;
        done.push(
          `Replaced "${change.find}" ${result.replaced === 1 ? "once" : `${result.replaced} times`}${result.tooLong.length > 0 ? ` (left in ${result.tooLong.length} text${result.tooLong.length === 1 ? "" : "s"} that would be too long)` : ""}.`,
        );
        break;
      }
      case "add_section": {
        const rows = sections[added++];
        if (!rows || rows.length === 0) return refuse(`"${change.name}" could not be built.`);
        if (page.rows.length + rows.length > ROWS_MAX) return refuse(`A page holds at most ${ROWS_MAX} rows.`);
        if (change.pattern === "hero" && change.at !== 1) return refuse("An opening (hero) is only ever the first row: give it at: 1.");
        const at = change.at === undefined ? page.rows.length : Math.min(change.at - 1, page.rows.length);
        let next = page.rows;
        rows.forEach((row, offset) => (next = insertRow(next, row, at + offset)));
        page = { ...page, rows: next };
        done.push(`Added "${change.name}" as row ${at + 1}.`);
        break;
      }
      case "remove_row": {
        const at = page.rows.findIndex((row) => row.id === change.row);
        if (at < 0) return refuse(`The page has no row "${change.row}". get_page lists its rows.`);
        page = { ...page, rows: removeRow(page.rows, change.row) };
        done.push(`Removed row ${at + 1}.`);
        break;
      }
      case "move_row": {
        const from = page.rows.findIndex((row) => row.id === change.row);
        if (from < 0) return refuse(`The page has no row "${change.row}". get_page lists its rows.`);
        const to = Math.min(change.to, page.rows.length);
        page = { ...page, rows: moveRow(page.rows, change.row, to - 1) };
        done.push(`Moved row ${from + 1} to ${to}.`);
        break;
      }
    }
  }
  return { ok: true, content: page, done };
}

/** What a build is given as the owner's words: the only facts its plan and its sections may state, besides the site's own. */
export function ownerWordsOf(args: Pick<BuildPageArgs, "purpose" | "audience" | "key_points" | "facts" | "call_to_action">): string {
  return [args.purpose, args.audience, ...args.key_points, ...args.facts, args.call_to_action].filter(Boolean).join("\n");
}

/** The page studio's brief (D92) from the tool's arguments: no pictures is the studio's "none". */
export function briefOf(args: BuildPageArgs): PageBrief {
  return pageBrief.parse({
    title: args.title,
    purpose: args.purpose,
    audience: args.audience,
    keyPoints: args.key_points,
    facts: args.facts,
    sections: args.sections,
    callToAction: args.call_to_action,
    tone: args.tone,
    pictures: args.pictures ? args.picture_style : "none",
  });
}

/**
 * The changes tried on the page before anything is built, so a key that is not there, a claim or a row that is gone is refused before
 * the model writes a section: each `add_section` stands in as an empty row.
 */
export function dryRunEdits(content: PageContent, changes: readonly PageChange[]): EditOutcome {
  const stub = (n: number): PageRow[] => [{ id: `planned-${n}`, type: "row", layout: "1", columns: [{ id: `planned-${n}-column`, blocks: [] }] }];
  const sections = changes.filter((change) => change.do === "add_section").map((_, n) => stub(n));
  return applyPageEdits(content, changes, { sections, allowLink: () => true });
}

/** The words the brief carries that the claims filter finds: refused before anything is built. */
export function briefClaims(args: BuildPageArgs): string[] {
  return claimsIn([args.title, args.purpose, ...args.key_points, ...args.facts, args.call_to_action].join("\n"));
}

/** The publish approval in words, from the page's own title when the server has it. */
export function publishSummary(type: "page" | "article", title: string | null, ref: string): string {
  return `Publish the ${type === "article" ? "article" : "page"} ${title ? `"${title}"` : ref}, so visitors see its draft as it is now.`;
}

// ---------------------------------------------------------------------------
// Places, menus, the header and footer (D308 A2b)
// ---------------------------------------------------------------------------

/** The places a store's page can be chosen for: its front page, its All products page, a special page (D112, D113) or a legal page (D158). */
export const STORE_PLACES = ["front", "products", ...PAGE_ROLES, ...LEGAL_ROLES] as const;
export type StorePlace = (typeof STORE_PLACES)[number];

/** What the admin calls a place, in the owner's words. */
export function placeName(place: StorePlace): string {
  if (place === "front") return "front page";
  if (place === "products") return "All products page";
  return (isLegalRole(place) ? LEGAL_ROLE_COPY[place].name : ROLE_COPY[place].name).toLowerCase();
}

export const setPagePlaceInput = z.object({
  place: z
    .enum(STORE_PLACES)
    .describe(`The place: ${STORE_PLACES.map((place) => `${place} (${placeName(place)})`).join(", ")}.`),
  page: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullable()
    .describe("A published page's id or address, or null for the standard one (the products list on the front, the standard page elsewhere)."),
});

export const getMenusInput = z.object({});

/** A menu item: its words and where it goes, as the menu editor saves the link (`menuLinkSchema`, or Kaizena Flow's `platformMenuLinkSchema`). */
const menuItemInput = <L extends z.ZodType<AnyMenuLink>>(link: L, where: string) =>
  z.object({
    text: z.string().trim().max(LABEL_MAX).default("").describe("Its words in the site's main language (a product link may leave it empty for the product's title)."),
    texts: z.record(z.string(), z.string().trim().max(LABEL_MAX)).default({}).describe("Its words in the site's other languages, by language code."),
    link: link.describe(where),
    depth: z.number().int().min(0).max(MENU_MAX_DEPTH).default(0).describe(`How deep under the link before it (0 at the top, at most ${MENU_MAX_DEPTH}).`),
    new_tab: z.boolean().default(false),
  });

const menuArgs = <I extends z.ZodType>(item: I) =>
  z.object({
    menu: z.string().trim().min(1).max(MENU_NAME_MAX).optional().describe("The menu to change, by its id or name (get_menus); leave it out to make a new one."),
    name: z.string().trim().min(1).max(MENU_NAME_MAX).optional().describe("A new menu's name, or a new name for the menu."),
    items: z.array(item).max(MENU_MAX_ITEMS).describe("Every link of the menu in order, replacing the ones there."),
  });

export const saveMenuInput = menuArgs(
  menuItemInput(
    menuLinkSchema,
    "Where it goes: home, products (All products), account, cart, blog, a page or article by its address (slug), a product by its handle, a category or tag by its slug, or a web address (url).",
  ),
);
export type SaveMenuArgs = z.output<typeof saveMenuInput>;

/** Kaizena Flow's own menus (D85): its pages and articles by id (list_pages), its sign-up and sign-in. */
export const savePlatformMenuInput = menuArgs(
  menuItemInput(
    platformMenuLinkSchema,
    "Where it goes: home, signUp, signIn, blog, a page or article by its id (pageId, from list_pages), a category or tag by its slug, or a web address (url).",
  ),
);
export type SavePlatformMenuArgs = z.output<typeof savePlatformMenuInput>;

/** A menu item as the tools take it, for a store or Kaizena Flow. */
export type MenuItemArgs<L extends AnyMenuLink = AnyMenuLink> = { text: string; texts: Record<string, string>; link: L; depth: number; new_tab: boolean };

/** The places on Kaizena Flow's own site (D143): its front page, blog and 404 page (the theme store's are chosen from Themes, D285). */
export const PLATFORM_PLACES = SPECIAL_ROLES;
export const platformPlaceName = (place: SpecialRole) => PLATFORM_ROLE_COPY[place].name.toLowerCase();

export const setPlatformPlaceInput = z.object({
  place: z.enum(SPECIAL_ROLES).describe(`The place: ${SPECIAL_ROLES.map((place) => `${place} (${platformPlaceName(place)})`).join(", ")}.`),
  page: z.string().trim().min(1).max(200).nullable().describe("A published page's id or address, or null for the standard one."),
});

export const setHeaderFooterInput = z.object({
  header_menu: z.string().trim().min(1).max(MENU_NAME_MAX).nullable().optional().describe("The menu the standard header shows, by id or name; null for none; left out to keep it."),
  footer_menu: z.string().trim().min(1).max(MENU_NAME_MAX).nullable().optional().describe("The menu the standard footer shows, as header_menu."),
  logo: z.string().trim().min(1).max(1000).nullable().optional().describe("The logo's address in the media library; null for none (the site's name shows); left out to keep it."),
  logo_dark: z.string().trim().min(1).max(1000).nullable().optional().describe("The logo for dark backgrounds, as logo."),
  icon: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .nullable()
    .optional()
    .describe("The site's icon in browser tabs: a square picture of at least 256 pixels from the media library (make_brand_marks makes one); null for the standard icon; left out to keep it."),
});
export type SetHeaderFooterArgs = z.output<typeof setHeaderFooterInput>;

/** How a drafted header or footer is laid out (D351): the standard one, or another arrangement of the same parts. */
export const HEADER_LOOKS = ["standard", "centred"] as const;
export const FOOTER_LOOKS = ["columns", "simple"] as const;

export const draftHeaderFooterInput = z.object({
  kind: z.enum(["header", "footer"]),
  look: z.enum([...HEADER_LOOKS, ...FOOTER_LOOKS]).optional().describe("A header: standard (logo left, menu, tools right) or centred (menu left, logo in the middle). A footer: columns or simple (one column)."),
  menu: z.string().trim().min(1).max(MENU_NAME_MAX).optional().describe("The menu it shows, by id or name from get_menus; the standard one's when left out."),
  section_style: z.string().trim().min(1).max(40).optional().describe("One of the live theme's section styles (plain, hero, feature, muted, contrast, quote, or the theme's own), for its colours; plain when left out."),
  title: z.string().trim().min(1).max(120).optional().describe("Its name in the builder."),
});
export type DraftHeaderFooterArgs = z.output<typeof draftHeaderFooterInput>;

export const useHeaderFooterInput = z.object({
  kind: z.enum(["header", "footer"]),
  page: z.string().trim().min(1).max(200).describe("The header's or footer's id (draft_header_footer gives it), or standard to go back to the standard one."),
});
export type UseHeaderFooterArgs = z.output<typeof useHeaderFooterInput>;

/**
 * A header or footer drafted for the site (D351): the standard layout's own parts (`defaultHeader()`/`defaultFooter()`, so the logo, the
 * cart, the business details, the cookies and withdrawal links are always there), arranged by `look`, showing `menuId`, in a section style of
 * the theme. Pure; the server checks it with `siteLayoutProblem()` and saves it as a draft.
 */
export function draftedLayout(
  storeId: string | null,
  kind: "header" | "footer",
  options: { look?: string; menuId: string | null; sectionStyle?: string; title?: string },
): PageContent {
  const menus = { header: kind === "header" ? options.menuId : null, footer: kind === "footer" ? options.menuId : null };
  const base = kind === "header" ? defaultHeader(storeId, menus) : defaultFooter(storeId, menus);
  const rows = base.rows.map((row): PageRow => {
    let next: PageRow = { ...row, ...(options.sectionStyle && options.sectionStyle !== "plain" ? { sectionStyle: options.sectionStyle } : {}) };
    if (kind === "header" && options.look === "centred") {
      const [brand, nav, tools] = next.columns;
      next = { ...next, columns: [{ ...nav, justify: "start" }, { ...brand, justify: "center" }, tools] };
    }
    if (kind === "footer" && options.look === "simple") {
      next = { ...next, layout: "1", columns: [{ id: "footer-all", blocks: next.columns.flatMap((column) => column.blocks) }] };
    }
    return next;
  });
  return { ...base, title: options.title ?? (kind === "header" ? "Header" : "Footer"), rows };
}

/** Kaizena Flow's own hosts, where `/s/{store}` is a store's address. */
const PLATFORM_HOSTS = ["kaizenaflow.com", "www.kaizenaflow.com"];

/**
 * Whether a menu's web address goes to another store on Kaizena Flow: `/s/{other}/…` on the site or on Kaizena Flow's own hosts, or
 * `{other}.{store domain}`. A store's menus link to its own site and to the wider web, never into another store's shop (a store's domain
 * of its own is looked up on the server).
 */
export function otherStoreAddress(url: string, own: string, storeDomain: string | null): boolean {
  const pathStore = (path: string) => /^\/s\/([a-z0-9-]+)(?:[/?#]|$)/.exec(path)?.[1] ?? null;
  if (url.startsWith("/")) {
    const slug = pathStore(url);
    return slug !== null && slug !== own;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (storeDomain && host.endsWith(`.${storeDomain}`)) {
    const sub = host.slice(0, -(storeDomain.length + 1));
    if (sub !== own && !sub.includes(".")) return true;
  }
  if (![...PLATFORM_HOSTS, ...(storeDomain ? [storeDomain, `www.${storeDomain}`] : [])].includes(host)) return false;
  const slug = pathStore(parsed.pathname);
  return slug !== null && slug !== own;
}

/**
 * A menu's items as the menu editor saves them, from the tool's: the words in the main language and the others, and each existing item's
 * mega menu and picture kept where the same link is still there (the tool does not set them).
 */
export function toMenuEntries<L extends AnyMenuLink>(
  items: readonly MenuItemArgs<L>[],
  mainLocale: string,
  before: readonly { link: L; mega?: MegaMenu; image?: MenuPicture }[],
): { label: Record<string, string>; link: L; depth: number; newTab?: true; mega?: MegaMenu; image?: MenuPicture }[] {
  const kept = new Map(before.map((entry) => [JSON.stringify(entry.link), entry]));
  return items.map((item) => {
    const previous = kept.get(JSON.stringify(item.link));
    const label = Object.fromEntries(
      Object.entries({ ...item.texts, ...(item.text ? { [mainLocale]: item.text } : {}) }).filter(([, words]) => words.trim() !== ""),
    );
    return {
      label,
      link: item.link,
      depth: item.depth,
      ...(item.new_tab && { newTab: true }),
      ...(item.depth === 0 && previous?.mega && { mega: previous.mega }),
      ...(previous?.image && { image: previous.image }),
    };
  });
}

/** The menu's words the claims filter finds. */
export function menuClaims(items: readonly MenuItemArgs[]): string[] {
  return claimsIn(items.flatMap((item) => [item.text, ...Object.values(item.texts)]).join("\n"));
}

/** A menu change in words, for the owner's approval: its name and its top links. */
export function menuSummary(name: string, items: readonly MenuItemArgs[], isNew: boolean): string {
  const top = items.filter((item) => item.depth === 0).map((item) => item.text || linkWords(item.link));
  const list = top.slice(0, 8).join(", ") + (top.length > 8 ? `, and ${top.length - 8} more` : "");
  return `${isNew ? "Make" : "Change"} the menu "${name}" to ${items.length} link${items.length === 1 ? "" : "s"}${top.length > 0 ? `: ${list}` : ""}.`;
}

/** A link in a few words, where an item has none of its own. */
function linkWords(link: AnyMenuLink): string {
  if ("pageId" in link) return `the ${link.kind} ${link.pageId}`;
  switch (link.kind) {
    case "signUp":
      return "Start a store";
    case "signIn":
      return "Sign in";
    case "home":
      return "the front page";
    case "products":
      return "All products";
    case "account":
      return "My account";
    case "cart":
      return "the cart";
    case "blog":
      return "the blog";
    case "product":
      return `the product ${link.handle}`;
    case "page":
    case "article":
      return `/${link.slug}`;
    case "category":
    case "tag":
    case "blogCategory":
      return `${link.kind === "tag" ? "the tag" : "the category"} ${link.slug}`;
    case "url":
      return link.url;
  }
}

/** A place change in words, for the owner's approval. */
export function placeSummary(place: StorePlace, title: string | null, name: string = placeName(place)): string {
  return title ? `Show the page "${title}" as the ${name}.` : `Show the standard ${name} again.`;
}

/** A header and footer change in words, for the owner's approval, from the names the server found. */
export function headerFooterSummary(change: { header?: string | null; footer?: string | null; logo?: boolean | null; logoDark?: boolean | null; icon?: boolean | null }): string {
  const parts = [
    change.header !== undefined && (change.header === null ? "the header shows no menu" : `the header shows the menu "${change.header}"`),
    change.footer !== undefined && (change.footer === null ? "the footer shows no menu" : `the footer shows the menu "${change.footer}"`),
    change.logo !== undefined && (change.logo ? "a new logo" : "no logo (the site's name shows)"),
    change.logoDark !== undefined && (change.logoDark ? "a new logo for dark backgrounds" : "no logo for dark backgrounds"),
    change.icon !== undefined && (change.icon ? "a new icon in browser tabs" : "the standard icon in browser tabs"),
  ].filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? `Change the standard header and footer: ${parts.join("; ")}.` : "Change nothing in the header and footer.";
}
