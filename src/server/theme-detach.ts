import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { parsePageContent, type PageRow } from "@/lib/page-content";
import type { SectionStyles } from "@/lib/section-styles";
import { parseStoreTheme } from "@/lib/theme";
import { detachThemeValues } from "@/lib/theme-detach";
import type { ThemeElements } from "@/lib/theme-elements";

import { audit } from "./auth";
import { lookChangeRefusal } from "./theme-installs";

type Row = Record<string, unknown>;
type Tx = Pick<ReturnType<typeof db>, "execute">;

/** What the migration of `docs/theme-store.md` 4.4 would do to one page. */
export type DetachPage = { id: string; type: string; slug: string; title: string; followed: number; own: number };
export type DetachReport = { pages: DetachPage[]; followed: number; own: number; unreadable: number };

/** A run's rows are kept this long, so it can be undone; the daily job prunes older ones (`pruneThemeDetaches()`). */
export const THEME_DETACH_KEEP_DAYS = 90;

type Layers = { elements: ThemeElements | undefined; sections: SectionStyles | undefined };

/**
 * The pages the migration may change (D243): every page of the store but a test's version (D148), a page in a running A/B test (its
 * versions are compared setting by setting) and a header, footer or product layout that an installed theme which is not live chose (it is
 * drawn under that theme, not the live one, once switched to).
 */
const candidates = (storeId: string, lock = false) => sql`
  select p.id, p.type, p.slug, p.draft, p.published from commerce.pages p
  where p.store_id = ${storeId}::uuid and p.type <> 'variant'
    and not exists (
      select 1 from commerce.experiments e
      where e.store_id = p.store_id and e.status in ('running', 'scheduled')
        and (e.target_page_id = p.id or exists (select 1 from commerce.experiment_variants v where v.experiment_id = e.id and v.page_id = p.id))
    )
    and not exists (
      select 1 from commerce.store_theme_installs i
      where i.store_id = p.store_id and not i.live
        and p.id::text in (i.look ->> 'headerId', i.look ->> 'footerId', i.look ->> 'productLayoutId')
    )
  order by p.type, p.slug
  ${lock ? sql`for update of p` : sql``}
`;

function layersOf(theme: unknown): Layers {
  const { elements, sectionStyles } = parseStoreTheme(theme).settings;
  return { elements, sections: sectionStyles };
}

/** One version of a page with the settings that repeat the theme taken out; null when nothing would change or it cannot be read. */
function detachContent(value: unknown, layers: Layers): { value: Row; followed: number; own: number } | { value: null; followed: 0; own: number } | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as Row).rows)) return null;
  const content = parsePageContent(value);
  if (!content) return null;
  const result = detachThemeValues(content.rows, layers.elements, layers.sections);
  if (result.followed === 0) return { value: null, followed: 0, own: result.own };
  const next = { ...(value as Row), rows: result.rows as PageRow[] };
  // What is written must read back as a page: if it does not, the version is left as it is.
  if (!parsePageContent(next)) return { value: null, followed: 0, own: result.own };
  return { value: next, followed: result.followed, own: result.own };
}

/**
 * The migration of `docs/theme-store.md` 4.4 as a dry run (D241, D243): for each page it may change (its published content, else its
 * draft), how many of its parts' settings only repeat the live theme and would follow it once taken out, and how many are the owner's own.
 * Reads only.
 */
export async function detachDryRun(storeId: string): Promise<DetachReport | null> {
  const [store] = await db().execute<Row>(sql`select theme from commerce.stores where id = ${storeId}::uuid`);
  if (!store) return null;
  const layers = layersOf(store.theme);
  const rows = await db().execute<Row>(candidates(storeId));
  const report: DetachReport = { pages: [], followed: 0, own: 0, unreadable: 0 };
  for (const row of rows) {
    const content = parsePageContent(row.published ?? row.draft);
    if (!content) {
      report.unreadable += 1;
      continue;
    }
    const result = detachThemeValues(content.rows, layers.elements, layers.sections);
    report.followed += result.followed;
    report.own += result.own;
    if (result.followed + result.own > 0) {
      report.pages.push({ id: String(row.id), type: String(row.type), slug: String(row.slug), title: content.title || String(row.slug), followed: result.followed, own: result.own });
    }
  }
  report.pages.sort((a, b) => b.followed - a.followed || a.slug.localeCompare(b.slug));
  return report;
}

