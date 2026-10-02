import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { targetLabel } from "@/lib/ab-site";
import { applyChanges, offeredBlocks, partOf } from "@/lib/experiment-tools";
import { compareToOriginal, estimateRuntime, normalQuantile } from "@/lib/experiment-results";
import { GOAL_WORDS, MAX_RUNNING_PER_STORE, STATUS_WORDS, type Goal } from "@/lib/experiments";
import { findClaims } from "@/lib/claims";
import { formatMoney } from "@/lib/money";
import type { OwnerToolInput } from "@/lib/owner-tools";

import { audit } from "./auth";
import {
  buttonsOf,
  createExperiment,
  deleteDraft,
  discardExperiment,
  getExperiment,
  listExperiments,
  publishedContentOf,
  applyVariant,
  startExperiment,
  startProblemsOf,
  stopExperiment,
  testablePages,
  type ExperimentInfo,
} from "./experiment-admin";
import { experimentResults } from "./experiment-results";
import { OwnerToolError } from "./owner-tool-error";
import { salesFunnel } from "./owner-insights";
import { savePage } from "./pages";
import type { Store } from "./stores";

type Row = Record<string, unknown>;
type Ctx = { account: import("./auth").Account; store: Store; invalidate: (tag: string) => void };

/**
 * The AI manager's A/B test tools (D148, phase 4). The assistant suggests, words and drafts; the store counts, checks and
 * decides what is true: figures and verdicts come from `experimentResults()`, the words it writes pass the claims filter and
 * the lengths, and a draft is never live. Starting, stopping and choosing a winner change what visitors see, so they are
 * kept for the owner's yes (`public`), checked first so they are never asked to approve what could not be done.
 */

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const mainLocale = (store: Store) => store.markets[0]?.locale ?? "en";
const percent = (share: number, digits = 1) => `${(share * 100).toLocaleString("en-GB", { maximumFractionDigits: digits })} %`;
const adminLink = (store: Store, path: string) => `/admin/${store.slug}${path}`;
const when = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/** A test by its name (any case) or id, the store's only; a name that fits several says so. */
async function findTest(store: Store, ref: string): Promise<ExperimentInfo> {
  const all = await listExperiments(store.id);
  const lower = ref.trim().toLowerCase();
  const hits = all.filter((t) => t.id === ref.trim() || t.name.toLowerCase() === lower);
  if (hits.length === 0) return fail(`No A/B test "${ref}" in this store. Use list_experiments to find it.`);
  if (hits.length > 1) return fail(`Several tests are called "${ref}": give the id from list_experiments.`);
  return hits[0];
}

const claimsIn = (...texts: string[]) => [...new Set(texts.flatMap((text) => findClaims(text).map((c) => c.phrase)))];

const targetWords = (t: ExperimentInfo) => `${targetLabel(t.page.kind, t.page.slug, t.page.title, t.page.role)}${t.part ? `, ${t.part.label}` : ""}`;

// Reading ---------------------------------------------------------------------------------------------

export async function listExperimentsTool({ store }: Ctx, { limit }: OwnerToolInput<"list_experiments">) {
  const tests = (await listExperiments(store.id)).slice(0, limit);
  const rows = await Promise.all(
    tests.map(async (t) => {
      // The verdict is worked out for a test that is counting or has just stopped: the rest are history.
      const verdict = t.status === "running" || t.status === "stopped" ? (await experimentResults(store, t)).verdict : null;
      return {
        id: t.id,
        name: t.name,
        status: STATUS_WORDS[t.status],
        tests: targetWords(t),
        improves: GOAL_WORDS[t.goal].label,
        versions: t.variants.map((v) => v.name),
        visitors_counted: t.exposed,
        started: when(t.startedAt),
        starts: t.status === "scheduled" ? when(t.scheduledStart) : undefined,
        planned_end: t.status === "running" ? when(t.plannedEnd) : undefined,
        winner: t.status === "applied" ? t.variants.find((v) => v.key === t.appliedVariant)?.name : undefined,
        verdict: verdict ? { kind: verdict.kind, headline: verdict.headline } : undefined,
      };
    }),
  );
  return {
    tests: rows,
    running: tests.filter((t) => t.status === "running").length,
    most_at_once: MAX_RUNNING_PER_STORE,
    note: tests.length === 0 ? "No A/B tests yet. suggest_experiments helps choose one." : "Verdicts are worked out by the store; explain_results gives the detail.",
    admin: adminLink(store, "/experiments"),
  };
}

