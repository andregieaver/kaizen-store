import "server-only";

import { sql } from "drizzle-orm";
import { revalidateTag, updateTag } from "next/cache";

import { db } from "@/db/client";
import { targetKindOf, WORKING_ROLES, type TargetKind } from "@/lib/ab-site";
import { applyPart, buttonsWithin, describePart, findPart, partChanges, testablePart, type PartKind } from "@/lib/experiment-parts";
import { parsePageContent, type PageContent, type PageType } from "@/lib/page-content";
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

/** The working pages' places as a Postgres array literal, for the queries that tell them from the other pages with a place of their own. */
const WORKING_ROLE_LIST = `{${WORKING_ROLES.join(",")}}`;

/**
 * Refreshes a cache tag after a change. A server action may `updateTag` (the owner sees it at once); anywhere else (the
 * five-minute job, the AI manager's route) that throws, and the tag is revalidated instead, so a stop, a scheduled start or an
 * apply made outside an action still reaches the pages that draw the test.
 */
function refreshTag(tag: string): void {
  try {
    updateTag(tag);
  } catch {
    revalidateTag(tag, "max");
  }
}

/**
 * Making, starting, stopping and applying A/B tests of pages (D148, docs/ab-testing.md): what the admin's actions call
 * (each behind `requireMember()`). A test is a draft until it starts; its versions are copies of the page, pages of type
 * `variant` with no address of their own, edited in the page builder. The database holds the rules (the migration); the
 * checks here say what is wrong in words before it asks.
 */

export type VariantInfo = {
  key: string;
  name: string;
  share: number;
  pageId: string | null;
  published: boolean;
  changed: boolean;
  /** For a part test: whether the version differs from the original in the part only (see `partChanges()`). */
  scope: "ok" | "outside" | "missing" | "modal" | null;
};

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
  scheduledStart: string | null;
  scheduleProblem: string | null;
  page: {
    id: string;
    slug: string;
    title: string;
    published: boolean;
    /** What it is: a page, a product layout, a header or a footer. */
    type: PageType;
    kind: TargetKind;
    /** The place the page was chosen for (D112), if it has one: a working page's, for a test of it. */
    role?: string | null;
  };
  /** The part under test (D148, phase 2), by its id, kind and a name for it; null for a test of the whole page. */
  part: { id: string; kind: PartKind; label: string; modal?: { byItself: boolean } | null } | null;
  variants: VariantInfo[];
};

const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);

/** The part a test is about, named from the page as it is published (or as it was drafted, if the part is not in the published page). */
function partOfRow(row: Row): ExperimentInfo["part"] {
  if (!row.target_part) return null;
  const target = { id: String(row.target_part), kind: row.target_part_kind as PartKind };
  const content = parsePageContent(row.page_published) ?? parsePageContent(row.page_draft);
  const info = content ? describePart(content, target) : null;
  return { ...target, label: info?.label ?? "the part under test", modal: info?.modal ?? null };
}

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
  scheduledStart: iso(row.scheduled_start),
  scheduleProblem: row.schedule_problem ? String(row.schedule_problem) : null,
  part: partOfRow(row),
  page: {
    id: String(row.target_page_id),
    slug: String(row.page_slug),
    title: String((row.page_draft as { title?: unknown } | null)?.title ?? row.page_slug),
    published: row.page_published_at !== null,
    type: String(row.page_type) as PageType,
    kind: targetKindOf(String(row.page_type), row.page_role ? String(row.page_role) : null) ?? "page",
    role: row.page_role ? String(row.page_role) : null,
  },
  variants,
});

/** The rows of a page's content that a visitor sees, to tell whether a version still equals the original. */
const sameRows = (a: unknown, b: unknown) => JSON.stringify((a as { rows?: unknown })?.rows ?? null) === JSON.stringify((b as { rows?: unknown })?.rows ?? null);

