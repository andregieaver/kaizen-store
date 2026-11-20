import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  pageBlocks,
  pageInput,
  pageFonts,
  pageSlugProblem,
  parsePageContent,
  reservedPageSlugs,
  samePageContent,
  type PageContent,
  type PageType,
  termContentOf
} from "@/lib/page-content";

import { currentGlobal, refreshUses, sameGlobal, type GlobalPart, type PartKind } from "@/lib/global-parts";
import { mergeLocales } from "@/lib/localization";
import { PLATFORM_PAGE_LOCALES } from "@/lib/platform-lang";
import { cleanTranslations, pageLanguages, type PageLanguage } from "@/lib/page-translation";
import { ROLE_COPY, type PageRole } from "@/lib/page-roles";
import { isLegalRole, LEGAL_ROLE_COPY, type LegalRole } from "@/lib/legal-roles";
import { issueCounts, pageIssues, blockingIssues, refusedIssues, themeSetsOf, unacknowledged, type PageIssue } from "@/lib/page-a11y";
import { reservedChoiceSlugs } from "@/lib/store-address";
import { parseStoreTheme } from "@/lib/theme";
import { textStylesCss } from "@/lib/text-styles";

import { audit, type Account } from "./auth";
import { col, typedRow, typedRows } from "./typed-rows";
import { auditChange } from "./audit";
import { findFont, installFonts } from "./fonts";
import { GlobalsRefused, globalsIn, lockSavedParts, spreadGlobals } from "./global-parts";
import { log } from "./log";
import { pageRulesProblem, payPageProblem } from "./page-rules";
import { houseStoreId } from "./house-customers";
import { keepVersion } from "./page-versions";
import { listTextStyles } from "./text-styles";
import { scopedTermIds } from "./taxonomy";
import { getStore, refreshStoreById, storeSlugOf } from "./stores";
import { ownMarkets } from "@/lib/page-markets";
import { listFacts, sameListFacts } from "@/lib/page-list-facts";
import { linksToRemoved } from "@/lib/demo-content";
import { withoutItems } from "@/lib/menu-structure";
import { normalisePath } from "@/lib/redirect-path";
import { refreshRedirects } from "./redirect-live";
import { redirectDeletedPage } from "./redirects";
import { owned } from "./owned";
import { documentsById, hasPageGridByDate, iso, ownedBy, type PageOwner } from "./page-reads";

/**
 * Pages built in the page builder (D42), Kaizen's own (`owner` null, served
 * at `/{slug}`) and each store's (D53, at `/s/{store}/{market}/{slug}`), in
 * one table. The editor saves a draft; publishing copies it to what
 * visitors see, so a published page can be worked on without changing it.
 * Articles (D57, at `/blog/{slug}`) are kept the same way, with a type of
 * their own: every function takes the owner and the type (a page unless
 * said), so a page is only ever found by its own, and never as an article.
 */

type Row = Record<string, unknown>;

export { PAGES_TAG, pageTag, pagesTag } from "@/lib/cache-tags";

export {
  articleCards,
  articleInBlog,
  findPublishedPage,
  listPublishedPages,
  namesQuery,
  PAGE_INDEX_FIELDS,
  pageCardColumns,
  pageCardRow,
  pageCards,
  pageForRole,
  pageInMarketSql,
  productsPageOf,
  publishedPageById,
  publishedPageIndex,
  publishedPageNames,
  type PageCard,
  type PageOwner,
  type PublishedPage,
  type PublishedPageEntry,
} from "./page-reads";

export type PageState = "draft" | "published" | "changed";

export type PageSummary = {
  id: string;
  title: string;
  /** The address in use: the live one once published. */
  slug: string;
  state: PageState;
  updatedAt: string;
  publishedAt: string | null;
  searchEngines: boolean;
  aiAssistants: boolean;
  thumbnail: string | null;
};

export type EditablePage = {
  id: string;
  /** The address in use: the live one once published. */
  slug: string;
  draft: PageContent;
  state: PageState;
  /** Whether it was ever published, so changing the address leaves a redirect. */
  published: boolean;
  publishedAt: string | null;
  updatedAt: string;
};

/**
 * `pages`: how many other pages a change to a global part (D98) reached, so the site's cached pages are refreshed. `scope`, on a publish
 * only (bloat review step 2.14): `page` when nothing other pages show changed (`publishScope()`), so refreshing the page's own tag is
 * enough; `site` when the store's pages tag must be refreshed too.
 */
export type PageResult =
  | { ok: true; id: string; pages?: number; scope?: "page" | "site" }
  /**
   * `code: "needs_confirmation"` (wave 1, 1e, docs/wave-1-trust.md 2.2): publishing was held because the checker found blocking issues the owner
   * has not acknowledged; nothing was saved or published, and `issues` lists them. Sending the same page again with `acknowledgedIssues` (the
   * issue ids or rule ids the owner saw) publishes it and records the choice.
   */
  | { ok: false; problems: string[]; code?: "needs_confirmation" | "pay_page_block"; issues?: PageIssue[] };


function stateOf(draft: PageContent, published: PageContent | null): PageState {
  if (!published) return "draft";
  return samePageContent(draft, published) ? "published" : "changed";
}

