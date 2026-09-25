import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import { pageInput, parsePageContent, samePageContent, type PageContent } from "@/lib/page-content";

import { audit, type Account } from "./auth";

/**
 * Kaizen's own pages (D42), built from blocks in the platform admin and
 * served at `/{slug}`. The editor saves a draft; publishing copies it to
 * what visitors see, so a published page can be worked on without
 * changing it. Stores' pages will share the table (`store_id`).
 */

type Row = Record<string, unknown>;

/** Revalidate after a page is published, unpublished or deleted. */
export const PAGES_TAG = "platform-pages";

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
      blocks: [],
    }
  );
}

/** Every page of Kaizen's, newest change first, for the Pages list. */
export async function listPages(): Promise<PageSummary[]> {
  const rows = await db().execute<Row>(sql`
    select id, slug, draft, published, published_at, updated_at from commerce.pages
    where store_id is null
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

export async function getPageForEdit(id: string): Promise<EditablePage | null> {
  const [row] = await db().execute<Row>(sql`
    select id, slug, draft, published, published_at, updated_at from commerce.pages
    where id = ${id}::uuid and store_id is null
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

/** Whether another of Kaizen's pages uses the address (redirects give way). */
async function slugTaken(tx: Pick<ReturnType<typeof db>, "execute">, slug: string, id: string | null): Promise<boolean> {
  const [row] = await tx.execute<Row>(sql`
    select 1 from commerce.pages
    where store_id is null and slug = ${slug} and (${id}::uuid is null or id <> ${id}::uuid)
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
  id: string | null,
  input: unknown,
  { publish }: { publish: boolean },
): Promise<PageResult> {
  const parsed = pageInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const content = parsed.data;
  const json = JSON.stringify(content);

  let result: PageResult;
  try {
    result = await db().transaction(async (tx): Promise<PageResult> => {
      if (await slugTaken(tx, content.slug, id)) return { ok: false, problems: [takenProblem(content.slug)] };

      if (id === null) {
        const [row] = await tx.execute<Row>(sql`
          insert into commerce.pages (slug, draft, published, published_at, created_by, updated_by)
          values (${content.slug}, ${json}::jsonb,
            case when ${publish} then ${json}::jsonb end, case when ${publish} then now() end,
            ${account.id}::uuid, ${account.id}::uuid)
          returning id
        `);
        return { ok: true, id: String(row.id) };
      }

      const [row] = await tx.execute<Row>(sql`
        select published_at is not null as live from commerce.pages
        where id = ${id}::uuid and store_id is null
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
    await audit(account.id, null, publish ? "platform.page_published" : "platform.page_saved", {
      page: result.id,
      slug: content.slug,
    });
  }
  return result;
}

/** Takes a page off the site; its draft stays, and so do its redirects. */
export async function unpublishPage(account: Account, id: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.pages set published = null, published_at = null, updated_at = now(), updated_by = ${account.id}::uuid
    where id = ${id}::uuid and store_id is null and published_at is not null
    returning slug
  `);
  if (rows.length > 0) await audit(account.id, null, "platform.page_unpublished", { page: id, slug: rows[0].slug });
  return rows.length > 0;
}

/** Deletes a page for good, with its redirects. Menu links to it disappear from the site. */
export async function deletePage(account: Account, id: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.pages where id = ${id}::uuid and store_id is null returning slug, draft ->> 'title' as title
  `);
  if (rows.length > 0) {
    await audit(account.id, null, "platform.page_deleted", { page: id, slug: rows[0].slug, title: rows[0].title });
  }
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// The site
// ---------------------------------------------------------------------------

export type PublishedPage = { id: string; slug: string; content: PageContent; publishedAt: string };

/** Every published page of Kaizen's, oldest first: for its routes, menus, sitemap and llms.txt. */
export async function listPublishedPages(): Promise<PublishedPage[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(PAGES_TAG);
  const rows = await readDb().execute<Row>(sql`
    select id, slug, published, published_at from commerce.pages
    where store_id is null and published_at is not null
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
  slug: string,
): Promise<{ page: PublishedPage } | { redirect: string } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(PAGES_TAG);
  const [row] = await readDb().execute<Row>(sql`
    select p.id, p.slug, p.published, p.published_at, p.slug <> ${slug} as moved
    from commerce.pages p
    where p.store_id is null and p.published_at is not null
      and (p.slug = ${slug} or p.id = (
        select r.page_id from commerce.page_redirects r where r.store_id is null and r.slug = ${slug}
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

/** Kaizen's pages for the menu editor to link to: published or not, by title. */
export async function listMenuPages(): Promise<{ id: string; title: string; published: boolean }[]> {
  const rows = await db().execute<Row>(sql`
    select id, coalesce(nullif(published ->> 'title', ''), draft ->> 'title', slug) as title, published_at is not null as published
    from commerce.pages where store_id is null
    order by 2
  `);
  return rows.map((row) => ({ id: String(row.id), title: String(row.title), published: Boolean(row.published) }));
}
