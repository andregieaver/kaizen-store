import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { blockingIssues, pageIssues, themeSetsOf } from "@/lib/page-a11y";
import { planSection, type PagePlan, type PictureJob, type StudioMessage } from "@/lib/page-ai";
import { PAGE_JOB_DAYS, PAGE_JOB_TRIES, type PageJobKind } from "@/lib/page-jobs";
import type { PageContent, PageRow, PageType } from "@/lib/page-content";
import { isLegalRole } from "@/lib/legal-roles";
import { menuInput, parseBusinessDetails, parseNavigation, platformMenuInput, type AnyMenuEntry, type AnyMenuLink, type BusinessDetails, type StoreNavigation } from "@/lib/navigation";
import { isSpecialRole, type SpecialRole } from "@/lib/platform-roles";
import { storeDomain } from "@/lib/paths";
import { can, type PermissionHolder } from "@/lib/permissions";
import {
  applyPageEdits,
  briefClaims,
  briefOf,
  dryRunEdits,
  ownerWordsOf,
  headerFooterSummary,
  menuClaims,
  menuSummary,
  otherStoreAddress,
  pageOutline,
  PLATFORM_PLACES,
  placeName,
  placeSummary,
  platformPlaceName,
  publishSummary,
  saveMenuInput,
  savePlatformMenuInput,
  setHeaderFooterInput,
  setPagePlaceInput,
  setPlatformPlaceInput,
  toMenuEntries,
  type BuildPageArgs,
  type PageChange,
  type SaveMenuArgs,
  type SavePlatformMenuArgs,
  type SetHeaderFooterArgs,
  type StorePlace,
} from "@/lib/site-tools";

import { activeAccount, passMembership, type Account, type Membership } from "./auth";
import { runningTestOf } from "./experiment-admin";
import { OwnerToolError } from "./owner-tool-error";
import { buildDraft, fillPicture, planPage, sectionForPage, siteFacts, studioAbilities, type StudioOwner } from "./page-ai";
import { libraryFilesByUrl } from "./media-library";
import { listPlatformMenus, listStoreMenus, menuUses, savePlatformMenu, saveStoreMenu } from "./menus";
import { saveNavigation } from "./navigation";
import { getPageForEdit, pagesTag, savePage, setFrontPage, setPageRole, setProductsPage } from "./pages";
import { memberCan } from "./permissions";
import { PLATFORM_NAVIGATION_TAG, getPlatformTheme, savePlatformNavigation } from "./platform-navigation";
import { setPlatformPageRole } from "./platform-roles";
import { storeTag, type Store } from "./stores";
import { aiFor } from "./ai";

type Row = Record<string, unknown>;

/**
 * The AI manager's website tools for pages (D308, `docs/ai-autopilot.md` 4): read a page, build one from a brief, change one, publish
 * one, for a store's owner (`store`) or Kaizena Flow's admin on its own site (`store: null`, D308 A2c). Every page is saved by
 * `savePage()`, the builder's own save, as a draft unless published: its checks, its version (D305) and its activity entry. A build and
 * every picture run after the answer, one at a time, in `commerce.page_ai_jobs` (`runPageJobs()`, the every-minute job and `after()` the
 * call), in the name of who asked, who must still be allowed to change the site.
 */

export type SiteToolContext = { account: Account; store: Store | null; invalidate: (tag: string) => void; holder?: PermissionHolder };

export type SiteToolDeps = {
  /** Runs the background work after the answer (`after()`); tests run it themselves. */
  schedule?: (run: () => Promise<unknown>) => void;
  /** The page studio's steps, replaced in tests. */
  section?: typeof sectionForPage;
  plan?: typeof planPage;
  build?: typeof buildDraft;
  fill?: typeof fillPicture;
};

/** At most this many pages are waiting to be built for one site at a time. */
export const BUILDS_WAITING_MAX = 3;
/** At most this many new sections are written in one change, each one call to the site's AI. */
export const SECTIONS_PER_EDIT = 3;
/** How long a run holds a job: a build plans and writes (up to a few minutes), a picture takes the picture model up to 150 s. */
const HOLD: Record<PageJobKind, string> = { build: "8 minutes", picture: "4 minutes" };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const ownerOf = (ctx: Pick<SiteToolContext, "store">) => ctx.store?.id ?? null;
const adminBase = (ctx: Pick<SiteToolContext, "store">) => (ctx.store ? `/admin/${ctx.store.slug}` : "/admin/platform");
const editorLink = (ctx: SiteToolContext, type: PageType, id: string) => `${adminBase(ctx)}/${type === "article" ? "articles" : "pages"}/${id}`;
const studioOwner = (ctx: SiteToolContext): StudioOwner => ({ storeId: ownerOf(ctx), storeSlug: ctx.store?.slug ?? null, account: ctx.account });

/** A store's pages are built and pictured in the background only while it is open for real: not a store template, not closed (D171, D175). */
function backgroundRefusal(ctx: SiteToolContext): string | null {
  if (!ctx.store) return null;
  if (ctx.store.status !== "active") return "The store is not open, so the AI manager does no work for it in the background.";
  if (ctx.store.starter) return "A demo store's pages are built from Pages, Create with AI: the AI manager's background work is for stores open for business.";
  return null;
}

/** Runs work after the answer where there is one (`after()`); elsewhere the every-minute job takes it up. */
function schedule(deps: SiteToolDeps, run: () => Promise<unknown>): void {
  if (deps.schedule) return deps.schedule(run);
  void import("next/server")
    .then(({ after }) => {
      try {
        after(run);
      } catch {
        // Not in a request: the every-minute job takes the work up.
      }
    })
    .catch(() => undefined);
}

