import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { levelOf } from "@/lib/autopilot-autonomy";
import { testAction, type AutopilotTestOutcome } from "@/lib/autopilot-tests";
import { OWNER_TOOLS_BY_NAME, type GateCategory } from "@/lib/owner-tools";

import { actingAs } from "./actor";
import { aiAutonomyPaused } from "./ai-pause";
import { addNotice, noticeApproval } from "./assistant-notices";
import { autopilotDecision } from "./autopilot-gate";
import { principalOf } from "./autopilot-runner";
import { autonomyFor } from "./autopilot-settings";
import { asTheStoresDecision } from "./autopilot-tests";
import { discardExperiment, getExperiment, stopExperiment, type ExperimentInfo } from "./experiment-admin";
import { experimentResults } from "./experiment-results";
import { log } from "./log";
import { holderOfPrincipal, keepForApproval, type Principal } from "./owner-assistant";
import { heldBy, OwnerToolError, runOwnerTool } from "./owner-tools";
import { refreshTag } from "./refresh";
import { currentStore, type Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";
import { jobReport } from "./job-report";

/**
 * The store decides the autopilot's tests of its own changes (ecosystem plan E4.1, D729), by code from each test's verdict (`testAction()`),
 * once an hour in the dispatcher's job `autopilotTests`, never by a model (the autopilot's events leave these tests out):
 * - version B clearly better: the change goes live through `apply_winner`, within the owner's levels (`autopilotDecision()`, area Website),
 *   as the autopilot; at *Ask me first*, or past a limit, it is kept for their yes as any gated call is. Never while the autopilot is paused,
 *   for the store or platform-wide, and on Kaizena Flow's own store, which sells nothing, only once its speed guardrail found it fine (D757);
 * - clearly worse, stopped by a guardrail, a broken split, or its time up without an answer for the change: the page stays as it was, the test
 *   stopped and its original kept, as the autopilot, whatever the levels, as the watch's rollback (D628) undoes a change without asking;
 * - a test a person stopped or decided, or one whose maker can no longer act in the store, is left to a person on the A/B tests screens.
 * Each decision is kept on the row once (`outcome`), so nothing is asked or done twice. Never throws.
 */

export type DecideRun = { applied: number; asked: number; kept: number; left: number; waiting: number };

const OPEN = z.object({
  store_id: col.uuid,
  experiment_id: col.uuid,
  slug: col.text,
  account_id: col.uuid.nullable(),
  page: col.text,
  /** The goal the test counts: on Kaizena Flow's own store its sign-ups, whose change must also clear the speed guardrail (D757). */
  goal: col.text,
  /** Null while undecided; `asked` only when the owner declined the change or let the question lapse. */
  outcome: z.enum(["asked"]).nullable(),
});
type Open = z.infer<typeof OPEN>;

/** Keeps how the store decided a test, once: a row already decided is left as it is (a question the owner declined ends as kept). */
const decided = (r: Open, outcome: AutopilotTestOutcome, extra: { approvalId?: string; conversationId?: string } = {}) =>
  db().execute(sql`
    update commerce.autopilot_tests set outcome = ${outcome}, decided_at = now(),
      approval_id = coalesce(${extra.approvalId ?? null}::uuid, approval_id), conversation_id = coalesce(${extra.conversationId ?? null}::uuid, conversation_id)
    where store_id = ${r.store_id}::uuid and experiment_id = ${r.experiment_id}::uuid and outcome is not distinct from ${r.outcome}
  `);

/** The store's one conversation for its autopilot tests' questions, per person: kept from the first on, a new one when it was deleted. */
async function testConversation(p: Principal & { store: Store }): Promise<string> {
  const kept = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      select c.id from commerce.autopilot_tests t
      join commerce.assistant_conversations c on c.id = t.conversation_id and c.account_id = ${p.account.id}::uuid
      where t.store_id = ${p.store.id}::uuid
      order by t.decided_at desc nulls last limit 1
    `,
  );
  if (kept) return kept.id;
  const made = await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.assistant_conversations (store_id, account_id, title, source)
      values (${p.store.id}::uuid, ${p.account.id}::uuid, 'Autopilot: page tests', 'autopilot') returning id`,
  );
  if (!made) throw new Error("The page tests' conversation could not be made.");
  return made.id;
}

/** The page stays as it was: the test stopped if it still runs, and its original kept, as the autopilot. */
async function keepThePage(p: Principal, test: ExperimentInfo): Promise<boolean> {
  return actingAs("autopilot", async () => {
    if (test.status === "running" && !(await stopExperiment(p.account, p.store!.id, test.id, "person")).ok) return false;
    return (await discardExperiment(p.account, p.store!.id, test.id)).ok;
  });
}

