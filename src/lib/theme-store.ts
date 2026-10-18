import { baseScheme } from "./color-mode";
import type { DesignSnapshot } from "./design-presets";
import { CORE_SECTION_STYLES, sectionStyleLabel } from "./section-styles";
import { slugify } from "./slug";
import { whatsNew } from "./theme-update";
import { PACK_DEMO_WORDS, PACK_KEYS, PACK_TRADES, type PackKey } from "./content-packs";
import { isStarterPicture } from "./store-starters";
import { themeStorePath } from "./theme-host";
import { readHighlightWords, type HighlightWords, type ThemeHighlight } from "./theme-highlights";
import type { LookShots } from "./theme-shots";

/**
 * The theme store (phase 3 of `docs/theme-store.md`, `docs/theme-phase-3.md`): a theme's listing and what the list and a theme's page say.
 * Pure, free of zod. A listing is the address and the kinds of store and styles the platform's admin chose; everything a theme includes is
 * worked out from its published version (`themeFeatures()`), so a listing never claims what the theme does not do.
 */

export const STORE_KINDS = {
  fashion: "Fashion and accessories",
  food: "Food and drink",
  home: "Home and interior",
  beauty: "Health and beauty",
  crafts: "Crafts and art",
  services: "Services and bookings",
  digital: "Digital products",
} as const;
export type StoreKind = keyof typeof STORE_KINDS;

export const THEME_STYLES = {
  minimal: "Minimal",
  warm: "Warm",
  bold: "Bold",
  classic: "Classic",
  natural: "Natural",
  playful: "Playful",
  artistic: "Artistic",
} as const;
export type ThemeStyle = keyof typeof THEME_STYLES;

/** What a theme includes, as facts of its published version. */
export const THEME_FEATURES = {
  dark: "Light and dark",
  switch: "Visitors choose light or dark",
  header: "Its own header",
  footer: "Its own footer",
  productPage: "Its own product page",
  fonts: "Its own fonts",
  sections: "Section styles beyond the core six",
} as const;
export type ThemeFeature = keyof typeof THEME_FEATURES;

/**
 * A listing: the kinds of store and styles a theme is listed under, and its own pictures beside its main one (`docs/theme-phase-3.md`). What
 * its looks are shown on is the theme's own content (D275, `ThemeContent`), never a choice in the listing: the `pack` and `presetPacks` a
 * listing kept before are no longer read.
 */
export type ThemeListing = {
  kinds: StoreKind[];
  styles: ThemeStyle[];
  pictures: string[];
  /** Its highlights' words (`docs/theme-showcase-phase-2.md` step 2), only when some are written. */
  highlights?: HighlightWords;
  /** The platform admin's own pictures in place of made ones (step 3), by slot, only when some are set. */
  own?: OwnPictures;
};

/**
 * The made pictures a platform admin may replace with their own (`docs/theme-showcase-phase-2.md` step 3): the share image and each
 * highlight. The card's own picture is the theme's main picture (`design_presets.picture_url`), set with its details.
 */
export const OWN_SLOTS = ["share", "devices", "collage", "closeup"] as const;
export type OwnSlot = (typeof OWN_SLOTS)[number];
export type OwnPictures = Partial<Record<OwnSlot, string>>;
export const OWN_SLOT_NAMES: Record<OwnSlot, string> = {
  share: "Share image",
  devices: "Highlight: on a computer and two phones",
  collage: "Highlight: the page, section by section",
  closeup: "Highlight: the product page up close",
};

/** A listing's own pictures: known slots with a picture's address only. */
export function readOwnPictures(value: unknown): OwnPictures {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: OwnPictures = {};
  for (const slot of OWN_SLOTS) {
    const url = (value as Record<string, unknown>)[slot];
    if (isThemePicture(url)) out[slot] = url;
  }
  return out;
}

export const isPack = (value: unknown): value is PackKey => typeof value === "string" && (PACK_KEYS as readonly string[]).includes(value);

/** At most this many pictures beside a theme's main one. */
export const THEME_PICTURES_MAX = 6;

/** A picture's address: one on this site or an https address, as a store template's picture (`isStarterPicture()`). */
export const isThemePicture = (value: unknown): value is string => typeof value === "string" && value.trim() === value && value !== "" && isStarterPicture(value);

/** The address a theme is found at in the store: lowercase letters, digits and hyphens, 1 to 60. */
export const THEME_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

const isKey = <T extends object>(record: T, value: unknown): value is keyof T & string => typeof value === "string" && Object.hasOwn(record, value);
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : typeof value === "string" ? [value] : []);