/** A page of the site by its id or address; the site's own only. */
async function findPage(ctx: SiteToolContext, ref: string, type: PageType): Promise<string> {
  const owner = ownerOf(ctx);
  const byId = /^[0-9a-f-]{36}$/i.test(ref);
  const [row] = await db().execute<Row>(sql`
    select id from commerce.pages
    where store_id is not distinct from ${owner}::uuid and type = ${type}
      and ${byId ? sql`id = ${ref}::uuid` : sql`slug = ${ref.replace(/^\/+|\/+$/g, "")}`}
  `);
  return row ? String(row.id) : fail(`No ${type === "article" ? "article" : "page"} "${ref}" on this site. Use list_pages to find it.`);
}

async function themeSets(ctx: SiteToolContext) {
  return themeSetsOf((ctx.store ? ctx.store.theme : await getPlatformTheme()).settings);
}

/** How the pictures of a page are coming along: made, waiting, and given up (the page changed, or the picture model failed). */
async function pictureCounts(pageId: string): Promise<{ made: number; waiting: number; not_made: number }> {
  const [row] = await db().execute<Row>(sql`
    select count(*) filter (where status = 'done')::int as made, count(*) filter (where status = 'waiting')::int as waiting,
      count(*) filter (where status in ('gone', 'failed'))::int as not_made
    from commerce.page_ai_jobs where kind = 'picture' and page_id = ${pageId}::uuid
  `);
  return { made: Number(row?.made ?? 0), waiting: Number(row?.waiting ?? 0), not_made: Number(row?.not_made ?? 0) };
}

// Reading ---------------------------------------------------------------------------------

/**
 * `get_page`: the page's draft as the model reads it (its texts by key, its rows by id and number), whether it is live, what publishing
 * it would still ask (the accessibility checker's blocking issues) and its pictures still being made.
 */
export async function getPageTool(ctx: SiteToolContext, { page: ref, type }: { page: string; type: PageType }) {
  const id = await findPage(ctx, ref, type);
  const page = await getPageForEdit(ownerOf(ctx), id, type);
  if (!page) return fail("That page is gone.");
  const outline = pageOutline(page.draft);
  const blocking = blockingIssues(pageIssues(page.draft, { theme: { sets: await themeSets(ctx) } }));
  const test = ctx.store && type !== "article" ? await runningTestOf(ctx.store.id, id) : null;
  return {
    id,
    title: page.draft.title,
    address: page.slug,
    state: { draft: "a draft, not on the site", published: "on the site, as the draft is", changed: "on the site, with changes in its draft not yet published" }[page.state],
    editor: editorLink(ctx, type, id),
    ...outline,
    pictures: await pictureCounts(id),
    before_publishing: blocking.length > 0 ? blocking.slice(0, 10).map((issue) => `${issue.where}: ${issue.message}`) : undefined,
    ab_test: test ? `In the running A/B test "${test.name}": its draft can change, but it is not published until the test stops.` : undefined,
  };
}

/** `list_page_builds`: the pages the AI manager was asked to build for this site, most recent first, and how far each is. */
export async function listPageBuildsTool(ctx: SiteToolContext, { limit }: { limit: number }) {
  const rows = await db().execute<Row>(sql`
    select j.id, j.status, j.problem, j.result, j.page_id, j.input ->> 'title' as title, j.created_at, p.type
    from commerce.page_ai_jobs j left join commerce.pages p on p.id = j.page_id
    where j.kind = 'build' and j.store_id is not distinct from ${ownerOf(ctx)}::uuid
    order by j.created_at desc limit ${limit}
  `);
  return {
    builds: await Promise.all(
      rows.map(async (row) => {
        const status = String(row.status);
        const result = (row.result ?? {}) as { notes?: string[] };
        const pageId = row.page_id ? String(row.page_id) : null;
        return {
          build: String(row.id),
          title: String(row.title ?? ""),
          asked: new Date(String(row.created_at)).toISOString(),
          state: status === "waiting" ? "being built" : status === "done" && pageId ? "built as a draft" : status === "done" ? "built, then deleted" : "not built",
          problem: row.problem ? String(row.problem) : undefined,
          page: pageId ?? undefined,
          editor: pageId ? editorLink(ctx, row.type === "article" ? "article" : "page", pageId) : undefined,
          notes: result.notes?.length ? result.notes : undefined,
          pictures: pageId ? await pictureCounts(pageId) : undefined,
        };
      }),
    ),
  };
}

// Building --------------------------------------------------------------------------------

/**
 * `build_page`: a page from a brief, built after the answer by the page studio (D92) as it builds one for the owner: planned, each
 * section written and checked by the claims filter, saved as a new draft, never published; its pictures follow one at a time. Refused at
 * once when the site's AI has no text model, the brief makes a claim, or enough pages are already being built.
 */
