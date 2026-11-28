import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { PAGE_DEFAULT, PAGE_MAX } from "@/lib/admin-api";
import { CONTENT_API, SITE_PAGE_TYPES_API } from "@/lib/admin-api-content";
import type { AdminAnswer, ApiRoute } from "@/lib/admin-api-routes";
import { entryStatus, type Entry } from "@/lib/content-types";
import { moneyCurrencies } from "@/lib/field-money";
import { siteUrl } from "@/lib/site";
import { parseImportOptions } from "@/lib/product-import";
import { issueId, type PageIssue } from "@/lib/page-a11y";
import type { PageType } from "@/lib/page-content";

import { fail, holds, jsonBody, ok, readBody, record, sinceWhere, type ApiAnswer } from "./admin-api-kit";
import type { ApiCaller } from "./api-tokens";
import { uploadUrl } from "./api-uploads";
import { getEntry, listEntries, publishEntry, saveEntry, type EntryContext } from "./content-entries";
import { getContentType, listContentTypes } from "./content-types";
import { dataStorage, safeName, type DataDeps, type DataJob } from "./data-job-store";
import {
  cancelJob,
  downloadPart,
  dryCountsOf,
  importProblemsCsv,
  jobFor,
  registerImport,
  requestProductExport,
  startImportApply,
  startImportCheck,
  startImportUpload,
} from "./data-jobs";
import { listStoreMenus, saveStoreMenu } from "./menus";
import { getPageForEdit, listPages, savePage } from "./pages";
import { readPriceDisplay } from "./price-display";
import { EXPERIMENTS_WORDS } from "@/lib/admin-words/experiments";
import { experimentCard } from "@/lib/experiment-card";
import { getExperiment, type ExperimentInfo } from "./experiment-admin";
import { listedTests } from "./experiment-list";
import { experimentResults } from "./experiment-results";
import { runReport } from "./report-query";
import { getSavedReport, listSavedReports } from "./saved-reports";
import { col, typedRow, typedRows } from "./typed-rows";
import { addEndpoint, listEndpointDeliveries, listEndpoints, removeEndpoint, resendDelivery, switchEndpoint, updateEndpoint, type EndpointProblem } from "./webhook-endpoints";

/**
 * The Admin API's content, the store and its operations (wave 14 unit C4, D440): pages and articles through the editor's own save and publish
 * (`savePage()`, publishing only with `content:publish`), content entries through `saveEntry()`/`publishEntry()`, menus and the store's
 * settings read, saved reports run by `runReport()` (the Reports page's runner, nothing written), the owner's endpoints through the
 * Integrations page's writers with `webhooks:write` (a secret answered once), and the product file's jobs through the Data page's own steps
 * (`requestProductExport()`, `startImportUpload()`, `registerImport()`, `startImportCheck()`, `startImportApply()`). Each change audited
 * `integration.api_{what}`.
 */

export const CONTENT_NAMES = CONTENT_API.map((o) => o.name);
type ContentName = (typeof CONTENT_API)[number]["name"];
export type ContentRoute = Extract<ApiRoute, { name: ContentName }>;

// ---------------------------------------------------------------------------
// Pages and articles
// ---------------------------------------------------------------------------

type ApiPage = AdminAnswer<"pages.get">["data"];
type ApiPageType = ApiPage["type"];

const NO_PAGE = "No such page, header or footer in this store.";

/** What a row under `/pages` is (D917): one of the store's pages, headers or footers; `not_found` for anything else. */
async function siteTypeOf(storeId: string, id: string): Promise<ApiPageType> {
  const row = await typedRow(
    z.object({ type: z.enum(SITE_PAGE_TYPES_API) }),
    sql`select type from commerce.pages where id = ${id}::uuid and store_id = ${storeId}::uuid and type in ('page', 'header', 'footer')`,
  );
  return row?.type ?? fail("not_found", NO_PAGE);
}

async function pageById(caller: ApiCaller, id: string, type: ApiPageType): Promise<ApiPage> {
  const storeId = caller.member.store.id;
  const [page, dated] = await Promise.all([
    getPageForEdit(storeId, id, type),
    typedRow(z.object({ first_published_at: col.timestampOrNull }), sql`select first_published_at from commerce.pages where id = ${id}::uuid and store_id = ${storeId}::uuid`),
  ]);
  if (!page) return fail("not_found", type === "article" ? "No such article in this store." : NO_PAGE);
  return {
    id: page.id,
    type,
    title: page.draft.title,
    slug: page.slug,
    state: page.state,
    published_at: page.publishedAt,
    first_published_at: dated?.first_published_at ?? null,
    updated_at: page.updatedAt,
    draft: page.draft as unknown as Record<string, unknown>,
  };
}

/**
 * An article's first date (D917): when it first appeared, for one brought from another site, kept when it is published (`savePage()` keeps a
 * first date it finds). Not in the future; an article on the site keeps one, and changing it there changes what visitors see, which takes
 * `content:publish`. Checked before anything is saved; answers whether the article is on the site.
 */
