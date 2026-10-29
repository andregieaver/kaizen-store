import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { withoutRecipients } from "@/lib/forms";
import { uniqueSlug } from "@/lib/page-ai";
import { RESERVED_STORE_PAGE_SLUGS, parsePageContent, type PageContent } from "@/lib/page-content";
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
import { SUBMISSION_PAGES_MAX, type SubmittedPage } from "@/lib/theme-submissions";

import type { Account } from "./auth";
import { log } from "./log";
import { copyToLibrary, libraryFilesByUrl, type LibraryFile } from "./media-library";
import { pageRulesProblem } from "./page-rules";
import { refreshTag } from "./refresh";
import { storeTag } from "./stores";
import type { TemplateDeps } from "./templates";

/**
 * A theme submission's own pages (wave 11 unit I, D388, `docs/wave-11-core-and-psi.md` I). When the look is sent, the author store's
 * published pages (not those chosen for a place: legal pages, the cart, the blog and the like stay the store's) are copied as a template is
 * (`pagesToSubmit()`: `sanitizeTemplate()` takes out everything that points into the store, forms lose their recipients, and categories,
 * tags, countries and an author's name are dropped) and kept with the submission, so the store can change after. A review places them in a
 * store template of their own (`makeSubmittedContent()`: copied from the default template as every theme's content is, the pictures copied
 * from the author store's library into its own, each page checked as the builder checks a save), never products, customers or settings.
 * On approval it becomes the theme's content (D275, `adoptSubmittedContent()`), and is published with the theme; a submission rejected or
 * withdrawn puts it away (`archiveSubmittedContent()`).
 */

type Row = Record<string, unknown>;

type Result<T> = ({ ok: true } & T) | { ok: false; problems: string[] };

class Refused extends Error {}

/** The author store's published pages as a submission keeps them: the front page first, then the pages changed most recently. */
export async function pagesToSubmit(storeId: string): Promise<SubmittedPage[]> {
  const rows = await db().execute<Row>(sql`
    select p.published, p.slug, s.slug as store_slug, s.front_page_id is not distinct from p.id as front
      from commerce.pages p join commerce.stores s on s.id = p.store_id
     where p.store_id = ${storeId}::uuid and p.type = 'page' and p.published is not null
       and not exists (select 1 from commerce.page_roles r where r.page_id = p.id)
     order by (s.front_page_id is not distinct from p.id) desc, p.updated_at desc, p.id
     limit ${SUBMISSION_PAGES_MAX}
  `);
  const pages: SubmittedPage[] = [];
  for (const row of rows) {
    const page = parsePageContent(row.published);
    if (!page) continue;
    const slug = String(row.store_slug);
    const from = { id: storeId, slug, hosts: storeOrigins(slug).map((origin) => new URL(origin).host) };
    const layout = sanitizeTemplate("page", { pageType: "page", rows: page.rows, css: page.css ?? "" } satisfies PageLayout, from) as PageLayout;
    const content: PageContent = withoutRecipients({
      ...page,
      rows: layout.rows,
      css: layout.css,
      thumbnail: null,
      categories: [],
      tags: [],
      markets: undefined,
      author: undefined,
      blogId: undefined,
      authorId: undefined,
    });
    pages.push({ title: page.title, slug: String(row.slug), front: row.front === true, content });
  }
  return pages;
}

/** One page made ready for the content store: its pictures copied from the author store's library, then checked. */
async function placedPage(
  target: { storeId: string; accountId: string },
  sourceStoreId: string,
  page: SubmittedPage,
  deps: TemplateDeps,
): Promise<{ ok: true; content: PageContent; leftOut: number } | { ok: false; problem: string }> {
  const read = parsePageContent(page.content);
  if (!read) return { ok: false, problem: "it cannot be read" };
  const layout = { pageType: "page", rows: read.rows, css: read.css ?? "" } satisfies PageLayout;
  const wanted = templateMediaUrls("page", layout).filter(isStorageUrl);
  const files = await libraryFilesByUrl(sourceStoreId, wanted);
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
    const copy = await copyToLibrary(target, file, deps.copyFile);
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
  const content = parsePageContent({ ...read, rows: placed.rows, css: placed.css });
  const problem = content ? pageRulesProblem(target.storeId, "page", content) : "it cannot be read";
  if (!content || problem) return { ok: false, problem: problem ?? "it cannot be read" };
  if (leftoverStorageUrls(content, new Set(replaced.values())).length > 0) return { ok: false, problem: "a picture could not be made its own" };
  return { ok: true, content, leftOut: new Set(wanted.filter((url) => !replaced.has(url))).size };
}

/**
 * Places a submission's pages in a store template of their own, for its review: the default template copied (`clone_store(starter_source(
 * null))`, the admin its owner), marked a starter, described under the theme's name and unpublished, tied to no theme until approval; then
 * each page as a published page of it, the author's front page its front page. A page that does not fit is left out and named.
 */