export async function buildPageTool(ctx: SiteToolContext, args: BuildPageArgs, deps: SiteToolDeps = {}) {
  const refusal = backgroundRefusal(ctx);
  if (refusal) return fail(refusal);
  if (!(await studioAbilities(ownerOf(ctx))).text) return fail("Set up an AI text model under AI settings to build pages with AI.");
  const claims = briefClaims(args);
  if (claims.length > 0) return fail(`Rewrite the brief without claims the site cannot back: ${claims.join(", ")}.`);
  const [waiting] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.page_ai_jobs
    where kind = 'build' and status = 'waiting' and store_id is not distinct from ${ownerOf(ctx)}::uuid
  `);
  if (Number(waiting?.n ?? 0) >= BUILDS_WAITING_MAX) {
    return fail(`${BUILDS_WAITING_MAX} pages are being built already. Ask again when one is done: list_page_builds says how far they are.`);
  }
  const [job] = await db().execute<Row>(sql`
    insert into commerce.page_ai_jobs (store_id, kind, asked_by, input)
    values (${ownerOf(ctx)}::uuid, 'build', ${ctx.account.id}::uuid, ${JSON.stringify(args)}::jsonb)
    returning id
  `);
  schedule(deps, () => runPageJobs(Date.now() + 60_000, deps));
  return {
    building: String(job.id),
    title: args.title,
    done: `"${args.title}" is being built as a draft, in a minute or two${args.pictures ? ", and its pictures follow one at a time" : ""}. Nothing is on the site until it is published. list_page_builds says how far it is; get_page reads it once built.`,
  };
}

// Changing --------------------------------------------------------------------------------

/**
 * `edit_page`: changes to a page's draft, made in order and saved together by `savePage()` as a draft with a version kept (D305): a text
 * by its key, words replaced everywhere, a section added from the page studio's designs (written by the studio's writer, its pictures made
 * after), a row removed or moved. What could not be made is refused before anything is written; a live page stays as it is on the site
 * until it is published.
 */
export async function editPageTool(ctx: SiteToolContext, { page: ref, type, changes }: { page: string; type: PageType; changes: PageChange[] }, deps: SiteToolDeps = {}) {
  const id = await findPage(ctx, ref, type);
  const page = await getPageForEdit(ownerOf(ctx), id, type);
  if (!page) return fail("That page is gone.");
  const adding = changes.filter((change) => change.do === "add_section");
  if (adding.length > SECTIONS_PER_EDIT) return fail(`Add at most ${SECTIONS_PER_EDIT} sections in one change.`);
  const dry = dryRunEdits(page.draft, changes);
  if (!dry.ok) return fail(dry.problem);

  const owner = studioOwner(ctx);
  const facts = adding.length > 0 ? await siteFacts(owner, await aiFor(owner.storeId)) : null;
  const hrefs = new Set((facts?.links ?? []).map((link) => link.href));
  const allowLink = (href: string) => hrefs.has(href);
  const pictures: PictureJob[] = [];
  const notes: string[] = [];
  const done: string[] = [];
  let content = page.draft;
  for (const change of changes) {
    let rows: PageRow[][] = [];
    if (change.do === "add_section") {
      const wanted = planSection.parse({
        pattern: change.pattern,
        variant: change.variant,
        name: change.name,
        brief: change.brief,
        picture: change.picture,
        pictures: change.pictures,
        links: change.links,
        category: change.category,
      });
      const at = change.at === undefined ? content.rows.length : Math.min(change.at - 1, content.rows.length);
      const built = await (deps.section ?? sectionForPage)(owner, content, wanted, [change.brief, ...change.facts].join("\n"), at);
      if (!built.ok) return fail(`"${change.name}" could not be added: ${built.problem} Nothing was changed.`);
      rows = [built.rows];
      pictures.push(...built.pictures);
      notes.push(...built.notes);
    }
    const next = applyPageEdits(content, [change], { sections: rows, allowLink });
    if (!next.ok) return fail(`${next.problem} Nothing was changed.`);
    content = next.content;
    done.push(...next.done);
  }
  const saved = await savePage(ctx.account, ownerOf(ctx), id, content, { publish: false, type });
  if (!saved.ok) return fail(`The page could not be saved: ${saved.problems.join(" ")}`);
  const queued = backgroundRefusal(ctx) ? 0 : await queuePictures(ctx, id, pictures);
  if (queued > 0) schedule(deps, () => runPageJobs(Date.now() + 60_000, deps));
  return {
    done: [...done, page.state === "draft" ? "Saved as the draft." : "Saved as the page's draft: the site shows it as it was until it is published (publish_page)."].join(" "),
    editor: editorLink(ctx, type, id),
    notes: notes.length > 0 ? notes : undefined,
    pictures_coming: queued > 0 ? queued : undefined,
    pictures_not_made: pictures.length > queued ? "The pictures of the new sections are not made in the background for this store: add them in the builder." : undefined,
  };
}

async function queuePictures(ctx: SiteToolContext, pageId: string, jobs: readonly PictureJob[]): Promise<number> {
  for (const job of jobs) {
    await db().execute(sql`
      insert into commerce.page_ai_jobs (store_id, kind, page_id, asked_by, input)
      values (${ownerOf(ctx)}::uuid, 'picture', ${pageId}::uuid, ${ctx.account.id}::uuid, ${JSON.stringify(job)}::jsonb)
    `);
  }
  return jobs.length;
}

// Publishing ------------------------------------------------------------------------------

/** What a publish would refuse, checked before it is kept for the owner's yes (D308): a page that is gone, in a running test, or with blocking issues. */
export async function preflightPublishPage(ctx: SiteToolContext, { page: ref, type }: { page: string; type: PageType }): Promise<void> {
  const id = await findPage(ctx, ref, type);
  const page = await getPageForEdit(ownerOf(ctx), id, type);
  if (!page) return fail("That page is gone.");
  await refusePublish(ctx, id, type, page.draft);
}

async function refusePublish(ctx: SiteToolContext, id: string, type: PageType, draft: PageContent): Promise<void> {
  if (ctx.store && type !== "article") {
    const test = await runningTestOf(ctx.store.id, id);
    if (test) fail(`This page is in the running A/B test "${test.name}". Publishing a change now would spoil its results: stop the test first.`);
  }
  // Until the owner's autonomy level says otherwise (unit B), a page with a blocking issue is never published by the AI manager: the
  // builder is where a person decides to publish past one.
  const blocking = blockingIssues(pageIssues(draft, { theme: { sets: await themeSets(ctx) } }));
  if (blocking.length > 0) {
    fail(
      `The page has ${blocking.length === 1 ? "a problem" : `${blocking.length} problems`} to fix before it is published: ${blocking
        .slice(0, 6)
        .map((issue) => `${issue.where}: ${issue.message}`)
        .join(" ")} Fix ${blocking.length === 1 ? "it" : "them"} with edit_page, or the owner can publish anyway from the builder.`,
    );
  }
}

/** `publish_page` (gated `public`): the draft published as the builder's Publish does, never past a blocking issue. */
export async function publishPageTool(ctx: SiteToolContext, { page: ref, type }: { page: string; type: PageType }) {
  const id = await findPage(ctx, ref, type);
  const page = await getPageForEdit(ownerOf(ctx), id, type);
  if (!page) return fail("That page is gone.");
  await refusePublish(ctx, id, type, page.draft);
  const saved = await savePage(ctx.account, ownerOf(ctx), id, page.draft, { publish: true, type });
  if (!saved.ok) return fail(`The page could not be published: ${saved.problems.join(" ")}`);
  ctx.invalidate(pagesTag(ownerOf(ctx)));
  const waiting = (await pictureCounts(id)).waiting;
  return {
    done: `"${page.draft.title}" is published.${waiting > 0 ? ` ${waiting} of its pictures are still being made: they go into its draft, to publish again when they are in.` : ""}`,
    editor: editorLink(ctx, type, id),
  };
}

/** The publish approval in words from the page's own title. */
export async function publishApprovalWords(ctx: SiteToolContext, args: Record<string, unknown>): Promise<string> {
  const type = args.type === "article" ? "article" : "page";
  const ref = String(args.page ?? "");
  const byId = /^[0-9a-f-]{36}$/i.test(ref);
  const [row] = await db().execute<Row>(sql`
    select draft ->> 'title' as title from commerce.pages
    where store_id is not distinct from ${ownerOf(ctx)}::uuid and type = ${type} and ${byId ? sql`id = ${ref}::uuid` : sql`slug = ${ref}`}
  `);
  return publishSummary(type, row?.title ? String(row.title) : null, ref);
}

// The job ---------------------------------------------------------------------------------

type ClaimedJob = { id: string; storeId: string | null; kind: PageJobKind; pageId: string | null; askedBy: string; input: unknown; tries: number };

/**
 * Takes the oldest waiting job no run holds and holds it while it is done. A job that stopped before it was done `PAGE_JOB_TRIES` times
 * is given up first. A store's jobs wait while it is not open (`commerce.store_is_active()`).
 */
async function claimJob(): Promise<ClaimedJob | null> {
  await db().execute(sql`
    update commerce.page_ai_jobs set status = 'failed', problem = coalesce(problem, 'It stopped before it was done, three times.'), claimed_until = null, updated_at = now()
    where status = 'waiting' and tries >= ${PAGE_JOB_TRIES} and (claimed_until is null or claimed_until < now())
  `);
  const [row] = await db().execute<Row>(sql`
    update commerce.page_ai_jobs j
    set claimed_until = now() + case when j.kind = 'build' then ${HOLD.build}::interval else ${HOLD.picture}::interval end, tries = j.tries + 1
    where j.id = (
      select w.id from commerce.page_ai_jobs w
      where w.status = 'waiting' and w.tries < ${PAGE_JOB_TRIES} and (w.claimed_until is null or w.claimed_until < now())
        and (w.store_id is null or commerce.store_is_active(w.store_id))
      order by w.created_at, w.id
      limit 1
      for update skip locked
    )
    returning j.id, j.store_id, j.kind, j.page_id, j.asked_by, j.input, j.tries
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    storeId: row.store_id ? String(row.store_id) : null,
    kind: row.kind as PageJobKind,
    pageId: row.page_id ? String(row.page_id) : null,
    askedBy: String(row.asked_by),
    input: row.input,
    tries: Number(row.tries),
  };
}