export async function explainResultsTool(ctx: Ctx, { experiment }: OwnerToolInput<"explain_results">) {
  const { store } = ctx;
  const test = await findTest(store, experiment);
  const base = {
    test: {
      id: test.id,
      name: test.name,
      status: STATUS_WORDS[test.status],
      tests: targetWords(test),
      improves: GOAL_WORDS[test.goal].label,
      hypothesis: test.hypothesis || undefined,
      started: when(test.startedAt),
      stopped: when(test.stoppedAt),
      stop_reason: test.stopReason === "guardrail" ? "Kaizen stopped it because a version was clearly selling less." : test.stopReason === "planned_end" ? "It stopped itself at its planned end." : undefined,
      winner: test.status === "applied" ? (test.variants.find((v) => v.key === test.appliedVariant)?.name ?? "the original") : undefined,
    },
    admin: adminLink(store, `/experiments/${test.id}`),
  };
  if (test.status === "draft" || test.status === "scheduled") {
    const problems = await startProblemsOf(store.id, test.id);
    return {
      ...base,
      results: "None yet: the test has not started.",
      what_is_left: problems.length > 0 ? problems : ["Nothing: it can be started (start_experiment, which needs the owner's approval)."],
      starts: test.status === "scheduled" ? test.scheduledStart : undefined,
    };
  }
  const r = await experimentResults(store, test);
  const goal = GOAL_WORDS[test.goal];
  const original = r.figures.find((f) => f.key === "a");
  const z = normalQuantile(1 - 0.025 / Math.max(1, r.figures.length - 1));
  const locale = mainLocale(store);
  const name = (key: string) => test.variants.find((v) => v.key === key)?.name ?? key.toUpperCase();
  const versions = r.figures.map((f) => {
    const c = original && f.key !== "a" ? compareToOriginal(goal.kind, original, f, z) : null;
    const value =
      goal.kind === "rate"
        ? { who_did_it: f.conversions, rate: percent(f.visitors ? f.conversions / f.visitors : 0, 2) }
        : { revenue_per_visitor: formatMoney(Math.round(f.money && f.visitors ? f.money.sum / f.visitors : 0), r.currency, locale) };
    return {
      version: name(f.key),
      visitors: f.visitors,
      ...value,
      against_the_original: c
        ? { change: c.relative === null ? "no figure to compare with" : `${c.relative >= 0 ? "+" : "−"}${percent(Math.abs(c.relative))}`, chance_it_is_better: `${Math.round(c.chanceBetter * 100)} %` }
        : undefined,
    };
  });
  const next: string[] = [];
  if (test.status === "running") {
    if (r.verdict.kind === "few" || r.verdict.kind === "early") next.push("Keep it running: nothing can be said yet. The verdict only counts after the minimum visitors and days.");
    else if (r.verdict.kind === "better") next.push(`Stop it and use ${name(r.verdict.best ?? "b")} (apply_winner chooses it and stops the test, with the owner's approval).`, "Or keep it running longer.");
    else if (r.verdict.kind === "broken") next.push("Stop it: the visitors were not divided as promised, so the figures cannot be trusted. Start a new test.");
    else next.push("Stop it and keep the original (apply_winner with `original`), or keep it running longer, or try a bolder change.");
  } else if (test.status === "stopped") {
    next.push("Choose with apply_winner: a version, or `original` to keep what is there.");
  } else if (test.status === "applied") {
    next.push("Done: the winner is the page now.");
  }
  return {
    ...base,
    days_counted: r.days,
    verdict: { kind: r.verdict.kind, headline: r.verdict.headline, detail: r.verdict.detail },
    versions,
    what_visitors_did: test.variants.map((v) => {
      const f = r.funnel[v.key] ?? { visitors: 0, carts: 0, checkouts: 0, buyers: 0, clicks: 0 };
      return { version: v.name, saw_it: f.visitors, added_to_cart: f.carts, started_checkout: f.checkouts, ordered: f.buyers, clicked: test.goal === "click" ? f.clicks : undefined };
    }),
    revenue_without_vat: test.variants.map((v) => ({ version: v.name, revenue: formatMoney(Math.round(r.revenue[v.key]?.plain ?? 0), r.currency, locale) })),
    split_between_versions: r.splitP < 0.001 ? "Wrong: the versions did not get the share of visitors they should." : "As promised.",
    guardrail: r.harmed ? `${name(r.harmed)} is clearly selling less than the original.` : undefined,
    how_it_is_counted:
      "Only visitors who accepted statistics cookies, each counted once in the version they first saw. An order counts when it is paid, from a basket started after first seeing the version. Revenue is without VAT, in the store's main currency, with one very large order capped.",
    what_next: next,
    never: "Do not call a winner the verdict does not, and do not give a verdict of your own.",
  };
}