/** A listing as stored, read safely: unknown kinds and styles are dropped, each kept once, in the lists' own order. */
export function readListing(value: unknown): ThemeListing {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const kinds = new Set(listOf(raw.kinds).filter((k) => isKey(STORE_KINDS, k)));
  const styles = new Set(listOf(raw.styles).filter((s) => isKey(THEME_STYLES, s)));
  const pictures = [...new Set(listOf(raw.pictures).filter(isThemePicture))].slice(0, THEME_PICTURES_MAX);
  const highlights = readHighlightWords(raw.highlights);
  const own = readOwnPictures(raw.own);
  return {
    kinds: (Object.keys(STORE_KINDS) as StoreKind[]).filter((k) => kinds.has(k)),
    styles: (Object.keys(THEME_STYLES) as ThemeStyle[]).filter((s) => styles.has(s)),
    pictures,
    ...(Object.keys(highlights).length > 0 ? { highlights } : {}),
    ...(Object.keys(own).length > 0 ? { own } : {}),
  };
}

/** A listing from the platform admin's form, or what is wrong with it in plain words. */
export function parseListing(form: {
  slug?: unknown;
  kinds?: unknown;
  styles?: unknown;
  pictures?: unknown;
  /** The highlights' words, by kind (`readHighlightWords()`). */
  highlights?: unknown;
  /** The own pictures the listing already has, kept as they are. */
  own?: unknown;
}): { ok: true; slug: string; listing: ThemeListing } | { ok: false; problems: string[] } {
  const slug = typeof form.slug === "string" ? form.slug.trim().toLowerCase() : "";
  const problems: string[] = [];
  if (!slug) problems.push("Give the theme an address in the theme store.");
  else if (!THEME_SLUG.test(slug)) problems.push("The address is lowercase letters, digits and hyphens, at most 60, not starting or ending with a hyphen.");
  const pictures = listOf(form.pictures).filter((value) => !(typeof value === "string" && value.trim() === ""));
  if (pictures.some((value) => !isThemePicture(value))) problems.push("A picture's address is one on this site (/…) or an https:// address.");
  if (pictures.length > THEME_PICTURES_MAX) problems.push(`A theme has at most ${THEME_PICTURES_MAX} pictures beside its main one.`);
  if (problems.length > 0) return { ok: false, problems };
  // The admin's own pictures in place of made ones are saved on their own (`saveThemeOwnPicture()`), so the listing form keeps them.
  return { ok: true, slug, listing: readListing({ kinds: form.kinds, styles: form.styles, pictures, highlights: form.highlights, own: form.own }) };
}

/** The address suggested for a theme that has none: its title, as an address. */
export const suggestedSlug = (title: string): string => slugify(title).slice(0, 60).replace(/-+$/, "") || "theme";

/** What a published version includes. */
export function themeFeatures(snapshot: DesignSnapshot): ThemeFeature[] {
  const settings = snapshot.theme.settings;
  const own = Object.keys(settings.sectionStyles ?? {}).filter((name) => !(CORE_SECTION_STYLES as readonly string[]).includes(name));
  const has: Record<ThemeFeature, boolean> = {
    dark: settings.mode === "auto" || settings.visitorSwitch,
    switch: settings.visitorSwitch,
    header: snapshot.header !== null,
    footer: snapshot.footer !== null,
    productPage: snapshot.productLayout !== null,
    fonts: Boolean(settings.fonts.heading || settings.fonts.body),
    sections: own.length > 0,
  };
  return (Object.keys(THEME_FEATURES) as ThemeFeature[]).filter((key) => has[key]);
}

/** The section styles a version has, by their names in the builder. */
export const themeSectionStyles = (snapshot: DesignSnapshot): string[] => Object.keys(snapshot.theme.settings.sectionStyles ?? {}).map(sectionStyleLabel);

/**
 * A theme's own content (D275, `docs/themes-content-and-demo-stores.md`): its published store template (`store_starters.design_preset_id`),
 * what its preview and photographs draw and new stores started from it are copied from; `pack` when it is one of Kaizena Flow's content
 * packs (a launch theme's), for the words of its trade.
 */
export type ThemeContent = { starterId: string; pack: PackKey | null; storeName: string };

/** What a look is shown on: its theme's own content, the same for every look. */
export type Showcase = { pack: PackKey | null; trade: string | null; line: string; starterId: string };

/** A theme's content as a look's showcase: its store's name, with its trade's words when it is a content pack's. */
export const contentShowcase = (content: ThemeContent): Showcase => ({
  pack: content.pack,
  trade: content.pack ? PACK_TRADES[content.pack] : null,
  line: content.pack ? `${content.storeName}, ${PACK_DEMO_WORDS[content.pack]}` : content.storeName,
  starterId: content.starterId,
});