/** Who a job is done for: the person who asked, while they may still change the site's pages; else why not. */
async function jobOwner(job: ClaimedJob): Promise<StudioOwner | string> {
  const account = await activeAccount(job.askedBy);
  if (!account) return "The person who asked can no longer sign in.";
  if (job.storeId === null) return account.platformAdmin ? { storeId: null, storeSlug: null, account } : "The person who asked is no longer one of Kaizena Flow's admins.";
  const [store] = await db().execute<Row>(sql`select slug from commerce.stores where id = ${job.storeId}::uuid`);
  const member = store ? await passMembership(String(store.slug), account.id) : null;
  if (!member || !memberCan(member, "website:write")) return "The person who asked may no longer change this store's website.";
  return { storeId: job.storeId, storeSlug: member.store.slug, account: member.account };
}

type Outcome = { status: "done"; pageId?: string; result?: unknown; pictures?: PictureJob[] } | { status: "gone" | "failed" | "retry"; problem: string };

async function doBuild(owner: StudioOwner, raw: unknown, deps: SiteToolDeps): Promise<Outcome> {
  const args = raw as BuildPageArgs;
  const brief = briefOf(args);
  const history: StudioMessage[] = [{ role: "user", content: ownerWordsOf(args) }];
  const planned = await (deps.plan ?? planPage)(owner, history, brief);
  if (!planned.ok) return { status: "retry", problem: planned.problem };
  // No pictures asked: the plan is built without them, as the studio builds a page for a site that cannot make them.
  const plan: PagePlan = args.pictures
    ? planned.plan
    : { ...planned.plan, sections: planned.plan.sections.map((section) => ({ ...section, picture: undefined, pictures: undefined })) };
  const built = await (deps.build ?? buildDraft)(owner, history, brief, plan);
  if (!built.ok) return { status: "retry", problem: built.problem };
  return {
    status: "done",
    pageId: built.pageId,
    result: { notes: [...planned.notes, ...built.notes].slice(0, 30), sections: plan.sections.map((section) => section.name) },
    pictures: args.pictures ? built.pictures : [],
  };
}