export async function suggestExperimentsTool({ store }: Ctx, input: OwnerToolInput<"suggest_experiments">) {
  const [targets, tests, funnel, consents, [orders]] = await Promise.all([
    testablePages(store.id),
    listExperiments(store.id),
    salesFunnel({ store }, { days: 30 }),
    db().execute<Row>(sql`
      select count(*)::int as total, count(*) filter (where choices ->> 'statistics' = 'true')::int as yes
      from commerce.consents where store_id = ${store.id}::uuid and created_at > now() - interval '90 days'
    `),
    db().execute<Row>(sql`
      select count(*)::int as n from commerce.orders o
      where o.store_id = ${store.id}::uuid and o.copied_from is null and o.placed_at > now() - interval '30 days'
        and exists (select 1 from commerce.payments p where p.order_id = o.id and p.status = 'captured')
    `),
  ]);
  const running = tests.filter((t) => t.status === "running" || t.status === "scheduled");
  const consent = consents[0];
  const sample = Number(consent?.total ?? 0) >= 20 ? Number(consent.yes) / Number(consent.total) : null;
  const candidates = await Promise.all(
    targets.slice(0, 24).map(async (t) => {
      const content = await publishedContentOf(store.id, t.id);
      const earlier = tests.filter((x) => x.page.id === t.id && (x.status === "applied" || x.status === "stopped" || x.status === "discarded")).slice(0, 2);
      return {
        target: t.kind === "page" || t.kind === "role" ? t.slug : t.kind === "layout" ? t.title : t.kind,
        kind: t.kind,
        title: t.title,
        // A working page (the cart, the checkout, …): one block or part around the shop's own component, never the page as a whole.
        working_page: t.kind === "role" && t.partOnly ? `${t.role}: test one block at a time (a heading, a text, a button around the shop's own component), never the whole page` : undefined,
        place: t.kind === "role" && !t.partOnly ? `the store's ${t.role === "front" ? "front page" : "All products page"}: a test of the whole page or of one part of it` : undefined,
        rows: content?.rows.length ?? 0,
        buttons: buttonsOf(content).map((b) => b.label),
        blocks: content ? offeredBlocks(content) : [],
        earlier_tests: earlier.length > 0 ? earlier.map((x) => ({ name: x.name, status: STATUS_WORDS[x.status], tested: x.part?.label })) : undefined,
      };
    }),
  );
  const estimate =
    input.visitors_per_day && input.current_rate_percent
      ? estimateRuntime({ baseline: input.current_rate_percent / 100, relativeChange: input.change_percent / 100, versions: 2, eligiblePerDay: input.visitors_per_day, trafficShare: 1 })
      : null;
  return {
    can_be_tested: candidates,
    running_or_scheduled: running.map((t) => ({ name: t.name, tests: targetWords(t), status: STATUS_WORDS[t.status] })),
    room_for_more: Math.max(0, MAX_RUNNING_PER_STORE - tests.filter((t) => t.status === "running").length),
    who_takes_part: sample === null ? "Too few cookie choices recorded to say how many visitors accept statistics cookies." : `About ${Math.round(sample * 100)} % of the visitors who made a cookie choice in the last 90 days accepted statistics cookies: only they are in a test.`,
    paid_orders_last_30_days: Number(orders?.n ?? 0),
    from_cart_to_paid_order: { carts_with_products: funnel.carts_with_products, paid: funnel.orders_paid, share: funnel.from_filled_cart_to_paid },
    how_long: estimate ? { about_days: estimate.days, sentence: estimate.sentence } : "Ask the owner roughly how many visitors a day see the page and what share of them do the thing now (visitors_per_day, current_rate_percent): Kaizen does not count page views, so do not guess. A small store needs a bolder change or a goal with more activity (adding to the cart, or a click).",
    rules: [
      "One thing at a time, so the owner knows what made the difference.",
      "Prices, discounts, shipping and legal pages are never tested.",
      "Say that nothing is started without the owner's yes: draft_experiment makes a draft, start_experiment needs their approval.",
    ],
    admin: adminLink(store, "/experiments/new"),
  };
}

// Drafting ---------------------------------------------------------------------------------------------

