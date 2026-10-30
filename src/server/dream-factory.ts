import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { autonomySettingsSchema } from "@/lib/autopilot-autonomy";
import {
  DREAM_STEPS,
  DREAM_TRIES,
  PROMPT_MAX,
  PROMPT_MIN,
  FRONT_FIX_TOOLS,
  STEP_TOOLS,
  frontFixMessage,
  answeredBrief,
  briefPrompt,
  briefSchema,
  briefQuestions,
  initialSteps,
  isTestOwner,
  ownerWaitMs,
  passed,
  readBrief,
  readSteps,
  runStatusOf,
  scoreOf,
  startable,
  stepMessage,
  stepOf,
  type AiStepId,
  type DreamBrief,
  type DreamScore,
  type DreamStepId,
  type DreamSteps,
  type RunStatus,
  type StepState,
} from "@/lib/dream-factory";
import { STARTER_ROLES, type StarterRole } from "@/lib/legal-starters";
import { featureOn } from "@/lib/store-features";

import { actingAs } from "./actor";
import { aiFor, completeText, type AiConnection } from "./ai";
import { audit, passMembership, type Account, type Membership } from "./auth";
import { isDemoProduct } from "./demo-content";
import { createLegalStarter } from "./legal-starters";
import { legalWrites, turnOnLegalAi } from "./legal-writer";
import { log } from "./log";
import { runTurn, type Principal, type TurnInput } from "./owner-assistant";
import { setFrontPage } from "./pages";
import { saveCurrencies } from "./localization";
import { backToRule, marketPriceRules, rateProblem, saveMarketPriceRule } from "./market-prices";
import { memberCan } from "./permissions";
import type { SaveResult } from "./settings";
import { setFeature } from "./store-features";
import { createStoreForOwner } from "./platform";
import { refreshTag } from "./refresh";
import { archiveDemoProducts, getSetupProgress } from "./setup";
import { checkupFindings } from "./store-checkup";
import { draftStore, openDraft, publishDraft } from "./store-drafts";
import { storeTag, type Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The Dream Factory's conductor (D409, `docs/dream-factory.md`): a run from an owner's description to a store ready to open. Every minute
 * (`/api/cron/dream-factory`) the runs due are claimed one at a time; each starts the steps whose needs have passed (`startable()`) and runs
 * them: the AI's as a turn of the AI manager in the owner's name, limited to the step's tools and at *Just do it* for the areas a store being
 * set up needs (nothing reaches the public before it opens); code's by the screens' own functions; the owner's wait for their press. Every
 * step then meets a check made here against the store's rows, never the model's word: a check that fails three times becomes a question
 * for the owner (a test run fails instead). The run is written only here.
 */

type Row = Record<string, unknown>;

/** A turn of the AI manager takes two minutes at most (as an autopilot step's), so the minute's run ends within its route's time. */
const TURN_MS = 120_000;
/** How long a run is held by the cron run working on it. */
const CLAIM_MINUTES = 5;
/** The run's steps that wait on background work (page builds, legal writes) fail after this. */
const WAIT_MINUTES = 60;
/** Checkup findings that stop a store from being ready to open (the others are what a new store has, such as test payments). */
const BLOCKING_CHECKUP = new Set(["setup", "drafts", "numbering", "stock_history"]);
/** Areas a run may act in without asking: what setting up a store that is not open yet changes. Money and messages always ask. */
const RUN_LEVELS = { catalogue: "auto", website: "auto", design: "auto", setup: "auto" } as const;

export type DreamRun = {
  id: string;
  storeId: string;
  accountId: string | null;
  prompt: string;
  test: boolean;
  status: RunStatus | "stopped";
  brief: DreamBrief | null;
  steps: DreamSteps;
  conversationId: string | null;
  ownerPresses: number;
  createdAt: Date;
  readyAt: Date | null;
  finishedAt: Date | null;
};

const runRow = z.object({
  id: col.uuid,
  store_id: col.uuid,
  account_id: col.uuid.nullable(),
  prompt: col.text,
  test: col.bool,
  status: col.text,
  brief: z.unknown().nullable(),
  steps: z.unknown(),
  conversation_id: col.uuid.nullable(),
  owner_presses: col.int,
  created_at: col.timestamp,
  ready_at: col.timestampOrNull,
  finished_at: col.timestampOrNull,
});

const RUN_COLUMNS = sql`id, store_id, account_id, prompt, test, status, brief, steps, conversation_id, owner_presses, created_at, ready_at, finished_at`;

function toRun(row: z.output<typeof runRow>): DreamRun {
  // The brief as kept: its business details were checked against the owner's words when it was made (`readBrief()`).
  const brief = row.brief ? (briefSchema.safeParse(row.brief).data ?? null) : null;
  return {
    id: row.id,
    storeId: row.store_id,
    accountId: row.account_id,
    prompt: row.prompt,
    test: row.test,
    status: row.status as DreamRun["status"],
    brief,
    steps: readSteps(row.steps),
    conversationId: row.conversation_id,
    ownerPresses: row.owner_presses,
    createdAt: new Date(row.created_at),
    readyAt: row.ready_at ? new Date(row.ready_at) : null,
    finishedAt: row.finished_at ? new Date(row.finished_at) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Starting, the owner's presses, reading
// ---------------------------------------------------------------------------------------------------------------------------------

export type StartResult = { ok: true; id: string } | { ok: false; problem: string };

/**
 * Starts a run for a store from its owner's description: refused for anyone but an owner, a description of the wrong length, or while
 * another run of the store is going. The description is the owner's first press. A run whose owner is at the drills' test address is a test.
 */
export async function startDreamRun(member: Pick<Membership, "account" | "store" | "role" | "permissions" | "kind">, prompt: string): Promise<StartResult> {
  if (!memberCan(member, "owner")) return { ok: false, problem: "Only an owner of the store can start the Dream Factory." };
  const text = prompt.trim();
  if (text.length < PROMPT_MIN || text.length > PROMPT_MAX) {
    return { ok: false, problem: `Describe the store in ${PROMPT_MIN} to ${PROMPT_MAX} characters.` };
  }
  const test = isTestOwner(member.account.email);
  const [row] = await db().execute<Row>(sql`
    insert into commerce.dream_runs (store_id, account_id, prompt, test, steps)
    values (${member.store.id}::uuid, ${member.account.id}::uuid, ${text}, ${test}, ${JSON.stringify(initialSteps())}::jsonb)
    on conflict do nothing
    returning id
  `);
  if (!row) return { ok: false, problem: "The Dream Factory is already building this store." };
  const id = String(row.id);
  await audit(member.account.id, member.store.id, "store.dream_started", { run: id, test }, { area: "website", target: { type: "store", id: member.store.id } });
  log("info", "dream_factory.started", { run: id, test });
  return { ok: true, id };
}

export type StartStoreResult = { ok: true; slug: string; run: StartResult } | { ok: false; problems: string[] };

/**
 * A new store built by the Dream Factory, from Your stores: an owner of another store (within their plan's stores) or a platform admin
 * makes it as *Create a store* would, from the Standard store, and its run starts at once in their name. A description of the wrong length
 * makes no store; a store whose run could not start is kept, and its Dream Factory page offers to start one.
 */
export async function startDreamStore(account: Account, input: { name: string; slug: string; prompt: string }): Promise<StartStoreResult> {
  const prompt = input.prompt.trim();
  if (prompt.length < PROMPT_MIN || prompt.length > PROMPT_MAX) {
    return { ok: false, problems: [`Describe the store in ${PROMPT_MIN} to ${PROMPT_MAX} characters.`] };
  }
  const made = await createStoreForOwner(account, input.name, input.slug);
  if (!made.ok) return made;
  const member = await passMembership(made.slug, account.id);
  const run = member ? await startDreamRun(member, prompt) : ({ ok: false, problem: "The new store has no owner." } as const);
  if (!run.ok) log("warn", "dream_factory.store_run_not_started", { store: made.storeId });
  return { ok: true, slug: made.slug, run };
}

/** The store's newest run, for its Dream Factory page. */
export async function latestDreamRun(storeId: string): Promise<DreamRun | null> {
  const row = await typedRow(runRow, sql`select ${RUN_COLUMNS} from commerce.dream_runs where store_id = ${storeId}::uuid order by created_at desc limit 1`);
  return row ? toRun(row) : null;
}

export type DreamRunSummary = DreamRun & { storeName: string; storeSlug: string; score: DreamScore };

/** The newest runs on the platform, for the scorecard on Platform → AI. */
export async function recentDreamRuns(limit = 20): Promise<DreamRunSummary[]> {
  const rows = await typedRows(
    runRow.extend({ store_name: col.text, store_slug: col.text }),
    sql`select r.id, r.store_id, r.account_id, r.prompt, r.test, r.status, r.brief, r.steps, r.conversation_id, r.owner_presses, r.created_at,
          r.ready_at, r.finished_at, s.name as store_name, s.slug as store_slug
        from commerce.dream_runs r join commerce.stores s on s.id = r.store_id
        order by r.created_at desc limit ${limit}`,
  );
  const now = new Date();
  return rows.map((row) => {
    const run = toRun(row);
    return { ...run, storeName: row.store_name, storeSlug: row.store_slug, score: scoreOf({ ...run, ownerWaitMs: ownerWaitMs(run.steps, now) }) };
  });
}

type OwnerAction = { ok: true } | { ok: false; problem: string };

async function ownedRun(member: Pick<Membership, "account" | "store" | "role" | "permissions" | "kind">, runId: string): Promise<DreamRun | null> {
  if (!memberCan(member, "owner")) return null;
  const row = await typedRow(runRow, sql`select ${RUN_COLUMNS} from commerce.dream_runs where id = ${runId}::uuid and store_id = ${member.store.id}::uuid`);
  return row ? toRun(row) : null;
}

/** The owner's answers to the brief's questions: the run goes on when nothing is left to ask. */
export async function answerDreamBrief(member: Membership, runId: string, answers: unknown): Promise<OwnerAction> {
  const run = await ownedRun(member, runId);
  if (!run || !run.brief || run.steps.brief.status !== "asking") return { ok: false, problem: "Nothing is waiting for an answer." };
  let brief: DreamBrief;
  try {
    brief = answeredBrief(run.brief, answers);
  } catch {
    return { ok: false, problem: "Check the answers: a country is its two-letter code, such as NO." };
  }
  const left = briefQuestions(brief);
  const steps = { ...run.steps, brief: { ...run.steps.brief, ...(left.length === 0 ? { status: "done" as const, finishedAt: now() } : {}), detail: left.join(" ") || "Answered." } };
  await save(run.id, { brief, steps, presses: 1 });
  return { ok: true };
}

/** The owner's yes to the brief (step 1b): the lanes start. */
export async function confirmDreamBrief(member: Membership, runId: string): Promise<OwnerAction> {
  const run = await ownedRun(member, runId);
  if (!run || run.steps.confirm.status !== "asking") return { ok: false, problem: "The brief is not waiting for a yes." };
  await save(run.id, { steps: { ...run.steps, confirm: { ...run.steps.confirm, status: "done", finishedAt: now(), detail: "Confirmed by the owner." } }, presses: 1 });
  return { ok: true };
}

/** A step that became a question after three tries is tried again on the owner's press. */
export async function retryDreamStep(member: Membership, runId: string, step: DreamStepId): Promise<OwnerAction> {
  const run = await ownedRun(member, runId);
  if (!run || stepOf(step).who === "owner" || run.steps[step].status !== "asking") return { ok: false, problem: "That step is not waiting." };
  await save(run.id, { steps: { ...run.steps, [step]: { status: "waiting", tries: 0, detail: run.steps[step].detail } }, presses: 1 });
  return { ok: true };
}

/** Stops the run: nothing more is done; what was made stays in the store. */
export async function stopDreamRun(member: Membership, runId: string): Promise<OwnerAction> {
  const run = await ownedRun(member, runId);
  if (!run || (run.status !== "running" && run.status !== "asking")) return { ok: false, problem: "The run is not going." };
  await db().execute(sql`update commerce.dream_runs set status = 'stopped', finished_at = now(), updated_at = now() where id = ${run.id}::uuid`);
  await audit(member.account.id, member.store.id, "store.dream_stopped", { run: run.id }, { area: "website", target: { type: "store", id: member.store.id } });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The minute's run
// ---------------------------------------------------------------------------------------------------------------------------------

const now = () => new Date().toISOString();

async function save(runId: string, change: { steps?: DreamSteps; brief?: DreamBrief; conversationId?: string | null; presses?: number }) {
  const [row] = await db().execute<Row>(sql`
    update commerce.dream_runs set
      steps = coalesce(${change.steps ? JSON.stringify(change.steps) : null}::jsonb, steps),
      brief = coalesce(${change.brief ? JSON.stringify(change.brief) : null}::jsonb, brief),
      conversation_id = coalesce(${change.conversationId ?? null}::uuid, conversation_id),
      owner_presses = owner_presses + ${change.presses ?? 0},
      updated_at = now()
    where id = ${runId}::uuid
    returning steps, status, test
  `);
  if (!row || row.status === "stopped") return;
  const steps = readSteps(row.steps);
  const status = runStatusOf(steps);
  await db().execute(sql`
    update commerce.dream_runs set
      status = ${status},
      ready_at = case when ${status === "ready" || status === "open" || passed(steps.rehearsal)} then coalesce(ready_at, now()) else ready_at end,
      finished_at = case when ${status === "failed" || status === "open" || (status === "ready" && passed(steps.goals))} then coalesce(finished_at, now()) else null end
    where id = ${runId}::uuid
  `);
}

export type DreamDeps = {
  turn?: (input: TurnInput) => Promise<void>;
  connection?: AiConnection | null;
  complete?: typeof completeText;
  draft?: typeof draftStore;
  publish?: typeof publishDraft;
  legalOn?: typeof turnOnLegalAi;
  /** The store's currencies saved at the ECB's rates (`saveCurrencies()`); tests stand in for the ECB. */
  currencies?: (member: Membership) => Promise<SaveResult>;
};

/**
 * The minute's work: the runs due, one at a time, while there is time. Never throws: a run that breaks is logged and the others go on.
 * Returns how many steps moved.
 */
export async function advanceDreamRuns({ deadline, deps = {} }: { deadline: number; deps?: DreamDeps }): Promise<number> {
  let moved = 0;
  while (Date.now() < deadline) {
    const [claimed] = await db().execute<Row>(sql`
      update commerce.dream_runs set claimed_until = now() + make_interval(mins => ${CLAIM_MINUTES})
      where id = (
        select id from commerce.dream_runs
        where status in ('running', 'asking', 'ready') and finished_at is null and (claimed_until is null or claimed_until < now())
        order by claimed_until nulls first, updated_at limit 1 for update skip locked
      )
      returning id
    `);
    if (!claimed) break;
    const runId = String(claimed.id);
    try {
      moved += await advanceRun(runId, deadline, deps);
    } catch (error) {
      log("error", "dream_factory.run_failed", { run: runId }, error);
    } finally {
      // Due again in a minute: the next run of the cron takes it.
      await db().execute(sql`update commerce.dream_runs set claimed_until = now() + interval '50 seconds' where id = ${runId}::uuid`);
    }
  }
  return moved;
}

type Context = { run: DreamRun; member: Membership; deps: DreamDeps; deadline: number };

/** One run's turn: the steps waiting on something are looked at again, then the ones that may start are started, one AI turn at most. */
async function advanceRun(runId: string, deadline: number, deps: DreamDeps): Promise<number> {
  const row = await typedRow(runRow, sql`select ${RUN_COLUMNS} from commerce.dream_runs where id = ${runId}::uuid`);
  if (!row) return 0;
  let run = toRun(row);
  const [store] = await typedRows(z.object({ slug: col.text }), sql`select slug from commerce.stores where id = ${run.storeId}::uuid`);
  const member = store && run.accountId ? await passMembership(store.slug, run.accountId) : null;
  if (!member || !memberCan(member, "owner")) {
    await db().execute(sql`update commerce.dream_runs set status = 'failed', finished_at = now(), updated_at = now() where id = ${run.id}::uuid`);
    log("warn", "dream_factory.no_owner", { run: run.id });
    return 0;
  }
  let moved = 0;
  let turns = 0;
  for (let pass = 0; pass < DREAM_STEPS.length && Date.now() < deadline; pass++) {
    const due = DREAM_STEPS.filter((s) => run.steps[s.id].status === "running" || run.steps[s.id].status === "asking" || startable(run.steps).includes(s.id)).map((s) => s.id);
    let changed = false;
    for (const id of due) {
      if (Date.now() >= deadline) break;
      // A turn of the AI manager takes up to two minutes: one a minute. The brief is one short answer, not a turn.
      const usesTurn = (stepOf(id).who === "ai" && id !== "brief" && run.steps[id].status !== "asking") || (id === "website" && Boolean(run.steps.website.ref));
      if (usesTurn && (turns > 0 || deadline - Date.now() < TURN_MS)) continue;
      const before = run.steps[id];
      // The store as it is now: a step earlier in this minute may have set its country, its markets or its features.
      const current = (await passMembership(store.slug, member.account.id)) ?? member;
      const after = await runStep(id, { run, member: current, deps, deadline });
      if (usesTurn) turns++;
      if (after && (JSON.stringify(after.state) !== JSON.stringify(before) || after.brief || after.presses)) {
        run = { ...run, steps: { ...run.steps, [id]: after.state }, ...(after.brief && { brief: after.brief }), ...(after.conversationId && { conversationId: after.conversationId }) };
        await save(run.id, { steps: run.steps, brief: after.brief, conversationId: after.conversationId, presses: after.presses });
        changed = true;
        moved++;
      }
    }
    if (!changed) break;
  }
  return moved;
}

type StepOutcome = { state: StepState; brief?: DreamBrief; conversationId?: string; presses?: number };

const started = (state: StepState): StepState => (state.status === "waiting" ? { ...state, status: "running", startedAt: now() } : state);
const done = (state: StepState, detail: string): StepState => ({ ...state, status: "done", finishedAt: now(), detail });
const skipped = (state: StepState, detail: string): StepState => ({ ...state, status: "skipped", finishedAt: now(), detail });
const waitingOn = (state: StepState, detail: string): StepState => ({ ...state, status: "running", detail });
const asking = (state: StepState, detail: string): StepState => ({ ...state, status: "asking", startedAt: state.startedAt ?? now(), detail });

/** A failed try: tried again next minute, and after `DREAM_TRIES` a question for the owner (a test run, with no owner to ask, fails). */
function failedTry(run: DreamRun, state: StepState, problem: string): StepState {
  const tries = state.tries + 1;
  if (tries < DREAM_TRIES) return { ...state, status: "waiting", tries, detail: problem };
  return { ...state, status: run.test ? "failed" : "asking", tries, finishedAt: run.test ? now() : undefined, detail: problem };
}

/** Background work (page builds, legal writes) given up on after `WAIT_MINUTES`. */
const waitedTooLong = (state: StepState) => Boolean(state.startedAt) && Date.now() - new Date(state.startedAt as string).getTime() > WAIT_MINUTES * 60_000;

async function runStep(id: DreamStepId, ctx: Context): Promise<StepOutcome | null> {
  const state = ctx.run.steps[id];
  switch (id) {
    case "brief":
      return state.status === "asking" ? null : briefStep(ctx);
    case "confirm":
      if (ctx.run.test) return { state: done(state, "Pressed by the drill (a test run)."), presses: 1 };
      return state.status === "asking" ? null : { state: asking(state, "Waiting for the owner's yes to the brief.") };
    case "research":
    case "setup":
    case "brand":
    case "catalogue":
    case "goals":
      return state.status === "asking" ? null : aiStep(id, ctx);
    case "website":
      return websiteStep(ctx);
    case "legal":
      return legalStep(ctx);
    case "payments":
      return paymentsStep(ctx);
    case "plan":
      return planStep(ctx);
    case "rehearsal":
      return rehearsalStep(ctx);
    case "open":
      return openStep(ctx);
  }
}

// The brief ---------------------------------------------------------------------------------------------------------------------

async function briefStep({ run, member, deps }: Context): Promise<StepOutcome> {
  const state = started(run.steps.brief);
  const connection = deps.connection !== undefined ? deps.connection : await aiFor(run.storeId, { feature: "dream_factory", accountId: member.account.id });
  if (!connection?.textModel) return { state: failedTry(run, state, "The store's AI has no text model.") };
  let answer: string;
  try {
    answer = (
      await (deps.complete ?? completeText)(
        connection,
        [
          { role: "system", content: briefPrompt(member.store.name) },
          { role: "user", content: run.prompt },
        ],
        { maxTokens: 1500, timeoutMs: 60_000 },
      )
    ).text;
  } catch (error) {
    log("warn", "dream_factory.brief_failed", { run: run.id }, error);
    return { state: failedTry(run, state, "The brief could not be written just now.") };
  }
  const brief = readBrief(answer, run.prompt);
  if (!brief) return { state: failedTry(run, state, "The brief could not be read.") };
  const questions = briefQuestions(brief);
  if (questions.length > 0) return { state: asking(state, questions.join(" ")), brief };
  return { state: done(state, `${brief.storeName}: ${brief.products} products, selling in ${brief.countries.join(", ")}.`), brief };
}

// The AI's steps ----------------------------------------------------------------------------------------------------------------

/** One turn of the AI manager on the step, in the owner's name, then the step's check. */
async function aiStep(id: AiStepId, ctx: Context): Promise<StepOutcome> {
  const { run, member } = ctx;
  const state = started(run.steps[id]);
  if (!run.brief) return { state: failedTry(run, state, "The run has no brief.") };
  // The products are made one at a time (each with its picture, which takes a while), so a turn ends well within its time.
  const progress = id === "catalogue" ? await catalogueCheck(member.store, run.brief) : null;
  if (progress?.ok) return { state: done(state, progress.detail) };
  // The owner's yes to the brief covers its countries: selling in more than one needs Several countries (D178), a switch the AI may not
  // press on its own, so code presses it here.
  if (id === "setup" && run.brief.countries.length > 1 && !featureOn(member.store, "countries")) {
    const on = await setFeature(member as Membership, "countries", true);
    if (!on.ok) return { state: failedTry(run, state, `Several countries could not be switched on: ${on.problems.join(" ")}`) };
  }
  const home = member.store.markets[0];
  // Other countries' prices are the store's rules' (set when setup passed): the model prices in the home country only, code converts.
  const ruled = id === "catalogue" ? (await marketPriceRules(member.store.id)).map((r) => r.market) : [];
  const pricing = ruled.length > 0 && home ? `\nPrices: give the price in ${home.code} (${home.currency}) only. ${ruled.join(", ")} are worked out by the store's price rules from it at the exchange rate: leave them out.` : "";
  const message =
    id === "catalogue" && progress ? `${stepMessage(id, run.brief)}${pricing}\n\nNow: ${progress.detail} Make the next product only, complete.` : stepMessage(id, run.brief);
  // Each product in a conversation of its own: in one long one the model took to answering "I created …" like its earlier turns, making none.
  const seen = await managerTurn(ctx, STEP_TOOLS[id], message, id === "catalogue" ? null : run.conversationId);
  const conversationId = id === "catalogue" ? undefined : (seen.conversationId ?? undefined);
  if (seen.error) return { state: failedTry(run, state, seen.error.slice(0, 300)), conversationId };
  // A price typed for a ruled country anyway goes back to the rule, as emptying the editor's field does: the arithmetic is code's.
  if (id === "catalogue" && ruled.length > 0) await backToRule(member.store.id, await ownProductIds(member.store.id));
  const check = await checkAiStep(id, ctx, state);
  if (check.ok && id === "setup") {
    const priced = await priceOtherCountries(ctx);
    if (!priced.ok) return { state: failedTry(run, state, priced.problem), conversationId };
    return { state: done(state, `${check.detail}${priced.detail ? ` ${priced.detail}` : ""}`), conversationId };
  }
  if (check.ok) return { state: done(state, check.detail), conversationId };
  // The products count up a turn at a time: a turn that added one is progress, not a failed try.
  if (id === "catalogue" && progress && check.count > progress.count) return { state: { ...state, status: "waiting", detail: check.detail }, conversationId };
  return { state: failedTry(run, state, check.detail), conversationId };
}

/** The store's own products not archived (demo products aside), for putting their prices back under the rules. */
async function ownProductIds(storeId: string): Promise<string[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid }),
    sql`select p.id from commerce.products p where p.store_id = ${storeId}::uuid and p.status <> 'archived' and not ${isDemoProduct(sql`p`)}`,
  );
  return rows.map((r) => r.id);
}

/**
 * Every country but the home one priced from it (D335's rules: the price before VAT carried over at the exchange rate, rounded to whole
 * units), so no price in another currency is the model's guess. The store's currencies get the ECB's rates first when a rule lacks one.
 */
async function priceOtherCountries({ member, deps }: Context): Promise<{ ok: true; detail: string } | { ok: false; problem: string }> {
  const fresh = { ...member, store: await freshStore(member) };
  const [home, ...others] = fresh.store.markets;
  if (!home || others.length === 0) return { ok: true, detail: "" };
  const rules = others.map((m) => ({ market: m.code, base: home.code, percentBps: 0, basis: "net" as const, roundToMinor: 100, endingMinor: null }));
  const lacking = (await Promise.all(rules.map((rule) => rateProblem(fresh.store.id, rule)))).some(Boolean);
  if (lacking) {
    const saved = await (deps.currencies ?? ((m: Membership) => saveCurrencies(m, [], true)))(fresh);
    if (!saved.ok) return { ok: false, problem: `The exchange rates could not be set: ${saved.problems.join(" ")}` };
  }
  for (const rule of rules) {
    const result = await saveMarketPriceRule(fresh.store, member.account.id, rule);
    if (!result.ok) return { ok: false, problem: `${rule.market}'s prices could not be worked out from ${home.code}: ${result.problem}` };
  }
  return { ok: true, detail: `${others.map((m) => m.code).join(", ")} priced from ${home.code} at the ECB's exchange rate.` };
}

/** A turn of the AI manager in the owner's name, offered only the tools given, at the run's levels. */
async function managerTurn({ run, member, deps }: Context, tools: readonly string[], message: string, conversationId: string | null) {
  const principal: Principal = { account: member.account, store: member.store, role: member.role, kind: member.kind, permissions: member.permissions };
  const connection = deps.connection !== undefined ? deps.connection : await aiFor(run.storeId, { feature: "dream_factory", accountId: member.account.id });
  const seen: { error: string | null; conversationId: string | null } = { error: null, conversationId: null };
  await actingAs("autopilot", () =>
    (deps.turn ?? runTurn)({
      member: principal,
      conversationId,
      message,
      emit: (event) => {
        if (event.type === "conversation") seen.conversationId = event.id;
        if (event.type === "error") seen.error = event.message;
      },
      invalidate: refreshTag,
      signal: AbortSignal.timeout(TURN_MS),
      scheduled: true,
      autopilot: { tools: [...tools], settings: autonomySettingsSchema.parse({ levels: RUN_LEVELS }), told: [] },
      connection,
    }),
  );
  return seen;
}

type Check = { ok: boolean; detail: string; count: number };

async function checkAiStep(id: AiStepId, { run, member }: Context, state: StepState): Promise<Check> {
  const since = state.startedAt ?? run.createdAt.toISOString();
  const store = member.store;
  switch (id) {
    case "research": {
      const [row] = await typedRows(
        z.object({ n: col.int }),
        sql`select count(*)::int as n from commerce.research_notes where store_id = ${store.id}::uuid and cardinality(sources) > 0 and created_at >= ${since}::timestamptz`,
      );
      const n = row?.n ?? 0;
      return { ok: n >= 3, count: n, detail: `${n} research note(s) with a source.` };
    }
    case "setup": {
      const fresh = await freshStore(member);
      const progress = await getSetupProgress(fresh);
      // Every country of the brief sold to, as the store now offers them (its features applied).
      const selling = new Set(fresh.markets.map((m) => m.code.toUpperCase()));
      const wanted = run.brief?.countries ?? [];
      const unsold = wanted.filter((c) => !selling.has(c));
      // A country the brief does not name (one the store was made with) would need prices of its own: the store sells to the brief's only.
      const extra = wanted.length > 0 ? [...selling].filter((c) => !wanted.includes(c)) : [];
      const countryProblems = [unsold.length > 0 && `${unsold.join(", ")} not sold to`, extra.length > 0 && `${extra.join(", ")} sold to but not in the brief`].filter(Boolean);
      const missing = [
        !progress.details && "business details",
        (!progress.countries || countryProblems.length > 0) && `countries${countryProblems.length > 0 ? ` (${countryProblems.join("; ")})` : ""}`,
        !progress.shipping && "a shipping price for every country",
      ].filter(Boolean);
      return { ok: missing.length === 0, count: 3 - missing.length, detail: missing.length === 0 ? "Details, countries and shipping are set." : `Still missing: ${missing.join(", ")}.` };
    }
    case "brand": {
      const [row] = await typedRows(
        z.object({ brand: col.bool, themes: col.int }),
        sql`select exists (select 1 from commerce.brand_profiles where store_id = ${store.id}::uuid and (tagline <> '' or voice <> '')) as brand,
              (select count(*)::int from commerce.store_theme_installs where store_id = ${store.id}::uuid) as themes`,
      );
      const ok = Boolean(row?.brand) && (row?.themes ?? 0) > 0;
      return { ok, count: Number(row?.brand ?? 0) + (row?.themes ?? 0), detail: ok ? "The brand is set down and a theme is in the library." : !row?.brand ? "No brand profile yet." : "No theme in the library yet." };
    }
    case "catalogue": {
      if (!run.brief) return { ok: false, count: 0, detail: "No brief." };
      const check = await catalogueCheck(store, run.brief);
      return { ok: check.ok, count: check.count, detail: check.detail };
    }
    case "goals": {
      const [row] = await typedRows(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.assistant_goals where store_id = ${store.id}::uuid and status = 'active'`);
      const n = row?.n ?? 0;
      return { ok: n >= 2, count: n, detail: `${n} goal(s) set.` };
    }
  }
}

/** The store as it is now (a step may have changed its details or countries since the membership was read). */
async function freshStore(member: Membership): Promise<Store> {
  return (await passMembership(member.store.slug, member.account.id))?.store ?? member.store;
}

/**
 * The products a store sells, counted by code: the store's own (not demo), active, each with a picture and a price in every country the
 * store sells to (its markets as the store offers them, Several countries applied, as the product tools see them); and no demo product left
 * on the site.
 */
async function catalogueCheck(store: Store, brief: DreamBrief): Promise<Check> {
  const [row] = await typedRows(
    z.object({ ready: col.int, own: col.int, markets: col.int }),
    sql`
      with markets as (select unnest(${`{${store.markets.map((m) => m.code).join(",")}}`}::text[]) as code),
      own as (
        select p.id from commerce.products p
        where p.store_id = ${store.id}::uuid and p.status <> 'archived' and not ${isDemoProduct(sql`p`)}
      )
      select
        (select count(*)::int from own o join commerce.products p on p.id = o.id
          where p.status = 'active'
            and exists (select 1 from commerce.product_media m where m.product_id = p.id)
            and not exists (
              select 1 from markets mk where not exists (
                select 1 from commerce.kept_prices k join commerce.product_variants v on v.id = k.variant_id
                where k.store_id = ${store.id}::uuid and v.product_id = p.id and k.market_code = mk.code))) as ready,
        (select count(*)::int from own) as own,
        (select count(*)::int from markets) as markets
    `,
  );
  const [demoRow] = await typedRows(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.products p where p.store_id = ${store.id}::uuid and p.status = 'active' and ${isDemoProduct(sql`p`)}`,
  );
  const demo = demoRow?.n ?? 0;
  const ready = row?.ready ?? 0;
  const ok = ready >= brief.products && demo === 0 && (row?.markets ?? 0) > 0;
  const words = `${ready} of ${brief.products} products are on sale with a picture and a price in every country${demo > 0 ? `; ${demo} demo product(s) are still on the site` : ""}.`;
  return { ok, count: ready, detail: words };
}

// Code's steps ------------------------------------------------------------------------------------------------------------------

/**
 * The website: the store's pages drafted from the brief (D351), built in the background, then published, the first made the front page.
 * A front page the builder holds back (a blocking problem) is fixed by the AI a turn a minute (`FRONT_FIX_TOOLS`) until it is published.
 */
async function websiteStep(ctx: Context): Promise<StepOutcome> {
  const { run, member, deps } = ctx;
  const state = started(run.steps.website);
  if (!run.brief) return { state: failedTry(run, state, "The run has no brief.") };
  if (state.ref) return frontFix(ctx, state, state.ref);
  const draft = await openDraft(member.store.id);
  if (!draft) {
    const made = await (deps.draft ?? draftStore)(
      { account: member.account, store: member.store },
      {
        description: `${run.brief.sells} ${run.brief.audience ? `For ${run.brief.audience}.` : ""}`.trim().slice(0, 1500),
        front: { purpose: `The front page of ${run.brief.storeName}: what it sells, to whom, and why to buy here.`, key_points: [] },
        pages: run.brief.pages.length > 0 ? run.brief.pages : [{ title: "About us", purpose: `Who is behind ${run.brief.storeName} and what it stands for.` }],
        facts: [],
      },
    );
    if (!made.ok) return { state: failedTry(run, state, made.problem) };
    return { state: waitingOn(state, `Building ${made.pages} page(s).`) };
  }
  if (!draft.ready) {
    if (waitedTooLong(state)) return { state: failedTry(run, { ...state, startedAt: now() }, "The pages took too long to build.") };
    return { state: waitingOn(state, `${draft.pages.filter((p) => p.status === "built").length} of ${draft.pages.length} page(s) built.`) };
  }
  const published = await (deps.publish ?? publishDraft)({ account: member.account, store: member.store }, draft.id, refreshTag);
  if (!published.ok) return { state: failedTry(run, state, published.problem) };
  if (published.frontHeld) {
    const held = published.frontHeld;
    return { state: { ...waitingOn(state, `The AI fixes the front page "${held.title}": ${held.issues.join(" ").slice(0, 300) || "a blocking problem"}.`), ref: held.id } };
  }
  if (published.published === 0) return { state: failedTry(run, state, published.notes.join(" ") || "No page could be published.") };
  return { state: done(state, `Published ${published.published} page(s)${published.notes.length ? `: ${published.notes.join(" ")}` : ""}.`) };
}

/** One turn of the AI on the held front page; done once it is published and made the store's front page. */
async function frontFix(ctx: Context, state: StepState, pageId: string): Promise<StepOutcome> {
  const { run, member } = ctx;
  const front = async () => {
    const [row] = await typedRows(
      z.object({ title: z.string().nullable(), published: col.bool }),
      sql`select draft->>'title' as title, published_at is not null as published from commerce.pages where id = ${pageId}::uuid and store_id = ${member.store.id}::uuid`,
    );
    return row ?? null;
  };
  const before = await front();
  if (!before) return { state: failedTry(run, { ...state, ref: undefined }, "The front page is gone.") };
  if (!before.published) {
    const seen = await managerTurn(ctx, FRONT_FIX_TOOLS, frontFixMessage({ id: pageId, title: before.title ?? "" }, state.detail ?? ""), null);
    if (seen.error) return { state: failedTry(run, state, seen.error.slice(0, 300)) };
    if (!(await front())?.published) return { state: failedTry(run, state, `The front page "${before.title}" is still a draft with a problem the builder holds it back for.`) };
  }
  const made = await setFrontPage(member.account, member.store.id, pageId);
  if (!made.ok) return { state: failedTry(run, state, `The front page could not be set: ${made.problems.join(" ")}`) };
  refreshTag(storeTag(member.store.slug));
  return { state: done({ ...state, ref: undefined }, `The front page "${before.title}" was fixed by the AI and published, with the other pages.`) };
}

/**
 * The legal pages (D311): the AI writer turned on (the owner's yes to the brief agreed to it) and its writes awaited. Where it cannot write
 * (a business outside Norway, Sweden and Denmark), the step is skipped and says so; the owner writes or adds them on Legal pages.
 */
async function legalStep({ run, member, deps }: Context): Promise<StepOutcome | null> {
  const state = started(run.steps.legal);
  // Waiting on the owner to check and publish the starters: passed once every kind of page the writer was asked for has a published page.
  if (state.status === "asking") {
    const wanted = Object.values(await legalWrites(member.store.id)).map((w) => w.role).filter((role) => (STARTER_ROLES as readonly string[]).includes(role));
    const [row] = await typedRows(
      z.object({ n: col.int }),
      sql`select count(*)::int as n from commerce.page_roles r join commerce.pages p on p.id = r.page_id
          where r.store_id = ${member.store.id}::uuid and p.published_at is not null and r.role = any(${`{${[...new Set(wanted)].join(",")}}`}::text[])`,
    );
    const have = row?.n ?? 0;
    return wanted.length > 0 && have >= new Set(wanted).size ? { state: done(state, `The owner published the ${have} legal page(s).`) } : null;
  }
  if (!state.detail?.startsWith("Writing")) {
    const on = await (deps.legalOn ?? turnOnLegalAi)(member, "auto");
    if (!on.ok) {
      const reason = on.problems.join(" ");
      if (/country|sources/.test(reason)) return { state: skipped(state, "The AI writes legal pages for businesses in Norway, Sweden and Denmark; add yours on Legal pages.") };
      return { state: failedTry(run, state, `The legal writer could not start: ${reason}.`) };
    }
    return { state: waitingOn(state, `Writing ${on.queued} page(s).`) };
  }
  const writes = Object.values(await legalWrites(member.store.id)).filter((w) => (STARTER_ROLES as readonly string[]).includes(w.role));
  const pending = writes.filter((w) => w.status === "queued" || w.status === "running");
  if (pending.length > 0) {
    if (waitedTooLong(state)) return { state: failedTry(run, { ...state, detail: undefined }, "The legal pages took too long to write.") };
    return { state: waitingOn(state, `Writing ${pending.length} of ${writes.length} page(s).`) };
  }
  const failed = writes.filter((w) => w.status === "failed");
  const published = writes.filter((w) => w.status === "published");
  if (failed.length === 0 && published.length > 0) return { state: done(state, `${published.length} legal page(s) written from official sources and published.`) };
  // The writer's own checker refused what the model wrote (a quote not word for word, a number no quote holds): writing again with the same
  // model rarely does better. The hand-written starters (D158) are made from the store's facts as drafts instead, for a person to check.
  const roles = [...new Set(failed.map((w) => w.role))].filter((role): role is StarterRole => (STARTER_ROLES as readonly string[]).includes(role));
  let made = 0;
  for (const role of roles) if ((await createLegalStarter(member, role)).ok) made++;
  const words = `${published.length} legal page(s) written by the AI and published; ${failed.length} failed the writer's check of the law's words, so ${made} starter page(s) from the store's facts are drafts on Legal pages`;
  if (run.test) return { state: skipped(state, `${words}, for a person to check (a test run has none).`) };
  return { state: asking({ ...state, detail: undefined }, `${words}: check them, fill in what they ask and publish them.`) };
}

/** Payments: Stripe's identity check is the owner's, by law. A test run pays in test mode and skips it. */
async function paymentsStep({ run, member }: Context): Promise<StepOutcome | null> {
  const state = run.steps.payments;
  if (run.test) return { state: skipped(started(state), "A test run takes payments in Stripe's test mode.") };
  const progress = await getSetupProgress(await freshStore(member));
  if (progress.payments) return { state: done(started(state), "Live card payments are active.") };
  return state.status === "asking" ? null : { state: asking(state, "Verify yourself with Stripe on the Payments page; the store takes test payments until then.") };
}

/** The plan: a plan chosen or the trial running. */
async function planStep({ run, member }: Context): Promise<StepOutcome | null> {
  const state = run.steps.plan;
  const progress = await getSetupProgress(member.store);
  if (progress.plan) return { state: done(started(state), "On a plan or its free trial.") };
  if (run.test) return { state: skipped(started(state), "A test run needs no plan.") };
  return state.status === "asking" ? null : { state: asking(state, "Choose a plan on the Plan page.") };
}

/** The rehearsal: the demo store's products archived, then the store's own checkup without a blocking finding, and every product still on sale everywhere. */
async function rehearsalStep({ run, member }: Context): Promise<StepOutcome> {
  const state = started(run.steps.rehearsal);
  if (!run.brief) return { state: failedTry(run, state, "The run has no brief.") };
  // The store's own products have replaced the demo store's (the owner's yes to the brief covers it): what is left of the demo, drafts
  // included, is archived as the setup wizard's one press does, so the checkup counts only the store's own.
  await archiveDemoProducts({ ...member, store: await freshStore(member) });
  const store = await freshStore(member);
  const [findings, catalogue] = await Promise.all([checkupFindings(store, member.account.id), catalogueCheck(store, run.brief)]);
  const blocking = findings.filter((f) => BLOCKING_CHECKUP.has(f.key));
  if (blocking.length > 0 || !catalogue.ok) {
    return { state: failedTry(run, state, [...blocking.map((f) => f.what), ...(catalogue.ok ? [] : [catalogue.detail])].join(" ").slice(0, 500)) };
  }
  return { state: done(state, `The store's checkup has nothing blocking, and ${catalogue.detail}`) };
}

/** Opening: only the owner, and never in a test run, which stays private and ends ready to open. */
async function openStep({ run, member }: Context): Promise<StepOutcome | null> {
  const state = run.steps.open;
  if (run.test) return { state: skipped(started(state), "A test run stays private: it ends ready to open.") };
  const store = await freshStore(member);
  if (store.setupCompletedAt) return { state: done(started(state), "The store is open."), presses: 1 };
  return state.status === "asking" ? null : { state: asking(state, "Everything is ready: open the store when you are.") };
}

