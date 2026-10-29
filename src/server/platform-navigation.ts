import "server-only";

import { langOfLocale, PLATFORM_LANGS, type PlatformLang } from "@/lib/platform-lang";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import {
  businessDetailsSchema,
  parseBusinessDetails,
  parsePlatformMenuItems,
  parsePlatformNavigation,
  platformNavigationSchema,
  type BusinessDetails,
  type Favicon,
  type MenuPage,
  type PlatformMenu,
  type PlatformNavigation,
  termNames,
  type TermNames,
} from "@/lib/navigation";
import { type TrackingSettings } from "@/lib/cookie-consent";
import { parseTracking } from "@/lib/cookie-consent-schema";
import { parseSiteFonts, type SiteFonts } from "@/lib/fonts-schema";
import { parseStoreTheme, type StoreTheme } from "@/lib/theme";

import { audit, type Account } from "./auth";
import { ownMenus, standardMenusInput } from "./navigation";
import { listPublishedPages } from "./pages";
import { siteTerms } from "./taxonomy";
import type { SaveResult } from "./settings";

type Row = Record<string, unknown>;

/** Revalidate after Kaizen's logo, menus or business details change. */
export const PLATFORM_NAVIGATION_TAG = "platform-navigation";

/** Everything Kaizen's header and footer show (D42). */
export type PlatformChrome = {
  navigation: PlatformNavigation;
  /** Kaizen's menus (D85), and those its standard header (and phone menu) and footer show. */
  menus: PlatformMenu[];
  headerMenuId: string | null;
  footerMenuId: string | null;
  business: BusinessDetails;
  /** Published pages by id, so menu links follow a page to a new address. */
  pages: Map<string, MenuPage>;
  /** Page category and tag names by address, for links to their listings (D50). */
  terms: TermNames;
  /** Published articles by id, and blog category names by address (D57). */
  blog: { articles: Map<string, MenuPage>; categories: ReadonlyMap<string, string> };
  /** Kaizen's analytics and marketing tools, loaded only with consent (D58). */
  tracking: TrackingSettings;
  /** Kaizen's heading and body fonts (D59). */
  fonts: SiteFonts;
  /** Kaizen's own CSS for every one of its pages (D100). */
  customCss: string;
  /** Kaizen's own theme (D235): Minimal until the page builder's Theme tab or saved colours change it; its fonts are `fonts`. */
  theme: StoreTheme;
  /** The languages the site is offered in (D312), English first: `platform_settings.locales` read as the site's languages. */
  langs: PlatformLang[];
};

async function loadSettings(): Promise<{
  navigation: PlatformNavigation;
  menus: PlatformMenu[];
  headerMenuId: string | null;
  footerMenuId: string | null;
  business: BusinessDetails;
  tracking: TrackingSettings;
  fonts: SiteFonts;
  customCss: string;
  theme: StoreTheme;
  langs: PlatformLang[];
}> {
  "use cache";
  cacheLife("hours");
  cacheTag(PLATFORM_NAVIGATION_TAG);
  const [[row], menus] = await Promise.all([
    readDb().execute<Row>(sql`select navigation, business, tracking, fonts, custom_css, theme, locales, header_menu_id, footer_menu_id from commerce.platform_settings`),
    readDb().execute<Row>(sql`select id, name, items from commerce.menus where store_id is null order by name`),
  ]);
  return {
    navigation: parsePlatformNavigation(row?.navigation),
    menus: menus.map((m) => ({ id: String(m.id), name: String(m.name), items: parsePlatformMenuItems(m.items) })),
    headerMenuId: row?.header_menu_id ? String(row.header_menu_id) : null,
    footerMenuId: row?.footer_menu_id ? String(row.footer_menu_id) : null,
    business: parseBusinessDetails(row?.business),
    tracking: parseTracking(row?.tracking),
    fonts: parseSiteFonts(row?.fonts),
    customCss: String(row?.custom_css ?? ""),
    theme: platformTheme(row?.theme, parseSiteFonts(row?.fonts)),
    langs: offeredLangs(row?.locales),
  };
}

/** The site's languages from `platform_settings.locales`: English always, first, and any other the site has. */
function offeredLangs(locales: unknown): PlatformLang[] {
  const listed = Array.isArray(locales) ? locales.map((l) => langOfLocale(String(l))).filter((l): l is PlatformLang => l !== null) : [];
  return ["en", ...PLATFORM_LANGS.filter((lang) => lang !== "en" && listed.includes(lang))];
}

/** The languages Kaizena Flow's own site is offered in (D312), English first. */
export async function getPlatformLangs(): Promise<PlatformLang[]> {
  return (await loadSettings()).langs;
}