async function variantsOf(experimentId: string, originalPublished: unknown, part: { id: string; kind: PartKind } | null): Promise<VariantInfo[]> {
  const rows = await db().execute<Row>(sql`
    select v.key, v.name, v.share::float8 as share, v.page_id, p.published_at is not null as published, p.draft, p.published
    from commerce.experiment_variants v left join commerce.pages p on p.id = v.page_id and p.store_id = v.store_id
    where v.experiment_id = ${experimentId}::uuid order by v.key
  `);
  const original = part ? parsePageContent(originalPublished) : null;
  return rows.map((r) => ({
    key: String(r.key),
    name: String(r.name),
    share: Number(r.share),
    pageId: r.page_id ? String(r.page_id) : null,
    published: r.key === "a" ? true : Boolean(r.published),
    changed: r.key === "a" ? false : !sameRows(r.published ?? r.draft, originalPublished),
    scope: scopeOf(r, original, part),
  }));
}

/** A part test's check of one version against the original; null for the original and for a test of the whole page. */
function scopeOf(row: Row, original: PageContent | null, part: { id: string; kind: PartKind } | null): VariantInfo["scope"] {
  if (!part || !original || row.key === "a") return null;
  const version = parsePageContent(row.published ?? row.draft);
  return version ? partChanges(original, version, part) : "missing";
}

/** The part a row of `experiments` is about, for `variantsOf()`. */
const partOfExperimentRow = (row: Row) => (row.target_part ? { id: String(row.target_part), kind: row.target_part_kind as PartKind } : null);

const SELECT = sql`
  select e.*, p.slug as page_slug, p.type as page_type, p.draft as page_draft, p.published as page_published, p.published_at as page_published_at,
    (select r.role from commerce.page_roles r where r.store_id = e.store_id and r.page_id = e.target_page_id) as page_role
  from commerce.experiments e join commerce.pages p on p.id = e.target_page_id and p.store_id = e.store_id
`;

export async function listExperiments(storeId: string): Promise<(ExperimentInfo & { exposed: number })[]> {
  const rows = await db().execute<Row>(sql`
    ${SELECT}
    where e.store_id = ${storeId}::uuid
    order by case e.status when 'running' then 0 when 'scheduled' then 1 when 'draft' then 2 when 'stopped' then 3 else 4 end, e.created_at desc
  `);
  const exposed = await db().execute<Row>(sql`select experiment_id, count(*)::int as n from commerce.experiment_exposures where store_id = ${storeId}::uuid group by experiment_id`);
  const counts = new Map(exposed.map((r) => [String(r.experiment_id), Number(r.n)]));
  return Promise.all(rows.map(async (r) => ({ ...infoOf(r, await variantsOf(String(r.id), r.page_published, partOfExperimentRow(r))), exposed: counts.get(String(r.id)) ?? 0 })));
}

export async function getExperiment(storeId: string, id: string): Promise<ExperimentInfo | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db().execute<Row>(sql`${SELECT} where e.store_id = ${storeId}::uuid and e.id = ${id}::uuid`);
  return row ? infoOf(row, await variantsOf(id, row.page_published, partOfExperimentRow(row))) : null;
}

/** The test a version's page belongs to, for the banner in the builder: its name, which version this is, and what it is a test of. */
export async function testOfVersionPage(storeId: string, pageId: string): Promise<{ id: string; name: string; status: ExperimentStatus; key: string; pageId: string; targetType: PageType; part: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(pageId)) return null;
  const [row] = await db().execute<Row>(sql`
    select v.experiment_id from commerce.experiment_variants v where v.store_id = ${storeId}::uuid and v.page_id = ${pageId}::uuid
  `);
  if (!row) return null;
  const test = await getExperiment(storeId, String(row.experiment_id));
  const version = test?.variants.find((v) => v.pageId === pageId);
  return test && version ? { id: test.id, name: test.name, status: test.status, key: version.key, pageId: test.page.id, targetType: test.page.type, part: test.part?.label ?? null } : null;
}

export type TestableTarget = {
  id: string;
  slug: string;
  title: string;
  kind: TargetKind;
  /** The place a working page was chosen for; a test of it is by a part of it only (`partOnly`). */
  role?: string | null;
  partOnly?: boolean;
};

/**
 * What a store can test: its published pages with an address of their own (not the front page, the All products page or a page
 * chosen for a place), its working pages (the cart, the checkout, …) by a part of them, the header and footer it uses, and its
 * product layouts that something uses; none already in a running test.
 */
