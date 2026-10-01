import "server-only";

import { sql } from "drizzle-orm";
import { updateTag } from "next/cache";

import { db } from "@/db/client";
import { parsePageContent, type PageContent } from "@/lib/page-content";
import {
  evenSplit,
  GOAL_WORDS,
  isGoal,
  MAX_RUNNING_PER_STORE,
  MAX_VARIANTS,
  MIN_DAYS,
  NEXT_STATUSES,
  parseAudience,
  startProblems,
  type Audience,
  type ExperimentStatus,
  type Goal,
  type VariantKey,
} from "@/lib/experiments";

import { audit, type Account } from "./auth";
import { experimentsTag, forgetRunning, variantSlug } from "./experiments";
import { pagesTag, savePage } from "./pages";

type Row = Record<string, unknown>;

/**
 * Making, starting, stopping and applying A/B tests of pages (D148, docs/ab-testing.md): what the admin's actions call
 * (each behind `requireMember()`). A test is a draft until it starts; its versions are copies of the page, pages of type
 * `variant` with no address of their own, edited in the page builder. The database holds the rules (the migration); the
 * checks here say what is wrong in words before it asks.
 */

export type VariantInfo = { key: string; name: string; share: number; pageId: string | null; published: boolean; changed: boolean };

export type ExperimentInfo = {
  id: string;
  name: string;
  hypothesis: string;
  status: ExperimentStatus;
  goal: Goal;
  goalBlock: string | null;
  trafficShare: number;
  audience: Audience;
  minDays: number;
  minVisitors: number;
  plannedEnd: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
  appliedVariant: string | null;
  createdAt: string;
  page: { id: string; slug: string; title: string; published: boolean };
  variants: VariantInfo[];
};

const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);

const infoOf = (row: Row, variants: VariantInfo[]): ExperimentInfo => ({
  id: String(row.id),
  name: String(row.name),
  hypothesis: String(row.hypothesis ?? ""),
  status: row.status as ExperimentStatus,
  goal: row.primary_goal as Goal,
  goalBlock: typeof (row.goal_params as { block?: unknown })?.block === "string" ? String((row.goal_params as { block: string }).block) : null,
  trafficShare: Number(row.traffic_share),
  audience: parseAudience(row.audience),
  minDays: Number(row.min_days),
  minVisitors: Number(row.min_visitors),
  plannedEnd: iso(row.planned_end),
  startedAt: iso(row.started_at),
  stoppedAt: iso(row.stopped_at),
  stopReason: row.stop_reason ? String(row.stop_reason) : null,
  appliedVariant: row.applied_variant ? String(row.applied_variant) : null,
  createdAt: iso(row.created_at)!,
  page: {
    id: String(row.target_page_id),
    slug: String(row.page_slug),
    title: String((row.page_draft as { title?: unknown } | null)?.title ?? row.page_slug),
    published: row.page_published_at !== null,
  },
  variants,
});

/** The rows of a page's content that a visitor sees, to tell whether a version still equals the original. */
const sameRows = (a: unknown, b: unknown) => JSON.stringify((a as { rows?: unknown })?.rows ?? null) === JSON.stringify((b as { rows?: unknown })?.rows ?? null);

async function variantsOf(experimentId: string, originalPublished: unknown): Promise<VariantInfo[]> {
  const rows = await db().execute<Row>(sql`
    select v.key, v.name, v.share::float8 as share, v.page_id, p.published_at is not null as published, p.draft, p.published
    from commerce.experiment_variants v left join commerce.pages p on p.id = v.page_id and p.store_id = v.store_id
    where v.experiment_id = ${experimentId}::uuid order by v.key
  `);
  return rows.map((r) => ({
    key: String(r.key),
    name: String(r.name),
    share: Number(r.share),
    pageId: r.page_id ? String(r.page_id) : null,
    published: r.key === "a" ? true : Boolean(r.published),
    changed: r.key === "a" ? false : !sameRows(r.published ?? r.draft, originalPublished),
  }));
}