async function doPicture(owner: StudioOwner, pageId: string, raw: unknown, deps: SiteToolDeps): Promise<Outcome> {
  const filled = await (deps.fill ?? fillPicture)(owner, pageId, raw);
  if (filled.ok) return { status: "done" };
  if ("outcome" in filled && filled.outcome) return { status: filled.outcome === "gone" ? "gone" : "failed", problem: filled.problem };
  return { status: "retry", problem: filled.problem };
}

/** The job's outcome kept: a build's page and its pictures' jobs in one statement with it, a try that failed waiting for the next run. */
async function keep(job: ClaimedJob, outcome: Outcome): Promise<void> {
  if (outcome.status === "done") {
    await db().transaction(async (tx) => {
      await tx.execute(sql`
        update commerce.page_ai_jobs
        set status = 'done', problem = null, claimed_until = null, updated_at = now(), page_id = coalesce(${outcome.pageId ?? null}::uuid, page_id),
          result = ${outcome.result === undefined ? null : JSON.stringify(outcome.result)}::jsonb
        where id = ${job.id}::uuid
      `);
      for (const picture of outcome.pictures ?? []) {
        await tx.execute(sql`
          insert into commerce.page_ai_jobs (store_id, kind, page_id, asked_by, input)
          values (${job.storeId}::uuid, 'picture', ${outcome.pageId}::uuid, ${job.askedBy}::uuid, ${JSON.stringify(picture)}::jsonb)
        `);
      }
    });
    return;
  }
  const last = outcome.status !== "retry" || job.tries >= PAGE_JOB_TRIES;
  const status = outcome.status === "retry" ? (last ? "failed" : "waiting") : outcome.status;
  // A try that failed is held a little, so the next waits out what may pass (a busy model) instead of following at once.
  await db().execute(sql`
    update commerce.page_ai_jobs
    set status = ${status}, problem = ${outcome.problem.slice(0, 500)}, updated_at = now(),
      claimed_until = case when ${status} = 'waiting' then now() + interval '2 minutes' else null end
    where id = ${job.id}::uuid
  `);
}

/**
 * The job (D308, `/api/cron/page-jobs` every minute, and at once after `build_page` or `edit_page`): builds the pages and makes the
 * pictures the AI manager was asked for, one at a time, oldest first, starting none after `until`. Never throws.
 */
export async function runPageJobs(until: number, deps: SiteToolDeps = {}): Promise<{ done: number; failed: number }> {
  const result = { done: 0, failed: 0 };
  while (Date.now() < until) {
    let job: ClaimedJob | null;
    try {
      job = await claimJob();
    } catch (error) {
      console.error("[page-jobs] no job could be taken:", error);
      break;
    }
    if (!job) break;
    let outcome: Outcome;
    try {
      const owner = await jobOwner(job);
      outcome =
        typeof owner === "string"
          ? { status: "failed", problem: owner }
          : job.kind === "build"
            ? await doBuild(owner, job.input, deps)
            : job.pageId
              ? await doPicture(owner, job.pageId, job.input, deps)
              : { status: "failed", problem: "The picture has no page." };
    } catch (error) {
      console.error("[page-jobs] a job failed:", error);
      outcome = { status: "retry", problem: "Something went wrong. It is tried again." };
    }
    try {
      await keep(job, outcome);
    } catch (error) {
      // The hold runs out by itself, and the job is taken again then.
      console.error("[page-jobs] the outcome could not be kept:", error);
      break;
    }
    if (outcome.status === "done") result.done += 1;
    else if (outcome.status !== "retry") result.failed += 1;
  }
  return result;
}