/** One test: what its verdict says, done or kept for a yes, and the row marked. */
async function decideOne(r: Open, run: DecideRun, now: Date, paused: boolean): Promise<void> {
  const test = await getExperiment(r.store_id, r.experiment_id);
  if (!test) return;
  if (test.status === "applied" || test.status === "discarded" || test.status === "draft" || test.status === "scheduled") {
    // Decided on the A/B tests screens (or never started): the person's.
    await decided(r, "left");
    run.left++;
    return;
  }
  // The owner said no to the change, or let the question lapse: the page stays as it was.
  if (r.outcome === "asked") {
    const p = r.account_id ? await principalOf({ accountId: r.account_id, storeId: r.store_id, storeSlug: r.slug, storeActive: true }) : "gone";
    if (p === "gone" || p === "closed" || !p.store || !(await keepThePage(p, test))) {
      await decided(r, "left");
      run.left++;
      return;
    }
    await decided(r, "kept");
    run.kept++;
    return;
  }
  const store = await currentStore(r.slug);
  if (!store) return;
  const results = await experimentResults(store, test, now);
  const action = testAction({
    status: test.status,
    stopReason: test.stopReason,
    verdict: results.verdict.kind,
    best: results.verdict.best,
    harmed: Boolean(results.harmed),
    goal: r.goal,
    guardrails: results.guardrails,
    plannedEnd: test.plannedEnd,
    now,
  });
  if (action === "wait") {
    run.waiting++;
    return;
  }
  const p = r.account_id ? await principalOf({ accountId: r.account_id, storeId: r.store_id, storeSlug: r.slug, storeActive: true }) : "gone";
  if (action === "leave" || p === "gone" || p === "closed" || !p.store) {
    await decided(r, "left");
    run.left++;
    return;
  }
  const settings = await autonomyFor(r.store_id, now);
  const tellOf = (outcome: "live" | "kept") =>
    addNotice({ accountId: p.account.id, storeId: r.store_id, notice: "test_decided", ref: test.id, path: `experiments/${test.id}`, facts: { page: r.page, outcome } });

  if (action === "keep") {
    if (!(await keepThePage(p, test))) return;
    await decided(r, "kept");
    run.kept++;
    if (levelOf(settings, "website") === "tell") await tellOf("kept");
    log("info", "autopilot.test_kept_page", { storeId: r.store_id, experimentId: test.id, verdict: results.verdict.kind });
    return;
  }

  // The change goes live only as far as the owner lets the autopilot act; while it is paused, the test waits.
  if (paused || settings.paused) {
    run.waiting++;
    return;
  }
  const args = { experiment: test.id, version: "b" };
  const gate = (OWNER_TOOLS_BY_NAME.apply_winner.gate ?? "public") as GateCategory;
  const decision = await autopilotDecision(p, settings, "apply_winner", gate, args);
  const ctx = { account: p.account, store: p.store, invalidate: refreshTag, holder: heldBy(holderOfPrincipal(p)) };
  if (decision.run) {
    try {
      await actingAs("autopilot", () => asTheStoresDecision(() => runOwnerTool(ctx, "apply_winner", args)));
    } catch (error) {
      // A role that may no longer decide tests, or a test that changed since: a person decides it.
      if (!(error instanceof OwnerToolError)) throw error;
      log("warn", "autopilot.test_not_applied", { storeId: r.store_id, experimentId: test.id });
      await decided(r, "left");
      run.left++;
      return;
    }
    await decided(r, "applied");
    run.applied++;
    if (decision.tell) await tellOf("live");
    return;
  }
  const conversationId = await testConversation({ ...p, store: p.store });
  const kept = await keepForApproval({ account: p.account, store: p.store, invalidate: refreshTag }, conversationId, "apply_winner", gate, args);
  await noticeApproval(kept, conversationId, p.account.id, p.store.id);
  await decided(r, "asked", { approvalId: kept.id, conversationId });
  run.asked++;
}

/** The hourly decisions (the dispatcher's job `autopilotTests`, in the first five minutes of each hour, after the tests' own checks). */
export async function decideAutopilotTests(options: { now?: Date; everyRun?: boolean } = {}): Promise<DecideRun> {
  const report = jobReport();
  const now = options.now ?? new Date();
  const run: DecideRun = { applied: 0, asked: 0, kept: 0, left: 0, waiting: 0 };
  if (!options.everyRun && now.getUTCMinutes() >= 5) return run;
  try {
    const paused = await aiAutonomyPaused();
    const open = await typedRows(
      OPEN,
      sql`
        select t.store_id, t.experiment_id, s.slug, t.account_id, coalesce(nullif(p.published ->> 'title', ''), p.slug) as page, t.goal, t.outcome
        from commerce.autopilot_tests t
        join commerce.stores s on s.id = t.store_id
        join commerce.pages p on p.store_id = t.store_id and p.id = t.page_id
        where commerce.store_is_active(t.store_id)
          and (t.outcome is null or (t.outcome = 'asked' and exists (
            select 1 from commerce.assistant_approvals ap where ap.id = t.approval_id and ap.store_id = t.store_id and ap.status in ('declined', 'expired', 'failed'))))
        order by t.created_at
        limit 100
      `,
    );
    for (const r of open) {
      try {
        await decideOne(r, run, now, paused);
      } catch (error) {
        report(error, "test-decision");
        log("error", "autopilot.test_decision_failed", { storeId: r.store_id, experimentId: r.experiment_id }, error);
      }
    }
  } catch (error) {
    report(error, "test-decisions");
    log("error", "autopilot.test_decisions_failed", {}, error);
  }
  return run;
}
