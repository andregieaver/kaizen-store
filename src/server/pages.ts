import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
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
import { cleanTranslations, pageLanguages, type PageLanguage } from "@/lib/page-translation";
import { ROLE_COPY, type PageRole } from "@/lib/page-roles";
import { isLegalRole, LEGAL_ROLE_COPY, type LegalRole } from "@/lib/legal-roles";
import { issueCounts, pageIssues, blockingIssues, refusedIssues, themeSetsOf, unacknowledged, type PageIssue } from "@/lib/page-a11y";
import { reservedChoiceSlugs } from "@/lib/store-address";
import { parseStoreTheme } from "@/lib/theme";

import { audit, type Account } from "./auth";
import { auditChange } from "./audit";
import { findFont, installFonts } from "./fonts";
import { GlobalsRefused, globalsIn, lockSavedParts, spreadGlobals } from "./global-parts";
import { withPageAlts } from "./media-alts";
import { pageRulesProblem, payPageProblem } from "./page-rules";
import { scopedTermIds } from "./taxonomy";
import { getStore } from "./stores";
import { keepOwnRuleIds } from "./visibility";

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

/** Whose pages: a store's id, or null for Kaizen's own. */
export type PageOwner = string | null;

/** Revalidate after one of Kaizen's pages is published, unpublished or deleted. */
export const PAGES_TAG = "platform-pages";
/** The same for an owner: Kaizen's, or a store's. */
export const pagesTag = (owner: PageOwner) => (owner === null ? PAGES_TAG : `pages:${owner}`);

const ownedBy = (owner: PageOwner, type: PageType) => sql`store_id is not distinct from ${owner}::uuid and type = ${type}`;

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

/** `pages`: how many other pages a change to a global part (D98) reached, so the site's cached pages are refreshed. */
export type PageResult =
  | { ok: true; id: string; pages?: number }
  /**
   * `code: "needs_confirmation"` (wave 1, 1e, docs/wave-1-trust.md 2.2): publishing was held because the checker found blocking issues the owner
   * has not acknowledged; nothing was saved or published, and `issues` lists them. Sending the same page again with `acknowledgedIssues` (the
   * issue ids or rule ids the owner saw) publishes it and records the choice.
   */
  | { ok: false; problems: string[]; code?: "needs_confirmation" | "pay_page_block"; issues?: PageIssue[] };

const iso = (value: unknown) => (value == null ? null : new Date(String(value)).toISOString());

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