/** Jobs done, given up or gone are kept `PAGE_JOB_DAYS` for the owner to ask about, then deleted (the daily job). */
export async function prunePageJobs(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.page_ai_jobs where status <> 'waiting' and updated_at < now() - make_interval(days => ${PAGE_JOB_DAYS}) returning id
  `);
  return rows.length;
}

// Places, menus, the header and footer (D308 A2b; Kaizena Flow's own site, A2c) ------------

/** The person as the store's savers take them: the account and the store (their own checks ask the rest). */
const memberOf = (ctx: SiteToolContext, store: Store): Membership => ({ account: ctx.account, store, role: ctx.holder?.role ?? "owner" });
const mainLocaleOf = (ctx: Pick<SiteToolContext, "store">) => (ctx.store ? (ctx.store.localization.locales[0] ?? ctx.store.markets[0]?.locale ?? "en") : "en");
/** The cache the site's menus, header and footer are read under: the store's, or Kaizena Flow's navigation. */
const navigationTag = (ctx: Pick<SiteToolContext, "store">) => (ctx.store ? storeTag(ctx.store.slug) : PLATFORM_NAVIGATION_TAG);

const isOwner = (ctx: SiteToolContext) => can(ctx.holder ?? { role: "owner" }, "owner");

/** A place's name in the owner's words: a store's, or Kaizena Flow's own (D143). */
const placeWords = (ctx: Pick<SiteToolContext, "store">, place: StorePlace) =>
  ctx.store || !isSpecialRole(place) ? placeName(place) : platformPlaceName(place);

/** `set_page_place` (gated `public`): one of the site's published pages in a place, or the standard page again, as the Pages list chooses it. */
export async function setPagePlaceTool(ctx: SiteToolContext, { place, page }: { place: StorePlace; page: string | null }) {
  if (ctx.store && isLegalRole(place) && !isOwner(ctx)) return fail("Only the store's owner chooses its legal pages.");
  if (!ctx.store && !isSpecialRole(place)) return fail(`Kaizena Flow's own site has a ${PLATFORM_PLACES.map(platformPlaceName).join(", ")}; the theme store's pages are chosen from Themes.`);
  const pageId = page === null ? null : await findPage(ctx, page, "page");
  let result: { ok: true } | { ok: false; problems: string[] };
  try {
    result = !ctx.store
      ? await setPlatformPageRole(ctx.account, place as SpecialRole, pageId)
      : place === "front"
        ? await setFrontPage(ctx.account, ctx.store.id, pageId)
        : place === "products"
          ? await setProductsPage(ctx.account, ctx.store.id, pageId)
          : await setPageRole(ctx.account, ctx.store.id, place, pageId);
  } catch (error) {
    // A place whose page is under a running A/B test is held by the database until the test stops (D148).
    if (error instanceof Error && /experiment/.test(`${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`)) {
      return fail("That place's page is in a running A/B test: stop the test before choosing another.");
    }
    throw error;
  }
  if (!result.ok) return fail(result.problems.join(" "));
  if (ctx.store) ctx.invalidate(storeTag(ctx.store.slug));
  ctx.invalidate(pagesTag(ownerOf(ctx)));
  const title = pageId ? await pageTitle(ctx, pageId) : null;
  const name = placeWords(ctx, place);
  return { done: title ? `"${title}" is the ${name} now.` : `The ${name} is the standard one again.` };
}

async function pageTitle(ctx: Pick<SiteToolContext, "store">, pageId: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select coalesce(nullif(published ->> 'title', ''), draft ->> 'title') as title from commerce.pages
    where id = ${pageId}::uuid and store_id is not distinct from ${ownerOf(ctx)}::uuid
  `);
  return row?.title ? String(row.title) : null;
}

/** What a place change would refuse, before it is kept for a yes: a page that is not there, not published, or in another place. */
export async function preflightPagePlace(ctx: SiteToolContext, { place, page }: { place: StorePlace; page: string | null }): Promise<void> {
  if (ctx.store && isLegalRole(place) && !isOwner(ctx)) fail("Only the store's owner chooses its legal pages.");
  if (!ctx.store && !isSpecialRole(place)) fail("Kaizena Flow's own site has a front page, blog and 404 page to choose; the theme store's are chosen from Themes.");
  if (page === null) return;
  const pageId = await findPage(ctx, page, "page");
  const [row] = ctx.store
    ? await db().execute<Row>(sql`
        select p.published_at is not null as published,
          case when s.front_page_id = p.id then 'front' when s.products_page_id = p.id then 'products'
            else (select role from commerce.page_roles r where r.store_id = s.id and r.page_id = p.id) end as taken
        from commerce.pages p join commerce.stores s on s.id = p.store_id where p.id = ${pageId}::uuid
      `)
    : await db().execute<Row>(sql`
        select p.published_at is not null as published, (select role from commerce.platform_page_roles r where r.page_id = p.id) as taken
        from commerce.pages p where p.id = ${pageId}::uuid and p.store_id is null
      `);
  const name = placeWords(ctx, place);
  if (!row?.published) fail(`Publish the page before making it the ${name}.`);
  const taken = row.taken ? String(row.taken) : null;
  if (taken && taken !== place) fail(`That page is the ${placeWords(ctx, taken as StorePlace)} already. Choose another page for the ${name}.`);
}

export async function placeApprovalWords(ctx: SiteToolContext, args: Record<string, unknown>): Promise<string | null> {
  const parsed = (ctx.store ? setPagePlaceInput : setPlatformPlaceInput).safeParse(args);
  if (!parsed.success) return null;
  const name = placeWords(ctx, parsed.data.place);
  if (parsed.data.page === null) return placeSummary(parsed.data.place, null, name);
  const pageId = await findPage(ctx, parsed.data.page, "page").catch(() => null);
  return placeSummary(parsed.data.place, pageId ? await pageTitle(ctx, pageId) : parsed.data.page, name);
}

type AnyMenu = { id: string; name: string; items: AnyMenuEntry[] };

/** The site's menus: a store's, or Kaizena Flow's own. */
const siteMenus = (ctx: Pick<SiteToolContext, "store">): Promise<AnyMenu[]> => (ctx.store ? listStoreMenus(ctx.store.id) : listPlatformMenus());

/** A menu of the site by its id or name. */
async function findMenu(ctx: Pick<SiteToolContext, "store">, ref: string): Promise<AnyMenu> {
  const menus = await siteMenus(ctx);
  const menu = menus.find((one) => one.id === ref) ?? menus.find((one) => one.name.toLowerCase() === ref.toLowerCase());
  return menu ?? fail(`No menu "${ref}" on this site. get_menus lists them.`);
}

/** Whether a menu is on the site: in the standard header or footer, or in a published page, header or footer. */
async function menuShown(ctx: Pick<SiteToolContext, "store">, menuId: string): Promise<boolean> {
  const standard = ctx.store
    ? sql`exists (select 1 from commerce.stores s where s.id = ${ctx.store.id}::uuid and ${menuId}::uuid in (s.header_menu_id, s.footer_menu_id))`
    : sql`exists (select 1 from commerce.platform_settings s where ${menuId}::uuid in (s.header_menu_id, s.footer_menu_id))`;
  const [row] = await db().execute<Row>(sql`
    select ${standard}
      or exists (select 1 from commerce.pages p where p.store_id is not distinct from ${ownerOf(ctx)}::uuid and p.published::text like ${`%"${menuId}"%`}) as shown
  `);
  return Boolean(row?.shown);
}

