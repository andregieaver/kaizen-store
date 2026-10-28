import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { AnalyticsPeriod } from "@/lib/analytics-period";
import { convertMinor } from "@/lib/currency";
import { BONUS_ROLL_KINDS, GIFT_CARD_ROLL_KINDS, liabilityRow, rollForward, type LiabilityRow, type RollForward } from "@/lib/liabilities";
import { mainCurrency } from "@/lib/markets";

import { dayStart } from "./analytics-sql";
import { giftCardOutstanding } from "./gift-cards-admin";
import { bonusProgram } from "./bonus";
import { storePaymentMode } from "./host-payments";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * What the store owes its customers on Finance (wave 11 unit B, D381), read from the two ledgers only: bonus credit (`bonus_entries`, in the
 * program's currency) and gift cards (`gift_card_entries`, per currency, the store's payment mode only), each as a roll-forward from the ledger's
 * sum before the period's first instant (in the store's day) to its sum at the end, with each kind's movement between. Bonus credit owed now is
 * the sum of `commerce.bonus_balance()` over the store's customers, beside the ledger's own sum: credits whose time ran out are written off by
 * the nightly job, so until then the two differ by that much, and the page says so rather than making them agree.
 */

const SUM_ROW = z.object({ amount: col.minor });
const KIND_ROW = z.object({ kind: col.text, amount: col.minor });
const CURRENCY_KIND_ROW = z.object({ currency: col.currency, kind: col.text, amount: col.minor });
const CURRENCY_SUM_ROW = z.object({ currency: col.currency, opening: col.minor, closing: col.minor });

export type BonusLiability = RollForward & {
  /** What customers can use now or soon: the sum of `bonus_balance()`'s available and pending credits. */
  owedNowMinor: number;
  /** Whether the period ends now, so the closing and what is owed now can be compared. */
  endsNow: boolean;
};

/** The bonus program's roll-forward for the period and what it owes now; null when the store has never granted a credit. */
export async function bonusLiability(store: Pick<Store, "id" | "timeZone">, period: AnalyticsPeriod, now = new Date()): Promise<BonusLiability | null> {
  const start = dayStart(store as Store, period.from);
  const end = dayStart(store as Store, period.to);
  const [any] = await db().execute(sql`select 1 from commerce.bonus_entries where store_id = ${store.id}::uuid limit 1`);
  if (!any) return null;
  const [program, opening, closing, moved, owed] = await Promise.all([
    bonusProgram(db(), store.id),
    typedRow(SUM_ROW, sql`select coalesce(sum(amount_minor), 0)::bigint as amount from commerce.bonus_entries where store_id = ${store.id}::uuid and created_at < ${start}`),
    typedRow(
      SUM_ROW,
      sql`select coalesce(sum(amount_minor), 0)::bigint as amount from commerce.bonus_entries where store_id = ${store.id}::uuid and created_at < least(${end}, ${now.toISOString()}::timestamptz)`,
    ),
    typedRows(
      KIND_ROW,
      sql`
        select kind, coalesce(sum(amount_minor), 0)::bigint as amount from commerce.bonus_entries
        where store_id = ${store.id}::uuid and created_at >= ${start} and created_at < least(${end}, ${now.toISOString()}::timestamptz)
        group by kind
      `,
    ),
    typedRow(
      SUM_ROW,
      sql`
        select coalesce(sum(b.available_minor + b.pending_minor), 0)::bigint as amount
        from commerce.customers c cross join lateral commerce.bonus_balance(c.store_id, c.id) b
        where c.store_id = ${store.id}::uuid
          and exists (select 1 from commerce.bonus_entries e where e.store_id = c.store_id and e.customer_id = c.id)
      `,
    ),
  ]);
  const roll = rollForward(
    program.currency,
    opening?.amount ?? 0,
    moved.map((m) => ({ kind: m.kind, amountMinor: m.amount })),
    closing?.amount ?? 0,
    BONUS_ROLL_KINDS,
  );
  const endsNow = (await db().execute<Record<string, unknown>>(sql`select ${end} > ${now.toISOString()}::timestamptz as now`))[0]?.now === true;
  return { ...roll, owedNowMinor: owed?.amount ?? 0, endsNow };
}

/**
 * Gift cards' roll-forward per currency (never converted or added across currencies): the ledger's sums before and at the end of the period, and
 * each kind's movement; a hold for an unpaid order and its release are one line, `held`, so what was spent is what was taken.
 */
export async function giftCardRollForward(store: Pick<Store, "id" | "timeZone">, period: AnalyticsPeriod, now = new Date()): Promise<RollForward[]> {
  const start = dayStart(store as Store, period.from);
  const end = sql`least(${dayStart(store as Store, period.to)}, ${now.toISOString()}::timestamptz)`;
  const test = (await storePaymentMode(store.id)) === "test";
  const [sums, moved] = await Promise.all([
    typedRows(
      CURRENCY_SUM_ROW,
      sql`
        select trim(g.currency) as currency,
          coalesce(sum(e.amount_minor) filter (where e.created_at < ${start}), 0)::bigint as opening,
          coalesce(sum(e.amount_minor) filter (where e.created_at < ${end}), 0)::bigint as closing
        from commerce.gift_card_entries e join commerce.gift_cards g on g.store_id = e.store_id and g.id = e.card_id
        where e.store_id = ${store.id}::uuid and g.test_mode = ${test}
        group by 1 order by 1
      `,
    ),
    typedRows(
      CURRENCY_KIND_ROW,
      sql`
        select trim(g.currency) as currency, case when e.kind in ('hold', 'release') then 'held' else e.kind end as kind,
          coalesce(sum(e.amount_minor), 0)::bigint as amount
        from commerce.gift_card_entries e join commerce.gift_cards g on g.store_id = e.store_id and g.id = e.card_id
        where e.store_id = ${store.id}::uuid and g.test_mode = ${test} and e.created_at >= ${start} and e.created_at < ${end}
        group by 1, 2
      `,
    ),
  ]);
  return sums
    .filter((s) => s.opening !== 0 || s.closing !== 0 || moved.some((m) => m.currency === s.currency))
    .map((s) =>
      rollForward(
        s.currency,
        s.opening,
        moved.filter((m) => m.currency === s.currency).map((m) => ({ kind: m.kind, amountMinor: m.amount })),
        s.closing,
        [...GIFT_CARD_ROLL_KINDS, "held"],
      ),
    );
}

/**
 * Finance's table of what the store owes customers (D381): a row for bonus credit and one per gift card currency, each a roll-forward with what is
 * held now. Bonus credit in a currency other than the main one is shown converted beside it, for display only; nothing is added across currencies.
 */
export async function liabilityRows(store: Store, period: AnalyticsPeriod, now = new Date()): Promise<LiabilityRow[]> {
  const [bonus, cards, held] = await Promise.all([bonusLiability(store, period, now), giftCardRollForward(store, period, now), giftCardOutstanding(store.id)]);
  const rows: LiabilityRow[] = [];
  if (bonus) {
    const main = mainCurrency(store);
    const inMain = bonus.currency === main ? null : { currency: main, minor: convertMinor(bonus.owedNowMinor, bonus.currency, main, store.localization.rates) };
    rows.push(liabilityRow("bonus", bonus, bonus.owedNowMinor, inMain));
  }
  for (const roll of cards) rows.push(liabilityRow("gift_cards", roll, held.find((h) => h.currency === roll.currency)?.amountMinor ?? 0));
  return rows;
}