export async function makeSubmittedContent(
  admin: Account,
  input: { title: string; sourceStoreId: string; pages: SubmittedPage[] },
  deps: TemplateDeps = {},
): Promise<Result<{ starterId: string; storeId: string; notes: string[] }>> {
  if (!admin.platformAdmin) return { ok: false, problems: ["Only Kaizena Flow's admins review themes."] };
  const slug = `content-${randomBytes(4).toString("hex")}`;
  let made: { starterId: string; storeId: string };
  try {
    made = await db().transaction(async (tx) => {
      const [store] = await tx.execute<Row>(sql`
        select commerce.clone_store(commerce.starter_source(null), ${slug}, ${input.title}, ${admin.id}::uuid) as id
      `);
      const storeId = String(store.id);
      await tx.execute(sql`update commerce.stores set starter = true where id = ${storeId}::uuid`);
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.store_starters (store_id, title, category, position, published, created_by, updated_by)
        values (${storeId}::uuid, ${input.title}, 'other', (select coalesce(max(position), 0) + 1 from commerce.store_starters), false,
          ${admin.id}::uuid, ${admin.id}::uuid)
        returning id
      `);
      return { starterId: String(row.id), storeId };
    });
  } catch (error) {
    log("error", "theme_submission.content_failed", { sourceStoreId: input.sourceStoreId }, error);
    return { ok: false, problems: ["Its pages could not be placed. Nothing was changed; try again."] };
  }
  const notes: string[] = [];
  const ready: { page: SubmittedPage; content: PageContent }[] = [];
  let leftOut = 0;
  for (const page of input.pages) {
    const placed = await placedPage({ storeId: made.storeId, accountId: admin.id }, input.sourceStoreId, page, deps);
    if (!placed.ok) notes.push(`The page ${page.title} was left out: ${placed.problem}.`);
    else {
      ready.push({ page, content: placed.content });
      leftOut += placed.leftOut;
    }
  }
  if (leftOut > 0) notes.push(`${leftOut} ${leftOut === 1 ? "picture" : "pictures"} could not be copied and ${leftOut === 1 ? "was" : "were"} left out.`);
  try {
    await db().transaction(async (tx) => {
      const taken = (await tx.execute<Row>(sql`select slug from commerce.pages where store_id = ${made.storeId}::uuid and type = 'page'`)).map((r) => String(r.slug));
      for (const { page, content } of ready) {
        const pageSlug = uniqueSlug(content.slug || page.slug, taken, RESERVED_STORE_PAGE_SLUGS);
        taken.push(pageSlug);
        const json = JSON.stringify({ ...content, slug: pageSlug });
        const [row] = await tx.execute<Row>(sql`
          insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at, created_by, updated_by)
          values (${made.storeId}::uuid, 'page', ${pageSlug}, ${json}::jsonb, ${json}::jsonb, now(), now(), ${admin.id}::uuid, ${admin.id}::uuid)
          returning id
        `);
        if (page.front) await tx.execute(sql`update commerce.stores set front_page_id = ${String(row.id)}::uuid where id = ${made.storeId}::uuid`);
      }
    });
  } catch (error) {
    log("error", "theme_submission.pages_failed", { storeId: made.storeId }, error);
    notes.push("Its pages could not be saved; the theme's content is the standard store's until they are placed again.");
  }
  // Its front page was chosen: the store's cached read follows (DATA-02).
  refreshTag(storeTag(slug));
  return { ok: true, starterId: made.starterId, storeId: made.storeId, notes };
}

/**
 * Makes a submission's content store the theme's content (D275), in one transaction: the content the theme had is let go as
 * `giveThemeContent()` lets it go (a content pack's template stays starting content, a copy of its own is archived). The caller publishes it.
 */
export async function adoptSubmittedContent(admin: Account, presetId: string, starterId: string): Promise<Result<object>> {
  if (!admin.platformAdmin) return { ok: false, problems: ["Only Kaizena Flow's admins review themes."] };
  try {
    await db().transaction(async (tx) => {
      const [theme] = await tx.execute<Row>(sql`select id from commerce.design_presets where id = ${presetId}::uuid and archived_at is null for update`);
      if (!theme) throw new Refused("The theme is archived. Restore it first.");
      const [held] = await tx.execute<Row>(sql`
        select id from commerce.store_starters where id = ${starterId}::uuid and design_preset_id is null and archived_at is null for update
      `);
      if (!held) throw new Refused("Its pages are no longer waiting to become the theme's content.");
      await tx.execute(sql`
        update commerce.store_starters
           set design_preset_id = null,
               archived_at = case when pack_key is null then coalesce(archived_at, now()) else archived_at end,
               archived_by = case when pack_key is null then coalesce(archived_by, ${admin.id}::uuid) else archived_by end,
               published = case when pack_key is null then false else published end, updated_by = ${admin.id}::uuid
         where design_preset_id = ${presetId}::uuid
      `);
      await tx.execute(sql`
        update commerce.store_starters set design_preset_id = ${presetId}::uuid, updated_by = ${admin.id}::uuid where id = ${starterId}::uuid
      `);
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, problems: [error.message] };
    log("error", "theme_submission.adopt_failed", { presetId, starterId }, error);
    return { ok: false, problems: ["Its pages could not become the theme's content. Try again."] };
  }
  return { ok: true };
}

/** Puts away a submission's content store that never became a theme's (rejected or withdrawn): archived, unpublished, kept. */
export async function archiveSubmittedContent(accountId: string, starterId: string): Promise<void> {
  await db().execute(sql`
    update commerce.store_starters set archived_at = now(), archived_by = ${accountId}::uuid, published = false, updated_by = ${accountId}::uuid
     where id = ${starterId}::uuid and design_preset_id is null and archived_at is null
  `);
}
