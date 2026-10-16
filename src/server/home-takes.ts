import "server-only";

import { sql } from "drizzle-orm";

import { db, readDb } from "@/db/client";
import { CONTENT_PACKS, PACK_TRADES, contentPack, type PackKey } from "@/lib/content-packs";
import { RESERVED_STORE_PAGE_SLUGS, parsePageContent, type PageContent } from "@/lib/page-content";
import { uniqueSlug } from "@/lib/page-ai";
import type { PageLayout } from "@/lib/page-layout";
import { storeOrigins } from "@/lib/paths";
import {
  TEMPLATE_MEDIA_BYTES_MAX,
  TEMPLATE_MEDIA_MAX,
  isStorageUrl,
  leftoverStorageUrls,
  mapTemplateMedia,
  sanitizeTemplate,
  templateMediaUrls,
} from "@/lib/template-content";

import { audit } from "./auth";
import { copyToLibrary, libraryFilesByUrl, type LibraryFile } from "./media-library";
import { pageRulesProblem } from "./page-rules";
import { starterPreviewHref } from "./store-starters";
import type { TemplateDeps } from "./templates";

/**
 * Taking a demo store's home page (`docs/theme-showcase-phase-1.md` step 4c): an existing store may make the home page of a content pack
 * (the page a theme's look is shown with in the theme store) its own front page, and put its own back. The page is copied from the pack's
 * published store template (its frozen copy, `starter_offered_source()`) as D125 copies a template: cleaned of everything that points into
 * the other store (`sanitizeTemplate()`), its pictures copied into this store's library (any it cannot copy left out), checked as the builder
 * checks a save; then, in one transaction, it is a new published page and the store's front page, and `store_home_takes` keeps the front
 * page the store had. *Put back your front page* chooses that one again and deletes the copy unless the owner changed it, chose it for
 * something else or put it in an A/B test. Its layout follows the store's own theme (its rows name core section styles); its words and
 * pictures are the demo store's until the owner changes them, which the page says before the press.
 */

type Row = Record<string, unknown>;

/** A demo store's home page offered to a store: its pack, the store's name and trade, and where to look at it first. */
export type HomeOffer = { pack: PackKey; name: string; trade: string; previewHref: string };

/** The latest home page a store took and has not put back: what *Put back your front page* would undo. */
export type HomeTake = {
  id: string;
  pack: string;
  name: string;
  takenAt: string;
  /** The copy, while it exists. */
  pageId: string | null;
  /** The front page before it: a page's title, or null for the store's products. */
  previousTitle: string | null;
  /** Whether the copy is still the front page (else putting back leaves the front page as the owner chose it since). */
  copyIsFront: boolean;
};

export type HomeTakeResult = { ok: true; pageId: string; notes: string[] } | { ok: false; problems: string[] };
export type HomeUndoResult = { ok: true; messages: string[] } | { ok: false; problems: string[] };

const refuse = (problem: string) => ({ ok: false as const, problems: [problem] });

/** The demo stores whose home page a store may take now: published packs whose store has a published front page, in the packs' order. */
export async function homePageOffers(): Promise<HomeOffer[]> {
  const rows = await readDb().execute<Row>(sql`
    select st.pack_key, src.slug
    from commerce.store_starters st
    join commerce.stores src on src.id = commerce.starter_offered_source(st.id)
    join commerce.pages pg on pg.id = src.front_page_id and pg.published is not null
    where st.pack_key is not null and st.published and st.archived_at is null
  `);
  const slugs = new Map(rows.map((row) => [String(row.pack_key), String(row.slug)]));
  return CONTENT_PACKS.filter((pack) => slugs.has(pack.key)).map((pack) => ({
    pack: pack.key,
    name: pack.storeName,
    trade: PACK_TRADES[pack.key],
    previewHref: starterPreviewHref(slugs.get(pack.key)!),
  }));
}

