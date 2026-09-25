import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import {
  pageInput,
  pageSlugProblem,
  parsePageContent,
  reservedPageSlugs,
  samePageContent,
  type PageContent,
} from "@/lib/page-content";

import { cleanTranslations, pageLanguages, type PageLanguage } from "@/lib/page-translation";

import { audit, type Account } from "./auth";
import { scopedTermIds } from "./taxonomy";

/**
 * Pages built in the page builder (D42), Kaizen's own (`owner` null, served
 * at `/{slug}`) and each store's (D53, at `/s/{store}/{market}/{slug}`), in
 * one table. The editor saves a draft; publishing copies it to what
 * visitors see, so a published page can be worked on without changing it.
 * Every function takes the owner, so a page is only ever found by its own.
 */

type Row = Record<string, unknown>;

/** Whose pages: a store's id, or null for Kaizen's own. */
export type PageOwner = string | null;

/** Revalidate after one of Kaizen's pages is published, unpublished or deleted. */
export const PAGES_TAG = "platform-pages";
/** The same for an owner: Kaizen's, or a store's. */
export const pagesTag = (owner: PageOwner) => (owner === null ? PAGES_TAG : `pages:${owner}`);

const ownedBy = (owner: PageOwner) => sql`store_id is not distinct from ${owner}::uuid`;

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

export type PageResult = { ok: true; id: string } | { ok: false; problems: string[] };

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