/** Kaizen's theme as stored, completed from Minimal, with Kaizen's own fonts (D235). */
export function platformTheme(stored: unknown, fonts: SiteFonts): StoreTheme {
  const theme = parseStoreTheme(stored);
  return { ...theme, settings: { ...theme.settings, fonts } };
}

/** Kaizen's own theme (D235). */
export async function getPlatformTheme(): Promise<StoreTheme> {
  return (await loadSettings()).theme;
}

/** Kaizena Flow's own site CSS (D100), for the page checker (D390). */
export async function getPlatformSiteCss(): Promise<string> {
  return (await loadSettings()).customCss;
}

/** Kaizen's own icon (D62), or none for the default. */
export async function getPlatformFavicon(): Promise<Favicon | null> {
  return (await loadSettings()).navigation.favicon;
}

/** Kaizen's own heading and body fonts (D59). */
export async function getPlatformFonts(): Promise<SiteFonts> {
  return (await loadSettings()).fonts;
}

/** Kaizen's logo, menus and business details, and the pages its menus can link to. */
export async function getPlatformChrome(): Promise<PlatformChrome> {
  const [settings, pages, terms, articles, blogTerms] = await Promise.all([
    loadSettings(),
    listPublishedPages(),
    siteTerms(null, "page"),
    listPublishedPages(null, "article"),
    siteTerms(null, "article"),
  ]);
  // A page's title in each other language it is written in (D312 P4), for menus drawn in that language.
  const titles = (content: (typeof pages)[number]["content"]) =>
    Object.fromEntries(Object.entries(content.translations ?? {}).flatMap(([locale, texts]) => (typeof texts.title === "string" && texts.title ? [[locale, texts.title]] : [])));
  const byId = (list: typeof pages) => new Map(list.map((p) => [p.id, { id: p.id, slug: p.slug, title: p.content.title, titles: titles(p.content) }]));
  return {
    ...settings,
    pages: byId(pages),
    terms: termNames(terms),
    blog: { articles: byId(articles), categories: termNames(blogTerms).category },
  };
}

/** For the editor: the saved settings, read fresh. */
export async function getPlatformNavigationForEdit(): Promise<{
  navigation: PlatformNavigation;
  business: BusinessDetails;
  headerMenuId: string | null;
  footerMenuId: string | null;
}> {
  const [row] = await db().execute<Row>(sql`select navigation, business, header_menu_id, footer_menu_id from commerce.platform_settings`);
  return {
    navigation: parsePlatformNavigation(row?.navigation),
    business: parseBusinessDetails(row?.business),
    headerMenuId: row?.header_menu_id ? String(row.header_menu_id) : null,
    footerMenuId: row?.footer_menu_id ? String(row.footer_menu_id) : null,
  };
}

/** Saves Kaizen's logo, icon and business details, and the menus its standard header and footer show (D85). */
export async function savePlatformNavigation(account: Account, input: unknown): Promise<SaveResult> {
  const parsed = platformNavigationSchema.safeParse(input);
  const menus = standardMenusInput.safeParse(input);
  const business = businessDetailsSchema.safeParse((input as { business?: unknown } | null)?.business ?? {});
  if (!parsed.success || !business.success || !menus.success) {
    const issues = [...(parsed.error?.issues ?? []), ...(business.error?.issues ?? []), ...(menus.error?.issues ?? [])];
    return { ok: false, problems: [...new Set(issues.map((i) => i.message))] };
  }
  const { headerMenuId, footerMenuId } = menus.data;
  const own = await ownMenus(null, [headerMenuId, footerMenuId]);
  if ((headerMenuId && !own.has(headerMenuId)) || (footerMenuId && !own.has(footerMenuId))) {
    return { ok: false, problems: ["That menu no longer exists. Choose another."] };
  }
  const navigation: PlatformNavigation = { logo: parsed.data.logo, logoDark: parsed.data.logoDark, favicon: parsed.data.favicon };

  await db().execute(sql`
    update commerce.platform_settings set
      navigation = ${JSON.stringify(navigation)}::jsonb,
      business = ${JSON.stringify(business.data)}::jsonb,
      header_menu_id = ${headerMenuId}::uuid,
      footer_menu_id = ${footerMenuId}::uuid,
      updated_at = now(), updated_by = ${account.id}::uuid
  `);
  await audit(account.id, null, "platform.navigation_updated", {
    logo: navigation.logo !== null,
    logoDark: navigation.logoDark !== null,
    favicon: navigation.favicon !== null,
    headerMenuId,
    footerMenuId,
  });
  return { ok: true };
}
