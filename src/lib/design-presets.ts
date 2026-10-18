import { z } from "zod";

import { CSS_MAX, cssProblem } from "./custom-css";
import {
  PAGE_TITLE_MAX,
  ROWS_MAX,
  newPageContent,
  pageFonts,
  pageRowSchema,
  type PageBlock,
  type PageContent,
  type PageRow,
} from "./page-content";
import type { PageLayout } from "./page-layout";
import { slugify } from "./slug";
import { themeFontFamilies } from "./theme-elements";
import { isStarterPicture, starterChoice } from "./store-starters";
import {
  isStorageUrl,
  mapTemplateMedia,
  sanitizeTemplate,
  templateMediaUrls,
  type ForeignStore,
  type MediaResolver,
} from "./template-content";
import type { ThemeListing } from "./theme-store";
import { THEME_TEMPLATE_KEYS, themeSettingsSchema, type ThemeSettings, type ThemeTemplate } from "./theme";

/**
 * Design profiles (D176, `docs/design-profiles.md`): a frozen snapshot of a store's look, never its content, that the platform's admins
 * make from a store and that any store can apply. Called "design presets" in code so they are never confused with the builder's templates
 * (D125), page layouts (D127), store templates (`starters`, D175) or a store's saved themes (D60); "Themes" in the interface (D241). Pure:
 * shared by the platform's pages, the owner's design settings, the sign-up form, the preview and the tests.
 */

// ---------------------------------------------------------------------------
// What a design profile holds: the look, never the brand or the content
// ---------------------------------------------------------------------------

/**
 * The store's columns a snapshot is taken from: its look. Everything a design profile changes in a store is one of these (and the header,
 * footer and product layout pages they choose, made new in the store).
 */
export const LOOK_FIELDS = ["theme", "custom_css", "header_id", "footer_id", "product_layout_id"] as const;

/**
 * The store's own brand and content, which a snapshot never reads and applying never writes: its name, logos and icon (`navigation`), its
 * business details, search texts, menus and their links, tracking and its own code, and its pages, products and everything else.
 */
export const BRAND_FIELDS = [
  "name",
  "navigation",
  "seo",
  "legal_name",
  "organisation_number",
  "contact_email",
  "postal_address",
  "country",
  "header_menu_id",
  "footer_menu_id",
  "front_page_id",
  "products_page_id",
  "tracking",
  "custom_code",
  "locales",
] as const;

/** The places a layout of a design profile goes: the store's chosen header and footer (D80) and standard product layout (D79). */
export const DESIGN_LAYOUT_KINDS = ["header", "footer", "productLayout"] as const;
export type DesignLayoutKind = (typeof DESIGN_LAYOUT_KINDS)[number];
/** The kind of page each is. */
export const LAYOUT_PAGE_TYPE = { header: "header", footer: "footer", productLayout: "product_layout" } as const;

/** Which of the store's chosen menus a menu component showed: its header's or its footer's (D85). Any other menu is not carried. */
export type MenuRole = "header" | "footer";

const css = z
  .string()
  .max(CSS_MAX)
  .default("")
  .superRefine((value, ctx) => {
    const problem = cssProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: `Custom CSS: ${problem}` });
  });

/** A header, footer or product layout as a design profile keeps it: its rows and CSS, a header's place over the page, and its menus' roles. */
export const designLayoutSchema = z.object({
  rows: z.array(pageRowSchema).max(ROWS_MAX),
  css,
  /** A header lying over the page (D80), everywhere or on the front page only: pages in some categories or tags are the store's own. */
  overlay: z
    .object({
      where: z.enum(["everywhere", "front"]),
      textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    })
    .optional(),
  /** Menu components by block id: the role of the menu each showed, so applying shows the store's own menu of that role. */
  menus: z.record(z.string().max(100), z.enum(["header", "footer"])).default({}),
});
export type DesignLayout = {
  rows: PageRow[];
  css: string;
  overlay?: { where: "everywhere" | "front"; textColor?: string };
  menus: Record<string, MenuRole>;
};

export const DESIGN_SNAPSHOT_VERSION = 1;
/** A snapshot that carries the theme's presets (`docs/theme-showcase-phase-1.md`) is version 2; one without them stays version 1. */
export const DESIGN_SNAPSHOT_WITH_PRESETS = 2;