const SELECT = sql`
  select e.*, p.slug as page_slug, p.draft as page_draft, p.published as page_published, p.published_at as page_published_at
  from commerce.experiments e join commerce.pages p on p.id = e.target_page_id and p.store_id = e.store_id
`;

export async function listExperiments(storeId: string): Promise<(ExperimentInfo & { exposed: number })[]> {
  const rows = await db().execute<Row>(sql`
    ${SELECT}
    where e.store_id = ${storeId}::uuid
    order by case e.status when 'running' then 0 when 'draft' then 1 when 'stopped' then 2 else 3 end, e.created_at desc
  `);
  const exposed = await db().execute<Row>(sql`select experiment_id, count(*)::int as n from commerce.experiment_exposures where store_id = ${storeId}::uuid group by experiment_id`);
  const counts = new Map(exposed.map((r) => [String(r.experiment_id), Number(r.n)]));
  return Promise.all(rows.map(async (r) => ({ ...infoOf(r, await variantsOf(String(r.id), r.page_published)), exposed: counts.get(String(r.id)) ?? 0 })));
}

export async function getExperiment(storeId: string, id: string): Promise<ExperimentInfo | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db().execute<Row>(sql`${SELECT} where e.store_id = ${storeId}::uuid and e.id = ${id}::uuid`);
  return row ? infoOf(row, await variantsOf(id, row.page_published)) : null;
}

/** The pages a store can test: published pages with an address of their own, not the front page, the All products page or a page chosen for a place; not already in a running test. */
export async function testablePages(storeId: string): Promise<{ id: string; slug: string; title: string }[]> {
  const rows = await db().execute<Row>(sql`
    select p.id, p.slug, p.published ->> 'title' as title from commerce.pages p
    where p.store_id = ${storeId}::uuid and p.type = 'page' and p.published_at is not null
      and p.id not in (select coalesce(s.front_page_id, '00000000-0000-0000-0000-000000000000') from commerce.stores s where s.id = p.store_id)
      and p.id not in (select coalesce(s.products_page_id, '00000000-0000-0000-0000-000000000000') from commerce.stores s where s.id = p.store_id)
      and p.id not in (select r.page_id from commerce.page_roles r where r.store_id = p.store_id)
      and p.id not in (select e.target_page_id from commerce.experiments e where e.store_id = p.store_id and e.status = 'running')
    order by p.slug
  `);
  return rows.map((r) => ({ id: String(r.id), slug: String(r.slug), title: String(r.title ?? r.slug) }));
}

/** The buttons of a page, for a test that counts clicks: each block's id and its text. */
export function buttonsOf(content: PageContent | null): { id: string; label: string }[] {
  if (!content) return [];
  return content.rows.flatMap((row) =>
    row.columns.flatMap((column) => column.blocks.flatMap((block) => (block.type === "button" && block.label.trim() ? [{ id: block.id, label: block.label.trim() }] : []))),
  );
}

export type NewExperiment = {
  name: string;
  hypothesis?: string;
  pageId: string;
  goal: string;
  goalBlock?: string | null;
  trafficShare?: number;
  audience?: Audience;
  minDays?: number;
  minVisitors?: number;
};

export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

/** A copy of the page's published content as a version of it: a page of type `variant`, published at once, so a test of it can start; it is the owner's to change. */
async function makeVersionPage(account: Account, storeId: string, original: PageContent, experimentId: string, key: string, title: string) {
  const slug = variantSlug(experimentId, key);
  return savePage(account, storeId, null, { ...original, slug, title }, { publish: true, type: "variant" });
}

