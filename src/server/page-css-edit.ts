import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { cssProblem } from "@/lib/custom-css";
import { pageInput, parsePageContent, type PageContent } from "@/lib/page-content";

import { audit, type Account } from "./auth";
import { runningTestOf } from "./experiment-admin";
import { keepVersion } from "./page-versions";
import { PLATFORM_NAVIGATION_TAG } from "./platform-navigation";
import { pagesTag } from "./pages";
import { checkPassPermission, checkPermission } from "./permissions";
import { refreshTagNow } from "./refresh";
import { authorise, pageRow, revisionOf, type PageTextFailure } from "./page-text-edit";
import { saveSiteCss } from "./site-css";
import { storeTag } from "./stores";

/**
 * Custom CSS on the live site (D306): staff who may change a page's words there (D192) may also change its own CSS, and those who may
 * change the website its site's CSS, from a panel beside *Edit text*, seeing the page as they type. What is saved is checked as the page
 * builder's CSS panel is (`cssProblem()`), a page's CSS goes into the page as visitors see it and into the draft where the draft still
 * has the CSS the page had (as the words do), and every change is kept as a version of the page (D305).
 */

const fail = (status: PageTextFailure["status"], code: PageTextFailure["code"], message: string): PageTextFailure => ({ ok: false, status, code, message });
const FORBIDDEN = fail(403, "forbidden", "You cannot edit this page.");
const GONE = fail(404, "not_found", "This page is no longer here. Reload the page.");

type Row = Record<string, unknown>;

/** The fingerprint a save compares with: the page's CSS and the site's, as they were read. */
const cssRevision = (page: string, site: string) => revisionOf(`${page}\u0000${site}`);

/** Whether the person may change the whole site's CSS: a platform admin for Kaizena Flow's, else the website permission. */
async function maySiteCss(store: string | null, account: Account): Promise<boolean> {
  if (store === null) return Boolean(account.platformAdmin);
  return Boolean((await checkPermission(store, "website:write")) ?? (await checkPassPermission(store, "website:write")));
}

async function siteCssOf(owner: string | null): Promise<string> {
  const [row] =
    owner === null
      ? await db().execute<Row>(sql`select custom_css from commerce.platform_settings limit 1`)
      : await db().execute<Row>(sql`select custom_css from commerce.stores where id = ${owner}::uuid`);
  return String(row?.custom_css ?? "");
}

export type PageCssRead = {
  ok: true;
  pageCss: string;
  siteCss: string;
  /** Whether the site's tab may be saved. */
  site: boolean;
  rev: string;
  /** The names the site's `<CustomCss>` styles carry, so the panel can show its CSS in their place while it is open. */
  styles: { page: string; site: string };
};

/** A published page's CSS and its site's, for the person who may change them. */
export async function readPageCss(input: { store: string | null; page: string }): Promise<PageCssRead | PageTextFailure> {
  const row = await pageRow(input.page);
  if (!row) return GONE;
  const who = await authorise(input.store, row);
  if (!who) return FORBIDDEN;
  const [live] = await db().execute<Row>(sql`select published from commerce.pages where id = ${input.page}::uuid`);
  const published = parsePageContent(live?.published);
  if (!published) return fail(409, "not_published", "This page is not published, so there is nothing live to edit. Use the page builder.");
  const pageCss = published.css ?? "";
  const siteCss = await siteCssOf(who.owner);
  return {
    ok: true,
    pageCss,
    siteCss,
    site: await maySiteCss(input.store, who.account),
    rev: cssRevision(pageCss, siteCss),
    styles: { page: `page-${input.page}`, site: who.owner === null ? "kaizen" : `store-${who.owner}` },
  };
}

/**
 * Saves what the panel holds: the page's CSS, and the site's when it changed and the person may. Refused when either was changed by
 * someone else since it was read, when a CSS has a problem, when the page is not published or is in a running A/B test.
 */