/** Every page (or article) of an owner's, newest change first, for the Pages list. */
export async function listPages(owner: PageOwner, type: PageType = "page"): Promise<PageSummary[]> {
  const rows = await db().execute<Row>(sql`
    select id, slug, draft, published, published_at, updated_at from commerce.pages
    where ${ownedBy(owner, type)}
    order by updated_at desc
  `);
  return rows.map((row) => {
    const draft = readDraft(row.draft, String(row.slug));
    const published = parsePageContent(row.published);
    return {
      id: String(row.id),
      title: draft.title,
      slug: String(row.slug),
      state: stateOf(draft, published),
      updatedAt: iso(row.updated_at)!,
      publishedAt: iso(row.published_at),
      searchEngines: (published ?? draft).searchEngines,
      aiAssistants: (published ?? draft).aiAssistants,
      thumbnail: draft.thumbnail?.url ?? null,
    };
  });
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
  const [row] = await readDb().execute<{ slug: string }>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  const store = row ? await getStore(String(row.slug)) : null;
  return reservedChoiceSlugs(store?.address);
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
  }: {
    publish: boolean;
    type?: PageType;
    /** For a version made for an A/B test (D148): the kind of page it is a version of, which decides what it may hold. */
    variantOf?: PageType | null;
    /** The checker's blocking issues the owner has seen and chosen to publish with: issue ids (`image_alt:{block}`) or rule ids (`image_alt`). */
    acknowledgedIssues?: readonly string[];
  },
): Promise<PageResult> {
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
  const ruleProblem = pageRulesProblem(owner, type, parsed.data, variantOf);
  if (ruleProblem) return { ok: false, problems: [ruleProblem] };
  // Blocks' own fonts (D59) come from Google Fonts and must be on Kaizen before the page shows them.
  const families = pageFonts(parsed.data);
  const unknown = families.filter((family) => !findFont(family));
  if (unknown.length > 0) return { ok: false, problems: unknown.map((family) => `${family} is not in Google Fonts.`) };
  const installed = await installFonts(families);
  if (!installed.ok) return { ok: false, problems: [installed.problem] };
  // Only the owner's page (or article) categories and tags; one deleted meanwhile is left out.
  const scope = { storeId: owner, contentType: termContentOf(type) } as const;
  // Texts in the owner's other languages (D55); Kaizen's pages are in English only.
  const translated = cleanTranslations(parsed.data, (await ownerLanguages(owner)).slice(1));
  if (!translated.ok) return { ok: false, problems: translated.problems };
  const { author, ...rest } = translated.content;
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
    // Only articles have an author (D57).
    ...(type === "article" && author ? { author } : {}),
  };
  // Who sees a part (D179 phase 4): only the store's own groups, companies, products and categories stay in its conditions.
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
        ? pageRulesProblem(owner, type, again.data, variantOf)
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
    if (owner !== null) {
      const [row] = await db().execute<Row>(sql`
        select s.theme,
          exists (select 1 from commerce.page_roles r where r.store_id = s.id and r.role = 'checkout' and r.page_id = ${id}::uuid) as checkout
        from commerce.stores s where s.id = ${owner}::uuid
      `);
      if (row) {
        theme = themeSetsOf(parseStoreTheme(row.theme).settings);
        checkout = Boolean(row.checkout);
      }
    }
    const issues = pageIssues(content, { ...(theme && { theme: { sets: theme } }), checkout });
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
    console.error("[pages] the page checker failed; publishing goes on without it", error);
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
export async function deletePage(account: Account, owner: PageOwner, id: string, type: PageType = "page"): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.pages where id = ${id}::uuid and ${ownedBy(owner, type)} returning slug, draft ->> 'title' as title
  `);
  if (rows.length > 0) {
    await audit(account.id, owner, `${auditPrefix(owner)}.${type}_deleted`, { page: id, slug: rows[0].slug, title: rows[0].title, label: rows[0].title }, { target: { type: type === "article" ? "article" : "page", id } });
  }
  return rows.length > 0;
}

/**
 * The languages an owner's pages are written in (D55, D109): a store's own
 * choice, main first, else its markets' languages; Kaizen's, English.
 */
export async function ownerLanguages(owner: PageOwner): Promise<PageLanguage[]> {
  if (owner === null) return pageLanguages(["en"]);
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

/** Audit actions keep their names for Kaizen's pages (`platform.page_…`); a store's are `store.page_…`. */
const auditPrefix = (owner: PageOwner) => (owner === null ? "platform" : "store");

// ---------------------------------------------------------------------------
// The site
// ---------------------------------------------------------------------------

export type PublishedPage = {
  id: string;
  slug: string;
  content: PageContent;
  /** When it was last published (its last change on the site). */
  publishedAt: string;
  /** When it was first published: an article's date (D57). */
  firstPublishedAt: string;
};

const published = (row: Row, content: PageContent): PublishedPage => ({
  id: String(row.id),
  slug: String(row.slug),
  content,
  publishedAt: iso(row.published_at)!,
  firstPublishedAt: iso(row.first_published_at ?? row.published_at)!,
});

/**
 * Every published page of an owner's, oldest first, for its routes, menus,
 * sitemap and llms.txt; or its articles (D57), newest first.
 */
export async function listPublishedPages(owner: PageOwner = null, type: PageType = "page"): Promise<PublishedPage[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(owner));
  const rows = await readDb().execute<Row>(sql`
    select id, slug, published, published_at, first_published_at from commerce.pages
    where ${ownedBy(owner, type)} and published_at is not null
    order by ${type === "article" ? sql`coalesce(first_published_at, published_at) desc, slug` : sql`created_at`}
  `);
  // Pictures without alt texts of their own are described by the media library's (D89).
  return withPageAlts(
    rows.flatMap((row) => {
      const content = parsePageContent(row.published);
      return content ? [published(row, content)] : [];
    }),
  );
}

/** The published page at an address, or where a page that was there went, or null. */
export async function findPublishedPage(
  owner: PageOwner,
  slug: string,
  type: PageType = "page",
): Promise<{ page: PublishedPage } | { redirect: string } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(owner));
  const [row] = await readDb().execute<Row>(sql`
    select p.id, p.slug, p.published, p.published_at, p.first_published_at, p.slug <> ${slug} as moved
    from commerce.pages p
    where p.store_id is not distinct from ${owner}::uuid and p.type = ${type} and p.published_at is not null
      and (p.slug = ${slug} or p.id = (
        select r.page_id from commerce.page_redirects r
        where r.store_id is not distinct from ${owner}::uuid and r.type = ${type} and r.slug = ${slug}
      ))
    order by moved
    limit 1
  `);
  if (!row) return null;
  if (row.moved) return { redirect: String(row.slug) };
  const content = parsePageContent(row.published);
  if (!content) return null;
  const [page] = await withPageAlts([published(row, content)]);
  return { page };
}

/**
 * An owner's published pages by address, for menu links (D54): where each
 * is now and its title, also under the addresses it had before, so a link
 * follows a page that moved. Entries rather than a Map, to be cached.
 */
export async function publishedPageNames(
  owner: PageOwner,
  locale: string | null = null,
  type: PageType = "page",
): Promise<[string, { slug: string; title: string }][]> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(owner));
  // The title in the shopper's language where the page is translated (D55).
  const title = sql`coalesce(nullif(p.published #>> array['translations', ${locale ?? ""}, 'title'], ''), p.published ->> 'title')`;
  const rows = await readDb().execute<Row>(sql`
    select p.slug as address, p.slug, ${title} as title
    from commerce.pages p
    where p.store_id is not distinct from ${owner}::uuid and p.type = ${type} and p.published_at is not null
    union all
    select r.slug, p.slug, ${title}
    from commerce.page_redirects r
    join commerce.pages p on p.id = r.page_id and p.published_at is not null
    where r.store_id is not distinct from ${owner}::uuid and r.type = ${type}
  `);
  return rows.map((row) => [String(row.address), { slug: String(row.slug), title: String(row.title ?? row.slug) }]);
}

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
  return { ok: true };
}

/** A store's All products page (D83) while it is published, else null (the standard list). */
export async function productsPageOf(store: { id: string; productsPageId: string | null }): Promise<PublishedPage | null> {
  if (!store.productsPageId) return null;
  return (await listPublishedPages(store.id)).find((page) => page.id === store.productsPageId) ?? null;
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

/** The store's page for a role (D112) while it is published, else null (the standard page shows). */
export async function pageForRole(store: { id: string; pageRoles: Partial<Record<PageRole, string>> }, role: PageRole): Promise<PublishedPage | null> {
  const id = store.pageRoles[role];
  if (!id) return null;
  return (await listPublishedPages(store.id)).find((page) => page.id === id) ?? null;
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