/** Makes a test as a draft: the original and a first version, a copy of the page to change. */
export async function createExperiment(account: Account, storeId: string, input: NewExperiment): Promise<Outcome<{ id: string }>> {
  const name = input.name.trim();
  if (name === "" || name.length > 120) return { ok: false, problems: ["Give the test a name of up to 120 characters."] };
  if (!isGoal(input.goal)) return { ok: false, problems: ["Choose what the test should improve."] };
  if (GOAL_WORDS[input.goal].needsBlock && !input.goalBlock) return { ok: false, problems: ["Choose the button whose clicks you want more of."] };
  const traffic = input.trafficShare ?? 1;
  if (!(traffic > 0 && traffic <= 1)) return { ok: false, problems: ["The share of visitors in the test is more than 0 and at most 100 %."] };
  const [page] = await db().execute<Row>(sql`
    select id, slug, published, published_at from commerce.pages
    where id = ${input.pageId}::uuid and store_id = ${storeId}::uuid and type = 'page'
  `);
  if (!page) return { ok: false, problems: ["Choose one of the store's pages."] };
  const original = parsePageContent(page.published);
  if (!original) return { ok: false, problems: ["Publish the page before testing it: a test shows it to real visitors."] };
  const buttons = buttonsOf(original);
  if (input.goal === "click" && !buttons.some((b) => b.id === input.goalBlock)) return { ok: false, problems: ["That button is not on the page."] };

  const [made] = await db().execute<Row>(sql`
    insert into commerce.experiments (store_id, name, hypothesis, target_page_id, primary_goal, goal_params, traffic_share, audience, min_days, min_visitors, created_by, updated_by)
    values (${storeId}::uuid, ${name}, ${(input.hypothesis ?? "").slice(0, 500)}, ${input.pageId}::uuid, ${input.goal},
      ${JSON.stringify(input.goal === "click" ? { block: input.goalBlock } : {})}::jsonb, ${traffic}, ${JSON.stringify(parseAudience(input.audience ?? {}))}::jsonb,
      ${Math.min(90, Math.max(1, Math.round(input.minDays ?? MIN_DAYS)))}, ${Math.max(0, Math.round(input.minVisitors ?? 0))}, ${account.id}::uuid, ${account.id}::uuid)
    returning id
  `);
  const id = String(made.id);
  const copy = await makeVersionPage(account, storeId, original, id, "b", `${original.title} (B)`);
  if (!copy.ok) {
    await db().execute(sql`delete from commerce.experiments where id = ${id}::uuid`);
    return copy;
  }
  const [a, b] = evenSplit(2);
  await db().execute(sql`
    insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
    values (${storeId}::uuid, ${id}::uuid, 'a', 'Original', null, ${a}), (${storeId}::uuid, ${id}::uuid, 'b', 'Version B', ${copy.id}::uuid, ${b})
  `);
  await audit(account.id, storeId, "experiment.created", { experiment: id, page: input.pageId, goal: input.goal });
  return { ok: true, id };
}

/** Adds a version (C, then D) to a draft: another copy of the page, the shares evened out. */
export async function addVariant(account: Account, storeId: string, id: string): Promise<Outcome<{ key: string }>> {
  const test = await getExperiment(storeId, id);
  if (!test) return { ok: false, problems: ["This test no longer exists."] };
  if (test.status !== "draft") return { ok: false, problems: ["Versions can only be added before the test starts."] };
  if (test.variants.length >= MAX_VARIANTS) return { ok: false, problems: [`A test has at most ${MAX_VARIANTS} versions, the original included.`] };
  const key = (["b", "c", "d"] as VariantKey[]).find((k) => !test.variants.some((v) => v.key === k));
  if (!key) return { ok: false, problems: ["There is no room for another version."] };
  const [page] = await db().execute<Row>(sql`select published from commerce.pages where id = ${test.page.id}::uuid and store_id = ${storeId}::uuid`);
  const original = parsePageContent(page?.published);
  if (!original) return { ok: false, problems: ["The page under test is no longer published."] };
  const copy = await makeVersionPage(account, storeId, original, id, key, `${original.title} (${key.toUpperCase()})`);
  if (!copy.ok) return copy;
  const shares = evenSplit(test.variants.length + 1);
  const keys = [...test.variants.map((v) => v.key), key].sort();
  await db().transaction(async (tx) => {
    for (const [i, k] of keys.entries()) {
      if (k === key) {
        await tx.execute(sql`
          insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
          values (${storeId}::uuid, ${id}::uuid, ${key}, ${`Version ${key.toUpperCase()}`}, ${copy.id}::uuid, ${shares[i]})
        `);
      } else {
        await tx.execute(sql`update commerce.experiment_variants set share = ${shares[i]} where experiment_id = ${id}::uuid and key = ${k}`);
      }
    }
  });
  await audit(account.id, storeId, "experiment.variant_added", { experiment: id, key });
  return { ok: true, key };
}