/** An unreadable stored draft is shown as an empty page with its address, not as an error. */
function readDraft(value: unknown, slug: string): PageContent {
  return (
    parsePageContent(value) ?? {
      title: slug,
      slug,
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows: [],
    }
  );
}

const summaryRow = z.object({
  id: col.uuid,
  slug: col.text,
  title: col.text,
  thumbnail: col.textOrNull,
  search_engines: col.bool,
  ai_assistants: col.bool,
  live: col.bool,
  same: col.bool,
  published_at: col.timestampOrNull,
  updated_at: col.timestamp,
});

/**
 * Every page (or article) of an owner's, newest change first, for the Pages list: its list fields read in SQL (bloat review step 2.17),
 * so no document is sent for a page that is a draft or the same as published. A page whose two copies differ as stored is decided by the
 * parsed compare as before (two copies can differ as stored and be equal once the schema fills its defaults): those rows alone are read
 * whole, in a second statement. A page of 100 with `limit` and `offset`; `since`, only pages changed after that moment (the Admin API).
 */
export async function listPages(
  owner: PageOwner,
  type: PageType = "page",
  { limit, offset, since }: { limit?: number; offset?: number; since?: string } = {},
): Promise<PageSummary[]> {
  const rows = await typedRows(
    summaryRow,
    sql`
      select p.id, p.slug, coalesce(nullif(p.draft ->> 'title', ''), p.slug) as title, p.draft -> 'thumbnail' ->> 'url' as thumbnail,
        coalesce((case when p.published is null then p.draft ->> 'searchEngines' else p.published ->> 'searchEngines' end)::boolean, true) as search_engines,
        coalesce((case when p.published is null then p.draft ->> 'aiAssistants' else p.published ->> 'aiAssistants' end)::boolean, true) as ai_assistants,
        p.published is not null as live, compared.same, p.published_at, p.updated_at
      from commerce.pages p
      -- Whether the two copies are equal as stored, compared in the database: the documents are not sent. (In a lateral select, so the
      -- ratchet's pattern for a statement that returns a whole document, which counts any bare draft or published, does not count it.)
      cross join lateral (select p.published is not null and p.draft = p.published as same) compared
      where ${owned(owner, sql`p.store_id`)} and p.type = ${type}
        and (${since ?? null}::timestamptz is null or date_trunc('milliseconds', p.updated_at) > ${since ?? null}::timestamptz)
      order by p.updated_at desc, p.id
      limit ${limit ?? 100000} offset ${offset ?? 0}
    `,
  );
  // The live pages whose copies differ as stored: changed, or equal once parsed.
  const differ = rows.filter((row) => row.live && !row.same).map((row) => row.id);
  const states = new Map<string, PageState>();
  if (differ.length > 0) {
    for (const row of await documentsById(owner, differ, true)) states.set(row.id, stateOf(readDraft(row.draft, row.slug), parsePageContent(row.published)));
  }
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    state: !row.live ? "draft" : row.same ? "published" : (states.get(row.id) ?? "changed"),
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    searchEngines: row.search_engines,
    aiAssistants: row.ai_assistants,
    thumbnail: row.thumbnail,
  }));
}


/** How many pages (or articles) an owner has, for the Pages list's pager. */
export async function countPages(owner: PageOwner, type: PageType = "page"): Promise<number> {
  const row = await typedRow(z.object({ count: col.int }), sql`select count(*)::int as count from commerce.pages where ${ownedBy(owner, type)}`);
  return row?.count ?? 0;
}

const titleRow = z.object({ id: col.uuid, slug: col.text, title: col.text, live: col.bool, published_at: col.timestampOrNull });

/**
 * Every page (or article) of an owner's by id, address and the draft's title, newest change first, for pickers that need every page of a
 * kind (the builder's documents beside each other, the Pages list's own-page choices and its sentence): no document, up to 1,000. `live`:
 * published.
 */
export async function pageTitles(
  owner: PageOwner,
  type: PageType = "page",
): Promise<{ id: string; slug: string; title: string; live: boolean; publishedAt: string | null }[]> {
  const rows = await typedRows(
    titleRow,
    sql`
      select id, slug, coalesce(nullif(draft ->> 'title', ''), slug) as title, published is not null as live, published_at
      from commerce.pages where ${ownedBy(owner, type)}
      order by updated_at desc, id
      limit 1000
    `,
  );
  return rows.map((row) => ({ id: row.id, slug: row.slug, title: row.title, live: row.live, publishedAt: row.published_at }));
}

export async function getPageForEdit(owner: PageOwner, id: string, type: PageType = "page"): Promise<EditablePage | null> {
  const [row] = await db().execute<Row>(sql`
    select id, slug, draft, published, published_at, updated_at from commerce.pages
    where id = ${id}::uuid and ${ownedBy(owner, type)}
  `);
  if (!row) return null;
  const draft = readDraft(row.draft, String(row.slug));
  const published = parsePageContent(row.published);
  return {
    id: String(row.id),
    slug: String(row.slug),
    draft,
    state: stateOf(draft, published),
    published: published !== null,
    publishedAt: iso(row.published_at),
    updatedAt: iso(row.updated_at)!,
  };
}

/** Whether another of the owner's pages uses the address (redirects give way). */
async function slugTaken(
  tx: Pick<ReturnType<typeof db>, "execute">,
  owner: PageOwner,
  type: PageType,
  slug: string,
  id: string | null,
): Promise<boolean> {
  const [row] = await tx.execute<Row>(sql`
    select 1 from commerce.pages
    where ${ownedBy(owner, type)} and slug = ${slug} and (${id}::uuid is null or id <> ${id}::uuid)
  `);
  return Boolean(row);
}