/** A look of a theme (its own, `key` null, or a preset) and what it is shown on: the theme's own content; null while it has none published. */
export type ThemeLook = {
  key: string | null;
  name: string;
  showcase: Showcase | null;
  /** Its photographs on its showcase (`docs/theme-showcase-phase-2.md` step 1), where made: the latest set at each width. */
  shots?: LookShots | null;
  /** Its own colours and heading font (D275): what its swatch on the theme's page and card is drawn in. */
  swatch?: ThemeSwatch;
};

/** The colours a look is shown in and its heading font, for a swatch (`swatchOf()`). */
export type ThemeSwatch = { background: string; surface: string; text: string; accent: string; accentText: string; heading: string | null };

/**
 * A theme's looks, its own first, each shown on the theme's own content (D275) while it has one published; a preset is another look on the
 * same content. Without published content no look is shown: never a demo store chosen apart, never the Standard store.
 */
export function themeLooks(title: string, presets: { key: string; name: string }[], content: ThemeContent | null): ThemeLook[] {
  const showcase = content ? contentShowcase(content) : null;
  return [{ key: null, name: title, showcase }, ...presets.map((p) => ({ key: p.key, name: p.name, showcase }))];
}

/** The trades a theme's looks are shown on, each once, in its looks' order. */
export const showcaseTrades = (looks: ThemeLook[]): string[] => [...new Set(looks.flatMap((look) => (look.showcase?.trade ? [look.showcase.trade] : [])))];

/** A theme as the list shows it. */
export type ThemeStoreCard = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  pictureUrl: string | null;
  /** The card and the share image made from its own look's photographs (`docs/theme-showcase-phase-2.md` step 1), where made. */
  madeCard: string | null;
  madeShare: string | null;
  /** Its highlights with their words (step 2), where made; empty until then. */
  highlights?: ThemeHighlight[];
  /** Its presets besides its own look, from its published version (`docs/theme-showcase-phase-1.md`), in order. */
  presets: { key: string; name: string }[];
  /** Its own look and its presets, each shown on its own content (`themeLooks()`). */
  looks: ThemeLook[];
  listing: ThemeListing;
  features: ThemeFeature[];
  /** For a card without a picture: the colours its own look is shown in and the heading font. */
  swatch: ThemeSwatch;
};

/**
 * The picture a theme's card shows (`docs/theme-showcase-phase-2.md`): the theme's own, else the card made from the photograph of its own
 * look on its content; null: its colours (`Swatch`). Never the Standard store (D274).
 */
export const cardPicture = (card: Pick<ThemeStoreCard, "pictureUrl" | "madeCard">): string | null => card.pictureUrl ?? card.madeCard;

/**
 * The looks the theme store shows (D274, D275): all of them once the theme's own content is published, none before. A look is never drawn,
 * photographed or previewed on the Standard store.
 */
export const shownLooks = <T extends Pick<ThemeLook, "showcase">>(looks: readonly T[]): T[] => looks.filter((look) => look.showcase !== null);

/**
 * The share image of a theme's page: the admin's own share image (step 3), else its main picture, else the one made from its photograph;
 * null: the one drawn from its colours.
 */
export const sharePicture = (card: Pick<ThemeStoreCard, "pictureUrl" | "madeShare"> & { listing?: Pick<ThemeListing, "own"> }): string | null =>
  card.listing?.own?.share ?? card.pictureUrl ?? card.madeShare;

/**
 * A look's swatch (D280): the palette it is shown in (`baseScheme()`: its dark one when it is always dark, else its light one, as its
 * photographs show it) and its heading font. Its card, its dot among the presets and its highlights' backdrop are drawn in these.
 */
export const swatchOf = (snapshot: DesignSnapshot): ThemeStoreCard["swatch"] => {
  const settings = snapshot.theme.settings;
  const shown = settings[baseScheme(settings)];
  return { background: shown.background, surface: shown.surface, text: shown.text, accent: shown.accent, accentText: shown.accentText, heading: settings.fonts.heading ?? null };
};

/** The list's filters, from the address: one kind of store, one style, one feature; anything unknown is no filter. */
export type ThemeFilter = { kind: StoreKind | null; style: ThemeStyle | null; feature: ThemeFeature | null };

export function parseThemeFilter(query: Record<string, string | string[] | undefined>): ThemeFilter {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const kind = one(query.kind);
  const style = one(query.style);
  const feature = one(query.feature);
  return {
    kind: isKey(STORE_KINDS, kind) ? kind : null,
    style: isKey(THEME_STYLES, style) ? style : null,
    feature: isKey(THEME_FEATURES, feature) ? feature : null,
  };
}