async function dateRefusal(caller: ApiCaller, id: string | null, at: string | null): Promise<boolean> {
  if (at !== null && new Date(at).getTime() > Date.now()) return fail("invalid", "first_published_at: a time not in the future.");
  if (id === null) return false;
  const row = await typedRow(
    z.object({ live: col.bool }),
    sql`select published_at is not null as live from commerce.pages where id = ${id}::uuid and store_id = ${caller.member.store.id}::uuid and type = 'article'`,
  );
  if (!row) return fail("not_found", "No such article in this store.");
  if (row.live && at === null) return fail("invalid", "first_published_at: an article on the site keeps a date. Give one.");
  if (row.live && !holds(caller, "content:publish")) return fail("gated", "This article is on the site, and its date shows there at once: that takes a token with content:publish.");
  return row.live;
}

/**
 * What the site shows of a page after a publish over the API, refreshed as the page builder's publish refreshes it (`tagsAfterPublish()`:
 * the page's own tag, and the store's pages when what other pages show of it changed).
 */
async function refreshPublished(storeId: string, id: string, scope: "page" | "site" | undefined): Promise<void> {
  const [{ refreshTag }, { tagsAfterPublish }] = await Promise.all([import("./refresh"), import("./page-refresh")]);
  for (const tag of tagsAfterPublish(storeId, id, scope)) refreshTag(tag);
}

/** Writes an article's first date checked by `dateRefusal()`; on a live article the blog's order and dates change, so the site is refreshed. */
async function dateArticle(storeId: string, id: string, at: string | null, live: boolean): Promise<void> {
  await typedRows(
    z.object({ id: col.uuid }),
    sql`update commerce.pages set first_published_at = ${at}::timestamptz where id = ${id}::uuid and store_id = ${storeId}::uuid and type = 'article' returning id`,
  );
  if (live) await refreshPublished(storeId, id, "site");
}

/**
 * A draft as the API saves it (D440): the page's own draft and nothing past it. The editor also sends the global parts it changed
 * (`globalEdits`), which its save spreads to every page using them, published ones and the header and footer included: over the API that
 * is refused, as global parts change in the admin. Field entries (`fields`) are the editor's own save beside the page's: left out.
 */
function draftOf(draft: Record<string, unknown>): Record<string, unknown> {
  if (Object.hasOwn(draft, "globalEdits")) {
    return fail("invalid", "globalEdits: a draft over the API changes this page only. Global parts, and the pages that use them, change in the admin.");
  }
  const own = { ...draft };
  delete own.fields;
  return own;
}

/**
 * A page that was never published moves to its new address with its draft, and the pages under it with it (`savePage()`): one of those
 * that is published moves on the site at once, which takes `content:publish` (D440).
 */
async function moveRefusal(caller: ApiCaller, id: string, type: PageType, draft: Record<string, unknown>): Promise<void> {
  if (type !== "page" || typeof draft.slug !== "string" || holds(caller, "content:publish")) return;
  const [moved] = await typedRows(
    z.object({ moves: col.bool }),
    sql`
      select exists (
        select 1 from commerce.pages c
        where c.store_id = p.store_id and c.type = 'page' and c.published_at is not null and left(c.slug, length(p.slug) + 1) = p.slug || '/'
      ) as moves
      from commerce.pages p
      where p.store_id = ${caller.member.store.id}::uuid and p.id = ${id}::uuid and p.type = 'page' and p.published_at is null and p.slug <> ${draft.slug}
    `,
  );
  if (moved?.moves) return fail("gated", "Pages under this one are on the site, and a new address moves them now: that takes a token with content:publish.");
}

/** A refusal of the editor's save: the checker's blocking issues are a 409 that names them, the rest a 422. */
function pageRefusal(result: { problems: string[]; code?: string; issues?: PageIssue[] }): never {
  if (result.code === "needs_confirmation") {
    const issues = (result.issues ?? []).map((i) => `${issueId(i)} (${i.message})`).join(", ");
    return fail("conflict", `Publishing waits for these issues to be acknowledged (acknowledged_issues): ${issues}. ${result.problems.join(" ")}`.trim());
  }
  return fail("invalid", result.problems.join(" "));
}

// ---------------------------------------------------------------------------
// Looks and menus (D917)
// ---------------------------------------------------------------------------

async function lookById(storeId: string, id: string): Promise<AdminAnswer<"themes.get">["data"]> {
  const [{ installLook }, { lookForApi }] = await Promise.all([import("./theme-installs"), import("./theme-look-api")]);
  const install = await installLook(storeId, id);
  return install ? lookForApi(install) : fail("not_found", "No such theme in this store's theme library.");
}

/** A refusal of the theme library's writers: a full library, a store not open or the live look are a 409, the rest a 422. */
async function lookRefusal(problems: string[]): Promise<never> {
  const { INSTALLS_FULL, LIVE_LOOK } = await import("./theme-installs");
  const conflict = problems.some((p) => p === INSTALLS_FULL || p === LIVE_LOOK || p.startsWith("The store is not open") || p.startsWith("This store is kept"));
  return fail(conflict ? "conflict" : "invalid", problems.join(" "));
}

/** What visitors do not see yet of a look made live: its header or footer not published, so the standard one shows. */
async function liveLookNotes(storeId: string): Promise<string[]> {
  const row = await typedRow(
    z.object({ header: z.boolean().nullable(), footer: z.boolean().nullable() }),
    sql`
      select (select p.published_at is null from commerce.pages p where p.id = s.header_id) as header,
        (select p.published_at is null from commerce.pages p where p.id = s.footer_id) as footer
      from commerce.stores s where s.id = ${storeId}::uuid
    `,
  );
  return (["header", "footer"] as const).flatMap((type) => (row?.[type] ? [`The look's ${type} is not published: the site shows the standard ${type} until it is.`] : []));
}