/** `get_menus`: the site's menus, each with its links in order (words in the main language) and where it is shown. */
export async function getMenusTool(ctx: SiteToolContext) {
  const main = mainLocaleOf(ctx);
  const [menus, uses] = await Promise.all([siteMenus(ctx), menuUses(ownerOf(ctx))]);
  const standard = (place: "header" | "footer") => [...uses].find(([, use]) => use.standard.includes(place))?.[0] ?? null;
  return {
    menus: menus.map((menu) => {
      const use = uses.get(menu.id);
      return {
        id: menu.id,
        name: menu.name,
        shown_in: [...(use?.standard ?? []).map((place) => `the standard ${place}`), ...(use?.pages ?? []).map((page) => `${page.type} "${page.title}"`)],
        items: menu.items.map((item) => ({
          text: item.label[main] ?? Object.values(item.label)[0] ?? "",
          link: item.link,
          depth: item.depth,
          ...(item.newTab && { new_tab: true }),
        })),
      };
    }),
    standard_header: standard("header"),
    standard_footer: standard("footer"),
    editor: `${adminBase(ctx)}/menus`,
  };
}

/** The checks made before a menu is saved or kept for a yes: no link into another store from a store's, no claim, a name, the menu there. */
async function checkedMenu(ctx: SiteToolContext, args: SaveMenuArgs | SavePlatformMenuArgs) {
  if (ctx.store) await refuseOtherStores(ctx.store, args.items);
  const claims = menuClaims(args.items);
  if (claims.length > 0) fail(`Rewrite without claims the site cannot back: ${claims.join(", ")}.`);
  const existing = args.menu ? await findMenu(ctx, args.menu) : null;
  const name = args.name ?? existing?.name ?? fail("Give the new menu a name.");
  const entries = toMenuEntries<AnyMenuLink>(args.items, mainLocaleOf(ctx), existing?.items ?? []);
  const parsed = (ctx.store ? menuInput : platformMenuInput).safeParse({ name, items: entries });
  if (!parsed.success) fail([...new Set(parsed.error.issues.map((issue) => issue.message))].join(" "));
  return { existing, name, entries };
}

/** A store's menus link to its own site and to the wider web, never into another store's shop (D308): its path, host or domain of its own. */
async function refuseOtherStores(store: Store, items: SaveMenuArgs["items"] | SavePlatformMenuArgs["items"]): Promise<void> {
  const urls = items.flatMap((item) => (item.link.kind === "url" ? [item.link.url] : []));
  const hostOf = (url: string): string | null => {
    try {
      return /^https?:/i.test(url) ? new URL(url).hostname.toLowerCase() : null;
    } catch {
      return null;
    }
  };
  const hosts = [...new Set(urls.flatMap((url) => hostOf(url) ?? []))];
  const domains =
    hosts.length > 0
      ? await db().execute<Row>(sql`
          select hostname from commerce.store_domains
          where store_id <> ${store.id}::uuid and hostname in (${sql.join(hosts.map((host) => sql`${host}`), sql`, `)})
        `)
      : [];
  const otherDomains = new Set(domains.map((row) => String(row.hostname)));
  const foreign = urls.find((url) => otherStoreAddress(url, store.slug, storeDomain()) || otherDomains.has(hostOf(url) ?? ""));
  if (foreign) fail(`The link to ${foreign} goes to another store. A store's menus link to its own site and the wider web.`);
}

/** `save_menu` (gated `public` while the menu is on the site): a menu's links replaced, or a new menu, saved by the menu editor's own save. */
export async function saveMenuTool(ctx: SiteToolContext, args: SaveMenuArgs | SavePlatformMenuArgs) {
  const { existing, name, entries } = await checkedMenu(ctx, args);
  const saved = ctx.store
    ? await saveStoreMenu(memberOf(ctx, ctx.store), existing?.id ?? null, { name, items: entries })
    : await savePlatformMenu(ctx.account, existing?.id ?? null, { name, items: entries });
  if (!saved.ok) return fail(saved.problems.join(" "));
  ctx.invalidate(navigationTag(ctx));
  const shown = await menuShown(ctx, saved.id);
  return {
    done: `${existing ? "Saved" : "Made"} the menu "${name}" with ${entries.length} link${entries.length === 1 ? "" : "s"}.${shown ? "" : " It is not shown anywhere yet: set_header_footer puts it in the standard header or footer."}`,
    menu: saved.id,
    editor: `${adminBase(ctx)}/menus`,
  };
}

export const preflightSaveMenu = async (ctx: SiteToolContext, args: SaveMenuArgs | SavePlatformMenuArgs) => void (await checkedMenu(ctx, args));

/** A menu change waits for a yes only while the menu is on the site (D308): a new menu, or one shown nowhere, is changed at once. */
export async function menuGateNeeded(ctx: Pick<SiteToolContext, "store">, raw: Record<string, unknown>): Promise<boolean> {
  const ref = typeof raw.menu === "string" ? raw.menu : null;
  if (!ref) return false;
  const menu = await findMenu(ctx, ref).catch(() => null);
  return menu ? menuShown(ctx, menu.id) : false;
}

export async function menuApprovalWords(ctx: SiteToolContext, args: Record<string, unknown>): Promise<string | null> {
  const parsed = (ctx.store ? saveMenuInput : savePlatformMenuInput).safeParse(args);
  if (!parsed.success) return null;
  const existing = parsed.data.menu ? await findMenu(ctx, parsed.data.menu).catch(() => null) : null;
  return menuSummary(parsed.data.name ?? existing?.name ?? parsed.data.menu ?? "", parsed.data.items, !existing);
}