/** A preset's key (`design_variations.key`): fixed once made, in its address and in the installs made from it. */
export const VARIATION_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Presets besides the theme's own look (six in all). */
export const VARIATIONS_MAX = 5;
export const VARIATION_NAME_MAX = 40;

const themeLookSchema = z.object({ base: z.enum(THEME_TEMPLATE_KEYS), settings: themeSettingsSchema });

/**
 * One of a theme's presets as a version keeps it (*Presets* in the interface, variations in code): a whole look over the theme (the D60
 * template and every setting); the theme's header, footer, product layout and CSS are shared by its presets.
 */
export const designVariationSchema = z.object({
  key: z.string().regex(VARIATION_KEY),
  name: z.string().trim().min(1).max(VARIATION_NAME_MAX),
  theme: themeLookSchema,
});
export type DesignVariation = { key: string; name: string; theme: { base: ThemeTemplate; settings: ThemeSettings } };

/**
 * A design profile's snapshot (`design_presets.snapshot`): the theme (template and settings, D60: colours, fonts, headings, buttons, corners,
 * layout, product cards, the store's light or dark mode and the visitor's switch), the header, footer and standard product layout (null: the
 * standard one, which applying chooses too), and the site's CSS (D100); version 2 adds the theme's presets (`variations`, at most
 * `VARIATIONS_MAX`, keys unique). Unknown keys are dropped when it is read, so a snapshot can never carry anything else into a store.
 */