/** What to test, by an id, a page's address, `header`, `footer` or a layout's title, among what can be tested now. */
async function findTarget(store: Store, ref: string) {
  const targets = await testablePages(store.id);
  const lower = ref.trim().toLowerCase();
  const hits = targets.filter((t) => t.id === ref.trim() || (t.kind === "page" && t.slug === lower) || (t.kind === "header" && lower === "header") || (t.kind === "footer" && lower === "footer") || (t.kind === "layout" && t.title.toLowerCase() === lower));
  if (hits.length === 0) return fail(`"${ref}" cannot be tested now: it must be a published page (the front page and the All products page can be tested, other pages with a place of their own cannot, except a working page by a part), the header or footer the store uses, or a product layout in use, and not already in a running test. suggest_experiments lists what can.`);
  if (hits.length > 1) return fail(`Several things fit "${ref}": give the id from suggest_experiments.`);
  return hits[0];
}

export async function draftExperimentTool(ctx: Ctx, input: OwnerToolInput<"draft_experiment">) {
  const { store, account } = ctx;
  const target = await findTarget(store, input.target);
  const original = await publishedContentOf(store.id, target.id);
  if (!original) return fail("Publish it first: a test starts from what is published.");
  // Every word the assistant writes is checked before anything is made.
  const claims = claimsIn(...(input.name ? [input.name] : []), ...(input.hypothesis ? [input.hypothesis] : []), ...input.changes.map((c) => c.text));
  if (claims.length > 0) return fail(`Rewrite without claims the store cannot back: ${claims.join(", ")}.`);
  const dry = applyChanges(original, input.changes);
  if (!dry.ok) return fail(dry.problem);
  let goalBlock: string | null = null;
  if (input.goal === "click") {
    if (!input.button) return fail("For the goal click, name the button whose clicks should count (button).");
    const hits = buttonsOf(original).filter((b) => b.label.toLowerCase() === input.button!.toLowerCase());
    if (hits.length === 0) return fail(`The page has no button "${input.button}". suggest_experiments lists its buttons.`);
    goalBlock = hits[0].id;
  }
  const part = partOf(input.changes);
  const made = await createExperiment(account, store.id, {
    name: input.name?.trim() || (part ? `Test of ${target.title}` : `Test of ${target.title}`),
    hypothesis: input.hypothesis,
    pageId: target.id,
    goal: input.goal,
    goalBlock,
    trafficShare: input.traffic_percent / 100,
    part,
  });
  if (!made.ok) return fail(made.problems.join(" "));
  // The words go into version B only; the original is never touched.
  if (input.changes.length > 0) {
    const test = (await getExperiment(store.id, made.id))!;
    const b = test.variants.find((v) => v.key === "b");
    const copy = b?.pageId ? await publishedContentOf(store.id, b.pageId) : null;
    const applied = copy ? applyChanges(copy, input.changes) : null;
    const saved = applied?.ok && b?.pageId ? await savePage(account, store.id, b.pageId, applied.content, { publish: true, type: "variant", variantOf: test.page.type }) : null;
    if (!applied?.ok || !saved?.ok) {
      await deleteDraft(account, store.id, made.id);
      return fail(applied && !applied.ok ? applied.problem : saved && !saved.ok ? saved.problems.join(" ") : "The version could not be written.");
    }
  }
  await audit(account.id, store.id, "experiment.drafted_by_assistant", { experiment: made.id, target: target.id, changes: input.changes.length });
  const test = (await getExperiment(store.id, made.id))!;
  return {
    done: `A draft A/B test "${test.name}" is made: version B of ${targetWords(test)}${input.changes.length > 0 ? ` with ${input.changes.length === 1 ? "your new words" : `${input.changes.length} changes`}` : " as an unchanged copy to edit"}. Nothing is shown to visitors yet.`,
    id: test.id,
    tests: part ? `${test.part?.label} only` : `the whole ${target.kind === "page" ? "page" : target.kind}`,
    improves: GOAL_WORDS[test.goal as Goal].label,
    next: input.changes.length > 0 ? "Ask the owner to look at version B in the admin (the link), then start it with start_experiment, which needs their approval." : "Version B is a copy of the original: the owner changes it in the page builder (the link) before it can start.",
    admin: adminLink(store, `/experiments/${test.id}`),
  };
}

// Deciding (gated) ---------------------------------------------------------------------------------

