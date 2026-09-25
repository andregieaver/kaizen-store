import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import {
  businessDetailsSchema,
  cleanLabels,
  parseBusinessDetails,
  parsePlatformNavigation,
  platformNavigationSchema,
  type BusinessDetails,
  type MenuPage,
  type PlatformNavigation,
  termNames,
  type TermNames,
} from "@/lib/navigation";

import { audit, type Account } from "./auth";
import { listPublishedPages } from "./pages";
import { siteTerms } from "./taxonomy";
import type { SaveResult } from "./settings";

type Row = Record<string, unknown>;

/** Revalidate after Kaizen's logo, menus or business details change. */
export const PLATFORM_NAVIGATION_TAG = "platform-navigation";

/** Everything Kaizen's header and footer show (D42). */
export type PlatformChrome = {
  navigation: PlatformNavigation;
  business: BusinessDetails;
  /** Published pages by id, so menu links follow a page to a new address. */
  pages: Map<string, MenuPage>;
  /** Page category and tag names by address, for links to their listings (D50). */
  terms: TermNames;
};

async function loadSettings(): Promise<{ navigation: PlatformNavigation; business: BusinessDetails }> {
  "use cache";
  cacheLife("hours");
  cacheTag(PLATFORM_NAVIGATION_TAG);
  const [row] = await readDb().execute<Row>(sql`select navigation, business from commerce.platform_settings`);
  return { navigation: parsePlatformNavigation(row?.navigation), business: parseBusinessDetails(row?.business) };
}

/** Kaizen's logo, menus and business details, and the pages its menus can link to. */
export async function getPlatformChrome(): Promise<PlatformChrome> {
  const [settings, pages, terms] = await Promise.all([loadSettings(), listPublishedPages(), siteTerms(null, "page")]);
  return {
    ...settings,
    pages: new Map(pages.map((page) => [page.id, { id: page.id, slug: page.slug, title: page.content.title }])),
    terms: termNames(terms),
  };
}

/** For the editor: the saved settings, read fresh. */
export async function getPlatformNavigationForEdit(): Promise<{ navigation: PlatformNavigation; business: BusinessDetails }> {
  const [row] = await db().execute<Row>(sql`select navigation, business from commerce.platform_settings`);
  return { navigation: parsePlatformNavigation(row?.navigation), business: parseBusinessDetails(row?.business) };
}

/**
 * Saves Kaizen's logo, menus and business details. Links to pages must
 * name a page that exists (a draft shows once published); a web address
 * needs a text.
 */
export async function savePlatformNavigation(account: Account, input: unknown): Promise<SaveResult> {
  const parsed = platformNavigationSchema.safeParse(input);
  const business = businessDetailsSchema.safeParse((input as { business?: unknown } | null)?.business ?? {});
  if (!parsed.success || !business.success) {
    const issues = [...(parsed.error?.issues ?? []), ...(business.error?.issues ?? [])];
    return { ok: false, problems: [...new Set(issues.map((i) => i.message))] };
  }
  const items = [...parsed.data.header, ...parsed.data.footer];
  const ids = [...new Set(items.flatMap((i) => (i.link.kind === "page" ? [i.link.pageId] : [])))];
  const existing = new Set<string>();
  if (ids.length > 0) {
    const rows = await db().execute<Row>(sql`
      select id from commerce.pages
      where store_id is null and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
    `);
    for (const row of rows) existing.add(String(row.id));
  }

  const problems: string[] = [];
  const clean = (item: PlatformNavigation["header"][number]) => {
    const label = cleanLabels(item.label, ["en"]);
    if (item.link.kind === "page" && !existing.has(item.link.pageId)) {
      problems.push("A menu links to a page that no longer exists. Choose another.");
    }
    if (item.link.kind === "url" && !label.en) problems.push("Give each web address link a text.");
    return { label, link: item.link };
  };
  const navigation: PlatformNavigation = {
    logo: parsed.data.logo,
    header: parsed.data.header.map(clean),
    footer: parsed.data.footer.map(clean),
  };
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  await db().execute(sql`
    update commerce.platform_settings set
      navigation = ${JSON.stringify(navigation)}::jsonb,
      business = ${JSON.stringify(business.data)}::jsonb,
      updated_at = now(), updated_by = ${account.id}::uuid
  `);
  await audit(account.id, null, "platform.navigation_updated", {
    logo: navigation.logo !== null,
    header: navigation.header.length,
    footer: navigation.footer.length,
  });
  return { ok: true };
}