function isUniqueViolation(error: unknown): boolean {
  for (let e = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

const takenProblem = (slug: string, type: PageType) =>
  type === "article"
    ? `Another article already has the address blog/${slug}. Choose another.`
    : `Another page already has the address /${slug}. Choose another.`;

/**
 * The page addresses a store's languages and currencies take (D181): a store that sells in one country reads `/en/…` or `/eur/…` as a
 * choice of language or currency, never as a page, so a page may not be called `en` while the store keeps English.
 */
async function choiceSlugsOf(storeId: string): Promise<string[]> {
  const slug = await storeSlugOf(storeId);
  const store = slug ? await getStore(slug) : null;
  return reservedChoiceSlugs(store?.address);
}

/** What the platform's page editor says while Kaizena Flow's site is served from its own store (D484). */
export const SITE_IN_STORE =
  "Kaizena Flow's site is served from its own store now, so this page is not on the site. Edit it in the store: Kaizena Flow → Website → Pages.";

/**
 * Whether a page of the platform's own (`id`, null for a new one) is no longer what Kaizena Flow's site shows, the site being served from
 * its own store (D484): every page and article but the theme store's (`THEME_STORE_ROLES`), which `/themes` still draws.
 */
async function platformSiteServedElsewhere(id: string | null): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select p.site_from_store as on,
           ${id === null ? sql`false` : sql`exists (select 1 from commerce.platform_page_roles r where r.page_id = ${id}::uuid and r.role in ('themes', 'theme'))`} as theme_store
      from commerce.platform_settings p`);
  return Boolean(row?.on) && !row?.theme_store;
}

/**
 * Saves the editor's page as the draft, and with `publish` also as what
 * visitors see. A page not yet published takes its draft's address at
 * once; a published page keeps its live address until it is published
 * again, when the old address starts redirecting to the new one (a rule in
 * the database). Everything happens in one transaction.
 */
export async function savePage(
  account: Account,
  owner: PageOwner,
  id: string | null,
  input: unknown,
  {
    publish,
    type = "page",
    variantOf = null,
    acknowledgedIssues,
    fonts = installFonts,
  }: {
    publish: boolean;
    type?: PageType;
    /** For a version made for an A/B test (D148): the kind of page it is a version of, which decides what it may hold. */
    variantOf?: PageType | null;
    /** The checker's blocking issues the owner has seen and chosen to publish with: issue ids (`image_alt:{block}`) or rule ids (`image_alt`). */
    acknowledgedIssues?: readonly string[];
    /** How the page's fonts are installed: from Google Fonts (the default), or as a caller that set them up already needs (a test). */
    fonts?: (families: string[]) => Promise<{ ok: true } | { ok: false; problem: string }>;
  },
): Promise<PageResult> {
  // While Kaizena Flow's site is served from its own store (D484), its pages and articles are edited there: the platform's own are on the
  // site no longer and would be lost to a later copy. The theme store's pages, and the header and footer of the platform's own routes, stay.
  if (owner === null && (type === "page" || type === "article") && (await platformSiteServedElsewhere(id))) {
    return { ok: false, problems: [SITE_IN_STORE] };
  }
  // What a page is shaped like: its own type, or the one a version of it stands in for.
  const shape: PageType = type === "variant" ? (variantOf ?? "page") : type;
  const edits = globalEditsOf(input);
  const parsed = pageInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const reserved = reservedPageSlugs(owner, type);
  const choices = owner && type === "page" ? await choiceSlugsOf(owner) : [];
  const slugProblem =
    pageSlugProblem(parsed.data.slug, reserved) ??
    (type !== "page" && parsed.data.slug.includes("/") ? "Only pages can be nested under another page." : null) ??
    (choices.includes(parsed.data.slug.split("/")[0]) ? `The address ${parsed.data.slug} is a language or currency of the store's own addresses. Choose another.` : null);
  if (slugProblem) return { ok: false, problems: [slugProblem] };
  // Kaizena Flow's own store (D466) serves Kaizena Flow's site (D484): its pages may hold Kaizena Flow's own parts.
  const house = owner !== null && owner === (await houseStoreId());
  const ruleProblem = pageRulesProblem(owner, type, parsed.data, variantOf, house);
  if (ruleProblem) return { ok: false, problems: [ruleProblem] };
  // Blocks' own fonts (D59) come from Google Fonts and must be on Kaizen before the page shows them.
  const families = pageFonts(parsed.data);
  const unknown = families.filter((family) => !findFont(family));
  if (unknown.length > 0) return { ok: false, problems: unknown.map((family) => `${family} is not in Google Fonts.`) };
  const installed = await fonts(families);
  if (!installed.ok) return { ok: false, problems: [installed.problem] };
  // Only the owner's page (or article) categories and tags; one deleted meanwhile is left out.
  const scope = { storeId: owner, contentType: termContentOf(type) } as const;
  // Texts in the owner's other languages (D55); Kaizen's pages are in English only.
  const translated = cleanTranslations(parsed.data, (await ownerLanguages(owner)).slice(1));
  if (!translated.ok) return { ok: false, problems: translated.problems };
  const { author, blogId, authorId, ...rest } = translated.content;
  // An article's blog and author (D341): only the store's own; one that is not (another store's, or deleted meanwhile) is left out.
  const refs: { blogId?: string; authorId?: string } = type === "article" ? await ownBlogRefs(owner, blogId, authorId) : {};
  let content: PageContent = {
    ...rest,
    categories: await scopedTermIds(scope, "category", parsed.data.categories),
    tags: await scopedTermIds(scope, "tag", parsed.data.tags),
    // A header's place over the page (D80), with only the owner's page categories and tags.
    ...(shape === "header" && parsed.data.overlay
      ? {
          overlay: {
            ...parsed.data.overlay,
            categories: await scopedTermIds(scope, "category", parsed.data.overlay.categories),
            tags: await scopedTermIds(scope, "tag", parsed.data.overlay.tags),
          },
        }
      : { overlay: undefined }),
    // A footer's reveal (D184); only footers have it.
    footerReveal: shape === "footer" && parsed.data.footerReveal ? true : undefined,
    // Only articles have an author (D57), a blog and an author record (D341).
    ...(type === "article" && author ? { author } : {}),
    // The countries a store's page or article is for (D338): the store's own (kept ones too), none for Kaizena Flow's or any other kind.
    markets: owner !== null && (type === "page" || type === "article") ? ownMarkets(parsed.data.markets, await storeCountries(owner)) : undefined,
    ...(refs.blogId ? { blogId: refs.blogId } : {}),
    ...(refs.authorId ? { authorId: refs.authorId } : {}),
  };
  // Who sees a part (D179 phase 4): only the store's own groups, companies, products and categories stay in its conditions.
  const { keepOwnRuleIds } = await import("./visibility");
  content = { ...content, rows: await keepOwnRuleIds(owner, content.rows) };
  // The page checker (wave 1, 1e): what a shopper, a screen reader or the checkout's policy would meet. The checkout page may not hold
  // what the policy would break (refused on any save); publishing with another blocking issue asks first, on the server, so skipping
  // the dialog cannot skip the question. A draft is never held back.
  const checked = await checkBeforeSave(owner, id, content, publish, acknowledgedIssues);
  if (checked.result) return checked.result;
  const before = id === null ? null : await pageSummaryBefore(owner, id, type);

  let result: PageResult;
  let spreadTo = 0;
  try {
    result = await db().transaction(async (tx): Promise<PageResult> => {
      if (await slugTaken(tx, owner, type, content.slug, id)) return { ok: false, problems: [takenProblem(content.slug, type)] };

      // Global parts (D98): those changed on this page go to every page using them; the page's other uses follow them.
      const parts = await lockSavedParts(tx, owner);
      const known = globalsIn(parts);
      const changed: GlobalPart[] = [];
      for (const kind of ["block", "column", "row"] satisfies PartKind[]) {
        for (const globalId of edits) {
          const global = known.get(globalId);
          if (!global || global.kind !== kind) continue;
          const mine = currentGlobal(content, global);
          if (!sameGlobal(kind, mine, global)) changed.push(mine);
        }
      }
      const spread = await spreadGlobals(tx, {
        accountId: account.id,
        owner,
        parts,
        changed,
        skip: id === null ? undefined : { id, published: publish },
      });
      spreadTo = spread.pages;
      content = refreshUses(content, spread.globals, (globalId) => !spread.globals.has(globalId));
      const again = pageInput.safeParse(content);
      const problem = again.success
        ? pageRulesProblem(owner, type, again.data, variantOf, house)
        : [...new Set(again.error.issues.map((i) => i.message))].join(" ");
      if (problem) throw new GlobalsRefused([problem]);
      const json = JSON.stringify(content);

      if (id === null) {
        const [row] = await tx.execute<Row>(sql`
          insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at, created_by, updated_by)
          values (${owner}::uuid, ${type}, ${content.slug}, ${json}::jsonb,
            case when ${publish} then ${json}::jsonb end, case when ${publish} then now() end, case when ${publish} then now() end,
            ${account.id}::uuid, ${account.id}::uuid)
          returning id
        `);
        await keepVersion(tx, { owner, page: String(row.id), kind: publish ? "published" : "saved", content: json, account: account.id });
        return { ok: true, id: String(row.id) };
      }

      const [row] = await tx.execute<Row>(sql`
        select published_at is not null as live, slug as old_slug from commerce.pages
        where id = ${id}::uuid and ${ownedBy(owner, type)}
        for update
      `);
      if (!row) throw new GlobalsRefused(["This page no longer exists. It may have been deleted."]);
      // The address changes now unless the page is live and this is only a draft.
      const moveAddress = publish || !row.live;
      await tx.execute(sql`
        update commerce.pages set
          draft = ${json}::jsonb,
          slug = case when ${moveAddress} then ${content.slug} else slug end,
          published = case when ${publish} then ${json}::jsonb else published end,
          published_at = case when ${publish} then now() else published_at end,
          first_published_at = case when ${publish} then coalesce(first_published_at, now()) else first_published_at end,
          updated_at = now(), updated_by = ${account.id}::uuid
        where id = ${id}::uuid
      `);
      await keepVersion(tx, { owner, page: id, kind: publish ? "published" : "saved", content: json, account: account.id });
      // Pages nested under it follow it to its new address; each published one leaves a redirect from the old (a rule in the database).
      const from = String(row.old_slug);
      if (type === "page" && moveAddress && from !== content.slug) {
        await tx.execute(sql`
          update commerce.pages c set
            slug = ${content.slug}::text || substr(c.slug, length(${from}::text) + 1),
            draft = jsonb_set(c.draft, '{slug}', to_jsonb(${content.slug}::text || substr(c.slug, length(${from}::text) + 1))),
            published = case when c.published is null then null
              else jsonb_set(c.published, '{slug}', to_jsonb(${content.slug}::text || substr(c.slug, length(${from}::text) + 1))) end
          where ${ownedBy(owner, "page")} and left(c.slug, length(${from}::text) + 1) = ${from}::text || '/'
        `);
      }
      return { ok: true, id };
    });
  } catch (error) {
    if (error instanceof GlobalsRefused) {
      result = { ok: false, problems: error.problems };
    } else if (isUniqueViolation(error)) {
      // Another save took the address between the check and the write.
      result = { ok: false, problems: [takenProblem(content.slug, type)] };
    } else {
      throw error;
    }
  }
  if (result.ok && spreadTo > 0) result = { ...result, pages: spreadTo };
  if (result.ok && publish) {
    const scope = await publishScope(owner, { isNew: id === null, type, spreadTo, before: before?.livePublished ?? null, wasSaved: before !== null, content });
    result = { ...result, scope };
  }

  if (result.ok) {
    const state: PageState = publish ? "published" : before === null || before.state === "draft" ? "draft" : before.livePublished && samePageContent(content, before.livePublished) ? "published" : "changed";
    await auditChange(
      { accountId: account.id, storeId: owner },
      `${auditPrefix(owner)}.${type}_${publish ? "published" : "saved"}`,
      { type: type === "article" ? "article" : "page", id: result.id, label: content.title },
      before && { title: before.title, address: before.address, state: before.state, rowCount: before.rowCount, blockCount: before.blockCount },
      pageSummary(content, state),
      "page",
      { page: result.id, slug: content.slug, ...(spreadTo > 0 && { globalPages: spreadTo }) },
    );
    // Published with checks the owner chose to go past: written down, with how many of each rule and never the page's words.
    if (publish && checked.acknowledged.length > 0) {
      await audit(
        account.id,
        owner,
        `${auditPrefix(owner)}.${type}_published_with_issues`,
        { page: result.id, slug: content.slug, issues: issueCounts(checked.acknowledged) },
        { target: { type: "page", id: result.id } },
      );
    }
  }
  return result;
}

/**
 * How far a publish reaches (bloat review step 2.14): `site` for a new page, one that was not live, a change to a global part that reached
 * other pages, any type but a page or an article (a header, a footer, a layout, a variant: every page draws them), a change to what other
 * pages show of it (`listFacts()`), or a page while the site has a grid of pages ordered by when each was published (`hasPageGridByDate()`,
 * whose order the publish changes). Else `page`: only the page's own tag needs refreshing.
 */
async function publishScope(
  owner: PageOwner,
  { isNew, type, spreadTo, before, wasSaved, content }: { isNew: boolean; type: PageType; spreadTo: number; before: PageContent | null; wasSaved: boolean; content: PageContent },
): Promise<"page" | "site"> {
  if (isNew || !wasSaved || before === null || spreadTo > 0) return "site";
  if (type !== "page" && type !== "article") return "site";
  if (!sameListFacts(listFacts(before), listFacts(content))) return "site";
  if (type === "page" && (await hasPageGridByDate(owner))) return "site";
  return "page";
}

/** An article's blog and author ids (D341), each kept only when it is one of the store's own; Kaizena Flow's articles have neither. */
async function ownBlogRefs(owner: PageOwner, blogId: string | undefined, authorId: string | undefined): Promise<{ blogId?: string; authorId?: string }> {
  if (!owner || (!blogId && !authorId)) return {};
  const [row] = await db().execute<Row>(sql`
    select
      (select b.id from commerce.blogs b where b.store_id = ${owner}::uuid and b.id = ${blogId ?? null}::uuid and not b.main) as blog,
      (select a.id from commerce.blog_authors a where a.store_id = ${owner}::uuid and a.id = ${authorId ?? null}::uuid) as author
  `);
  // The first blog is the one an article belongs to without naming any, so it is never written down.
  return { blogId: row?.blog ? String(row.blog) : undefined, authorId: row?.author ? String(row.author) : undefined };
}

type PageAuditFacts = { title: string; address: string; state: PageState; rowCount: number; blockCount: number };
const pageSummary = (content: PageContent, state: PageState): PageAuditFacts => ({
  title: content.title,
  address: content.slug,
  state,
  rowCount: content.rows.length,
  blockCount: pageBlocks(content).length,
});

/** The page as it stood before a save, for the audit entry's before and after. */
async function pageSummaryBefore(owner: PageOwner, id: string, type: PageType): Promise<(PageAuditFacts & { livePublished: PageContent | null }) | null> {
  const [row] = await db().execute<Row>(sql`
    select slug, draft, published from commerce.pages where id = ${id}::uuid and ${ownedBy(owner, type)}
  `);
  if (!row) return null;
  const draft = readDraft(row.draft, String(row.slug));
  const published = parsePageContent(row.published);
  return { ...pageSummary(draft, stateOf(draft, published)), livePublished: published };
}

/**
 * The checker's gate on a save. Returns the result to answer with when the save must stop (the checkout page holding what the policy
 * would break, or publishing with unacknowledged blocking issues), and otherwise the blocking issues the owner acknowledged. A checker
 * that throws on odd content is logged and publishing goes on as without it.
 */
async function checkBeforeSave(
  owner: PageOwner,
  id: string | null,
  content: PageContent,
  publish: boolean,
  acknowledgedIssues: readonly string[] | undefined,
): Promise<{ result: PageResult | null; acknowledged: PageIssue[] }> {
  try {
    let theme: ReturnType<typeof themeSetsOf> | undefined;
    let checkout = false;
    let siteCss = "";
    if (owner !== null) {
      const [row] = await db().execute<Row>(sql`
        select s.theme, s.custom_css,
          exists (select 1 from commerce.page_roles r where r.store_id = s.id and r.role = 'checkout' and r.page_id = ${id}::uuid) as checkout
        from commerce.stores s where s.id = ${owner}::uuid
      `);
      if (row) {
        theme = themeSetsOf(parseStoreTheme(row.theme).settings);
        checkout = Boolean(row.checkout);
        siteCss = String(row.custom_css ?? "");
      }
    } else {
      // Kaizena Flow's own pages: its theme (D235) and site CSS, read as a store's are (D390).
      const [row] = await db().execute<Row>(sql`select theme, custom_css from commerce.platform_settings limit 1`);
      if (row) {
        theme = themeSetsOf(parseStoreTheme(row.theme).settings);
        siteCss = String(row.custom_css ?? "");
      }
    }
    // The site's text styles (D393) colour the words that wear them, as its own CSS does.
    const styles = textStylesCss(await listTextStyles(owner));
    const issues = pageIssues(content, { ...(theme && { theme: { sets: theme } }), checkout, siteCss: `${styles}\n${siteCss}` });
    if (checkout && refusedIssues(issues).length > 0) {
      return { result: { ok: false, problems: [payPageProblem(content) ?? "The checkout page cannot hold this."], code: "pay_page_block", issues: refusedIssues(issues) }, acknowledged: [] };
    }
    if (!publish) return { result: null, acknowledged: [] };
    const open = unacknowledged(issues, acknowledgedIssues);
    if (open.length > 0) {
      return {
        result: {
          ok: false,
          code: "needs_confirmation",
          problems: [`This page has ${open.length === 1 ? "a problem" : `${open.length} problems`} to look at before it is published. Fix ${open.length === 1 ? "it" : "them"}, or publish anyway.`],
          issues: blockingIssues(issues),
        },
        acknowledged: [],
      };
    }
    return { result: null, acknowledged: blockingIssues(issues) };
  } catch (error) {
    log("error", "pages.checker_failed", {}, error);
    return { result: null, acknowledged: [] };
  }
}

/**
 * The global parts (D98) the editor says it changed on the page, sent with
 * it as `globalEdits`: only these are taken from the page; its other uses
 * are brought up to date from the globals as they are.
 */
function globalEditsOf(input: unknown): string[] {
  const edits = typeof input === "object" && input !== null ? (input as { globalEdits?: unknown }).globalEdits : undefined;
  if (!Array.isArray(edits)) return [];
  return [...new Set(edits.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 200);
}

/** Takes a page off the site; its draft stays, and so do its redirects. */
export async function unpublishPage(account: Account, owner: PageOwner, id: string, type: PageType = "page"): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.pages set published = null, published_at = null, updated_at = now(), updated_by = ${account.id}::uuid
    where id = ${id}::uuid and ${ownedBy(owner, type)} and published_at is not null
    returning slug
  `);
  if (rows.length > 0) await audit(account.id, owner, `${auditPrefix(owner)}.${type}_unpublished`, { page: id, slug: rows[0].slug }, { target: { type: type === "article" ? "article" : "page", id } });
  return rows.length > 0;
}

/** Deletes a page for good, with its redirects. Menu links to it disappear from the site. */
/**
 * Deletes a page or an article, and what pointed at it with it (PSI DATA-06), in one transaction: the menus lose their links to it (the
 * links under one moving up in its place, `withoutItems()`), and a store's published page leaves a redirect from its address, and from
 * each address it had before (`page_redirects`, which go with it), to the store's front page, or an article to the blog, so a link from
 * outside or a search result never ends on a 404. A redirect from the address already there is kept; the owner can point one elsewhere in
 * Website → Redirects. Kaizena Flow's own pages have no redirects (`commerce.redirects` is a store's); their menus lose the links the same
 * way, and the caller refreshes Kaizena Flow's navigation.
 */
export async function deletePage(account: Account, owner: PageOwner, id: string, type: PageType = "page"): Promise<boolean> {
  const out = await db().transaction(async (tx) => {
    const formerly = await tx.execute<Row>(sql`select slug from commerce.page_redirects where page_id = ${id}::uuid`);
    const rows = await tx.execute<Row>(sql`
      delete from commerce.pages where id = ${id}::uuid and ${ownedBy(owner, type)}
      returning slug, draft ->> 'title' as title, published_at is not null as live
    `);
    const [row] = rows;
    if (!row) return null;
    const slug = String(row.slug);
    const gone = { products: [], categories: [], tags: [], blogCategories: [], pages: type === "page" ? [slug] : [], articles: type === "article" ? [slug] : [] };
    const menus = await tx.execute<Row>(sql`select id, items from commerce.menus where ${owned(owner)} for update`);
    for (const menu of menus) {
      const items = Array.isArray(menu.items) ? (menu.items as { depth: number; link?: unknown }[]) : [];
      const left = withoutItems(
        items.map((item) => ({ ...item, depth: Number.isInteger(item.depth) ? item.depth : 0 })),
        // A store's menus link a page by its address; Kaizena Flow's by its id.
        (item) => linksToRemoved(item.link, gone) || (item.link as { pageId?: unknown } | undefined)?.pageId === id,
      );
      if (left.length !== items.length) {
        await tx.execute(sql`
          update commerce.menus set items = ${JSON.stringify(left)}::jsonb, updated_at = now(), updated_by = ${account.id}::uuid where id = ${String(menu.id)}::uuid
        `);
      }
    }
    const redirected: string[] = [];
    if (owner !== null && row.live === true && (type === "page" || type === "article")) {
      const at = (one: string) => (type === "article" ? `/blog/${one}` : `/${one}`);
      const target = type === "article" ? "/blog" : "/";
      const sources = [slug, ...formerly.map((f) => String(f.slug))].map((one) => normalisePath(at(one)));
      const usable = [...new Set(sources.filter((one): one is string => one !== null && one !== "/" && one !== target))];
      redirected.push(...(await redirectDeletedPage(tx, owner, account.id, usable, target)));
    }
    return { slug, title: row.title, redirected };
  });
  if (!out) return false;
  await audit(account.id, owner, `${auditPrefix(owner)}.${type}_deleted`, { page: id, slug: out.slug, title: out.title, label: out.title, redirected: out.redirected.length }, { target: { type: type === "article" ? "article" : "page", id } });
  if (owner !== null) {
    if (out.redirected.length > 0) refreshRedirects(owner);
    await refreshStoreById(owner);
  }
  return true;
}

/**
 * The languages an owner's pages are written in (D55, D109): a store's own
 * choice, main first, else its markets' languages; Kaizena Flow's, English and then its other languages (D312 P4).
 */
export async function ownerLanguages(owner: PageOwner): Promise<PageLanguage[]> {
  // Kaizena Flow's own (D312 P4): English, then the site's other languages, whose texts lie over it.
  if (owner === null) return pageLanguages(PLATFORM_PAGE_LOCALES);
  const [rows, [chosen]] = await Promise.all([
    db().execute<Row>(sql`
      select m.default_locale from commerce.markets m join commerce.stores s on s.id = m.store_id
      where m.store_id = ${owner}::uuid and m.active
      order by (m.code = s.country) desc nulls last, m.created_at, m.code
    `),
    db().execute<Row>(sql`select locales from commerce.stores where id = ${owner}::uuid`),
  ]);
  // The store's languages (D109): the owner's own choice, then its countries' own that it lacks.
  return pageLanguages(mergeLocales(((chosen?.locales ?? []) as string[]).map(String), rows.map((row) => String(row.default_locale))));
}

/** A store's countries, every one it has had (a page may be kept for one switched off for now), as market codes. */
async function storeCountries(storeId: string): Promise<string[]> {
  const rows = await db().execute<Row>(sql`select code from commerce.markets where store_id = ${storeId}::uuid`);
  return rows.map((row) => String(row.code));
}

/** Audit actions keep their names for Kaizen's pages (`platform.page_…`); a store's are `store.page_…`. */
const auditPrefix = (owner: PageOwner) => (owner === null ? "platform" : "store");


/**
 * Shows one of a store's published pages as its front page in every market
 * (D54), or the product list again with null. The database keeps it to the
 * store's own pages, and back to the list if the page is deleted.
 */
export async function setFrontPage(
  account: Account,
  storeId: string,
  pageId: string | null,
): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  if (pageId !== null) {
    const [page] = await db().execute<Row>(sql`
      select published_at is not null as published,
        id = (select products_page_id from commerce.stores where id = ${storeId}::uuid) as products,
        (select role from commerce.page_roles r where r.store_id = ${storeId}::uuid and r.page_id = pages.id) as role
      from commerce.pages
      where id = ${pageId}::uuid and store_id = ${storeId}::uuid and type = 'page'
    `);
    if (!page) return { ok: false, problems: ["That page no longer exists."] };
    if (!page.published) return { ok: false, problems: ["Publish the page before making it the front page."] };
    if (page.products) return { ok: false, problems: ["That page is your All products page. Choose another page for the front page."] };
    if (page.role) return { ok: false, problems: [`That page is your ${ROLE_COPY[page.role as PageRole]?.name.toLowerCase() ?? "special page"}. Choose another page for the front page.`] };
  }
  await db().execute(sql`update commerce.stores set front_page_id = ${pageId}::uuid where id = ${storeId}::uuid`);
  await audit(account.id, storeId, "store.front_page_changed", { page: pageId });
  await refreshStoreById(storeId);
  return { ok: true };
}

/**
 * Shows one of a store's published pages as its All products page at
 * /products in every market (D83), or the standard list again with null.
 * The database keeps it to the store's own pages, and back to the list if
 * the page is deleted.
 */
export async function setProductsPage(
  account: Account,
  storeId: string,
  pageId: string | null,
): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  if (pageId !== null) {
    const [page] = await db().execute<Row>(sql`
      select published_at is not null as published, id = (select front_page_id from commerce.stores where id = ${storeId}::uuid) as front,
        (select role from commerce.page_roles r where r.store_id = ${storeId}::uuid and r.page_id = pages.id) as role
      from commerce.pages
      where id = ${pageId}::uuid and store_id = ${storeId}::uuid and type = 'page'
    `);
    if (!page) return { ok: false, problems: ["That page no longer exists."] };
    if (!page.published) return { ok: false, problems: ["Publish the page before making it the All products page."] };
    if (page.front) return { ok: false, problems: ["That page is your front page. Choose another page for All products."] };
    if (page.role) return { ok: false, problems: [`That page is your ${ROLE_COPY[page.role as PageRole]?.name.toLowerCase() ?? "special page"}. Choose another page for All products.`] };
  }
  await db().execute(sql`update commerce.stores set products_page_id = ${pageId}::uuid where id = ${storeId}::uuid`);
  await audit(account.id, storeId, "store.products_page_changed", { page: pageId });
  await refreshStoreById(storeId);
  return { ok: true };
}


/**
 * Chooses one of a store's published pages for a role (D112): its blog, its
 * search page or its 404 page; or the standard page again with null. A page
 * has one place: not the front page, the All products page or another role's.
 *
 * Also the linked legal roles (wave 1, 1e, `LEGAL_ROLES`): the terms, the
 * privacy statement and the like, which keep their page at its own address.
 * The same refusals, and a page in a running or scheduled A/B test cannot be
 * given one (a legal page is never tested). The checkout page may not hold
 * what the payment policy would break, so a page that does is refused there.
 */
export async function setPageRole(
  account: Account,
  storeId: string,
  role: PageRole | LegalRole,
  pageId: string | null,
): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const legal = isLegalRole(role);
  const action = legal ? "store.legal_role_changed" : "store.page_role_changed";
  if (pageId === null) {
    await db().execute(sql`delete from commerce.page_roles where store_id = ${storeId}::uuid and role = ${role}`);
    await audit(account.id, storeId, action, { role, page: null });
    return { ok: true };
  }
  const [page] = await db().execute<Row>(sql`
    select published_at is not null as published, published, draft ->> 'title' as title,
      id = (select front_page_id from commerce.stores where id = ${storeId}::uuid) as front,
      id = (select products_page_id from commerce.stores where id = ${storeId}::uuid) as products,
      (select role from commerce.page_roles r where r.store_id = ${storeId}::uuid and r.page_id = pages.id) as other_role,
      exists (select 1 from commerce.experiments e where e.store_id = ${storeId}::uuid and e.target_page_id = pages.id and e.status in ('scheduled', 'running')) as in_test
    from commerce.pages
    where id = ${pageId}::uuid and store_id = ${storeId}::uuid and type = 'page'
  `);
  const name = (legal ? LEGAL_ROLE_COPY[role].name : ROLE_COPY[role].name).toLowerCase();
  const otherName = (other: string) => (isLegalRole(other) ? LEGAL_ROLE_COPY[other].name : ROLE_COPY[other as PageRole]?.name)?.toLowerCase() ?? "other special page";
  if (!page) return { ok: false, problems: ["That page no longer exists."] };
  if (!page.published) return { ok: false, problems: [`Publish the page before making it your ${name}.`] };
  if (page.front) return { ok: false, problems: [`That page is your front page. Choose another page for your ${name}.`] };
  if (page.products) return { ok: false, problems: [`That page is your All products page. Choose another page for your ${name}.`] };
  if (page.other_role && page.other_role !== role) {
    return { ok: false, problems: [`That page is your ${otherName(String(page.other_role))}. Choose another page for your ${name}.`] };
  }
  if (legal && page.in_test) return { ok: false, problems: [`That page is in an A/B test, and a legal page is never tested. Stop the test first, or choose another page for your ${name}.`] };
  if (role === "checkout") {
    const content = parsePageContent(page.published);
    const problem = content ? payPageProblem(content) : null;
    if (problem) return { ok: false, problems: [problem] };
  }
  await db().execute(sql`
    insert into commerce.page_roles (store_id, role, page_id) values (${storeId}::uuid, ${role}, ${pageId}::uuid)
    on conflict (store_id, role) do update set page_id = excluded.page_id, updated_at = now()
  `);
  await audit(account.id, storeId, action, { role, page: pageId, label: legal ? LEGAL_ROLE_COPY[role].name : undefined }, legal ? { target: { type: "page", id: pageId } } : {});
  return { ok: true };
}


/** An owner's pages (or articles) for the menu editor to link to: published or not, by title. */
export async function listMenuPages(
  owner: PageOwner,
  type: PageType = "page",
): Promise<{ id: string; slug: string; title: string; published: boolean }[]> {
  const rows = await db().execute<Row>(sql`
    select id, slug, coalesce(nullif(published ->> 'title', ''), draft ->> 'title', slug) as title, published_at is not null as published
    from commerce.pages where ${ownedBy(owner, type)}
    order by 3
  `);
  return rows.map((row) => ({
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    published: Boolean(row.published),
  }));
}