export async function startExperimentTool(ctx: Ctx, { experiment }: OwnerToolInput<"start_experiment">) {
  const test = await findTest(ctx.store, experiment);
  const result = await startExperiment(ctx.account, ctx.store.id, test.id);
  if (!result.ok) return fail(result.problems.join(" "));
  return { done: `The A/B test "${test.name}" is running. It needs at least ${test.minDays} days before it says anything.`, admin: adminLink(ctx.store, `/experiments/${test.id}`) };
}

export async function stopExperimentTool(ctx: Ctx, { experiment }: OwnerToolInput<"stop_experiment">) {
  const test = await findTest(ctx.store, experiment);
  const result = await stopExperiment(ctx.account, ctx.store.id, test.id, "person");
  if (!result.ok) return fail(result.problems.join(" "));
  return { done: `The A/B test "${test.name}" is stopped: everyone sees the original again. Choose a version or keep the original with apply_winner.`, admin: adminLink(ctx.store, `/experiments/${test.id}`) };
}

export async function applyWinnerTool(ctx: Ctx, { experiment, version }: OwnerToolInput<"apply_winner">) {
  const { store, account } = ctx;
  const test = await findTest(store, experiment);
  if (test.status === "running") {
    const stopped = await stopExperiment(account, store.id, test.id, "person");
    if (!stopped.ok) return fail(stopped.problems.join(" "));
  }
  const result = version === "original" ? await discardExperiment(account, store.id, test.id) : await applyVariant(account, store.id, test.id, version);
  if (!result.ok) return fail(result.problems.join(" "));
  return {
    done: version === "original" ? `The A/B test "${test.name}" is over and the original stays.` : `Version ${version.toUpperCase()} is now ${test.part ? test.part.label : "the page"} (${targetLabel(test.page.kind, test.page.slug, test.page.title, test.page.role)}). The test is over.`,
    admin: adminLink(store, `/experiments/${test.id}`),
  };
}

/**
 * Checks a gated A/B call before it is kept for approval, so the owner is never asked to approve what could not be done:
 * the test exists, and is in a state the call can act on; a start must pass the same checks as a start in the admin.
 */
export async function preflightExperimentTool(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<void> {
  const test = await findTest(ctx.store, String(input.experiment ?? ""));
  if (name === "start_experiment") {
    if (test.status !== "draft" && test.status !== "scheduled") return fail(`"${test.name}" is ${STATUS_WORDS[test.status].toLowerCase()}, not a draft.`);
    const problems = await startProblemsOf(ctx.store.id, test.id);
    if (problems.length > 0) return fail(`It cannot start yet: ${problems.join(" ")}`);
    return;
  }
  if (name === "stop_experiment") {
    if (test.status !== "running") return fail(`"${test.name}" is ${STATUS_WORDS[test.status].toLowerCase()}, not running.`);
    return;
  }
  if (test.status !== "running" && test.status !== "stopped") return fail(`"${test.name}" is ${STATUS_WORDS[test.status].toLowerCase()}: only a running or stopped test can be decided.`);
  if (input.version !== "original" && !test.variants.some((v) => v.key === input.version && v.pageId)) return fail(`"${test.name}" has no version ${String(input.version).toUpperCase()}.`);
}

/** What the owner is asked to say yes to, written from the test itself (not the model's words). */
export async function experimentApprovalSummary(store: Store, tool: string, args: Record<string, unknown>): Promise<string | null> {
  let test: ExperimentInfo;
  try {
    test = await findTest(store, String(args.experiment ?? ""));
  } catch {
    return null;
  }
  const what = `"${test.name}" (${targetWords(test)}; ${GOAL_WORDS[test.goal].label.toLowerCase()})`;
  if (tool === "start_experiment") {
    return `Start the A/B test ${what}: ${test.variants.length} versions, ${Math.round(test.trafficShare * 100)} % of the visitors who accepted statistics cookies, at least ${test.minDays} days. They see their version from their next page view; you can stop it at any time.`;
  }
  if (tool === "stop_experiment") return `Stop the A/B test ${what}: everyone sees the original again, and what was counted is kept.`;
  const version = String(args.version);
  const chosen = test.variants.find((v) => v.key === version);
  const stopFirst = test.status === "running" ? "Stop the test, then " : "";
  return version === "original"
    ? `${stopFirst}end the A/B test ${what} and keep the original.`
    : `${stopFirst}make ${chosen?.name ?? `version ${version.toUpperCase()}`} ${test.part ? `replace ${test.part.label}` : "the page"} for good in the A/B test ${what}: it goes live at once, the address stays.`;
}