type HeaderFooterChange = {
  navigation: StoreNavigation;
  headerMenuId: string | null;
  footerMenuId: string | null;
  words: Parameters<typeof headerFooterSummary>[0];
  /** The site shows a header or footer of its own design (D80), where the standard one's menus do not show. */
  custom: boolean;
  /** Kaizena Flow's business details, read as its Header and footer page reads them and saved back as they are. */
  business: BusinessDetails;
};

/** A logo from the site's own media library, with the size the library knows. */
async function libraryLogo(ctx: SiteToolContext, url: string) {
  const file = (await libraryFilesByUrl(ownerOf(ctx), [url])).get(url);
  if (!file || file.kind !== "image") return fail(`${url} is not a picture in the site's media library.`);
  if (!file.width || !file.height) return fail(`The size of ${url} is not known: choose it under Header and footer.`);
  return { url: file.url, width: file.width, height: file.height };
}

/** The header and footer as they are, with the changes asked laid over them; nothing given is kept. */
async function headerFooterChange(ctx: SiteToolContext, args: SetHeaderFooterArgs): Promise<HeaderFooterChange> {
  const [row] = ctx.store
    ? await db().execute<Row>(sql`
        select navigation, header_menu_id, footer_menu_id, header_id is not null or footer_id is not null as custom, null as business
        from commerce.stores where id = ${ctx.store.id}::uuid
      `)
    : await db().execute<Row>(sql`
        select navigation, header_menu_id, footer_menu_id, header_id is not null or footer_id is not null as custom, business
        from commerce.platform_settings
      `);
  const navigation = parseNavigation(row?.navigation);
  const words: HeaderFooterChange["words"] = {};
  const menuId = async (ref: string | null | undefined, now: unknown, place: "header" | "footer") => {
    if (ref === undefined) return now ? String(now) : null;
    if (ref === null) {
      words[place] = null;
      return null;
    }
    const menu = await findMenu(ctx, ref);
    words[place] = menu.name;
    return menu.id;
  };
  const headerMenuId = await menuId(args.header_menu, row?.header_menu_id, "header");
  const footerMenuId = await menuId(args.footer_menu, row?.footer_menu_id, "footer");
  const next: StoreNavigation = { ...navigation };
  if (args.logo !== undefined) {
    next.logo = args.logo === null ? null : await libraryLogo(ctx, args.logo);
    words.logo = args.logo !== null;
  }
  if (args.logo_dark !== undefined) {
    next.logoDark = args.logo_dark === null ? null : await libraryLogo(ctx, args.logo_dark);
    words.logoDark = args.logo_dark !== null;
  }
  return { navigation: next, headerMenuId, footerMenuId, words, custom: Boolean(row?.custom), business: parseBusinessDetails(row?.business) };
}

/** `set_header_footer` (gated `public`): which menus the standard header and footer show and the logo, saved by Header and footer's own save. */
export async function setHeaderFooterTool(ctx: SiteToolContext, args: SetHeaderFooterArgs) {
  const change = await headerFooterChange(ctx, args);
  const input = { ...change.navigation, headerMenuId: change.headerMenuId, footerMenuId: change.footerMenuId };
  const saved = ctx.store ? await saveNavigation(memberOf(ctx, ctx.store), input) : await savePlatformNavigation(ctx.account, { ...input, business: change.business });
  if (!saved.ok) return fail(saved.problems.join(" "));
  ctx.invalidate(navigationTag(ctx));
  return {
    done: headerFooterSummary(change.words).replace(/^Change/, "Changed"),
    note: change.custom ? "The site shows a header or footer of its own design: the standard one's menus show only where it is used." : undefined,
  };
}

export const preflightHeaderFooter = async (ctx: SiteToolContext, args: SetHeaderFooterArgs) => void (await headerFooterChange(ctx, args));

export async function headerFooterApprovalWords(ctx: SiteToolContext, args: Record<string, unknown>): Promise<string | null> {
  const parsed = setHeaderFooterInput.safeParse(args);
  if (!parsed.success) return null;
  const change = await headerFooterChange(ctx, parsed.data).catch(() => null);
  return change ? headerFooterSummary(change.words) : null;
}

// Kaizena Flow's own site (D308 A2c) ----------------------------------------------------------

/** Whether a gated tool on Kaizena Flow's own site needs the admin's yes for this call: a menu only while it is shown, the rest always. */
export async function platformSiteGateNeeded(name: string, raw: unknown): Promise<boolean> {
  if (name !== "save_menu") return true;
  return menuGateNeeded({ store: null }, typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {});
}

/** The site tools' checks before a gated call on Kaizena Flow's own site is kept for a yes; other tools have none. */
export async function preflightPlatformSiteTool(ctx: SiteToolContext, name: string, input: unknown): Promise<void> {
  if (name === "publish_page") return preflightPublishPage(ctx, input as { page: string; type: PageType });
  if (name === "set_page_place") return preflightPagePlace(ctx, input as { place: StorePlace; page: string | null });
  if (name === "save_menu") return preflightSaveMenu(ctx, input as SavePlatformMenuArgs);
  if (name === "set_header_footer") return preflightHeaderFooter(ctx, input as SetHeaderFooterArgs);
}

/** The site tools' approval words on Kaizena Flow's own site, from its own pages, menus and logos; null for any other tool. */
export async function platformSiteApprovalWords(ctx: SiteToolContext, name: string, args: Record<string, unknown>): Promise<string | null> {
  if (name === "publish_page") return publishApprovalWords(ctx, args);
  if (name === "set_page_place") return placeApprovalWords(ctx, args);
  if (name === "save_menu") return menuApprovalWords(ctx, args);
  if (name === "set_header_footer") return headerFooterApprovalWords(ctx, args);
  return null;
}