export const designSnapshotSchema = z
  .object({
    v: z.union([z.literal(DESIGN_SNAPSHOT_VERSION), z.literal(DESIGN_SNAPSHOT_WITH_PRESETS)]),
    theme: themeLookSchema,
    header: designLayoutSchema.nullable(),
    footer: designLayoutSchema.nullable(),
    productLayout: designLayoutSchema.nullable(),
    css,
    variations: z.array(designVariationSchema).max(VARIATIONS_MAX).optional(),
  })
  .superRefine((value, ctx) => {
    const keys = (value.variations ?? []).map((v) => v.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Two presets have the same key." });
  });
export type DesignSnapshot = {
  v: typeof DESIGN_SNAPSHOT_VERSION | typeof DESIGN_SNAPSHOT_WITH_PRESETS;
  theme: { base: ThemeTemplate; settings: ThemeSettings };
  header: DesignLayout | null;
  footer: DesignLayout | null;
  productLayout: DesignLayout | null;
  css: string;
  /** The theme's presets besides its own look (version 2); absent or empty: none. */
  variations?: DesignVariation[];
};

/** A stored snapshot, or null when it cannot be read (then it is neither offered nor applied). A version 1 snapshot has no presets. */
export function parseDesignSnapshot(value: unknown): DesignSnapshot | null {
  const parsed = designSnapshotSchema.safeParse(value);
  if (!parsed.success) return null;
  const snapshot = parsed.data as DesignSnapshot;
  return snapshotAsStored(snapshot.v === DESIGN_SNAPSHOT_VERSION ? { ...snapshot, variations: [] } : snapshot);
}

/**
 * A snapshot as it is stored: version 2 with its presets, version 1 without (so a theme with no presets keeps the same stored snapshot as
 * before presets existed, and republishing it adds no version).
 */
export function snapshotAsStored(snapshot: DesignSnapshot): DesignSnapshot {
  const { variations, ...look } = snapshot;
  return variations?.length ? { ...look, v: DESIGN_SNAPSHOT_WITH_PRESETS, variations } : { ...look, v: DESIGN_SNAPSHOT_VERSION };
}

// ---------------------------------------------------------------------------
// Taking a snapshot
// ---------------------------------------------------------------------------

const STORAGE_PATH = "/storage/v1/object/public/";

/** CSS a design profile may carry: clean (`cssProblem()`), and reaching into no store's files. Else none, and the reason. */
export function carriedCss(value: string): { css: string; dropped: boolean } {
  const trimmed = value.trim();
  if (trimmed === "") return { css: "", dropped: false };
  return cssProblem(trimmed) === null && !trimmed.includes(STORAGE_PATH) ? { css: trimmed, dropped: false } : { css: "", dropped: true };
}

/** Blocks that show the store's own data by id and cannot mean anything in another store: custom fields (D118) and field loops (D120). */
const STORE_DATA_BLOCKS: ReadonlySet<PageBlock["type"]> = new Set(["customField", "fieldLoop"]);

const mapBlocks = (rows: PageRow[], fn: (blocks: PageBlock[]) => PageBlock[]): PageRow[] =>
  rows.map((row) => ({ ...row, columns: row.columns.map((column) => ({ ...column, blocks: fn(column.blocks) })) }));

/** What a snapshot of a layout left out, for the platform admin's message. */
export type SnapshotNotes = { fieldBlocks: number; otherMenus: number; cssDropped: boolean; overlayDropped: boolean };

/**
 * A store's published header, footer or product layout as a design profile keeps it (pure): the store's own field components out, each
 * menu component's menu named by its role (the store's header or footer menu; any other menu is left out), and then the same cleaning as a
 * template used in another store (`sanitizeTemplate()`, D125/D127): no global marks, no menu or other ids, no links or files into the
 * store, no contact details, no form recipients, no other owner's HTML; its pictures stay for `mapSnapshotMedia()`. Its words in other
 * languages are not kept (they may hold links the cleaning does not see, and the store applying it has its own languages).
 */
export function snapshotLayout(
  content: Pick<PageContent, "rows" | "css" | "overlay">,
  kind: DesignLayoutKind,
  menus: { header: string | null; footer: string | null },
  from: ForeignStore,
): { layout: DesignLayout; notes: SnapshotNotes } {
  const notes: SnapshotNotes = { fieldBlocks: 0, otherMenus: 0, cssDropped: false, overlayDropped: false };
  const rows = mapBlocks(content.rows, (blocks) =>
    blocks.filter((block) => {
      if (!STORE_DATA_BLOCKS.has(block.type)) return true;
      notes.fieldBlocks += 1;
      return false;
    }),
  );
  const roles: Record<string, MenuRole> = {};
  for (const block of rows.flatMap((row) => row.columns.flatMap((column) => column.blocks))) {
    if (block.type !== "menu" || !block.menuId) continue;
    if (menus.header && block.menuId === menus.header) roles[block.id] = "header";
    else if (menus.footer && block.menuId === menus.footer) roles[block.id] = "footer";
    else notes.otherMenus += 1;
  }
  const clean = sanitizeTemplate("page", { pageType: LAYOUT_PAGE_TYPE[kind], rows, css: content.css ?? "" } satisfies PageLayout, from) as PageLayout;
  notes.cssDropped = (content.css ?? "").trim() !== "" && clean.css === "";
  let overlay: DesignLayout["overlay"];
  if (kind === "header" && content.overlay) {
    if (content.overlay.where === "terms") notes.overlayDropped = true;
    else overlay = { where: content.overlay.where, ...(content.overlay.textColor && { textColor: content.overlay.textColor }) };
  }
  return { layout: { rows: clean.rows, css: clean.css.trim(), ...(overlay && { overlay }), menus: roles }, notes };
}

// ---------------------------------------------------------------------------
// Applying (and previewing) a snapshot in a store
// ---------------------------------------------------------------------------

/**
 * A layout of a design profile as a page of the store it goes to (pure): each menu component shows the store's own menu of its role (none
 * when the store has none: the component then shows nothing until the owner chooses one), with the title and address given. What
 * `applyDesignPreset()` saves and the preview draws, so the preview is what applying makes.
 */
export function layoutForStore(
  layout: DesignLayout,
  menus: { header: string | null; footer: string | null },
  page: { title: string; slug: string },
): PageContent {
  const rows = mapBlocks(layout.rows, (blocks) =>
    blocks.map((block) => {
      if (block.type !== "menu") return block;
      const rest: PageBlock = { ...block };
      delete (rest as { menuId?: string }).menuId;
      const role = layout.menus[block.id];
      const menuId = role ? menus[role] : null;
      return menuId ? ({ ...rest, menuId } as PageBlock) : rest;
    }),
  );
  return {
    ...newPageContent(),
    title: page.title.slice(0, PAGE_TITLE_MAX),
    slug: page.slug,
    rows,
    ...(layout.css && { css: layout.css }),
    ...(layout.overlay && { overlay: { where: layout.overlay.where, categories: [], tags: [], ...(layout.overlay.textColor && { textColor: layout.overlay.textColor }) } }),
  };
}

/** Every font family a snapshot needs installed: the theme's heading and body, and the layouts' blocks' own (D59). */
export function snapshotFonts(snapshot: DesignSnapshot): string[] {
  const layouts = [snapshot.header, snapshot.footer, snapshot.productLayout].filter((l): l is DesignLayout => l !== null);
  return [...new Set([...themeFontFamilies(snapshot.theme.settings), ...layouts.flatMap((layout) => pageFonts(layout))])];
}

const asLayout = (layout: DesignLayout, kind: DesignLayoutKind): PageLayout => ({ pageType: LAYOUT_PAGE_TYPE[kind], rows: layout.rows, css: layout.css });

/** Every picture and video address in a snapshot's layouts that is a site's own upload (in Storage), once each. */
export function snapshotStorageUrls(snapshot: DesignSnapshot): string[] {
  const found = new Set<string>();
  for (const kind of DESIGN_LAYOUT_KINDS) {
    const layout = snapshot[kind];
    if (layout) for (const url of templateMediaUrls("page", asLayout(layout, kind))) if (isStorageUrl(url)) found.add(url);
  }
  return [...found];
}

/**
 * A snapshot with each picture and video address through `resolve` (`mapTemplateMedia()`, D125): the store's own copies in place of the
 * source's files; what resolves to null is left out (a picture becomes none, a background goes).
 */
export function mapSnapshotMedia(snapshot: DesignSnapshot, resolve: MediaResolver): DesignSnapshot {
  const next: DesignSnapshot = { ...snapshot };
  for (const kind of DESIGN_LAYOUT_KINDS) {
    const layout = snapshot[kind];
    if (!layout) continue;
    const mapped = mapTemplateMedia("page", asLayout(layout, kind), resolve) as PageLayout;
    next[kind] = { ...layout, rows: mapped.rows };
  }
  return next;
}

/** The name of the saved theme (D60) the look before a profile is kept as: "Before {profile} ({date})", within 60 characters and not taken. */
export function beforeThemeName(title: string, date: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((name) => name.toLowerCase()));
  const tail = ` (${date})`;
  const room = 60 - "Before ".length - tail.length;
  const short = title.length > room ? `${title.slice(0, room - 1).trimEnd()}…` : title;
  const base = `Before ${short}${tail}`;
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n += 1) {
    const suffix = ` ${n}`;
    const candidate = base.length + suffix.length > 60 ? `${base.slice(0, 60 - suffix.length)}${suffix}` : `${base}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base.slice(0, 50)} ${Date.now().toString(36).slice(-6)}`;
}