export type DetachRunResult = { ok: true; runId: string | null; pages: number; followed: number; kept: number } | { ok: false; problems: string[] };

/**
 * The migration run for real (D243, `docs/theme-phase-2.md` step 2): every page it may change has its draft and published content cleared
 * of the settings that only repeat the live theme, so the page is drawn exactly as before and follows the theme from then on. One
 * transaction under the store's row lock (the live theme cannot change meanwhile); each changed page keeps a row with both versions before
 * and after, for `undoDetach()`. Words, pictures, videos and links are never touched (only style settings are taken out). The caller
 * refreshes the pages' tags.
 */
export async function runDetach(storeId: string, accountId: string): Promise<DetachRunResult> {
  const refusal = await lookChangeRefusal(storeId, accountId);
  if (refusal) return { ok: false, problems: [refusal] };
  const runId = randomUUID();
  let done: { pages: number; followed: number; kept: number };
  try {
    done = await db().transaction(async (tx) => {
      const [store] = await tx.execute<Row>(sql`select theme from commerce.stores where id = ${storeId}::uuid for update`);
      if (!store) throw new Error("store gone");
      const layers = layersOf(store.theme);
      const pages = await tx.execute<Row>(candidates(storeId, true));
      const totals = { pages: 0, followed: 0, kept: 0 };
      for (const page of pages) {
        const draft = detachContent(page.draft, layers);
        const published = page.published == null ? null : detachContent(page.published, layers);
        const followed = (draft?.followed ?? 0) + (published?.followed ?? 0);
        if (followed === 0) continue;
        const kept = (draft?.own ?? 0) + (published?.own ?? 0);
        await writePage(tx, String(page.id), draft?.value ?? null, published?.value ?? null);
        await tx.execute(sql`
          insert into commerce.page_theme_detaches (store_id, run_id, page_id, draft_before, draft_after, published_before, published_after, followed, kept, created_by)
          values (${storeId}::uuid, ${runId}::uuid, ${String(page.id)}::uuid,
            ${draft?.value ? JSON.stringify(page.draft) : null}::jsonb, ${draft?.value ? JSON.stringify(draft.value) : null}::jsonb,
            ${published?.value ? JSON.stringify(page.published) : null}::jsonb, ${published?.value ? JSON.stringify(published.value) : null}::jsonb,
            ${followed}, ${kept}, ${accountId}::uuid)
        `);
        totals.pages += 1;
        totals.followed += followed;
        totals.kept += kept;
      }
      return totals;
    });
  } catch (error) {
    console.error("[theme-detach] the run failed", error);
    return { ok: false, problems: ["The pages could not be changed. Nothing was changed; try again."] };
  }
  if (done.pages === 0) return { ok: true, runId: null, ...done };
  await audit(accountId, storeId, "store.theme_pages_detached", { run: runId, pages: done.pages, followed: done.followed, kept: done.kept }, {
    area: "website",
    target: { type: "theme_detach", id: runId },
  });
  return { ok: true, runId, ...done };
}

async function writePage(tx: Tx, pageId: string, draft: Row | null, published: Row | null): Promise<void> {
  if (draft && published) {
    await tx.execute(sql`update commerce.pages set draft = ${JSON.stringify(draft)}::jsonb, published = ${JSON.stringify(published)}::jsonb where id = ${pageId}::uuid`);
  } else if (draft) {
    await tx.execute(sql`update commerce.pages set draft = ${JSON.stringify(draft)}::jsonb where id = ${pageId}::uuid`);
  } else if (published) {
    await tx.execute(sql`update commerce.pages set published = ${JSON.stringify(published)}::jsonb where id = ${pageId}::uuid`);
  }
}

