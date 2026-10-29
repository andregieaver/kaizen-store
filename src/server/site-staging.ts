import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { menuInput } from "@/lib/navigation";
import { pageInput, parsePageContent, type PageContent, type PageType } from "@/lib/page-content";
import { pageTypeKey } from "@/lib/permissions";
import { parseStoreTheme } from "@/lib/theme";
import { compareLooks, compareVersions, type LookArea, type PageDifference } from "@/lib/version-compare";

import { audit, type Membership } from "./auth";
import { log } from "./log";
import { listStoreMenus, saveStoreMenu } from "./menus";
import { savePage } from "./pages";
import { pageRulesProblem } from "./page-rules";
import { memberCan } from "./permissions";
import { installLook, listInstalls, liveLook, switchToInstall } from "./theme-installs";

type Row = Record<string, unknown>;

/**
 * A staging set of a store's site (wave 9 unit E, D358, `docs/wave-9-platform.md` section 3, E as built): page drafts chosen to go live
 * together, a theme installed but not live, and changes to menus kept here, compared with what visitors see and made live in one press
 * (`publishStaging()`) through the builder's own Publish (`savePage()`), `switchToInstall()` and the menu saver (`saveStoreMenu()`), each a
 * new version as any of those makes. Products, orders and customers are never part of it. The only writer of `commerce.site_stagings` and
 * `site_staging_pages`.
 *
 * Since D385 (wave 11 unit F) a page staged is a COPY: `stagePage()` copies its draft into the set (`content`) with what visitors saw then
 * (`base`), the builder's staging mode edits only the copy (`saveStagedPage()`, the page's own draft untouched), and *Make live* refuses, before
 * anything is written, while a page's live version changed since it was copied (`liveChanges()`), showing what changed, until the person
 * keeps the copy anyway (`keepStagedCopy()`). A row staged before D385 holds no copy and publishes the page's draft as before.
 */

/** The kinds of page a staging set may hold: those of the site (an A/B test's versions and content types' entry pages are not). */
export const STAGED_TYPES: readonly PageType[] = ["page", "article", "header", "footer", "product_layout"];

export type StagedMenu = { name: string; items: unknown[] };

export type Staging = {
  id: string;
  name: string;
  installId: string | null;
  menus: Record<string, StagedMenu>;
  pageIds: string[];
  createdAt: string;
};

export type StagingPage = {
  id: string;
  type: PageType;
  title: string;
  /** Never published: going live makes it public for the first time. */
  isNew: boolean;
  /** What the set would change on the live page: the copy's differences for a page staged with one, else the draft's. */
  differences: PageDifference[];
  staged: boolean;
  /** Staged as a copy (D385): the builder edits the set's copy, never the page's own draft. */
  copy: boolean;
  /** Whether the live page changed since the copy was made, and how; *Make live* is refused until the copy is kept anyway. */
  liveChanged: { changed: boolean; differences: PageDifference[] };
};

export type StagingOverview = {
  staging: Staging | null;
  /** Pages whose draft differs from what visitors see, with what differs. */
  pages: StagingPage[];
  /** Themes installed but not live, with the areas their look differs in from the live one. */
  themes: { id: string; title: string; areas: LookArea[] }[];
  /** Menus of the store, with the staged change's counts where one is kept. */
  menus: { id: string; name: string; staged: { name: string; before: number; after: number; renamed: boolean } | null }[];
};

export type StagingResult = { ok: true } | { ok: false; problem: string };

