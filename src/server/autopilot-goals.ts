import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { addDays, customPeriod, todayIn } from "@/lib/analytics-period";
import {
  GOAL_STATUSES,
  GOALS_ACTIVE_MAX,
  goalMet,
  goalTargetsSchema,
  targetFromInput,
  targetProgress,
  type GoalFigures,
  type GoalTarget,
  type GoalTargetInput,
  type TargetProgress,
} from "@/lib/autopilot-goals";
import { mainCurrency } from "@/lib/markets";
import { parsePrice } from "@/lib/product-input";

import { periodTotals } from "./analytics-totals";
import { audit } from "./auth";
import { isDemoProduct } from "./demo-content";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The autopilot's goals (D309, `docs/ai-autopilot.md` 7.1), the only writer of `commerce.assistant_goals`: a store's, or Kaizena Flow's
 * with no store. Progress is read here from the store's own figures (`periodTotals()`, the catalogue, the pages), never from the model,
 * and a goal whose every target is met is marked met by code.
 */

export type GoalScope = { account: { id: string }; store: Store | null };

const GOAL_ROW = z.object({
  id: col.uuid,
  title: col.text,
  vision: col.text,
  targets: z.unknown(),
  due_on: col.textOrNull,
  status: z.enum(GOAL_STATUSES),
  created_at: col.timestamp,
});
type GoalRow = z.output<typeof GOAL_ROW>;

export type Goal = {
  id: string;
  title: string;
  vision: string;
  targets: GoalTarget[];
  dueOn: string | null;
  status: (typeof GOAL_STATUSES)[number];
  createdAt: string;
};

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

/** The activity log's area: a store's AI settings, or the platform's. */
export const auditArea = (scope: { store: Store | null }) => ({ area: scope.store ? ("settings" as const) : ("platform" as const) });

const inScope = (scope: GoalScope) => (scope.store ? sql`store_id = ${scope.store.id}::uuid` : sql`store_id is null`);

function toGoal(row: GoalRow): Goal {
  const targets = goalTargetsSchema.safeParse(row.targets);
  return { id: row.id, title: row.title, vision: row.vision, targets: targets.success ? targets.data : [], dueOn: row.due_on, status: row.status, createdAt: row.created_at };
}

const SELECT = sql`select id, title, vision, targets, due_on::text as due_on, status, created_at from commerce.assistant_goals`;

export async function listGoals(scope: GoalScope, { all = false }: { all?: boolean } = {}): Promise<Goal[]> {
  const rows = await typedRows(GOAL_ROW, sql`${SELECT} where ${inScope(scope)} ${all ? sql`` : sql`and status = 'active'`} order by created_at`);
  return rows.map(toGoal);
}

export async function getGoal(scope: GoalScope, id: string): Promise<Goal | null> {
  const row = await typedRow(GOAL_ROW, sql`${SELECT} where id = ${id}::uuid and ${inScope(scope)}`);
  return row ? toGoal(row) : null;
}

export type GoalInput = { goal?: string; title: string; vision?: string; targets: GoalTargetInput[]; due_on?: string };