/** Every page of an owner's, newest change first, for the Pages list. */
export async function listPages(owner: PageOwner): Promise<PageSummary[]> {
  const rows = await db().execute<Row>(sql`
    select id, slug, draft, published, published_at, updated_at from commerce.pages
    where ${ownedBy(owner)}
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

export async function getPageForEdit(owner: PageOwner, id: string): Promise<EditablePage | null> {
  const [row] = await db().execute<Row>(sql`
    select id, slug, draft, published, published_at, updated_at from commerce.pages
    where id = ${id}::uuid and ${ownedBy(owner)}
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
  slug: string,
  id: string | null,
): Promise<boolean> {
  const [row] = await tx.execute<Row>(sql`
    select 1 from commerce.pages
    where ${ownedBy(owner)} and slug = ${slug} and (${id}::uuid is null or id <> ${id}::uuid)
  `);
  return Boolean(row);
}

function isUniqueViolation(error: unknown): boolean {
  for (let e = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

const takenProblem = (slug: string) => `Another page already has the address /${slug}. Choose another.`;

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
  { publish }: { publish: boolean },
): Promise<PageResult> {
  const parsed = pageInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const slugProblem = pageSlugProblem(parsed.data.slug, reservedPageSlugs(owner));
  if (slugProblem) return { ok: false, problems: [slugProblem] };
  const gridProblem = ownerGridProblem(owner, parsed.data.rows);
  if (gridProblem) return { ok: false, problems: [gridProblem] };
  // Only the owner's page categories and tags; one deleted meanwhile is left out.
  const scope = { storeId: owner, contentType: "page" } as const;
  // Texts in the owner's other languages (D55); Kaizen's pages are in English only.
  const translated = cleanTranslations(parsed.data, (await ownerLanguages(owner)).slice(1));
  if (!translated.ok) return { ok: false, problems: translated.problems };
  const content = {
    ...translated.content,
    categories: await scopedTermIds(scope, "category", parsed.data.categories),
    tags: await scopedTermIds(scope, "tag", parsed.data.tags),
  };
  const json = JSON.stringify(content);

  let result: PageResult;
  try {
    result = await db().transaction(async (tx): Promise<PageResult> => {
      if (await slugTaken(tx, owner, content.slug, id)) return { ok: false, problems: [takenProblem(content.slug)] };

      if (id === null) {
        const [row] = await tx.execute<Row>(sql`
          insert into commerce.pages (store_id, slug, draft, published, published_at, created_by, updated_by)
          values (${owner}::uuid, ${content.slug}, ${json}::jsonb,
            case when ${publish} then ${json}::jsonb end, case when ${publish} then now() end,
            ${account.id}::uuid, ${account.id}::uuid)
          returning id
        `);
        return { ok: true, id: String(row.id) };
      }

      const [row] = await tx.execute<Row>(sql`
        select published_at is not null as live from commerce.pages
        where id = ${id}::uuid and ${ownedBy(owner)}
        for update
      `);
      if (!row) return { ok: false, problems: ["This page no longer exists. It may have been deleted."] };
      // The address changes now unless the page is live and this is only a draft.
      const moveAddress = publish || !row.live;
      await tx.execute(sql`
        update commerce.pages set
          draft = ${json}::jsonb,
          slug = case when ${moveAddress} then ${content.slug} else slug end,
          published = case when ${publish} then ${json}::jsonb else published end,
          published_at = case when ${publish} then now() else published_at end,
          updated_at = now(), updated_by = ${account.id}::uuid
        where id = ${id}::uuid
      `);
      return { ok: true, id };
    });
  } catch (error) {
    // Another save took the address between the check and the write.
    if (!isUniqueViolation(error)) throw error;
    result = { ok: false, problems: [takenProblem(content.slug)] };
  }

  if (result.ok) {
    await audit(account.id, owner, publish ? `${auditPrefix(owner)}.page_published` : `${auditPrefix(owner)}.page_saved`, {
      page: result.id,
      slug: content.slug,
    });
  }
  return result;
}

/** Takes a page off the site; its draft stays, and so do its redirects. */
export async function unpublishPage(account: Account, owner: PageOwner, id: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.pages set published = null, published_at = null, updated_at = now(), updated_by = ${account.id}::uuid
    where id = ${id}::uuid and ${ownedBy(owner)} and published_at is not null
    returning slug
  `);
  if (rows.length > 0) await audit(account.id, owner, `${auditPrefix(owner)}.page_unpublished`, { page: id, slug: rows[0].slug });
  return rows.length > 0;
}

/** Deletes a page for good, with its redirects. Menu links to it disappear from the site. */
export async function deletePage(account: Account, owner: PageOwner, id: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.pages where id = ${id}::uuid and ${ownedBy(owner)} returning slug, draft ->> 'title' as title
  `);
  if (rows.length > 0) {
    await audit(account.id, owner, `${auditPrefix(owner)}.page_deleted`, { page: id, slug: rows[0].slug, title: rows[0].title });
  }
  return rows.length > 0;
}

/**
 * The languages an owner's pages are written in (D55): a store's markets'
 * languages, its own country's first (the main one); Kaizen's, English.
 */
export async function ownerLanguages(owner: PageOwner): Promise<PageLanguage[]> {
  if (owner === null) return pageLanguages(["en"]);
  const rows = await db().execute<Row>(sql`
    select m.default_locale from commerce.markets m join commerce.stores s on s.id = m.store_id
    where m.store_id = ${owner}::uuid and m.active
    order by (m.code = s.country) desc nulls last, m.created_at, m.code
  `);
  return pageLanguages(rows.map((row) => String(row.default_locale)));
}

/** Audit actions keep their names for Kaizen's pages (`platform.page_…`); a store's are `store.page_…`. */
const auditPrefix = (owner: PageOwner) => (owner === null ? "platform" : "store");

/**
 * A store's grids of products always show its own (D53), in the shopper's
 * market; Kaizen's name the store and market.
 */
function ownerGridProblem(owner: PageOwner, rows: PageContent["rows"]): string | null {
  for (const block of rows.flatMap((r) => r.columns.flatMap((c) => c.blocks))) {
    if (block.type !== "contentGrid" || block.source.type !== "products") continue;
    if (owner === null && (!block.source.storeId || !block.source.market)) {
      return "Choose the store and market for each content grid of products.";
    }
    if (owner !== null && block.source.storeId && block.source.storeId !== owner) {
      return "A content grid on a store's page shows that store's own products.";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The site
// ---------------------------------------------------------------------------

export type PublishedPage = { id: string; slug: string; content: PageContent; publishedAt: string };

/** Every published page of an owner's, oldest first: for its routes, menus, sitemap and llms.txt. */
export async function listPublishedPages(owner: PageOwner = null): Promise<PublishedPage[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(owner));
  const rows = await readDb().execute<Row>(sql`
    select id, slug, published, published_at from commerce.pages
    where ${ownedBy(owner)} and published_at is not null
    order by created_at
  `);
  return rows.flatMap((row) => {
    const content = parsePageContent(row.published);
    return content
      ? [{ id: String(row.id), slug: String(row.slug), content, publishedAt: iso(row.published_at)! }]
      : [];
  });
}

/** The published page at an address, or where a page that was there went, or null. */
export async function findPublishedPage(
  owner: PageOwner,
  slug: string,
): Promise<{ page: PublishedPage } | { redirect: string } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(owner));
  const [row] = await readDb().execute<Row>(sql`
    select p.id, p.slug, p.published, p.published_at, p.slug <> ${slug} as moved
    from commerce.pages p
    where p.store_id is not distinct from ${owner}::uuid and p.published_at is not null
      and (p.slug = ${slug} or p.id = (
        select r.page_id from commerce.page_redirects r
        where r.store_id is not distinct from ${owner}::uuid and r.slug = ${slug}
      ))
    order by moved
    limit 1
  `);
  if (!row) return null;
  if (row.moved) return { redirect: String(row.slug) };
  const content = parsePageContent(row.published);
  return content
    ? { page: { id: String(row.id), slug: String(row.slug), content, publishedAt: iso(row.published_at)! } }
    : null;
}

/**
 * An owner's published pages by address, for menu links (D54): where each
 * is now and its title, also under the addresses it had before, so a link
 * follows a page that moved. Entries rather than a Map, to be cached.
 */
export async function publishedPageNames(
  owner: PageOwner,
  locale: string | null = null,
): Promise<[string, { slug: string; title: string }][]> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(owner));
  // The title in the shopper's language where the page is translated (D55).
  const title = sql`coalesce(nullif(p.published #>> array['translations', ${locale ?? ""}, 'title'], ''), p.published ->> 'title')`;
  const rows = await readDb().execute<Row>(sql`
    select p.slug as address, p.slug, ${title} as title
    from commerce.pages p
    where p.store_id is not distinct from ${owner}::uuid and p.published_at is not null
    union all
    select r.slug, p.slug, ${title}
    from commerce.page_redirects r
    join commerce.pages p on p.id = r.page_id and p.published_at is not null
    where r.store_id is not distinct from ${owner}::uuid
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
      select published_at is not null as published from commerce.pages
      where id = ${pageId}::uuid and store_id = ${storeId}::uuid
    `);
    if (!page) return { ok: false, problems: ["That page no longer exists."] };
    if (!page.published) return { ok: false, problems: ["Publish the page before making it the front page."] };
  }
  await db().execute(sql`update commerce.stores set front_page_id = ${pageId}::uuid where id = ${storeId}::uuid`);
  await audit(account.id, storeId, "store.front_page_changed", { page: pageId });
  return { ok: true };
}

/** An owner's pages for the menu editor to link to: published or not, by title. */
export async function listMenuPages(
  owner: PageOwner,
): Promise<{ id: string; slug: string; title: string; published: boolean }[]> {
  const rows = await db().execute<Row>(sql`
    select id, slug, coalesce(nullif(published ->> 'title', ''), draft ->> 'title', slug) as title, published_at is not null as published
    from commerce.pages where ${ownedBy(owner)}
    order by 3
  `);
  return rows.map((row) => ({
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    published: Boolean(row.published),
  }));
}