/** The home page the store took last and has not put back, or null. */
export async function latestHomeTake(storeId: string): Promise<HomeTake | null> {
  const [row] = await db().execute<Row>(sql`
    select h.id, h.pack, h.taken_at, h.page_id, s.front_page_id is not distinct from h.page_id and h.page_id is not null as copy_is_front,
      coalesce(nullif(p.published ->> 'title', ''), nullif(p.draft ->> 'title', ''), p.slug) as previous_title
    from commerce.store_home_takes h
    join commerce.stores s on s.id = h.store_id
    left join commerce.pages p on p.id = h.previous_front_page_id
    where h.store_id = ${storeId}::uuid and h.undone_at is null
    order by h.taken_at desc, h.id desc
    limit 1
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    pack: String(row.pack),
    name: contentPack(String(row.pack))?.storeName ?? String(row.pack),
    takenAt: new Date(String(row.taken_at)).toISOString(),
    pageId: row.page_id ? String(row.page_id) : null,
    previousTitle: row.previous_title ? String(row.previous_title) : null,
    copyIsFront: Boolean(row.copy_is_front),
  };
}

/** The pack's home page made ready for this store, before anything of the store is written but its pictures' copies. */
async function placedHome(storeId: string, accountId: string, packKey: PackKey, deps: TemplateDeps): Promise<{ ok: true; content: PageContent; notes: string[] } | { ok: false; problems: string[] }> {
  const [source] = await db().execute<Row>(sql`
    select st.store_id as working_id, src.id as source_id, src.slug as source_slug, pg.published
    from commerce.store_starters st
    join commerce.stores src on src.id = commerce.starter_offered_source(st.id)
    join commerce.pages pg on pg.id = src.front_page_id and pg.published is not null
    where st.pack_key = ${packKey} and st.published and st.archived_at is null
  `);
  const home = source ? parsePageContent(source.published) : null;
  if (!source || !home) return refuse("That demo store's home page is not offered any more.");
  const sourceId = String(source.source_id);
  const slug = String(source.source_slug);
  const from = { id: sourceId, slug, hosts: storeOrigins(slug).map((origin) => new URL(origin).host) };
  const layout = sanitizeTemplate("page", { pageType: "page", rows: home.rows, css: home.css ?? "" } satisfies PageLayout, from) as PageLayout;

  // Pictures: the pack's own files (made in its working store's library, D257) are copied into this store's library, as a template's are.
  const wanted = templateMediaUrls("page", layout).filter(isStorageUrl);
  const files = new Map<string, LibraryFile>([...(await libraryFilesByUrl(String(source.working_id), wanted)), ...(await libraryFilesByUrl(sourceId, wanted))]);
  const chosen = new Map<string, LibraryFile>();
  let bytes = 0;
  for (const url of wanted) {
    const file = files.get(url);
    if (!file || chosen.has(file.id)) continue;
    if (chosen.size >= TEMPLATE_MEDIA_MAX || bytes + file.sizeBytes > TEMPLATE_MEDIA_BYTES_MAX) continue;
    chosen.set(file.id, file);
    bytes += file.sizeBytes;
  }
  const copies = new Map<string, { url: string; thumbnailUrl: string | null }>();
  for (const file of chosen.values()) {
    const copy = await copyToLibrary({ storeId, accountId }, file, deps.copyFile);
    if (copy) copies.set(file.id, copy);
  }
  const replaced = new Map<string, string>();
  for (const url of wanted) {
    const file = files.get(url);
    const copy = file && copies.get(file.id);
    const next = copy ? (url === file.thumbnailUrl && url !== file.url ? copy.thumbnailUrl : copy.url) : null;
    if (next) replaced.set(url, next);
  }
  const placed = mapTemplateMedia("page", layout, (url) => (isStorageUrl(url) ? (replaced.get(url) ?? null) : url)) as PageLayout;
  const notes: string[] = [];
  const leftOut = new Set(wanted.filter((url) => !replaced.has(url))).size;
  if (leftOut > 0) notes.push(`${leftOut} ${leftOut === 1 ? "picture" : "pictures"} could not be copied and ${leftOut === 1 ? "was" : "were"} left out.`);

  const content = parsePageContent({
    ...home,
    title: "Home page",
    slug: "home-page",
    thumbnail: null,
    excerpt: "",
    seo: { title: "", description: "" },
    // The demo store keeps search engines and AI assistants out by being a store template; the store's own page is open as any page.
    searchEngines: true,
    aiAssistants: true,
    categories: [],
    tags: [],
    rows: placed.rows,
    css: placed.css,
  });
  const problem = content ? pageRulesProblem(storeId, "page", content) : "it cannot be read";
  if (!content || problem) return refuse(`That demo store's home page does not fit your store: ${problem}`);
  if (leftoverStorageUrls(content, new Set(replaced.values())).length > 0) return refuse("That demo store's home page could not be made ready for your store.");
  return { ok: true, content, notes };
}

/**
 * Makes a pack's home page the store's front page (the owner's or a member's press with `website:write`): a new published page, chosen as
 * the front page, with the front page before kept for *Put back*. The caller checked the permission and refreshes the pages' and store's
 * tags after.
 */
export async function takePackHome(accountId: string, storeId: string, packKey: string, deps: TemplateDeps = {}): Promise<HomeTakeResult> {
  const pack = contentPack(packKey);
  if (!pack) return refuse("That demo store's home page is not offered any more.");
  const placed = await placedHome(storeId, accountId, pack.key, deps);
  if (!placed.ok) return placed;
  let made: { pageId: string; previous: string | null };
  try {
    made = await db().transaction(async (tx) => {
      const [store] = await tx.execute<Row>(sql`select front_page_id from commerce.stores where id = ${storeId}::uuid for update`);
      const taken = await tx.execute<Row>(sql`select slug from commerce.pages where store_id = ${storeId}::uuid and type = 'page'`);
      const slug = uniqueSlug("home-page", taken.map((r) => String(r.slug)), RESERVED_STORE_PAGE_SLUGS);
      const json = JSON.stringify({ ...placed.content, slug });
      const [page] = await tx.execute<Row>(sql`
        insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at, created_by, updated_by)
        values (${storeId}::uuid, 'page', ${slug}, ${json}::jsonb, ${json}::jsonb, now(), now(), ${accountId}::uuid, ${accountId}::uuid)
        returning id
      `);
      const pageId = String(page.id);
      await tx.execute(sql`update commerce.stores set front_page_id = ${pageId}::uuid where id = ${storeId}::uuid`);
      const previous = store?.front_page_id ? String(store.front_page_id) : null;
      await tx.execute(sql`
        insert into commerce.store_home_takes (store_id, pack, page_id, previous_front_page_id, taken_by, taken_at)
        values (${storeId}::uuid, ${pack.key}, ${pageId}::uuid, ${previous}::uuid, ${accountId}::uuid, now())
      `);
      return { pageId, previous };
    });
  } catch (error) {
    // The front page is held in place while an A/B test of it runs (D148 phase 10, `stores_experiment_guard`).
    if (/experiment/i.test(describe(error))) return refuse("Your front page is in an A/B test. Stop the test first.");
    throw error;
  }
  await audit(accountId, storeId, "store.front_page_from_pack", { pack: pack.key, page: made.pageId, previous: made.previous }, { target: { type: "page", id: made.pageId } });
  return { ok: true, pageId: made.pageId, notes: placed.notes };
}

/**
 * Puts back the front page a store had before it took a demo home page (`takePackHome()`): that page again (or the store's products, as
 * before), unless the owner chose another front page since; and the copy deleted unless the owner changed it, chose it for a place of its
 * own or put it in an A/B test. Done once; the answer says what stayed.
 */
export async function undoHomeTake(accountId: string, storeId: string, takeId: string): Promise<HomeUndoResult> {
  if (!/^[0-9a-f-]{36}$/i.test(takeId)) return refuse("There is nothing to put back.");
  const result = await db().transaction(async (tx) => {
    const [take] = await tx.execute<Row>(sql`
      select id, page_id, previous_front_page_id from commerce.store_home_takes
      where id = ${takeId}::uuid and store_id = ${storeId}::uuid and undone_at is null
      for update
    `);
    if (!take) return null;
    const messages: string[] = [];
    const copy = take.page_id ? String(take.page_id) : null;
    const [store] = await tx.execute<Row>(sql`select front_page_id from commerce.stores where id = ${storeId}::uuid for update`);
    const copyIsFront = copy !== null && store?.front_page_id === copy;
    if (copyIsFront) {
      await tx.execute(sql`update commerce.stores set front_page_id = ${take.previous_front_page_id ? String(take.previous_front_page_id) : null}::uuid where id = ${storeId}::uuid`);
      messages.push(take.previous_front_page_id ? "Your front page is back." : "Your store opens with your products again, as before.");
    } else {
      messages.push("You chose another front page since, so it stays.");
    }
    if (copy) {
      const [page] = await tx.execute<Row>(sql`
        select p.updated_at > (select h.taken_at from commerce.store_home_takes h where h.id = ${takeId}::uuid) as changed,
          (exists (select 1 from commerce.page_roles r where r.page_id = p.id)
            or exists (select 1 from commerce.stores s where s.id = p.store_id and (s.products_page_id = p.id or s.front_page_id = p.id))) as in_use,
          (exists (select 1 from commerce.experiments e where e.store_id = p.store_id and e.target_page_id = p.id)
            or exists (select 1 from commerce.experiment_variants v where v.page_id = p.id)) as in_test
        from commerce.pages p where p.id = ${copy}::uuid and p.store_id = ${storeId}::uuid
        for update
      `);
      if (page && !page.changed && !page.in_use && !page.in_test) {
        await tx.execute(sql`delete from commerce.pages where id = ${copy}::uuid and store_id = ${storeId}::uuid`);
      } else if (page) {
        messages.push(
          page.changed
            ? "The home page you took stays in your pages, as you changed it."
            : page.in_test
              ? "The home page you took stays in your pages, as it is in an A/B test."
              : "The home page you took stays in your pages, as you chose it for a place of its own.",
        );
      }
    }
    await tx.execute(sql`update commerce.store_home_takes set undone_at = now() where id = ${takeId}::uuid`);
    return { messages, copy, front: copyIsFront };
  });
  if (!result) return refuse("There is nothing to put back.");
  await audit(accountId, storeId, "store.front_page_put_back", { take: takeId, page: result.copy, front: result.front });
  return { ok: true, messages: result.messages };
}

function describe(error: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = error; e && parts.length < 5; e = (e as { cause?: unknown }).cause) {
    const record = e as { message?: unknown; constraint_name?: unknown };
    if (typeof record.message === "string") parts.push(record.message);
    if (typeof record.constraint_name === "string") parts.push(record.constraint_name);
  }
  return parts.join(" ");
}