/** The list's address with a filter changed (null: that filter off). */
export function themeFilterHref(filter: ThemeFilter, change: Partial<ThemeFilter>): string {
  const next = { ...filter, ...change };
  const query = new URLSearchParams();
  if (next.kind) query.set("kind", next.kind);
  if (next.style) query.set("style", next.style);
  if (next.feature) query.set("feature", next.feature);
  const text = query.toString();
  return themeStorePath(text ? `?${text}` : "");
}

/** The cards a filter keeps, in the platform's order. A theme listed for no kind of store suits any. */
export const filterThemes = (cards: ThemeStoreCard[], filter: ThemeFilter): ThemeStoreCard[] =>
  cards.filter(
    (card) =>
      (!filter.kind || card.listing.kinds.length === 0 || card.listing.kinds.includes(filter.kind)) &&
      (!filter.style || card.listing.styles.includes(filter.style)) &&
      (!filter.feature || card.features.includes(filter.feature)),
  );

/** A published version as the changelog reads it. */
export type ThemeVersion = { number: number; publishedAt: string; notes: string | null; snapshot: DesignSnapshot };
export type ChangelogEntry = { number: number; date: string; lines: string[] };

/** The changelog, newest first: each version's *What's new* against the one before (D245), the first one said as such. */
export function themeChangelog(versions: ThemeVersion[]): ChangelogEntry[] {
  const ordered = [...versions].sort((a, b) => a.number - b.number);
  return ordered
    .map((version, index) => {
      const before = ordered[index - 1];
      const lines = before ? whatsNew(before.snapshot, version.snapshot, version.notes) : [version.notes?.trim() || "The first version."];
      return { number: version.number, date: version.publishedAt.slice(0, 10), lines: lines.length > 0 ? lines : ["Small changes."] };
    })
    .reverse();
}

/** Structured data for a theme's page: a free creative work, no price. */
export function themeJsonLd(theme: { title: string; summary: string; pictureUrl: string | null }, url: string, publisher: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: theme.title,
    ...(theme.summary && { description: theme.summary }),
    url,
    ...(theme.pictureUrl && { image: theme.pictureUrl }),
    isAccessibleForFree: true,
    genre: "Website theme",
    publisher: { "@type": "Organization", name: publisher },
  };
}

/** The owner's page that installs a theme in a store they choose, without making it live (step 2). */
export const themeTryPath = (slug: string, preset: string | null = null) =>
  `/admin/account/themes/try/${slug}${preset ? `?preset=${encodeURIComponent(preset)}` : ""}`;

/** *Start with this theme*: sign-up with the theme, or one of its presets, chosen (`ThemeFromAddress`, `docs/theme-showcase-phase-1.md` step 4). */
export const themeStartLink = (id: string, preset: string | null = null) =>
  `/sign-up?theme=${encodeURIComponent(id)}${preset ? `&preset=${encodeURIComponent(preset)}` : ""}`;

/** A look's key from the address (`?preset=`): one of the theme's presets, else null (its own look). */
export const lookChoice = (looks: readonly Pick<ThemeLook, "key">[], value: unknown): string | null =>
  typeof value === "string" && value !== "" && looks.some((look) => look.key === value) ? value : null;

/** The full-screen preview's choices (D275): Home or A product, on a computer or a phone. */
export type PreviewView = { show: "home" | "product"; device: "computer" | "phone" };

export const previewView = (query: Record<string, string | string[] | undefined>): PreviewView => ({
  show: query.show === "product" ? "product" : "home",
  device: query.device === "phone" ? "phone" : "computer",
});

/**
 * A theme's full-screen preview in the theme store (D275, `docs/themes-content-and-demo-stores.md` section 6): `/themes/{slug}/preview`,
 * or `/{slug}/preview` on its own host, with the look and the view in the address so a shared link opens on them.
 */
export function themePreviewPath(slug: string, preset: string | null = null, view: Partial<PreviewView> = {}): string {
  const query = new URLSearchParams();
  if (preset) query.set("preset", preset);
  if (view.show === "product") query.set("show", "product");
  if (view.device === "phone") query.set("device", "phone");
  const search = query.toString();
  return themeStorePath(`${slug}/preview${search ? `?${search}` : ""}`);
}

/** A theme's page with one of its looks chosen (`?preset=`), as a shared link opens it. */
export const themePagePath = (slug: string, preset: string | null = null): string =>
  themeStorePath(`${slug}${preset ? `?preset=${encodeURIComponent(preset)}` : ""}`);

/** What *Try it in your store* links to: a route that sends the person there, or to sign in and back (the theme's page is cached). */
export const themeTryLink = (slug: string, preset: string | null = null) => `/themes/${slug}/try${preset ? `?preset=${encodeURIComponent(preset)}` : ""}`;
