import type { DesignSnapshot } from "./design-presets";
import { CORE_SECTION_STYLES, sectionStyleLabel } from "./section-styles";
import { slugify } from "./slug";
import { whatsNew } from "./theme-update";
import { PACK_DEMO_WORDS, PACK_KEYS, PACK_TRADES, contentPack, type PackKey } from "./content-packs";
import { isStarterPicture } from "./store-starters";
import { themeStorePath } from "./theme-host";

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
 * A listing: the kinds of store and styles a theme is listed under, and its own pictures beside its main one (`docs/theme-phase-3.md`); and
 * the content pack each of its looks is shown on (`docs/theme-showcase-phase-1.md` step 3): `pack` for the theme's own look, `presetPacks`
 * for its presets by key. A look with no pack, or whose pack's store template is not published, is shown on the Standard store.
 */
export type ThemeListing = { kinds: StoreKind[]; styles: ThemeStyle[]; pictures: string[]; pack: PackKey | null; presetPacks: Record<string, PackKey> };

/** A preset's key, as `VARIATION_KEY` (here without zod's module). */
const PRESET_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
const isPack = (value: unknown): value is PackKey => typeof value === "string" && (PACK_KEYS as readonly string[]).includes(value);

/** The content pack a look of the theme is shown on: its own look (`null`) or a preset's, or null for the Standard store. */
export const showcasePack = (listing: Pick<ThemeListing, "pack" | "presetPacks">, key: string | null): PackKey | null =>
  key === null ? listing.pack : (listing.presetPacks[key] ?? null);

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
  const presets = raw.presetPacks && typeof raw.presetPacks === "object" && !Array.isArray(raw.presetPacks) ? (raw.presetPacks as Record<string, unknown>) : {};
  return {
    kinds: (Object.keys(STORE_KINDS) as StoreKind[]).filter((k) => kinds.has(k)),
    styles: (Object.keys(THEME_STYLES) as ThemeStyle[]).filter((s) => styles.has(s)),
    pictures,
    pack: isPack(raw.pack) ? raw.pack : null,
    presetPacks: Object.fromEntries(
      Object.entries(presets)
        .filter((entry): entry is [string, PackKey] => PRESET_KEY.test(entry[0]) && isPack(entry[1]))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };
}

/** A listing from the platform admin's form, or what is wrong with it in plain words. */
export function parseListing(form: {
  slug?: unknown;
  kinds?: unknown;
  styles?: unknown;
  pictures?: unknown;
  /** The pack the theme's own look is shown on ("" for the Standard store). */
  pack?: unknown;
  /** Each preset's pack, by key ("" for the Standard store). */
  presetPacks?: Record<string, unknown>;
}): { ok: true; slug: string; listing: ThemeListing } | { ok: false; problems: string[] } {
  const slug = typeof form.slug === "string" ? form.slug.trim().toLowerCase() : "";
  const problems: string[] = [];
  if (!slug) problems.push("Give the theme an address in the theme store.");
  else if (!THEME_SLUG.test(slug)) problems.push("The address is lowercase letters, digits and hyphens, at most 60, not starting or ending with a hyphen.");
  const pictures = listOf(form.pictures).filter((value) => !(typeof value === "string" && value.trim() === ""));
  if (pictures.some((value) => !isThemePicture(value))) problems.push("A picture's address is one on this site (/…) or an https:// address.");
  if (pictures.length > THEME_PICTURES_MAX) problems.push(`A theme has at most ${THEME_PICTURES_MAX} pictures beside its main one.`);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, slug, listing: readListing({ kinds: form.kinds, styles: form.styles, pictures, pack: form.pack, presetPacks: form.presetPacks }) };
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

/** The demo store a look is shown on: a content pack's published store template. */
export type Showcase = { pack: PackKey; trade: string; line: string; starterId: string };

/** A look of a theme (its own, `key` null, or a preset) and the demo store it is shown on; null: the Standard store. */
export type ThemeLook = { key: string | null; name: string; showcase: Showcase | null };

/**
 * A theme's looks, its own first, each with the content pack its listing names when that pack's store template is published (`packs`: pack
 * to its template's id); any other look is shown on the Standard store, as before packs (`docs/theme-showcase-phase-1.md` step 3).
 */
export function themeLooks(title: string, presets: { key: string; name: string }[], listing: Pick<ThemeListing, "pack" | "presetPacks">, packs: ReadonlyMap<string, string>): ThemeLook[] {
  const showcase = (key: string | null): Showcase | null => {
    const pack = showcasePack(listing, key);
    const starterId = pack ? packs.get(pack) : undefined;
    const data = pack ? contentPack(pack) : null;
    return pack && starterId && data ? { pack, trade: PACK_TRADES[pack], line: `${data.storeName}, ${PACK_DEMO_WORDS[pack]}`, starterId } : null;
  };
  return [{ key: null, name: title, showcase: showcase(null) }, ...presets.map((p) => ({ key: p.key, name: p.name, showcase: showcase(p.key) }))];
}

/** The trades a theme's looks are shown on, each once, in its looks' order. */
export const showcaseTrades = (looks: ThemeLook[]): string[] => [...new Set(looks.flatMap((look) => (look.showcase ? [look.showcase.trade] : [])))];

/** A theme as the list shows it. */
export type ThemeStoreCard = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  pictureUrl: string | null;
  /** A launch theme's photograph on the demo store (`launchShot()`), shown on its card where the admin gave no picture. */
  shotUrl: string | null;
  /** Its presets besides its own look, from its published version (`docs/theme-showcase-phase-1.md`), in order. */
  presets: { key: string; name: string }[];
  /** Its own look and its presets, each with the demo store it is shown on (`themeLooks()`). */
  looks: ThemeLook[];
  listing: ThemeListing;
  features: ThemeFeature[];
  /** For a card without a picture: the light colours and the heading font. */
  swatch: { background: string; surface: string; text: string; accent: string; accentText: string; heading: string | null };
};

export const swatchOf = (snapshot: DesignSnapshot): ThemeStoreCard["swatch"] => {
  const light = snapshot.theme.settings.light;
  return { background: light.background, surface: light.surface, text: light.text, accent: light.accent, accentText: light.accentText, heading: snapshot.theme.settings.fonts.heading ?? null };
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

/** What *Try it in your store* links to: a route that sends the person there, or to sign in and back (the theme's page is cached). */
export const themeTryLink = (slug: string, preset: string | null = null) => `/themes/${slug}/try${preset ? `?preset=${encodeURIComponent(preset)}` : ""}`;