/** Takes a version out of a draft (never the original, and a test keeps at least one other), the shares evened out; its page is deleted. */
export async function removeVariant(account: Account, storeId: string, id: string, key: string): Promise<Outcome> {
  const test = await getExperiment(storeId, id);
  if (!test) return { ok: false, problems: ["This test no longer exists."] };
  if (test.status !== "draft") return { ok: false, problems: ["Versions can only be removed before the test starts."] };
  const gone = test.variants.find((v) => v.key === key);
  if (!gone || key === "a") return { ok: false, problems: ["The original stays in every test."] };
  if (test.variants.length <= 2) return { ok: false, problems: ["A test needs at least one version besides the original."] };
  const left = test.variants.filter((v) => v.key !== key).map((v) => v.key).sort();
  const shares = evenSplit(left.length);
  await db().transaction(async (tx) => {
    await tx.execute(sql`delete from commerce.experiment_variants where experiment_id = ${id}::uuid and key = ${key}`);
    for (const [i, k] of left.entries()) await tx.execute(sql`update commerce.experiment_variants set share = ${shares[i]} where experiment_id = ${id}::uuid and key = ${k}`);
    if (gone.pageId) await tx.execute(sql`delete from commerce.pages where id = ${gone.pageId}::uuid and store_id = ${storeId}::uuid and type = 'variant'`);
  });
  await audit(account.id, storeId, "experiment.variant_removed", { experiment: id, key });
  return { ok: true };
}

export type DraftChanges = { name?: string; hypothesis?: string; goal?: string; goalBlock?: string | null; trafficShare?: number; audience?: Audience; minDays?: number; minVisitors?: number; shares?: Record<string, number> };