/** An address for a page a profile makes, not taken by the store's pages of that kind: `{kind}-{profile}`, then `-2`, `-3` … */
export function designPageSlug(kind: DesignLayoutKind, title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const prefix = kind === "productLayout" ? "product-layout" : kind;
  const base = [prefix, slugify(title, 50)].filter(Boolean).join("-").slice(0, 70).replace(/-+$/g, "");
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now().toString(36)}`;
}

/** The title of a page a profile makes: "{Profile} header" and so on, as the builder lists it. */
export const designPageTitle = (kind: DesignLayoutKind, title: string): string =>
  `${title} ${kind === "productLayout" ? "product layout" : kind}`.slice(0, PAGE_TITLE_MAX);

// ---------------------------------------------------------------------------
// Details, choices and cards
// ---------------------------------------------------------------------------

/** The limits the database's checks hold too (`design_presets_*`). */
export const DESIGN_LIMITS = { title: 80, summary: 200, description: 2000, pictureUrl: 2000 } as const;

export type DesignDetails = { title: string; summary: string; description: string; pictureUrl: string | null };

/** Reads a design profile's details from a form, or says what is wrong with them, in plain words. */
export function parseDesignDetails(form: {
  title?: unknown;
  summary?: unknown;
  description?: unknown;
  pictureUrl?: unknown;
}): { ok: true; details: DesignDetails } | { ok: false; problems: string[] } {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const title = text(form.title);
  const summary = text(form.summary);
  const description = Array.from(text(form.description).replace(/\r\n?/g, "\n"))
    .filter((c) => c === "\n" || (c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127))
    .join("");
  const picture = text(form.pictureUrl);
  const problems: string[] = [];
  if (!title) problems.push("Enter a title.");
  else if (title.length > DESIGN_LIMITS.title) problems.push(`Keep the title under ${DESIGN_LIMITS.title + 1} characters.`);
  if (summary.length > DESIGN_LIMITS.summary) problems.push(`Keep the summary under ${DESIGN_LIMITS.summary + 1} characters.`);
  if (description.length > DESIGN_LIMITS.description) problems.push(`Keep the description under ${DESIGN_LIMITS.description + 1} characters.`);
  if (picture && !isStarterPicture(picture)) problems.push("The picture's address must start with https:// or be a path on this site.");
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, details: { title, summary, description, pictureUrl: picture || null } };
}

/**
 * What a form's choice of design profile is: a profile's id, or null to keep the store template's own look. Anything else is null too, and
 * the server checks the id again (published, or refused), so a value never chooses something that is not offered.
 */
export const designChoice = (value: unknown): string | null => designLookChoice(value)?.id ?? null;

/** A theme and one of its looks as a form's value: `{id}` for its own look, `{id}:{key}` for a preset (`docs/theme-showcase-phase-1.md` step 4). */
export const designLookValue = (id: string, variation: string | null): string => (variation ? `${id}:${variation}` : id);

/**
 * What a form's choice of a theme's look is: the theme's id and its preset's key (null for its own look), or null to keep the store
 * template's own look. A malformed value is null; the server checks the theme (published) and the key (in its published version) again.
 */
export function designLookChoice(value: unknown): { id: string; variation: string | null } | null {
  if (typeof value !== "string") return null;
  const [rawId, rawKey, ...rest] = value.trim().split(":");
  const id = starterChoice(rawId);
  if (!id || rest.length > 0) return null;
  if (rawKey === undefined) return { id, variation: null };
  const key = rawKey.trim().toLowerCase();
  return VARIATION_KEY.test(key) ? { id, variation: key } : null;
}

/** A design profile as owners and the sign-up form see it. */
export type OfferedDesign = {
  id: string;
  title: string;
  summary: string;
  description: string;
  pictureUrl: string | null;
  /** Its presets besides its own look, from its published version (`docs/theme-showcase-phase-1.md`); absent or empty: none. */
  presets?: { key: string; name: string }[];
};

/**
 * A design profile as the platform admin sees it. Its `OfferedDesign` fields are the **published** details (what stores see); `draft` is
 * what was saved since (D177), shown to the admin in their place.
 */
export type DesignRow = OfferedDesign & {
  published: boolean;
  position: number;
  sourceStoreId: string | null;
  sourceStoreName: string | null;
  sourceStoreSlug: string | null;
  /** Stores it was applied to so far (`design_preset_uses`). */
  storesUsing: number;
  /** Whether Kaizena Flow's own site has it installed (`docs/theme-phase-4.md`). */
  onPlatform: boolean;
  /** Access requests that chose it (D177): with stores using it, what keeps it from being deleted. */
  requests: number;
  /** Store templates that recommend it. */
  recommendedBy: string[];
  snapshotAt: string;
  readable: boolean;
  /** Details saved but not published (D177), or null. */
  draft: DesignDetails | null;
  /** Its workspace store (D177), or null for a profile made before D177 that was not edited since. */
  workspaceStoreId: string | null;
  workspaceSlug: string | null;
  /** The key of the workspace's look when it was last published or made (`snapshotKey()`). */
  workspaceKey: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  /** Its address and listing in the theme store (`docs/theme-phase-3.md`); null: not listed yet. */
  slug: string | null;
  listing: ThemeListing;
};

/** A saved draft of a profile's details (`design_presets.draft`), or null when it cannot be read. */
export function readDesignDraft(value: unknown): DesignDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = parseDesignDetails(value as Record<string, unknown>);
  return parsed.ok ? parsed.details : null;
}

/** Whether two sets of details are the same (a draft equal to what is published is no draft). */
export const sameDesignDetails = (a: DesignDetails, b: DesignDetails): boolean =>
  a.title === b.title && a.summary === b.summary && a.description === b.description && (a.pictureUrl ?? null) === (b.pictureUrl ?? null);

/** Where a new design profile starts (D177): a store's look, or Kaizen's standard one. */
export type DesignOrigin = { kind: "store"; storeId: string } | { kind: "scratch" };

/** The parts of a profile edited on its own pages (D177), in the order of its tabs, with their addresses under the profile's. */
export const DESIGN_TABS = [
  { key: "details", label: "Details", segment: "" },
  { key: "theme", label: "Theme", segment: "/theme" },
  { key: "presets", label: "Presets", segment: "/presets" },
  { key: "content", label: "Content", segment: "/content" },
  { key: "header", label: "Header", segment: "/header" },
  { key: "footer", label: "Footer", segment: "/footer" },
  { key: "productLayout", label: "Product page", segment: "/product-layout" },
  { key: "css", label: "CSS", segment: "/css" },
] as const;
export type DesignTab = (typeof DESIGN_TABS)[number]["key"];

/** The address of one of a profile's own pages (D177). */
export const designTabHref = (presetId: string, tab: DesignTab): string =>
  `/admin/platform/themes/${presetId}${DESIGN_TABS.find((t) => t.key === tab)?.segment ?? ""}`;

/** A card to choose: a design profile, or "keep the look" (`id` empty). */
export type DesignCard = Pick<OfferedDesign, "title" | "summary" | "description" | "pictureUrl"> & {
  id: string;
  /** The preview, opened in a new window; null for the Standard card. */
  previewHref: string | null;
  /**
   * The demo store its own look starts a new store with (D273): the published store template of the content pack it is shown on
   * (`docs/theme-showcase-phase-1.md` step 3), or null for the Standard store; and that store in a few words (`Showcase.line`).
   */
  starterId?: string | null;
  demo?: string | null;
  /** Its presets (step 4), each its own choice under the card. */
  looks?: DesignLookCard[];
};

/** A theme's preset as a choice under its card: its key and name, the trade it is shown on, the demo store it starts with, its preview. */
export type DesignLookCard = { key: string; name: string; trade: string | null; starterId: string | null; demo?: string | null; previewHref: string };

/**
 * The first card at creation and sign-up (D273): no theme of its own, so the Standard store's look and its demo products of every kind.
 * Any theme can be chosen later from Design settings.
 */
export function keepDesignCard(): DesignCard {
  return {
    id: "",
    title: "Standard",
    summary: "A simple look with a demo product of every kind. Choose a theme any time later.",
    description: "",
    pictureUrl: null,
    previewHref: null,
  };
}

/**
 * The address of a design profile's preview: on a store template's front page and one product (the Standard store's when none); with
 * `admin` unpublished ones too, and with `draft` the look in its workspace as last saved (D177).
 */
export function designPreviewPath(presetId: string, starterId?: string | null, admin = false, draft = false, embed = false, variation: string | null = null): string {
  const query = new URLSearchParams();
  if (starterId) query.set("starter", starterId);
  // One of the theme's presets (`docs/theme-showcase-phase-1.md`), by its key; none: the theme's own look.
  if (variation) query.set("preset", variation);
  if (admin) query.set("as", "admin");
  // The look in the profile's workspace, not yet published (D177): for platform admins only.
  if (admin && draft) query.set("draft", "1");
  // In a frame on the theme store's page, which says what it is: the store alone, no line above it.
  if (embed) query.set("embed", "1");
  const search = query.toString();
  return `/admin/account/themes/${presetId}/preview${search ? `?${search}` : ""}`;
}

/** The plain words for a refusal of the database's design profile rules, or null when the error is not one of them. */
export function designRefusal(text: string): string | null {
  if (text.includes("design_presets.used")) return "A store applied this theme, so it cannot be deleted. Archive it instead.";
  if (text.includes("design_presets.requested")) return "An access request chose this theme, so it cannot be deleted. Archive it instead.";
  if (text.includes("design_presets.workspace_fixed") || text.includes("design_presets.not_workspace")) return "The theme's workspace could not be set up. Try again.";
  if (text.includes("design_presets_archived_unpublished")) return "An archived theme is never published. Restore it first.";
  if (text.includes("design_preset_uses.restored")) return "The look from before was put back already.";
  if (text.includes("design_preset_uses.")) return "That record of a theme cannot be changed.";
  if (text.includes("design_presets_snapshot")) return "The store's look is too large to keep as a theme.";
  if (text.includes("design_presets_")) return "Those details do not fit. Check the lengths and the picture's address.";
  return null;
}
