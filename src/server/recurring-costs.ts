import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isPurchaseKind, isPurchaseVatRate } from "@/lib/purchases";
import {
  chargeOf,
  likelySubscriptions,
  recurringState,
  RECURRING_EVERY,
  type LikelySubscription,
  type RecurringCost,
  type RecurringEvery,
  type RecurringInput,
  type RecurringLine,
  type RecurringRow,
} from "@/lib/recurring-costs";

import { audit, type Membership } from "./auth";
import { BANK_ACCOUNT } from "./bank-statements";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store's subscriptions (D503, `src/lib/recurring-costs.ts`): the register the owner keeps on Settings → Books, the charges its words
 * know in the bank's statements, and the charges that come back each month offered to add. Owners only; audited. Nothing is posted here:
 * a charge is posted as a purchase with its receipt (D490), what it was and its VAT filled from the subscription.
 */

const COST = z.object({
  id: col.uuid,
  name: col.text,
  match_text: col.text,
  kind: col.text,
  vat_rate: z.coerce.number(),
  reverse_charge: z.boolean(),
  every: col.text,
  amount_minor: col.minor,
  started_on: col.text,
  ended_on: col.textOrNull,
});

const toCost = (r: z.infer<typeof COST>): RecurringCost | null => {
  if (!isPurchaseKind(r.kind) || !isPurchaseVatRate(r.vat_rate) || !(RECURRING_EVERY as readonly string[]).includes(r.every)) return null;
  return {
    id: r.id,
    name: r.name,
    matchText: r.match_text,
    kind: r.kind,
    vatRate: r.vat_rate,
    abroad: r.reverse_charge,
    every: r.every as RecurringEvery,
    amountMinor: r.amount_minor,
    startedOn: r.started_on,
    endedOn: r.ended_on,
  };
};

/** The store's subscriptions, every one it has had. */
export async function recurringCosts(storeId: string): Promise<RecurringCost[]> {
  const rows = await typedRows(
    COST,
    sql`select id, name, match_text, kind, vat_rate, reverse_charge, every, amount_minor, started_on::text, ended_on::text
          from commerce.recurring_costs where store_id = ${storeId}::uuid order by lower(name), id`,
  );
  return rows.flatMap((r) => toCost(r) ?? []);
}

const LINE = z.object({ id: col.uuid, day: col.text, amount_minor: col.minor, text: col.text, counterparty: col.textOrNull, reference: col.textOrNull, waiting: z.boolean() });

export type RecurringView = {
  rows: RecurringRow[];
  monthlyMinor: number;
  /** Charges that come back each month, not in the register yet. */
  likely: LikelySubscription[];
  /** For each bank line waiting for its entry, the subscription it most likely is. */
  charges: Map<string, RecurringCost>;
};

/**
 * The register as it stands on a day, from the book's statements of the last 13 months (money out, posted or waiting): each subscription's
 * last charge and the next, those late, what they cost a month, the charges offered to add, and the waiting lines each subscription knows.
 */
export async function recurringView(storeId: string, bookId: string, today: string): Promise<RecurringView> {
  const [costs, lines] = await Promise.all([
    recurringCosts(storeId),
    typedRows(
      LINE,
      sql`select id, booked_on::text as day, amount_minor, text, counterparty, reference, (entry_id is null) as waiting from commerce.bank_lines
           where store_id = ${storeId}::uuid and book_id = ${bookId}::uuid and ledger_account = ${BANK_ACCOUNT} and amount_minor < 0
             and booked_on > ${today}::date - interval '13 months'`,
    ),
  ]);
  const plain: RecurringLine[] = lines.map((l) => ({ id: l.id, day: l.day, amountMinor: l.amount_minor, text: l.text, counterparty: l.counterparty, reference: l.reference }));
  const state = recurringState(costs, plain, today);
  const charges = new Map<string, RecurringCost>();
  for (const [i, l] of plain.entries()) {
    if (!lines[i].waiting) continue;
    const cost = chargeOf(l, costs);
    if (cost) charges.set(l.id, cost);
  }
  return { ...state, likely: likelySubscriptions(plain, costs, today), charges };
}

export type RecurringProblemOnSave = "not_found";

/** Adds a subscription to the register, or changes one (`id`). Audited. */
export async function saveRecurringCost(
  member: Membership,
  input: RecurringInput,
  currency: string,
  id?: string,
): Promise<{ ok: true; id: string } | { ok: false; problem: RecurringProblemOnSave }> {
  const storeId = member.store.id;
  if (id) {
    const changed = await typedRow(
      z.object({ id: col.uuid }),
      sql`update commerce.recurring_costs
             set name = ${input.name}, match_text = ${input.matchText}, kind = ${input.kind}, vat_rate = ${input.vatRate}, reverse_charge = ${input.abroad},
                 every = ${input.every}, amount_minor = ${input.amountMinor}, currency = ${currency}, started_on = ${input.startedOn}::date,
                 ended_on = case when ended_on is not null and ended_on < ${input.startedOn}::date then ${input.startedOn}::date else ended_on end,
                 updated_at = now()
           where store_id = ${storeId}::uuid and id = ${id}::uuid
       returning id`,
    );
    if (!changed) return { ok: false, problem: "not_found" };
    await audit(member.account.id, storeId, "work.recurring_cost_changed", { recurringCostId: id, every: input.every, amountMinor: input.amountMinor, abroad: input.abroad });
    return { ok: true, id };
  }
  const newId = randomUUID();
  await db().execute(sql`
    insert into commerce.recurring_costs (id, store_id, name, match_text, kind, vat_rate, reverse_charge, every, amount_minor, currency, started_on, created_by)
    values (${newId}::uuid, ${storeId}::uuid, ${input.name}, ${input.matchText}, ${input.kind}, ${input.vatRate}, ${input.abroad}, ${input.every},
            ${input.amountMinor}, ${currency}, ${input.startedOn}::date, ${member.account.id}::uuid)`);
  await audit(member.account.id, storeId, "work.recurring_cost_added", { recurringCostId: newId, every: input.every, amountMinor: input.amountMinor, abroad: input.abroad });
  return { ok: true, id: newId };
}

/** Ends a running subscription on a day (not before it started); its charges before then stay known. Audited. */
export async function endRecurringCost(member: Membership, id: string, endedOn: string): Promise<{ ok: true } | { ok: false; problem: "not_found" | "day" }> {
  const storeId = member.store.id;
  const cost = await typedRow(
    z.object({ started_on: col.text, ended_on: col.textOrNull }),
    sql`select started_on::text, ended_on::text from commerce.recurring_costs where store_id = ${storeId}::uuid and id = ${id}::uuid`,
  );
  if (!cost || cost.ended_on !== null) return { ok: false, problem: "not_found" };
  if (endedOn < cost.started_on) return { ok: false, problem: "day" };
  await db().execute(sql`update commerce.recurring_costs set ended_on = ${endedOn}::date, updated_at = now() where store_id = ${storeId}::uuid and id = ${id}::uuid`);
  await audit(member.account.id, storeId, "work.recurring_cost_ended", { recurringCostId: id, endedOn });
  return { ok: true };
}
