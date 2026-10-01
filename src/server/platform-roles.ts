import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import { PLATFORM_ROLE_COPY, platformStarterPage, isPlatformRole, type PlatformRole } from "@/lib/platform-roles";

import { audit, type Account } from "./auth";
import { listPublishedPages, pagesTag, savePage, type PublishedPage } from "./pages";

type Row = Record<string, unknown>;
type Result = { ok: true } | { ok: false; problems: string[] };

/**
 * Which of Kaizen's published pages has a place of its own on its site (D143): its front page, its blog and its
 * 404 page, as a store's do (D54, D112). Cached under the pages' tag, which choosing and publishing refresh.
 * Entries rather than a record, to be cached.
 */
export async function getPlatformPageRoles(): Promise<[PlatformRole, string][]> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(null));
  const rows = await readDb().execute<Row>(sql`select role, page_id from commerce.platform_page_roles`);
  return rows.flatMap((row) => (isPlatformRole(row.role) ? [[row.role, String(row.page_id)] as [PlatformRole, string]] : []));
}

/** Kaizen's page for a place while it is published, else null (the standard page shows). */
export async function platformPageForRole(role: PlatformRole): Promise<PublishedPage | null> {
  const chosen = (await getPlatformPageRoles()).find(([r]) => r === role)?.[1];
  if (!chosen) return null;
  return (await listPublishedPages(null)).find((page) => page.id === chosen) ?? null;
}

/** The place a published page of Kaizen's holds, if any: its own address then leads to the place's. */
export async function platformRoleOf(pageId: string): Promise<PlatformRole | null> {
  return (await getPlatformPageRoles()).find(([, id]) => id === pageId)?.[0] ?? null;
}

/**
 * Chooses one of Kaizen's published pages for a place (D143): its front page, blog or 404 page; or the standard
 * page again with null. A page has one place. The caller refreshes the pages' tag.
 */
export async function setPlatformPageRole(account: Account, role: PlatformRole, pageId: string | null): Promise<Result> {
  if (pageId === null) {
    await db().execute(sql`delete from commerce.platform_page_roles where role = ${role}`);
    await audit(account.id, null, "platform.page_role_changed", { role, page: null });
    return { ok: true };
  }
  const name = PLATFORM_ROLE_COPY[role].name.toLowerCase();
  const [page] = await db().execute<Row>(sql`
    select published_at is not null as published,
      (select role from commerce.platform_page_roles r where r.page_id = pages.id) as other_role
    from commerce.pages
    where id = ${pageId}::uuid and store_id is null and type = 'page'
  `);
  if (!page) return { ok: false, problems: ["That page no longer exists."] };
  if (!page.published) return { ok: false, problems: [`Publish the page before making it Kaizen's ${name}.`] };
  if (page.other_role && page.other_role !== role) {
    const other = isPlatformRole(page.other_role) ? PLATFORM_ROLE_COPY[page.other_role].name.toLowerCase() : "other special page";
    return { ok: false, problems: [`That page is Kaizen's ${other}. Choose another page for the ${name}.`] };
  }
  await db().execute(sql`
    insert into commerce.platform_page_roles (role, page_id, updated_by) values (${role}, ${pageId}::uuid, ${account.id}::uuid)
    on conflict (role) do update set page_id = excluded.page_id, updated_at = now(), updated_by = excluded.updated_by
  `);
  await audit(account.id, null, "platform.page_role_changed", { role, page: pageId });
  return { ok: true };
}

/**
 * Makes a page for one of Kaizen's places from a starter that looks like the standard page it replaces, publishes
 * it and puts it in place; the owner then changes it in the builder.
 */
export async function createPlatformRolePage(account: Account, role: PlatformRole): Promise<{ ok: true; id: string } | { ok: false; problems: string[] }> {
  const content = platformStarterPage(role, () => crypto.randomUUID());
  let made: Awaited<ReturnType<typeof savePage>> | null = null;
  // The address is the role's own unless another page has taken it.
  for (let n = 1; n <= 5; n++) {
    made = await savePage(account, null, null, { ...content, slug: n === 1 ? content.slug : `${content.slug}-${n}` }, { publish: true, type: "page" });
    if (made.ok || !made.problems.some((p) => /address|slug/i.test(p))) break;
  }
  if (!made || !made.ok) return { ok: false, problems: made ? made.problems : ["The page could not be made."] };
  const placed = await setPlatformPageRole(account, role, made.id);
  return placed.ok ? { ok: true, id: made.id } : placed;
}