const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** The store's open staging set, or null. */
export async function openStagingOf(storeId: string): Promise<Staging | null> {
  const [row] = await db().execute<Row>(sql`
    select id, name, install_id, menus, created_at,
      coalesce((select array_agg(p.page_id::text) from commerce.site_staging_pages p where p.staging_id = s.id), '{}') as page_ids
    from commerce.site_stagings s where store_id = ${storeId}::uuid and status = 'open'
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    installId: row.install_id ? String(row.install_id) : null,
    menus: (row.menus && typeof row.menus === "object" ? row.menus : {}) as Record<string, StagedMenu>,
    pageIds: (row.page_ids as string[]).map(String),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

/** Starts the store's staging set; refused while one is open. */
export async function startStaging(member: Membership, name: string): Promise<StagingResult> {
  const clean = name.trim().slice(0, 80);
  if (!clean) return { ok: false, problem: "name" };
  const made = await db().execute<Row>(sql`
    insert into commerce.site_stagings (store_id, name, created_by) values (${member.store.id}::uuid, ${clean}, ${member.account.id}::uuid)
    on conflict do nothing returning id
  `);
  if (made.length === 0) return { ok: false, problem: "open" };
  await audit(member.account.id, member.store.id, "store.staging_started", {}, { area: "website", target: { type: "site_staging", id: String(made[0].id) } });
  return { ok: true };
}

/**
 * Puts a page in the open set or takes it out: only the store's own pages of the site's kinds. Putting it in copies its draft into the set
 * with what visitors see now (D385), so the set's changes are its own and later edits of the page's draft are not in it.
 */
export async function stagePage(member: Membership, pageId: string, staged: boolean): Promise<StagingResult> {
  const staging = await openStagingOf(member.store.id);
  if (!staging) return { ok: false, problem: "none" };
  if (!isUuid(pageId)) return { ok: false, problem: "page" };
  if (!staged) {
    await db().execute(sql`delete from commerce.site_staging_pages where staging_id = ${staging.id}::uuid and page_id = ${pageId}::uuid`);
    return { ok: true };
  }
  const [page] = await db().execute<Row>(sql`
    select type from commerce.pages where id = ${pageId}::uuid and store_id = ${member.store.id}::uuid
      and type in (${sql.join(STAGED_TYPES.map((t) => sql`${t}`), sql`, `)})
  `);
  if (!page) return { ok: false, problem: "page" };
  await db().execute(sql`
    insert into commerce.site_staging_pages (staging_id, store_id, page_id, content, base, copied_at)
    select ${staging.id}::uuid, ${member.store.id}::uuid, p.id, p.draft, p.published, now()
    from commerce.pages p where p.id = ${pageId}::uuid and p.store_id = ${member.store.id}::uuid
    on conflict do nothing
  `);
  return { ok: true };
}

/** The open set's copy of a page (D385), as the builder's staging mode edits it; null when the page is not staged as a copy. */
export async function stagedCopy(storeId: string, pageId: string): Promise<{ content: PageContent; type: PageType } | null> {
  if (!isUuid(pageId)) return null;
  const [row] = await db().execute<Row>(sql`
    select sp.content, p.type from commerce.site_staging_pages sp
    join commerce.site_stagings s on s.id = sp.staging_id and s.status = 'open'
    join commerce.pages p on p.id = sp.page_id and p.store_id = sp.store_id
    where sp.store_id = ${storeId}::uuid and sp.page_id = ${pageId}::uuid and sp.content is not null
  `);
  const content = row ? parsePageContent(row.content) : null;
  return content ? { content, type: row.type as PageType } : null;
}

/**
 * Saves what the builder's staging mode holds into the set's copy (D385): checked as the builder's save checks a page's content
 * (`pageInput`, `pageRulesProblem()`), the address, fonts and translations again by `savePage()` when it goes live. The page's own draft and
 * what visitors see do not change. The caller asks that the person may write the page's kind.
 */
export async function saveStagedPage(member: Membership, pageId: string, input: unknown): Promise<{ ok: true; content: PageContent } | { ok: false; problems: string[] }> {
  const copy = await stagedCopy(member.store.id, pageId);
  if (!copy) return { ok: false, problems: ["none"] };
  const parsed = pageInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const rule = pageRulesProblem(member.store.id, copy.type, parsed.data);
  if (rule) return { ok: false, problems: [rule] };
  const done = await db().execute<Row>(sql`
    update commerce.site_staging_pages sp set content = ${JSON.stringify(parsed.data)}::jsonb
    from commerce.site_stagings s
    where s.id = sp.staging_id and s.status = 'open' and sp.store_id = ${member.store.id}::uuid and sp.page_id = ${pageId}::uuid
      and sp.content is not null
    returning sp.page_id
  `);
  if (done.length === 0) return { ok: false, problems: ["none"] };
  return { ok: true, content: parsed.data };
}

/** Keeps the set's copy of a page after its live version changed (D385): what visitors see now becomes the copy's base, the copy unchanged. */
export async function keepStagedCopy(member: Membership, pageId: string): Promise<StagingResult> {
  if (!isUuid(pageId)) return { ok: false, problem: "page" };
  const done = await db().execute<Row>(sql`
    update commerce.site_staging_pages sp set base = p.published, copied_at = now()
    from commerce.site_stagings s, commerce.pages p
    where s.id = sp.staging_id and s.status = 'open' and p.id = sp.page_id and p.store_id = sp.store_id
      and sp.store_id = ${member.store.id}::uuid and sp.page_id = ${pageId}::uuid and sp.content is not null
    returning sp.page_id
  `);
  return done.length > 0 ? { ok: true } : { ok: false, problem: "page" };
}

/**
 * What changed on the live page since its copy was made: changed when the page's published content is not the copy's base any more (published
 * for the first time, taken off or edited), with the differences where both are pages.
 */
function liveChanges(base: unknown, published: unknown): { changed: boolean; differences: PageDifference[] } {
  const before = parsePageContent(base);
  const now = parsePageContent(published);
  if (JSON.stringify(before) === JSON.stringify(now)) return { changed: false, differences: [] };
  return { changed: true, differences: before && now ? compareVersions(before, now) : [] };
}

/** Chooses the theme the set makes live (one installed and not live), or none. */
export async function stageTheme(member: Membership, installId: string | null): Promise<StagingResult> {
  const staging = await openStagingOf(member.store.id);
  if (!staging) return { ok: false, problem: "none" };
  if (installId !== null) {
    const install = (await listInstalls(member.store.id)).find((i) => i.id === installId);
    if (!install || install.live) return { ok: false, problem: "theme" };
  }
  await db().execute(sql`update commerce.site_stagings set install_id = ${installId}::uuid where id = ${staging.id}::uuid`);
  return { ok: true };
}

/** Keeps a change to one of the store's menus in the set (checked for its shape now and by the menu saver when it goes live), or drops it. */
export async function stageMenu(member: Membership, menuId: string, input: unknown | null): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const staging = await openStagingOf(member.store.id);
  if (!staging) return { ok: false, problems: ["none"] };
  const menus = await listStoreMenus(member.store.id);
  if (!menus.some((m) => m.id === menuId)) return { ok: false, problems: ["menu"] };
  if (input === null) {
    await db().execute(sql`update commerce.site_stagings set menus = menus - ${menuId} where id = ${staging.id}::uuid`);
    return { ok: true };
  }
  const parsed = menuInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  await db().execute(sql`
    update commerce.site_stagings set menus = menus || jsonb_build_object(${menuId}::text, ${JSON.stringify(parsed.data)}::jsonb)
    where id = ${staging.id}::uuid
  `);
  return { ok: true };
}

/** Ends the open set without making anything live; drafts, the theme and menus stay as they are. */
export async function discardStaging(member: Membership): Promise<StagingResult> {
  const done = await db().execute<Row>(sql`
    update commerce.site_stagings set status = 'discarded' where store_id = ${member.store.id}::uuid and status = 'open' returning id
  `);
  if (done.length === 0) return { ok: false, problem: "none" };
  await audit(member.account.id, member.store.id, "store.staging_discarded", {}, { area: "website", target: { type: "site_staging", id: String(done[0].id) } });
  return { ok: true };
}

/** What the staging page shows: the open set, the pages with changes not yet live, the themes waiting and the menus. */
export async function stagingOverview(storeId: string): Promise<StagingOverview> {
  const staging = await openStagingOf(storeId);
  const pages: StagingPage[] = [];
  // The set's own copies first (D385): what each would change on the live page, and whether the live page moved since it was copied.
  const copies = staging
    ? await db().execute<Row>(sql`
        select p.id, p.type, sp.content, sp.base, p.published from commerce.site_staging_pages sp
        join commerce.pages p on p.id = sp.page_id and p.store_id = sp.store_id
        where sp.staging_id = ${staging.id}::uuid and sp.content is not null
        order by p.type, p.updated_at desc
      `)
    : [];
  const copied = new Set<string>();
  for (const row of copies) {
    const content = parsePageContent(row.content);
    if (!content) continue;
    const published = parsePageContent(row.published);
    copied.add(String(row.id));
    pages.push({
      id: String(row.id),
      type: row.type as PageType,
      title: content.title,
      isNew: !published,
      differences: published ? compareVersions(published, content) : [],
      staged: true,
      copy: true,
      liveChanged: liveChanges(row.base, row.published),
    });
  }
  const rows = await db().execute<Row>(sql`
    select id, type, draft, published from commerce.pages
    where store_id = ${storeId}::uuid and type in (${sql.join(STAGED_TYPES.map((t) => sql`${t}`), sql`, `)})
      and (published is null or draft::text <> published::text)
    order by type, updated_at desc
    limit 200
  `);
  for (const row of rows) {
    if (copied.has(String(row.id))) continue;
    const draft = parsePageContent(row.draft);
    if (!draft) continue;
    const published = parsePageContent(row.published);
    const differences = published ? compareVersions(published, draft) : [];
    if (published && differences.length === 0) continue;
    pages.push({
      id: String(row.id),
      type: row.type as PageType,
      title: draft.title,
      isNew: !published,
      differences,
      staged: staging?.pageIds.includes(String(row.id)) ?? false,
      copy: false,
      liveChanged: { changed: false, differences: [] },
    });
  }
  const live = await liveLook(storeId);
  const liveTheme = parseStoreTheme(live?.theme);
  const themes = [];
  for (const install of (await listInstalls(storeId)).filter((i) => !i.live)) {
    const look = await installLook(storeId, install.id);
    themes.push({ id: install.id, title: install.title, areas: look ? compareLooks(liveTheme, parseStoreTheme(look.look.theme)) : [] });
  }
  const menus = (await listStoreMenus(storeId)).map((menu) => {
    const kept = staging?.menus[menu.id];
    return {
      id: menu.id,
      name: menu.name,
      staged: kept ? { name: kept.name, before: menu.items.length, after: kept.items.length, renamed: kept.name !== menu.name } : null,
    };
  });
  return { staging, pages, themes, menus };
}

export type PublishOutcome = {
  pages: { id: string; title: string; ok: boolean; problem?: string }[];
  theme: { title: string; ok: boolean; problem?: string } | null;
  menus: { id: string; name: string; ok: boolean; problem?: string }[];
};

/**
 * Makes the open set live: each staged page's copy (or, staged before D385, its draft) published through `savePage()` (only a kind of page the person may write; a page in a
 * running A/B test, a blocking issue or anything the builder's Publish refuses is refused here the same way and said), then the theme through
 * `switchToInstall()` (a premium theme the store does not have is refused: it is made live from Design settings, where its price is shown),
 * then each staged menu through `saveStoreMenu()`. A part refused does not stop the others; the set is closed with what became of each.
 */
export async function publishStaging(
  member: Membership,
): Promise<{ ok: true; outcome: PublishOutcome } | { ok: false; problem: string; changed?: { id: string; title: string }[] }> {
  const staging = await openStagingOf(member.store.id);
  if (!staging) return { ok: false, problem: "none" };
  // A copy whose live page changed since it was copied would undo that change unseen (D385): nothing is made live until each is kept anyway.
  const copies = await db().execute<Row>(sql`
    select sp.page_id, sp.content, sp.base, p.published from commerce.site_staging_pages sp
    join commerce.pages p on p.id = sp.page_id and p.store_id = sp.store_id
    where sp.staging_id = ${staging.id}::uuid and sp.content is not null
  `);
  const changed = copies.filter((c) => liveChanges(c.base, c.published).changed).map((c) => ({ id: String(c.page_id), title: parsePageContent(c.content)?.title ?? "" }));
  if (changed.length > 0) return { ok: false, problem: "changed", changed };
  const copyOf = new Map(copies.map((c) => [String(c.page_id), c.content]));
  const claimed = await db().execute<Row>(sql`
    update commerce.site_stagings set status = 'published', published_by = ${member.account.id}::uuid, published_at = now()
    where id = ${staging.id}::uuid and status = 'open' returning id
  `);
  if (claimed.length === 0) return { ok: false, problem: "none" };
  const outcome: PublishOutcome = { pages: [], theme: null, menus: [] };

  for (const pageId of staging.pageIds) {
    const [row] = await db().execute<Row>(sql`select type, draft from commerce.pages where id = ${pageId}::uuid and store_id = ${member.store.id}::uuid`);
    // The set's copy (D385), else, for a page staged before copies, the page's own draft.
    const draft: PageContent | null = row ? parsePageContent(copyOf.has(pageId) ? copyOf.get(pageId) : row.draft) : null;
    if (!row || !draft) {
      outcome.pages.push({ id: pageId, title: "", ok: false, problem: "gone" });
      continue;
    }
    const type = row.type as PageType;
    const key = pageTypeKey(type, "write");
    if (!key || !memberCan(member, key)) {
      outcome.pages.push({ id: pageId, title: draft.title, ok: false, problem: "access" });
      continue;
    }
    try {
      const saved = await savePage(member.account, member.store.id, pageId, draft, { publish: true, type });
      outcome.pages.push(saved.ok ? { id: pageId, title: draft.title, ok: true } : { id: pageId, title: draft.title, ok: false, problem: saved.problems.join(" ") });
    } catch (error) {
      log("error", "staging.page_failed", { storeId: member.store.id, pageId }, error);
      outcome.pages.push({ id: pageId, title: draft.title, ok: false, problem: "failed" });
    }
  }

  if (staging.installId) {
    const install = (await listInstalls(member.store.id)).find((i) => i.id === staging.installId);
    if (!install) outcome.theme = { title: "", ok: false, problem: "gone" };
    else if (install.live) outcome.theme = { title: install.title, ok: true };
    else {
      const switched = await switchToInstall(member.store.id, install.id, member.account.id);
      outcome.theme = switched.ok ? { title: install.title, ok: true } : { title: install.title, ok: false, problem: switched.problems.join(" ") };
    }
  }

  for (const [menuId, menu] of Object.entries(staging.menus)) {
    const saved = await saveStoreMenu(member, menuId, menu);
    outcome.menus.push(saved.ok ? { id: menuId, name: menu.name, ok: true } : { id: menuId, name: menu.name, ok: false, problem: saved.problems.join(" ") });
  }

  await db().execute(sql`update commerce.site_stagings set outcome = ${JSON.stringify(outcome)}::jsonb where id = ${staging.id}::uuid`);
  await audit(
    member.account.id,
    member.store.id,
    "store.staging_published",
    {
      pages: outcome.pages.filter((p) => p.ok).length,
      refused: outcome.pages.filter((p) => !p.ok).length + outcome.menus.filter((m) => !m.ok).length + (outcome.theme && !outcome.theme.ok ? 1 : 0),
      theme: outcome.theme?.ok ?? false,
      menus: outcome.menus.filter((m) => m.ok).length,
    },
    { area: "website", target: { type: "site_staging", id: staging.id } },
  );
  return { ok: true, outcome };
}

/** The last set made live or discarded, with what became of each part, for the page to say. */
export async function lastStaging(storeId: string): Promise<{ name: string; status: string; at: string | null; outcome: PublishOutcome | null } | null> {
  const [row] = await db().execute<Row>(sql`
    select name, status, published_at, outcome from commerce.site_stagings
    where store_id = ${storeId}::uuid and status <> 'open' order by coalesce(published_at, created_at) desc limit 1
  `);
  if (!row) return null;
  return {
    name: String(row.name),
    status: String(row.status),
    at: row.published_at ? new Date(String(row.published_at)).toISOString() : null,
    outcome: (row.outcome as PublishOutcome | null) ?? null,
  };
}