export type UndoResult = { ok: true; restored: number; changedSince: number } | { ok: false; problems: string[] };

/**
 * Undoes a run (D243): each version of each page it changed goes back to what it was, but only while it is still what the run left (a page
 * edited since keeps its edit, and is counted). Once per run; the rows are kept, marked undone.
 */
export async function undoDetach(storeId: string, runId: string, accountId: string): Promise<UndoResult> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return { ok: false, problems: ["That run is not known."] };
  const refusal = await lookChangeRefusal(storeId, accountId);
  if (refusal) return { ok: false, problems: [refusal] };
  let done: { restored: number; changedSince: number };
  try {
    done = await db().transaction(async (tx) => {
      const rows = await tx.execute<Row>(sql`
        select id, page_id, draft_before, draft_after, published_before, published_after from commerce.page_theme_detaches
        where store_id = ${storeId}::uuid and run_id = ${runId}::uuid and undone_at is null
        order by id for update
      `);
      if (rows.length === 0) throw new UndoRefused("That run was undone already, or is no longer kept.");
      const totals = { restored: 0, changedSince: 0 };
      for (const row of rows) {
        let back = false;
        let since = false;
        if (row.draft_after != null) {
          const [hit] = await tx.execute<Row>(sql`
            update commerce.pages set draft = ${JSON.stringify(row.draft_before)}::jsonb
            where id = ${String(row.page_id)}::uuid and draft = ${JSON.stringify(row.draft_after)}::jsonb returning id
          `);
          if (hit) back = true;
          else since = true;
        }
        if (row.published_after != null) {
          const [hit] = await tx.execute<Row>(sql`
            update commerce.pages set published = ${JSON.stringify(row.published_before)}::jsonb
            where id = ${String(row.page_id)}::uuid and published = ${JSON.stringify(row.published_after)}::jsonb returning id
          `);
          if (hit) back = true;
          else since = true;
        }
        if (since) totals.changedSince += 1;
        else if (back) totals.restored += 1;
        await tx.execute(sql`update commerce.page_theme_detaches set undone_at = now() where id = ${String(row.id)}::uuid`);
      }
      return totals;
    });
  } catch (error) {
    if (error instanceof UndoRefused) return { ok: false, problems: [error.message] };
    console.error("[theme-detach] undo failed", error);
    return { ok: false, problems: ["The run could not be undone. Nothing was changed; try again."] };
  }
  await audit(accountId, storeId, "store.theme_pages_detach_undone", { run: runId, restored: done.restored, changedSince: done.changedSince }, {
    area: "website",
    target: { type: "theme_detach", id: runId },
  });
  return { ok: true, ...done };
}

class UndoRefused extends Error {}

export type DetachRun = { runId: string; at: string; pages: number; followed: number; kept: number; undoneAt: string | null };

/** The store's latest runs, newest first. */
export async function listDetachRuns(storeId: string, limit = 5): Promise<DetachRun[]> {
  const rows = await db().execute<Row>(sql`
    select run_id, min(created_at) as at, count(*)::int as pages, sum(followed)::int as followed, sum(kept)::int as kept, max(undone_at) as undone_at
    from commerce.page_theme_detaches where store_id = ${storeId}::uuid
    group by run_id order by min(created_at) desc limit ${limit}
  `);
  return rows.map((row) => ({
    runId: String(row.run_id),
    at: new Date(row.at as string).toISOString(),
    pages: Number(row.pages),
    followed: Number(row.followed),
    kept: Number(row.kept),
    undoneAt: row.undone_at ? new Date(row.undone_at as string).toISOString() : null,
  }));
}

/** The daily job: runs older than `THEME_DETACH_KEEP_DAYS` can no longer be undone and are deleted. */
export async function pruneThemeDetaches(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.page_theme_detaches where created_at < now() - make_interval(days => ${THEME_DETACH_KEEP_DAYS}) returning id
  `);
  return rows.length;
}