export async function savePageCss(input: {
  store: string | null;
  page: string;
  rev: string;
  pageCss: string;
  siteCss: string;
}): Promise<{ ok: true; draftKept: boolean; rev: string } | PageTextFailure> {
  const row = await pageRow(input.page);
  if (!row) return GONE;
  const who = await authorise(input.store, row);
  if (!who) return FORBIDDEN;
  const { account, owner } = who;
  const pageCss = input.pageCss.trim();
  const siteCss = input.siteCss.trim();
  for (const css of [pageCss, siteCss]) {
    const problem = css ? cssProblem(css) : null;
    if (problem) return fail(422, "refused", problem);
  }
  if (owner !== null) {
    const test = await runningTestOf(owner, input.page);
    if (test) return fail(409, "running_test", `This page is in the running A/B test "${test.name}". Changing it now would spoil its results: stop the test first.`);
  }
  const siteBefore = await siteCssOf(owner);
  const siteChanged = siteCss !== siteBefore.trim();
  if (siteChanged && !(await maySiteCss(input.store, account))) {
    return fail(403, "forbidden", "Changing the whole site's CSS needs access to the website settings. Save only this page's.");
  }

  const outcome = await db().transaction(async (tx): Promise<{ ok: true; draftKept: boolean; changed: boolean; slug: string; title: string; type: string } | PageTextFailure> => {
    const [page] = await tx.execute<Row>(sql`
      select slug, type, draft, published from commerce.pages
      where id = ${input.page}::uuid and store_id is not distinct from ${owner}::uuid and type in ('page', 'article')
      for update
    `);
    if (!page) return GONE;
    const published = parsePageContent(page.published);
    if (!published) return fail(409, "not_published", "This page is not published, so there is nothing live to edit. Use the page builder.");
    const before = published.css ?? "";
    if (cssRevision(before, siteBefore) !== input.rev) {
      return fail(409, "conflict", "This CSS was changed by someone else while you were editing it. Reload the page to see their version.");
    }
    if (pageCss === before.trim()) return { ok: true, draftKept: false, changed: false, slug: String(page.slug), title: published.title, type: String(page.type) };
    const checked = pageInput.safeParse({ ...published, css: pageCss || undefined });
    if (!checked.success) return fail(422, "invalid", [...new Set(checked.error.issues.map((issue) => issue.message))].join(" "));
    const next: PageContent = checked.data;
    // The draft keeps its own work: it takes the CSS only where it still has the one the page had.
    const draft = parsePageContent(page.draft);
    const follows = Boolean(draft && (draft.css ?? "").trim() === before.trim());
    const nextDraft = draft && follows ? { ...draft, css: pageCss || undefined } : null;
    await tx.execute(sql`
      update commerce.pages set
        published = ${JSON.stringify(next)}::jsonb,
        draft = case when ${nextDraft !== null}::boolean then ${JSON.stringify(nextDraft ?? {})}::jsonb else draft end,
        updated_at = now(), updated_by = ${account.id}::uuid
      where id = ${input.page}::uuid
    `);
    await keepVersion(tx, { owner, page: input.page, kind: "site_css", content: JSON.stringify(next), account: account.id });
    return { ok: true, draftKept: draft !== null && nextDraft === null, changed: true, slug: String(page.slug), title: next.title, type: String(page.type) };
  });
  if (!outcome.ok) return outcome;
  if (outcome.changed) {
    // Written down with where and how long, never the CSS.
    await audit(
      account.id,
      owner,
      `${owner === null ? "platform" : "store"}.${outcome.type}_css_edited`,
      { label: outcome.title, page: input.page, slug: outcome.slug, length: pageCss.length, draftKept: outcome.draftKept },
      { target: { type: "page", id: input.page } },
    );
    refreshTagNow(pagesTag(owner));
  }
  if (siteChanged) {
    const saved = await saveSiteCss(account, owner, siteCss);
    if (!saved.ok) return fail(422, "refused", saved.problems.join(" "));
    if (owner === null) refreshTagNow(PLATFORM_NAVIGATION_TAG);
    else refreshTagNow(storeTag(String(input.store)));
  }
  return { ok: true, draftKept: outcome.draftKept, rev: cssRevision(pageCss, siteCss) };
}