async function menuById(storeId: string, id: string): Promise<AdminAnswer<"menus.get">["data"]> {
  const menu = (await listStoreMenus(storeId)).find((m) => m.id === id);
  return menu ? { id: menu.id, name: menu.name, items: menu.items as unknown[] } : fail("not_found", "No such menu in this store.");
}

/** Whether visitors see a menu (D917): the standard header's or footer's, or named in a published page, header or footer. */
async function menuOnSite(storeId: string, id: string): Promise<boolean> {
  const row = await typedRow(
    z.object({ shown: col.bool }),
    sql`
      select exists (select 1 from commerce.stores s where s.id = ${storeId}::uuid and ${id}::uuid in (s.header_menu_id, s.footer_menu_id))
        or exists (select 1 from commerce.pages p where p.store_id = ${storeId}::uuid and p.published::text like ${`%"${id}"%`}) as shown
    `,
  );
  return row?.shown === true;
}

/** A refusal of the menu editor's save: a name another menu has is a 409, the rest a 422. */
const menuRefusal = (problems: string[]): never => fail(problems.some((p) => p.startsWith("There is already a menu")) ? "conflict" : "invalid", problems.join(" "));

// ---------------------------------------------------------------------------
// Content entries
// ---------------------------------------------------------------------------

const entryContext = (caller: ApiCaller): EntryContext => {
  const store = caller.member.store;
  return { accountId: caller.member.account.id, owner: store.id, locales: store.localization.locales, main: store.localization.locales[0] ?? "en", currencies: moneyCurrencies(store) };
};

const entryOut = (entry: Entry): AdminAnswer<"content.entry">["data"] => ({
  id: entry.id,
  type_id: entry.typeId,
  slug: entry.slug,
  state: entryStatus(entry),
  draft: entry.draft as unknown as Record<string, unknown>,
  published_at: entry.publishedAt,
  updated_at: entry.updatedAt,
});

async function entryById(storeId: string, id: string) {
  const entry = await getEntry(storeId, id);
  return entry ? entryOut(entry) : fail("not_found", "No such entry in this store.");
}

// ---------------------------------------------------------------------------
// Webhook endpoints
// ---------------------------------------------------------------------------

/** One A/B test as the API answers it: its card (`experimentCard()`), figures only once it has an answer. */
function experimentOut(t: ExperimentInfo, card: ReturnType<typeof experimentCard>): AdminAnswer<"experiments.get">["data"] {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    stage: card.state,
    next: card.next,
    best: card.best,
    goal: t.goal,
    target: { kind: t.page.kind, title: t.page.title, slug: t.page.slug, part: t.part?.label ?? null },
    versions: t.variants.map((v) => ({ key: v.key, name: v.name, share: v.share })),
    progress: {
      days: card.progress.days,
      min_days: card.progress.minDays,
      visitors: card.progress.visitors,
      min_visitors: card.progress.minVisitors,
      share: card.progress.share,
      reached: card.progress.reached,
      ready_around: card.progress.readyAround,
    },
    comparisons: card.showFigures ? card.comparisons.map((c) => ({ key: c.key, original: c.original, version: c.version, relative: c.relative, low: c.low, high: c.high, side: c.side })) : [],
    impact: card.impact && { key: card.impact.key, per_week: card.impact.perWeek, low: card.impact.low, high: card.impact.high },
    learning: t.learning,
    started_at: t.startedAt,
    stopped_at: t.stoppedAt,
    answered_at: t.answeredAt,
    applied_version: t.appliedVariant,
    created_at: t.createdAt,
  };
}

async function endpointById(storeId: string, id: string): Promise<AdminAnswer<"webhooks.update">["data"]> {
  const found = (await listEndpoints(storeId)).find((e) => e.id === id) ?? fail("not_found", "No such endpoint in this store.");
  return {
    id: found.id,
    name: found.name,
    hint: found.hint,
    topics: found.topics,
    enabled: found.enabled,
    disabled_reason: found.disabledReason,
    failing_since: found.failingSince,
    last_delivery: found.lastDelivery,
    recent_failures: found.recentFailures,
  };
}

function endpointRefusal(problem: EndpointProblem, detail?: string): never {
  const words: Record<EndpointProblem, string> = {
    name: "name: 1 to 80 characters.",
    topics: "topics: choose at least one.",
    url: `url: an HTTPS address${detail ? ` (${detail})` : ""}.`,
    address: `url: that address cannot take events${detail ? `: ${detail}` : ""}.`,
    key: "Kaizena Flow cannot keep the address safe right now. Try again later.",
    limit: "The store has as many endpoints as it may. Remove one first.",
    gone: "No such endpoint in this store.",
  };
  if (problem === "gone") return fail("not_found", words.gone);
  if (problem === "limit") return fail("conflict", words.limit);
  if (problem === "key") return fail("failed", words.key);
  return fail("invalid", words[problem]);
}

// ---------------------------------------------------------------------------
// The product file's jobs
// ---------------------------------------------------------------------------

const PRODUCT_JOBS = ["product_export", "product_import"] as const;