/** Changes what a draft measures and how its visitors are divided; a test that has started can only be renamed (below). */
export async function updateDraft(account: Account, storeId: string, id: string, changes: DraftChanges): Promise<Outcome> {
  const test = await getExperiment(storeId, id);
  if (!test) return { ok: false, problems: ["This test no longer exists."] };
  if (test.status !== "draft") return { ok: false, problems: ["A test that has started cannot be changed, so its results mean what was started. Make a new test instead."] };
  const goal = changes.goal ?? test.goal;
  if (!isGoal(goal)) return { ok: false, problems: ["Choose what the test should improve."] };
  const block = goal === "click" ? (changes.goalBlock !== undefined ? changes.goalBlock : test.goalBlock) : null;
  if (GOAL_WORDS[goal].needsBlock && !block) return { ok: false, problems: ["Choose the button whose clicks you want more of."] };
  const traffic = changes.trafficShare ?? test.trafficShare;
  if (!(traffic > 0 && traffic <= 1)) return { ok: false, problems: ["The share of visitors in the test is more than 0 and at most 100 %."] };
  const name = (changes.name ?? test.name).trim();
  if (name === "" || name.length > 120) return { ok: false, problems: ["Give the test a name of up to 120 characters."] };
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.experiments set name = ${name}, hypothesis = ${(changes.hypothesis ?? test.hypothesis).slice(0, 500)}, primary_goal = ${goal},
        goal_params = ${JSON.stringify(block ? { block } : {})}::jsonb, traffic_share = ${traffic},
        audience = ${JSON.stringify(parseAudience(changes.audience ?? test.audience))}::jsonb,
        min_days = ${Math.min(90, Math.max(1, Math.round(changes.minDays ?? test.minDays)))}, min_visitors = ${Math.max(0, Math.round(changes.minVisitors ?? test.minVisitors))},
        updated_by = ${account.id}::uuid, updated_at = now()
      where id = ${id}::uuid and store_id = ${storeId}::uuid
    `);
    if (changes.shares) {
      for (const v of test.variants) {
        const share = changes.shares[v.key];
        if (share !== undefined) await tx.execute(sql`update commerce.experiment_variants set share = ${share} where experiment_id = ${id}::uuid and key = ${v.key}`);
      }
    }
  });
  return { ok: true };
}

/** Renames a test or changes its hypothesis or planned end at any time before it is finished. */
export async function renameExperiment(account: Account, storeId: string, id: string, input: { name?: string; hypothesis?: string; plannedEnd?: Date }): Promise<Outcome> {
  const test = await getExperiment(storeId, id);
  if (!test) return { ok: false, problems: ["This test no longer exists."] };
  if (test.status === "applied" || test.status === "discarded") return { ok: false, problems: ["A finished test cannot be changed."] };
  const name = (input.name ?? test.name).trim();
  if (name === "" || name.length > 120) return { ok: false, problems: ["Give the test a name of up to 120 characters."] };
  await db().execute(sql`
    update commerce.experiments set name = ${name}, hypothesis = ${(input.hypothesis ?? test.hypothesis).slice(0, 500)},
      planned_end = ${input.plannedEnd ? input.plannedEnd.toISOString() : test.plannedEnd}::timestamptz, updated_by = ${account.id}::uuid, updated_at = now()
    where id = ${id}::uuid and store_id = ${storeId}::uuid
  `);
  return { ok: true };
}

/** Starts a test: checked in words first, then by the database, which refuses anything the checks missed. */
export async function startExperiment(account: Account, storeId: string, id: string): Promise<Outcome> {
  const test = await getExperiment(storeId, id);
  if (!test) return { ok: false, problems: ["This test no longer exists."] };
  if (test.status !== "draft") return { ok: false, problems: ["This test has already started."] };
  const [special] = await db().execute<Row>(sql`
    select (s.front_page_id = ${test.page.id}::uuid or s.products_page_id = ${test.page.id}::uuid
      or exists (select 1 from commerce.page_roles r where r.store_id = s.id and r.page_id = ${test.page.id}::uuid)) as special,
      (select count(*) from commerce.experiments e where e.store_id = s.id and e.status = 'running')::int as running
    from commerce.stores s where s.id = ${storeId}::uuid
  `);
  const problems = startProblems({
    name: test.name,
    goal: test.goal,
    goalBlock: test.goalBlock,
    trafficShare: test.trafficShare,
    variants: test.variants.map((v) => ({ key: v.key, name: v.name, share: v.share, published: v.published })),
    pagePublished: test.page.published,
    runningInStore: Number(special?.running ?? 0),
    pageIsSpecial: Boolean(special?.special),
  });
  for (const v of test.variants) if (v.key !== "a" && !v.changed) problems.push(`Version ${v.key.toUpperCase()} is still the same as the original: change it first, or the test has nothing to find.`);
  if (problems.length > 0) return { ok: false, problems };
  try {
    await db().execute(sql`update commerce.experiments set status = 'running', updated_by = ${account.id}::uuid, updated_at = now() where id = ${id}::uuid and store_id = ${storeId}::uuid`);
  } catch (error) {
    return { ok: false, problems: [databaseProblem(error) ?? "The test could not be started."] };
  }
  forgetRunning(storeId);
  updateTag(experimentsTag(storeId));
  await audit(account.id, storeId, "experiment.started", { experiment: id, page: test.page.id, goal: test.goal });
  return { ok: true };
}

/** Stops a running test: no new visitors are enrolled, and what was counted stays. */
export async function stopExperiment(account: Account | null, storeId: string, id: string, reason: "person" | "guardrail" | "planned_end" = "person"): Promise<Outcome> {
  const test = await getExperiment(storeId, id);
  if (!test) return { ok: false, problems: ["This test no longer exists."] };
  if (test.status !== "running") return { ok: false, problems: ["This test is not running."] };
  await db().execute(sql`
    update commerce.experiments set status = 'stopped', stop_reason = ${reason}, updated_by = ${account?.id ?? null}::uuid, updated_at = now()
    where id = ${id}::uuid and store_id = ${storeId}::uuid and status = 'running'
  `);
  forgetRunning(storeId);
  updateTag(experimentsTag(storeId));
  await audit(account?.id ?? null, storeId, "experiment.stopped", { experiment: id, reason });
  return { ok: true };
}

/**
 * Makes a version the page: its content replaces the original's (the original's address kept), published at once, and the
 * test ends as applied. One change, audited; visitors see the winner everywhere from the next page view.
 */
export async function applyVariant(account: Account, storeId: string, id: string, key: string): Promise<Outcome> {
  const test = await getExperiment(storeId, id);
  if (!test) return { ok: false, problems: ["This test no longer exists."] };
  if (test.status !== "stopped") return { ok: false, problems: ["Stop the test before choosing a winner."] };
  const chosen = test.variants.find((v) => v.key === key);
  if (!chosen || key === "a" || !chosen.pageId) return { ok: false, problems: ["Choose one of the versions, not the original."] };
  const done = await db().transaction(async (tx) => {
    const [from] = await tx.execute<Row>(sql`select draft, published from commerce.pages where id = ${chosen.pageId}::uuid and store_id = ${storeId}::uuid and type = 'variant' for update`);
    const content = parsePageContent(from?.published ?? from?.draft);
    if (!content) return false;
    const next = JSON.stringify({ ...content, slug: test.page.slug });
    await tx.execute(sql`
      update commerce.pages set draft = ${next}::jsonb, published = ${next}::jsonb, published_at = now(), updated_at = now(), updated_by = ${account.id}::uuid
      where id = ${test.page.id}::uuid and store_id = ${storeId}::uuid and type = 'page'
    `);
    await tx.execute(sql`update commerce.experiments set status = 'applied', applied_variant = ${key}, updated_by = ${account.id}::uuid, updated_at = now() where id = ${id}::uuid and store_id = ${storeId}::uuid`);
    return true;
  });
  if (!done) return { ok: false, problems: ["That version could not be read."] };
  updateTag(pagesTag(storeId));
  updateTag(experimentsTag(storeId));
  await audit(account.id, storeId, "experiment.applied", { experiment: id, variant: key, page: test.page.id });
  return { ok: true };
}

/** Keeps the original: the test is discarded. */
export async function discardExperiment(account: Account, storeId: string, id: string): Promise<Outcome> {
  const test = await getExperiment(storeId, id);
  if (!test) return { ok: false, problems: ["This test no longer exists."] };
  if (!NEXT_STATUSES[test.status].includes("discarded")) return { ok: false, problems: ["This test cannot be discarded now."] };
  await db().execute(sql`update commerce.experiments set status = 'discarded', updated_by = ${account.id}::uuid, updated_at = now() where id = ${id}::uuid and store_id = ${storeId}::uuid`);
  updateTag(experimentsTag(storeId));
  await audit(account.id, storeId, "experiment.discarded", { experiment: id });
  return { ok: true };
}

/** Deletes a draft with its versions' pages; a test that has run is kept. */
export async function deleteDraft(account: Account, storeId: string, id: string): Promise<Outcome> {
  const test = await getExperiment(storeId, id);
  if (!test) return { ok: false, problems: ["This test no longer exists."] };
  if (test.status !== "draft") return { ok: false, problems: ["Only a draft can be deleted: a test that has run is kept with its results."] };
  await db().transaction(async (tx) => {
    const pages = test.variants.flatMap((v) => (v.pageId ? [v.pageId] : []));
    await tx.execute(sql`delete from commerce.experiments where id = ${id}::uuid and store_id = ${storeId}::uuid`);
    for (const pageId of pages) await tx.execute(sql`delete from commerce.pages where id = ${pageId}::uuid and store_id = ${storeId}::uuid and type = 'variant'`);
  });
  await audit(account.id, storeId, "experiment.deleted", { experiment: id });
  return { ok: true };
}

/** A database refusal as the sentence the rule gave, or null. */
function databaseProblem(error: unknown): string | null {
  for (let e = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string") {
      const match = /experiments?\.[a-z_]+: (.+)$/m.exec(message) ?? /experiment_variants\.[a-z_]+: (.+)$/m.exec(message);
      if (match) return match[1];
    }
  }
  return null;
}

export { MAX_RUNNING_PER_STORE };