/** Makes a goal, or changes one by its id: the targets typed by the model made into stored ones (amounts in the main currency). */
export async function setGoal(scope: GoalScope, input: GoalInput): Promise<Goal> {
  const currency = scope.store ? mainCurrency(scope.store) : null;
  const targets: GoalTarget[] = [];
  for (const typed of input.targets) {
    const made = targetFromInput(typed, scope.store ? "store" : "platform", currency, parsePrice);
    if (!made.ok) return fail(made.problem);
    targets.push(made.target);
  }
  const vision = (input.vision ?? "").trim();
  const due = input.due_on ?? null;
  const storeId = scope.store ? sql`${scope.store.id}::uuid` : sql`null`;
  if (input.goal) {
    const before = await getGoal(scope, input.goal);
    if (!before) return fail("There is no such goal here. Look with list_goals.");
    if (before.status === "dropped") return fail("That goal was dropped: make a new one.");
    const row = await typedRow(
      GOAL_ROW,
      sql`
        update commerce.assistant_goals set title = ${input.title}, vision = ${vision}, targets = ${JSON.stringify(targets)}::jsonb,
          due_on = ${due}::date, status = 'active', updated_at = now()
        where id = ${input.goal}::uuid and ${inScope(scope)}
        returning id, title, vision, targets, due_on::text as due_on, status, created_at
      `,
    );
    await audit(scope.account.id, scope.store?.id ?? null, "ai.goal_changed", { goalId: input.goal, targets: targets.map((t) => t.kind) }, auditArea(scope));
    return toGoal(row ?? fail("The goal could not be changed."));
  }
  const active = await typedRow(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.assistant_goals where ${inScope(scope)} and status = 'active'`);
  if ((active?.n ?? 0) >= GOALS_ACTIVE_MAX) return fail(`There are already ${GOALS_ACTIVE_MAX} goals: drop or change one first.`);
  const row = await typedRow(
    GOAL_ROW,
    sql`
      insert into commerce.assistant_goals (store_id, title, vision, targets, due_on, created_by)
      values (${storeId}, ${input.title}, ${vision}, ${JSON.stringify(targets)}::jsonb, ${due}::date, ${scope.account.id}::uuid)
      returning id, title, vision, targets, due_on::text as due_on, status, created_at
    `,
  );
  const goal = toGoal(row ?? fail("The goal could not be kept."));
  await audit(scope.account.id, scope.store?.id ?? null, "ai.goal_set", { goalId: goal.id, targets: targets.map((t) => t.kind) }, auditArea(scope));
  return goal;
}

export async function dropGoal(scope: GoalScope, id: string): Promise<void> {
  const rows = await db().execute(sql`
    update commerce.assistant_goals set status = 'dropped', updated_at = now() where id = ${id}::uuid and ${inScope(scope)} and status <> 'dropped' returning id
  `);
  if (rows.length === 0) return fail("There is no such goal here.");
  await audit(scope.account.id, scope.store?.id ?? null, "ai.goal_dropped", { goalId: id }, auditArea(scope));
}

// Progress -------------------------------------------------------------------------------------

const COUNT = z.object({ n: col.int });

/** The figures every goal of a scope is measured against, read once. */
export async function goalFigures(store: Store | null, now = new Date()): Promise<GoalFigures> {
  const missing: GoalFigures["missing"] = {};
  if (!store) {
    const [pages, stores] = await Promise.all([
      typedRow(COUNT, sql`select count(*)::int as n from commerce.pages where store_id is null and type = 'page' and published is not null`),
      typedRow(
        COUNT,
        sql`select count(*)::int as n from commerce.stores s where s.status = 'active' and s.setup_completed_at is not null and not (s.is_template or s.starter)`,
      ),
    ]);
    return {
      revenue30d: null,
      currency: null,
      orders30d: null,
      conversion30d: null,
      openedOn: null,
      today: now.toISOString().slice(0, 10),
      products: null,
      pages: pages?.n ?? 0,
      stores: stores?.n ?? 0,
      missing,
    };
  }
  const today = todayIn(now, store.timeZone);
  const [totals, products, pages] = await Promise.all([
    periodTotals(store, customPeriod(addDays(today, -29), today)),
    typedRow(COUNT, sql`select count(*)::int as n from commerce.products p where p.store_id = ${store.id}::uuid and p.status = 'active' and not ${isDemoProduct(sql`p`)}`),
    typedRow(COUNT, sql`select count(*)::int as n from commerce.pages where store_id = ${store.id}::uuid and type = 'page' and published is not null`),
  ]);
  const t = totals.totals;
  let revenue30d: number | null = t.revenueMinor - t.refundsMinor;
  let orders30d: number | null = t.orders;
  if (totals.unconverted > 0) {
    const why = `${totals.unconverted} orders in ${totals.missingCurrencies.join(", ")} have no exchange rate, so the figure is not complete.`;
    revenue30d = null;
    orders30d = null;
    missing.revenue_30d = why;
    missing.orders_30d = why;
  }
  let conversion30d: number | null = null;
  if (t.sessions === null || t.sessions === 0) missing.conversion_30d = "Visit counting is off, or no visits were counted in 30 days (Settings → Analytics).";
  else conversion30d = ((t.checkoutOrders ?? t.orders) / t.sessions) * 100;
  const openedOn = store.setupCompletedAt ? todayIn(new Date(store.setupCompletedAt), store.timeZone) : null;
  return {
    revenue30d,
    currency: mainCurrency(store),
    orders30d,
    conversion30d,
    openedOn,
    today,
    products: products?.n ?? 0,
    pages: pages?.n ?? 0,
    stores: null,
    missing,
  };
}

export type GoalWithProgress = Goal & { progress: TargetProgress[]; met: boolean };

/** Each goal with its progress, read once from the figures; an active goal whose every target is met is marked met here. */
export async function goalsWithProgress(scope: GoalScope, options: { all?: boolean; now?: Date } = {}): Promise<GoalWithProgress[]> {
  const goals = await listGoals(scope, options);
  if (goals.length === 0) return [];
  const figures = await goalFigures(scope.store, options.now);
  const locale = scope.store?.markets[0]?.locale ?? "en-GB";
  const out: GoalWithProgress[] = [];
  for (const goal of goals) {
    const progress = goal.targets.map((t) => targetProgress(t, figures, locale));
    const met = goalMet(progress);
    if (met && goal.status === "active") {
      await db().execute(sql`update commerce.assistant_goals set status = 'met', updated_at = now() where id = ${goal.id}::uuid and status = 'active'`);
      out.push({ ...goal, status: "met", progress, met });
    } else out.push({ ...goal, progress, met });
  }
  return out;
}