/** The private buckets, named for each step (the Data page's own default, read here so one reading serves the whole call). */
const jobDeps = (): DataDeps => ({ storage: dataStorage() });

function jobOut(job: DataJob): AdminAnswer<"jobs.get">["data"] {
  return {
    id: job.id,
    kind: job.kind === "product_import" ? "product_import" : "product_export",
    status: job.status,
    rows_total: job.rowsTotal,
    rows_done: job.rowsDone,
    counts: job.counts,
    problem: job.problem,
    files: job.files.length,
    created_at: job.createdAt,
    finished_at: job.finishedAt,
    expires_at: job.expiresAt,
  };
}

async function productJob(caller: ApiCaller, id: string): Promise<DataJob> {
  const job = await jobFor(caller.member, id);
  if (!job || !(PRODUCT_JOBS as readonly string[]).includes(job.kind)) return fail("not_found", "No such job of the product file in this store.");
  return job;
}

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

export async function answerContent(caller: ApiCaller, route: ContentRoute, request: Request): Promise<ApiAnswer> {
  const store = caller.member.store;
  const storeId = store.id;
  const account = caller.member.account;
  const params = new URL(request.url).searchParams;
  // What a route's page is: an article under /articles; a page, header or footer under /pages, as its row says (D917).
  const typeOf = async (name: string, id: string): Promise<ApiPageType> => (name.startsWith("articles.") ? "article" : siteTypeOf(storeId, id));
  switch (route.name) {
    case "pages.list":
    case "articles.list": {
      const since = params.get("updated_after");
      if (since) sinceWhere(params, sql`now()`);
      const asked = params.get("type");
      const type: ApiPageType = route.name === "articles.list" ? "article" : asked === "header" || asked === "footer" ? asked : "page";
      const pages = await listPages(storeId, type, { since: since ? new Date(since).toISOString() : undefined });
      return ok(route.name, { data: pages.map((p) => ({ id: p.id, type, title: p.title, slug: p.slug, state: p.state, published_at: p.publishedAt, updated_at: p.updatedAt })) });
    }
    case "pages.get":
    case "articles.get":
      return ok(route.name, { data: await pageById(caller, route.id, await typeOf(route.name, route.id)) });
    case "pages.create":
    case "articles.create": {
      const input =
        route.name === "pages.create"
          ? { ...(await readBody("pages.create", request)), first_published_at: undefined }
          : { ...(await readBody("articles.create", request)), type: "article" as const };
      const type: ApiPageType = input.type ?? "page";
      const date = input.first_published_at;
      if (date !== undefined) await dateRefusal(caller, null, date);
      const saved = await savePage(account, storeId, null, draftOf(input.draft), { publish: false, type });
      if (!saved.ok) return pageRefusal(saved);
      if (date !== undefined) await dateArticle(storeId, saved.id, date, false);
      await record(caller, `${type}_created`, {}, { type, id: saved.id });
      return ok(route.name, { data: await pageById(caller, saved.id, type) }, 201);
    }
    case "pages.import": {
      // A Figma frame the Kaizena Flow plugin read (D898 F2): built by the page copy engine as a draft.
      const input = await readBody("pages.import", request);
      const { importFigmaPage } = await import("./figma-import");
      const made = await importFigmaPage({ account, storeId }, input);
      if (!made.ok) return fail("invalid", made.problem);
      await record(caller, "page_created", { source: "figma" }, { type: "page", id: made.id });
      return ok(route.name, { data: { id: made.id, title: made.title, edit_url: `${siteUrl()}/admin/${store.slug}/pages/${made.id}`, summary: made.summary, notes: made.notes } }, 201);
    }
    case "themes.list": {
      const { listInstalls } = await import("./theme-installs");
      const installs = await listInstalls(storeId);
      return ok(route.name, {
        data: installs.map((i) => ({ id: i.id, title: i.title, live: i.live, from_theme: i.presetId !== null, version: i.version, installed_at: i.installedAt })),
      });
    }
    case "themes.get": {
      const [{ installLook }, { lookForApi }] = await Promise.all([import("./theme-installs"), import("./theme-look-api")]);
      const install = await installLook(storeId, route.id);
      return ok(route.name, { data: install ? lookForApi(install) : fail("not_found", "No such theme in this store's theme library.") });
    }
    case "themes.import": {
      // A Figma file's colours and text styles the Kaizena Flow plugin read (D898 F3): a look in the theme library, never live.
      const input = await readBody("themes.import", request);
      const { importFigmaLook } = await import("./figma-look");
      const made = await importFigmaLook({ account, storeId }, input);
      if (!made.ok) return fail("invalid", made.problem);
      await record(caller, made.created ? "theme_created" : "theme_updated", { source: "figma" }, { type: "theme_install", id: made.id });
      const try_url = `${siteUrl()}/admin/${store.slug}/settings/design/themes/${made.id}`;
      return ok(route.name, { data: { id: made.id, title: made.title, created: made.created, try_url, summary: made.summary, notes: made.notes } }, 201);
    }
    case "themes.create": {
      // A look of the store's own from theme settings (D917): never live; its header, footer and CSS as given, else the live look's.
      const input = await readBody("themes.create", request);
      const { addOwnLook } = await import("./theme-installs");
      const made = await addOwnLook(storeId, account.id, input.title, input.theme, { css: input.css, headerId: input.header, footerId: input.footer });
      if (!made.ok) return lookRefusal(made.problems);
      await record(caller, "theme_created", { source: "settings" }, { type: "theme_install", id: made.id });
      return ok(route.name, { data: await lookById(storeId, made.id) }, 201);
    }
    case "themes.update": {
      const input = await readBody("themes.update", request);
      await lookById(storeId, route.id);
      const { saveInstallLook } = await import("./theme-installs");
      const saved = await saveInstallLook(storeId, route.id, account.id, { title: input.title, theme: input.theme, css: input.css, headerId: input.header, footerId: input.footer });
      if (!saved.ok) return lookRefusal(saved.problems);
      await record(caller, "theme_updated", { source: "settings" }, { type: "theme_install", id: route.id });
      return ok(route.name, { data: await lookById(storeId, route.id) });
    }
    case "themes.live": {
      // Design settings' own switch (D241): the live look put away as it is, this one's settings, CSS, header and footer the store's.
      await lookById(storeId, route.id);
      const [{ switchToInstall }, { designTags }, { refreshTag }] = await Promise.all([import("./theme-installs"), import("./design-presets"), import("./refresh")]);
      const done = await switchToInstall(storeId, route.id, account.id);
      if (!done.ok) return fail(done.problems.some((p) => p.startsWith("That theme is not installed")) ? "not_found" : "conflict", done.problems.join(" "));
      for (const tag of designTags(store)) refreshTag(tag);
      await record(caller, "theme_switched", {}, { type: "theme_install", id: route.id });
      return ok(route.name, { data: { id: route.id, title: done.title, put_away: done.from, notes: [...done.notes, ...(await liveLookNotes(storeId))] } });
    }
    case "menus.create": {
      // The menu editor's own save (D85): links checked, texts kept for the store's languages.
      const input = await readBody("menus.create", request);
      const saved = await saveStoreMenu(caller.member, null, input);
      if (!saved.ok) return menuRefusal(saved.problems);
      await record(caller, "menu_created", {}, { type: "menu", id: saved.id });
      return ok(route.name, { data: await menuById(storeId, saved.id) }, 201);
    }
    case "menus.update": {
      const input = await readBody("menus.update", request);
      await menuById(storeId, route.id);
      // A menu is not drafted: one visitors see changes for them at once (D917).
      if (!holds(caller, "content:publish") && (await menuOnSite(storeId, route.id))) {
        return fail("gated", "Visitors see this menu, and a change shows there at once: that takes a token with content:publish.");
      }
      const saved = await saveStoreMenu(caller.member, route.id, input);
      if (!saved.ok) return menuRefusal(saved.problems);
      const [{ refreshTag }, { storeTag }] = await Promise.all([import("./refresh"), import("@/lib/cache-tags")]);
      refreshTag(storeTag(store.slug));
      await record(caller, "menu_updated", {}, { type: "menu", id: route.id });
      return ok(route.name, { data: await menuById(storeId, route.id) });
    }
    case "pages.update":
    case "articles.update": {
      const type = await typeOf(route.name, route.id);
      await pageById(caller, route.id, type);
      const input = route.name === "pages.update" ? { ...(await readBody("pages.update", request)), first_published_at: undefined } : await readBody("articles.update", request);
      const own = draftOf(input.draft);
      await moveRefusal(caller, route.id, type, own);
      const date = input.first_published_at;
      // The date's refusals (in the future, gated on a live article) come before anything is saved.
      const live = date === undefined ? false : await dateRefusal(caller, route.id, date);
      // The draft only: what the site shows stays as published until it is published again.
      const saved = await savePage(account, storeId, route.id, own, { publish: false, type });
      if (!saved.ok) return pageRefusal(saved);
      if (date !== undefined) await dateArticle(storeId, route.id, date, live);
      await record(caller, `${type}_draft_saved`, {}, { type, id: route.id });
      return ok(route.name, { data: await pageById(caller, route.id, type) });
    }
    case "pages.publish":
    case "articles.publish": {
      const type = await typeOf(route.name, route.id);
      const page = await pageById(caller, route.id, type);
      const input = route.name === "pages.publish" ? await readBody("pages.publish", request) : await readBody("articles.publish", request);
      const saved = await savePage(account, storeId, route.id, page.draft, { publish: true, type, acknowledgedIssues: input.acknowledged_issues });
      if (!saved.ok) return pageRefusal(saved);
      await refreshPublished(storeId, route.id, saved.scope);
      await record(caller, `${type}_published`, {}, { type, id: route.id });
      return ok(route.name, { data: await pageById(caller, route.id, type) });
    }
    case "content.types": {
      const types = await listContentTypes(storeId);
      return ok(route.name, {
        data: types.map((t) => ({ id: t.id, key: t.key, name: t.name, slug: t.slug, fields: t.fields as unknown[], has_pages: t.hasPages, entries: t.entries ?? 0 })),
      });
    }
    case "content.entries": {
      if (!(await getContentType(storeId, route.id))) return fail("not_found", "No such content type in this store.");
      const since = params.get("updated_after");
      if (since) sinceWhere(params, sql`now()`);
      const entries = (await listEntries(storeId, route.id)).filter((e) => !since || e.updatedAt > new Date(since).toISOString());
      return ok(route.name, { data: entries.map(entryOut) });
    }
    case "content.entry":
      return ok(route.name, { data: await entryById(storeId, route.id) });
    case "content.entry_create": {
      if (!(await getContentType(storeId, route.id))) return fail("not_found", "No such content type in this store.");
      const input = await readBody(route.name, request);
      const saved = await saveEntry(entryContext(caller), { typeId: route.id, slug: input.slug, fields: input.fields, ...(input.seo && { seo: input.seo }) });
      if (!saved.ok || !saved.id) return fail(saved.ok ? "failed" : /taken/i.test(saved.problems.join(" ")) ? "conflict" : "invalid", saved.ok ? "The entry was saved but could not be read back." : saved.problems.join(" "));
      await record(caller, "entry_created", {}, { type: "content_entry", id: saved.id });
      return ok(route.name, { data: await entryById(storeId, saved.id) }, 201);
    }
    case "content.entry_update": {
      const entry = (await getEntry(storeId, route.id)) ?? fail("not_found", "No such entry in this store.");
      const input = await readBody(route.name, request);
      // An entry's address is not part of its draft: a published entry's moves on the site at once (D440).
      if (input.slug !== undefined && input.slug !== entry.slug && entry.publishedAt !== null && !holds(caller, "content:publish")) {
        return fail("gated", "The entry is on the site, and its address changes there at once: that takes a token with content:publish.");
      }
      const saved = await saveEntry(entryContext(caller), {
        id: entry.id,
        typeId: entry.typeId,
        slug: input.slug ?? entry.slug,
        fields: input.fields ?? {},
        seo: input.seo ?? entry.draft.seo,
        seoTranslations: entry.draft.seoTranslations,
      });
      if (!saved.ok) return fail("invalid", saved.problems.join(" "));
      await record(caller, "entry_draft_saved", {}, { type: "content_entry", id: entry.id });
      return ok(route.name, { data: await entryById(storeId, entry.id) });
    }
    case "content.entry_publish": {
      await entryById(storeId, route.id);
      await readBody(route.name, request);
      const published = await publishEntry(entryContext(caller), route.id);
      if (!published.ok) return fail("invalid", published.problems.join(" "));
      await record(caller, "entry_published", {}, { type: "content_entry", id: route.id });
      return ok(route.name, { data: await entryById(storeId, route.id) });
    }
    case "menus.list":
    case "menus.get": {
      const changed = params.get("updated_after")
        ? new Set((await typedRows(z.object({ id: col.uuid }), sql`select id from commerce.menus where store_id = ${storeId}::uuid and ${sinceWhere(params, sql`updated_at`)}`)).map((r) => r.id))
        : null;
      const menus = (await listStoreMenus(storeId)).map((m) => ({ id: m.id, name: m.name, items: m.items as unknown[] }));
      if (route.name === "menus.get") return ok(route.name, { data: menus.find((m) => m.id === route.id) ?? fail("not_found", "No such menu in this store.") });
      return ok(route.name, { data: menus.filter((m) => !changed || changed.has(m.id)) });
    }
    case "settings.get": {
      const [[own], rates, methods, tax, display] = await Promise.all([
        typedRows(z.object({ country: col.textOrNull }), sql`select country from commerce.stores where id = ${storeId}::uuid`),
        typedRows(
          z.object({ market: col.text, currency: col.currency, amount_minor: col.minor, free_over_minor: col.minor.nullable() }),
          sql`select market_code as market, currency, amount_minor, free_over_minor from commerce.shipping_rates where store_id = ${storeId}::uuid order by market_code`,
        ),
        typedRows(
          z.object({ id: col.uuid, market: col.text, currency: col.currency, name: col.text, min: col.int.nullable(), max: col.int.nullable(), free_over_minor: col.minor.nullable(), active: col.bool }),
          sql`
            select id, market_code as market, currency, name, estimate_min_days as min, estimate_max_days as max, free_over_minor, active
            from commerce.shipping_methods where store_id = ${storeId}::uuid order by market_code, position, id
          `,
        ),
        typedRows(
          z.object({ vat_registered: col.bool, vat_number: col.textOrNull, dispatch_country: col.textOrNull, oss: col.bool, ioss: col.bool }),
          sql`
            select vat_registered, vat_number, dispatch_country, oss_scheme is not null as oss, ioss_number is not null as ioss
            from commerce.store_tax_profile where store_id = ${storeId}::uuid
          `,
        ),
        readPriceDisplay(storeId),
      ]);
      return ok(route.name, {
        data: {
          name: store.name,
          slug: store.slug,
          country: own?.country ?? null,
          time_zone: store.timeZone,
          audience: store.audience,
          languages: store.localization.locales,
          currencies: store.localization.currencies.map((c) => ({ currency: c.currency, rate: c.rate })),
          markets: store.markets.map((m) => ({ code: m.code, currency: m.currency, own_currency: m.nativeCurrency, locale: m.locale, name: m.name })),
          shipping: { rates, methods: methods.map(({ min, max, ...m }) => ({ ...m, estimate_days: { min, max } })) },
          tax: tax[0] ?? { vat_registered: false, vat_number: null, dispatch_country: null, oss: false, ioss: false },
          price_display: {
            decimals: display.decimals,
            quantity_chooser: display.quantityPicker,
            words: Object.fromEntries(store.localization.locales.map((locale) => [locale, { before: display.words[locale]?.prefix ?? "", after: display.words[locale]?.suffix ?? "" }])),
          },
        },
      });
    }
    case "reports.list": {
      const since = params.get("updated_after");
      if (since) sinceWhere(params, sql`now()`);
      const reports = (await listSavedReports(storeId)).filter((r) => !since || r.updatedAt > new Date(since).toISOString());
      return ok(route.name, { data: reports.map((r) => ({ id: r.id, title: r.title, runs: r.spec !== null && r.problems.length === 0, updated_at: r.updatedAt })) });
    }
    case "reports.run": {
      const saved = (await getSavedReport(storeId, route.id)) ?? fail("not_found", "No such saved report in this store.");
      if (!saved.spec || saved.problems.length > 0) return fail("conflict", "The report cannot run as saved: open it in the report builder.");
      const outcome = await runReport(store, saved.spec);
      if (!outcome.ok) return fail("conflict", "The report cannot run as saved: open it in the report builder.");
      const r = outcome.report;
      return ok(route.name, {
        data: {
          report_id: saved.id,
          title: saved.title,
          currency: r.currency,
          columns: r.columns.map((c) => ({ metric: c.metric, adds_up: c.addsUp })),
          rows: r.rows.map((row) => ({ keys: row.keys, values: row.values as Record<string, number | null>, previous: (row.previous as Record<string, number | null> | null) ?? null, rest: row.rest })),
          totals: { values: r.totals.values as Record<string, number | null>, previous: (r.totals.previous as Record<string, number | null> | null) ?? null },
          hidden_rows: r.hiddenRows,
          period: r.period,
        },
      });
    }
    case "experiments.list": {
      const tests = await listedTests(store, { words: EXPERIMENTS_WORDS.en, numberLocale: "en-GB" });
      return ok(route.name, { data: tests.map((t) => experimentOut(t, t.card)) });
    }
    case "experiments.get": {
      const test = (await getExperiment(storeId, route.id)) ?? fail("not_found", "No such A/B test in this store.");
      const now = new Date();
      const results = test.status === "running" || test.status === "stopped" ? await experimentResults(store, test, now) : null;
      const card = experimentCard({ status: test.status, goal: test.goal, minDays: test.minDays, minVisitors: test.minVisitors, results, now, timeZone: store.timeZone });
      return ok(route.name, { data: experimentOut(test, card) });
    }
    case "webhooks.list": {
      const endpoints = await listEndpoints(storeId);
      return ok(route.name, { data: await Promise.all(endpoints.map((e) => endpointById(storeId, e.id))) });
    }
    case "webhooks.create": {
      const input = await readBody(route.name, request);
      const made = await addEndpoint(caller.member, { name: input.name, url: input.url, topics: input.topics });
      if (!made.ok) return endpointRefusal(made.problem, made.detail);
      await record(caller, "endpoint_added", { topics: input.topics.length }, { type: "webhook_endpoint", id: made.id });
      const endpoint = await endpointById(storeId, made.id);
      // The signing secret is answered this once; a replay of the request, and what is kept for it, has none.
      return { ...ok(route.name, { data: { ...endpoint, secret: made.secret ?? null } }, 201), replay: { data: { ...endpoint, secret: null } } };
    }
    case "webhooks.update": {
      const before = await endpointById(storeId, route.id);
      const input = await readBody(route.name, request);
      if (input.name !== undefined || input.url !== undefined || input.topics !== undefined) {
        const saved = await updateEndpoint(caller.member, route.id, { name: input.name ?? before.name, ...(input.url !== undefined && { url: input.url }), topics: input.topics ?? before.topics });
        if (!saved.ok) return endpointRefusal(saved.problem, saved.detail);
      }
      if (input.enabled !== undefined && input.enabled !== before.enabled && !(await switchEndpoint(caller.member, route.id, input.enabled))) return fail("not_found", "No such endpoint in this store.");
      await record(caller, "endpoint_changed", {}, { type: "webhook_endpoint", id: route.id });
      return ok(route.name, { data: await endpointById(storeId, route.id) });
    }
    case "webhooks.delete": {
      await endpointById(storeId, route.id);
      if (!(await removeEndpoint(caller.member, route.id))) return fail("not_found", "No such endpoint in this store.");
      await record(caller, "endpoint_removed", {}, { type: "webhook_endpoint", id: route.id });
      return ok(route.name, { data: { id: route.id, deleted: true } });
    }
    case "webhooks.deliveries": {
      await endpointById(storeId, route.id);
      // The contract's own paging: 50 unless asked, at most 100.
      const limit = Math.min(Math.max(Number(params.get("limit")) || PAGE_DEFAULT, 1), PAGE_MAX);
      const rows = await listEndpointDeliveries(storeId, route.id, limit);
      return ok(route.name, {
        data: rows.map((d) => ({ id: d.id, topic: d.event, status: d.status, attempts: d.attempts, last_status: d.lastStatus, last_error: d.lastError, created_at: d.createdAt, next_attempt_at: d.nextAttemptAt })),
      });
    }
    case "webhooks.resend": {
      await endpointById(storeId, route.id);
      await readBody(route.name, request);
      const [delivery] = await typedRows(
        z.object({ id: col.uuid }),
        sql`select id from commerce.integration_deliveries where store_id = ${storeId}::uuid and endpoint_id = ${route.id}::uuid and id = ${route.delivery_id}::uuid`,
      );
      if (!delivery) return fail("not_found", "No such delivery of this endpoint.");
      const sent = await resendDelivery(caller.member, route.delivery_id);
      if (sent === "gone") return fail("conflict", "That delivery is still being sent: wait for it to end.");
      if (sent === "off") return fail("conflict", "The endpoint is switched off: switch it on first.");
      if (sent === "erased") return fail("conflict", "The person this delivery was about was erased: it is not sent again.");
      await record(caller, "delivery_resent", {}, { type: "webhook_endpoint", id: route.id });
      return ok(route.name, { data: { queued: true } });
    }
    case "jobs.product_export": {
      const { options } = await readBody(route.name, request);
      const made = await requestProductExport(caller.member, options, jobDeps());
      if (!made.ok) return fail(made.code === "too_many" ? "conflict" : made.code === "forbidden" ? "forbidden" : "invalid", made.problem);
      await record(caller, "product_export_started", { direct: made.mode === "file" });
      if (made.mode === "file") return ok(route.name, { data: { job: null, file: { name: made.filename, content_type: "text/csv", csv: made.csv, rows: made.rows } } }, 201);
      return ok(route.name, { data: { job: jobOut(await productJob(caller, made.jobId)), file: null } }, 201);
    }
    case "jobs.product_import": {
      const { file_name } = await readBody(route.name, request);
      const started = await startImportUpload(caller.member, file_name, jobDeps());
      if (!started.ok) return fail(/not set up/i.test(started.problem) ? "failed" : "invalid", started.problem);
      const uploadId = started.path.split("/")[1];
      await record(caller, "product_import_started", {});
      const data = { upload_id: uploadId, upload_url: uploadUrl(started.path, { token: started.token }), method: "PUT" as const, headers: { "Content-Type": "text/csv" } };
      // The address carries a token that can still be used: answered this once, never kept for a replay (D440 review).
      return { ...ok(route.name, { data }, 201), replay: { data: { ...data, upload_url: null } } };
    }
    case "jobs.product_import_check": {
      const input = await readBody(route.name, request);
      // The upload's own address in the store's folder: the id and name it was started with, never a path a caller names.
      const registered = await registerImport(caller.member, { path: `${storeId}/${route.id}/${safeName(input.file_name)}`, name: input.file_name }, jobDeps());
      if (!registered.ok) return fail("invalid", registered.problems.join(" "));
      // Without `products:publish`, the check is of drafts only (D440): what would reach the shop is counted and refused, there and in the apply.
      const options = holds(caller, "products:publish") ? input.options : { ...input.options, draftsOnly: true };
      const checked = await startImportCheck(caller.member, registered.jobId, options, jobDeps());
      if (!checked.ok) return fail("conflict", checked.problem);
      await record(caller, "product_import_checked", {}, { type: "data_job", id: registered.jobId });
      return ok(route.name, { data: jobOut(await productJob(caller, registered.jobId)) }, 201);
    }
    case "jobs.apply": {
      const job = await productJob(caller, route.id);
      await jsonBody(request);
      if (job.kind !== "product_import") return fail("conflict", "Only a checked import is applied.");
      // What shoppers see takes `products:publish` (D440), as /publish, /archive and a change of a live product do. Without it, the apply
      // is of an import checked as drafts only (its options are fixed then), and the check counted no product the file would publish,
      // archive, bring back or change on the site; one that went on the site since is refused as the apply plans it again.
      if (!holds(caller, "products:publish")) {
        const onShop = dryCountsOf(job).onShop;
        const draftsOnly = parseImportOptions(job.options).draftsOnly;
        if (onShop > 0 && draftsOnly) {
          // Checked by a token like this one: nothing of it can be applied as it is, so it is closed and the next file can be imported.
          await cancelJob(caller.member, job.id, jobDeps());
          return fail(
            "gated",
            `${onShop === 1 ? "1 product" : `${onShop} products`} in the file would be published, archived, brought back or changed on the site: that takes a token with products:publish. The import is cancelled: leave those products out of the file and import it again, or import it in the admin.`,
          );
        }
        if (!draftsOnly) {
          return fail("gated", "This import was checked to change what shoppers see, which takes a token with products:publish. Check it again with this token to import drafts only.");
        }
      }
      const applied = await startImportApply(caller.member, route.id, jobDeps());
      if (!applied.ok) return fail("conflict", applied.problem);
      await record(caller, "product_import_applied", {}, { type: "data_job", id: route.id });
      return ok(route.name, { data: jobOut(await productJob(caller, route.id)) });
    }
    case "jobs.get":
      return ok(route.name, { data: jobOut(await productJob(caller, route.id)) });
    case "jobs.download": {
      const job = await productJob(caller, route.id);
      if (job.kind === "product_import") {
        const problems = await importProblemsCsv(caller.member, route.id);
        return ok(route.name, { data: { parts: [], problems_csv: problems.ok ? problems.csv : null } });
      }
      if (job.status !== "done") return fail("conflict", "The export is not ready yet: poll the job.");
      const parts = [];
      for (const [i, file] of job.files.entries()) {
        const link = await downloadPart(caller.member, route.id, i, jobDeps());
        if (!link.ok) return fail("conflict", link.problem);
        parts.push({ name: file.name, url: link.url });
      }
      return ok(route.name, { data: { parts, problems_csv: null } });
    }
  }
}