export async function testablePages(storeId: string): Promise<TestableTarget[]> {
  const rows = await db().execute<Row>(sql`
    select p.id, p.slug, p.type, p.published ->> 'title' as title,
      (select r.role from commerce.page_roles r where r.store_id = p.store_id and r.page_id = p.id) as role
    from commerce.pages p
    where p.store_id = ${storeId}::uuid and p.published_at is not null
      and p.id not in (select e.target_page_id from commerce.experiments e where e.store_id = p.store_id and e.status = 'running')
      and (
        (p.type = 'page'
          and p.id not in (select coalesce(s.front_page_id, '00000000-0000-0000-0000-000000000000') from commerce.stores s where s.id = p.store_id)
          and p.id not in (select coalesce(s.products_page_id, '00000000-0000-0000-0000-000000000000') from commerce.stores s where s.id = p.store_id)
          and p.id not in (select r.page_id from commerce.page_roles r where r.store_id = p.store_id))
        or (p.type = 'page' and p.id in (select r.page_id from commerce.page_roles r where r.store_id = p.store_id and r.role = any(${WORKING_ROLE_LIST}::text[])))
        or (p.type = 'header' and p.id in (select s.header_id from commerce.stores s where s.id = p.store_id))
        or (p.type = 'footer' and p.id in (select s.footer_id from commerce.stores s where s.id = p.store_id))
        or (p.type = 'product_layout' and (
          p.id in (select s.product_layout_id from commerce.stores s where s.id = p.store_id)
          or exists (select 1 from commerce.terms t where t.store_id = p.store_id and t.product_layout_id = p.id)
          or exists (select 1 from commerce.products pr where pr.store_id = p.store_id and pr.product_layout_id = p.id)))
      )
    order by case p.type when 'page' then 0 when 'header' then 1 when 'footer' then 2 else 3 end, p.slug
  `);
  return rows.map((r) => {
    const kind = targetKindOf(String(r.type), r.role ? String(r.role) : null) ?? "page";
    return { id: String(r.id), slug: String(r.slug), title: String(r.title ?? r.slug), kind, role: r.role ? String(r.role) : null, partOnly: kind === "role" };
  });
}

/** A store's page, header, footer or layout as last published, by its id: what a test of it starts from. Null when it is not published. */
export async function publishedContentOf(storeId: string, pageId: string): Promise<PageContent | null> {
  if (!/^[0-9a-f-]{36}$/i.test(pageId)) return null;
  const [row] = await db().execute<Row>(sql`select published from commerce.pages where id = ${pageId}::uuid and store_id = ${storeId}::uuid`);
  return parsePageContent(row?.published);
}

/** The buttons of a page, for a test that counts clicks: each block's id and its text. */
export function buttonsOf(content: PageContent | null): { id: string; label: string }[] {
  if (!content) return [];
  return content.rows.flatMap((row) =>
    row.columns.flatMap((column) => column.blocks.flatMap((block) => (block.type === "button" && block.label.trim() ? [{ id: block.id, label: block.label.trim() }] : []))),
  );
}

export type NewExperiment = {
  /** A part of the page to test instead of the whole page: its kind and id (the builder's "Test this"). */
  part?: { kind: PartKind; id: string } | null;
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
async function makeVersionPage(account: Account, storeId: string, original: PageContent, experimentId: string, key: string, title: string, of: PageType) {
  const slug = variantSlug(experimentId, key);
  return savePage(account, storeId, null, { ...original, slug, title }, { publish: true, type: "variant", variantOf: of });
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
    select p.id, p.slug, p.type, p.published, p.published_at,
      (select r.role from commerce.page_roles r where r.store_id = p.store_id and r.page_id = p.id) as role,
      exists (select 1 from commerce.stores s where s.id = p.store_id and (s.front_page_id = p.id or s.products_page_id = p.id)) as front
    from commerce.pages p
    where p.id = ${input.pageId}::uuid and p.store_id = ${storeId}::uuid and p.type in ('page', 'product_layout', 'header', 'footer')
  `);
  if (!page) return { ok: false, problems: ["Choose one of the store's pages, its header or footer, or one of its product layouts."] };
  const targetType = String(page.type) as PageType;
  const role = page.role ? String(page.role) : null;
  const kind = targetKindOf(targetType, role) ?? "page";
  // The front page and the pages for a place of their own that are not working pages cannot be tested yet; a working page only by a part of it.
  if (page.front || (role && kind !== "role")) return { ok: false, problems: ["The front page, the All products page, the cookies page and the blog, search, 404, category and tag pages cannot be tested yet."] };
  if (kind === "role" && !input.part) return { ok: false, problems: ["A working page is tested by a part of it: open it in the page builder and choose a row, a column or a component around the shop's own, with “A/B test this”."] };
  const original = parsePageContent(page.published);
  if (!original) return { ok: false, problems: ["Publish the page before testing it: a test shows it to real visitors."] };
  const part = input.part ?? null;
  if (part) {
    if (!testablePart(original, part, kind)) return { ok: false, problems: ["That part of the page cannot be tested: choose a row, a column or a component with something to see, in the published page. Publish your changes first if you just added it."] };
  }
  const buttons = part ? buttonsWithin(part.kind, findPart(original.rows, part.id)!.node) : buttonsOf(original);
  if (input.goal === "click" && !buttons.some((b) => b.id === input.goalBlock)) return { ok: false, problems: [part ? "That button is not in the part you are testing." : "That button is not on the page."] };

  const [made] = await db().execute<Row>(sql`
    insert into commerce.experiments (store_id, name, hypothesis, target_page_id, target_part, target_part_kind, primary_goal, goal_params, traffic_share, audience, min_days, min_visitors, created_by, updated_by)
    values (${storeId}::uuid, ${name}, ${(input.hypothesis ?? "").slice(0, 500)}, ${input.pageId}::uuid, ${part?.id ?? null}, ${part?.kind ?? null}, ${input.goal},
      ${JSON.stringify(input.goal === "click" ? { block: input.goalBlock } : {})}::jsonb, ${traffic}, ${JSON.stringify(parseAudience(input.audience ?? {}))}::jsonb,
      ${Math.min(90, Math.max(1, Math.round(input.minDays ?? MIN_DAYS)))}, ${Math.max(0, Math.round(input.minVisitors ?? 0))}, ${account.id}::uuid, ${account.id}::uuid)
    returning id
  `);
  const id = String(made.id);
  const copy = await makeVersionPage(account, storeId, original, id, "b", `${original.title} (B)`, targetType);
  if (!copy.ok) {
    await db().execute(sql`delete from commerce.experiments where id = ${id}::uuid`);
    return copy;
  }
  const [a, b] = evenSplit(2);
  await db().execute(sql`
    insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
    values (${storeId}::uuid, ${id}::uuid, 'a', 'Original', null, ${a}), (${storeId}::uuid, ${id}::uuid, 'b', 'Version B', ${copy.id}::uuid, ${b})
  `);
  await audit(account.id, storeId, "experiment.created", { experiment: id, page: input.pageId, goal: input.goal, ...(part && { part: part.id, partKind: part.kind }) });
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
  const copy = await makeVersionPage(account, storeId, original, id, key, `${original.title} (${key.toUpperCase()})`, test.page.type);
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

/** What is wrong with a test about to start or be scheduled, in words; empty when it can. */
async function checkStart(storeId: string, test: ExperimentInfo): Promise<string[]> {
  const [special] = await db().execute<Row>(sql`
    select (s.front_page_id = ${test.page.id}::uuid or s.products_page_id = ${test.page.id}::uuid
      or exists (select 1 from commerce.page_roles r where r.store_id = s.id and r.page_id = ${test.page.id}::uuid and not r.role = any(${WORKING_ROLE_LIST}::text[]))) as special,
      (select count(*) from commerce.experiments e where e.store_id = s.id and e.status = 'running' and e.id <> ${test.id}::uuid)::int as running
    from commerce.stores s where s.id = ${storeId}::uuid
  `);
  const problems = startProblems({
    name: test.name,
    goal: test.goal,
    goalBlock: test.goalBlock,
    trafficShare: test.trafficShare,
    variants: test.variants.map((v) => ({ key: v.key, name: v.name, share: v.share, published: v.published, scope: v.scope })),
    pagePublished: test.page.published,
    runningInStore: Number(special?.running ?? 0),
    pageIsSpecial: Boolean(special?.special),
    needsPart: test.page.kind === "role" && !test.part,
    partLabel: test.part?.label ?? null,
  });
  for (const v of test.variants) if (v.key !== "a" && !v.changed) problems.push(`Version ${v.key.toUpperCase()} is still the same as the original: change it first, or the test has nothing to find.`);
  return problems;
}

/** What would stop a test from starting, in words (empty when it can): the owner is never asked to approve what could not be done. */
export async function startProblemsOf(storeId: string, id: string): Promise<string[]> {
  const test = await getExperiment(storeId, id);
  if (!test) return ["This test no longer exists."];
  if (test.status !== "draft" && test.status !== "scheduled") return ["This test has already started."];
  return checkStart(storeId, test);
}

/**
 * Starts a test (from a draft, or a scheduled one that is due or started by hand): checked in words first, then by the
 * database, which refuses anything the checks missed. `account` is null when the scheduler starts it.
 */
export async function startExperiment(account: Account | null, storeId: string, id: string): Promise<Outcome> {
  const test = await getExperiment(storeId, id);
  if (!test) return { ok: false, problems: ["This test no longer exists."] };
  if (test.status !== "draft" && test.status !== "scheduled") return { ok: false, problems: ["This test has already started."] };
  const problems = await checkStart(storeId, test);
  if (problems.length > 0) return { ok: false, problems };
  try {
    await db().execute(sql`update commerce.experiments set status = 'running', updated_by = ${account?.id ?? null}::uuid, updated_at = now() where id = ${id}::uuid and store_id = ${storeId}::uuid`);
  } catch (error) {
    return { ok: false, problems: [databaseProblem(error) ?? "The test could not be started."] };
  }
  forgetRunning(storeId);
  refreshTag(experimentsTag(storeId));
  await audit(account?.id ?? null, storeId, test.status === "scheduled" ? "experiment.started_scheduled" : "experiment.started", {
    experiment: id,
    page: test.page.id,
    goal: test.goal,
    ...(test.part && { part: test.part.id }),
  });
  return { ok: true };
}

/** Lets a test that is ready start by itself at a time (in the future): the same checks as a start, made now and again then. */
export async function scheduleExperiment(account: Account, storeId: string, id: string, at: Date): Promise<Outcome> {
  const test = await getExperiment(storeId, id);
  if (!test) return { ok: false, problems: ["This test no longer exists."] };
  if (test.status !== "draft" && test.status !== "scheduled") return { ok: false, problems: ["This test has already started."] };
  if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now() + 60_000) return { ok: false, problems: ["Choose a time in the future."] };
  if (at.getTime() > Date.now() + 90 * 86_400_000) return { ok: false, problems: ["A test can be scheduled at most 90 days ahead."] };
  const problems = await checkStart(storeId, test);
  if (problems.length > 0) return { ok: false, problems };
  try {
    if (test.status === "scheduled") {
      await db().execute(sql`update commerce.experiments set scheduled_start = ${at.toISOString()}::timestamptz, updated_by = ${account.id}::uuid, updated_at = now() where id = ${id}::uuid and store_id = ${storeId}::uuid`);
    } else {
      await db().execute(sql`
        update commerce.experiments set status = 'scheduled', scheduled_start = ${at.toISOString()}::timestamptz, schedule_problem = null, updated_by = ${account.id}::uuid, updated_at = now()
        where id = ${id}::uuid and store_id = ${storeId}::uuid
      `);
    }
  } catch (error) {
    return { ok: false, problems: [databaseProblem(error) ?? "The test could not be scheduled."] };
  }
  await audit(account.id, storeId, "experiment.scheduled", { experiment: id, at: at.toISOString() });
  return { ok: true };
}

/** Takes a scheduled test back to a draft, to be changed or started by hand. `problem` says why a scheduled start did not happen. */
export async function unscheduleExperiment(account: Account | null, storeId: string, id: string, problem: string | null = null): Promise<Outcome> {
  const test = await getExperiment(storeId, id);
  if (!test) return { ok: false, problems: ["This test no longer exists."] };
  if (test.status !== "scheduled") return { ok: false, problems: ["This test is not scheduled."] };
  await db().execute(sql`
    update commerce.experiments set status = 'draft', schedule_problem = ${problem}, updated_by = ${account?.id ?? null}::uuid, updated_at = now()
    where id = ${id}::uuid and store_id = ${storeId}::uuid and status = 'scheduled'
  `);
  await audit(account?.id ?? null, storeId, "experiment.unscheduled", { experiment: id, ...(problem && { problem }) });
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
  refreshTag(experimentsTag(storeId));
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
    if (test.part) {
      // A test of a part changes that part only, in the page as it is now: what was edited elsewhere since is kept.
      const [now] = await tx.execute<Row>(sql`select draft, published from commerce.pages where id = ${test.page.id}::uuid and store_id = ${storeId}::uuid and type = ${test.page.type} for update`);
      const published = parsePageContent(now?.published);
      const draft = parsePageContent(now?.draft);
      const target = { id: test.part.id, kind: test.part.kind };
      const merged = published ? applyPart(published, content, target) : null;
      if (!merged) return false;
      // The draft keeps its unpublished edits when it still has the part; otherwise it is the published page.
      const mergedDraft = (draft ? applyPart(draft, content, target) : null) ?? merged;
      await tx.execute(sql`
        update commerce.pages set draft = ${JSON.stringify(mergedDraft)}::jsonb, published = ${JSON.stringify(merged)}::jsonb, published_at = now(), updated_at = now(), updated_by = ${account.id}::uuid
        where id = ${test.page.id}::uuid and store_id = ${storeId}::uuid and type = ${test.page.type}
      `);
    } else {
      const next = JSON.stringify({ ...content, slug: test.page.slug });
      await tx.execute(sql`
        update commerce.pages set draft = ${next}::jsonb, published = ${next}::jsonb, published_at = now(), updated_at = now(), updated_by = ${account.id}::uuid
        where id = ${test.page.id}::uuid and store_id = ${storeId}::uuid and type = ${test.page.type}
      `);
    }
    await tx.execute(sql`update commerce.experiments set status = 'applied', applied_variant = ${key}, updated_by = ${account.id}::uuid, updated_at = now() where id = ${id}::uuid and store_id = ${storeId}::uuid`);
    return true;
  });
  if (!done) return { ok: false, problems: [test.part ? `That version could not be applied: the page no longer has ${test.part.label}, or the version could not be read.` : "That version could not be read."] };
  refreshTag(pagesTag(storeId));
  refreshTag(experimentsTag(storeId));
  await audit(account.id, storeId, "experiment.applied", { experiment: id, variant: key, page: test.page.id, ...(test.part && { part: test.part.id }) });
  return { ok: true };
}

/** Keeps the original: the test is discarded. */
export async function discardExperiment(account: Account, storeId: string, id: string): Promise<Outcome> {
  const test = await getExperiment(storeId, id);
  if (!test) return { ok: false, problems: ["This test no longer exists."] };
  if (!NEXT_STATUSES[test.status].includes("discarded")) return { ok: false, problems: ["This test cannot be discarded now."] };
  await db().execute(sql`update commerce.experiments set status = 'discarded', updated_by = ${account.id}::uuid, updated_at = now() where id = ${id}::uuid and store_id = ${storeId}::uuid`);
  refreshTag(experimentsTag(storeId));
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

/**
 * The running test a page is part of, as the original or as a version: its published content is what visitors are being
 * compared on, so publishing a change to it waits until the test stops. Null when the page is free.
 */
export async function runningTestOf(storeId: string, pageId: string): Promise<{ id: string; name: string } | null> {
  const [row] = await db().execute<Row>(sql`
    select e.id, e.name from commerce.experiments e
    where e.store_id = ${storeId}::uuid and e.status = 'running'
      and (e.target_page_id = ${pageId}::uuid or exists (select 1 from commerce.experiment_variants v where v.experiment_id = e.id and v.page_id = ${pageId}::uuid))
    limit 1
  `);
  return row ? { id: String(row.id), name: String(row.name) } : null;
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
