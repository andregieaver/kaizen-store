import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";

import { db } from "@/db/client";
import { isPayoutStatus, lineKindOf, PAYOUT_LINE_KINDS, PAYOUT_LINES_MAX, type PayoutState, type PayoutStatus, type Reconciliation } from "@/lib/payouts";
import { paymentIntentOf, platformPayoutState, reconcilePlatformPayout } from "@/lib/platform-payouts";
import type { PaymentModeName } from "@/lib/stripe-account";

import { log } from "./log";
import { recordPlatformSale } from "./platform-sales";
import { platformStripe } from "./stripe";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Kaizena Flow's own Stripe payouts (D508 kept them for the books; D509 shows them, the platform's twin of a store's Payouts, D290): each
 * payout read from Kaizena Flow's Stripe account, live and test apart, and once paid, what it carried, line by line (its balance
 * transactions), each tied to the sale it was for by its payment intent. A sale's line also tells what it settled in the payout's currency
 * and Stripe's fee, kept on the sale where Stripe had not said it yet. Every step is safe to repeat; nothing here throws.
 */

/** The sale a payment intent paid, by the invoice it paid; an invoice not kept yet (a webhook missed) is kept now. */
async function saleOfIntent(mode: PaymentModeName, intent: string, stripe: Stripe): Promise<string | null> {
  for await (const payment of stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: intent }, limit: 1 })) {
    const invoice = typeof payment.invoice === "string" ? payment.invoice : (payment.invoice?.id ?? null);
    if (!invoice) return null;
    const find = () => typedRow(z.object({ id: col.uuid }), sql`select id from commerce.platform_sales where mode = ${mode} and stripe_invoice_id = ${invoice}`);
    const kept = await find();
    if (kept) return kept.id;
    const read = await stripe.invoices.retrieve(invoice);
    if (await recordPlatformSale(mode, read as unknown as Parameters<typeof recordPlatformSale>[1])) return (await find())?.id ?? null;
    return null;
  }
  return null;
}

/**
 * What a paid payout carried: each balance transaction (at most `PAYOUT_LINES_MAX`), tied to its sale, kept once; the payout's fee is the
 * sum of its lines' fees; a sale's own line settles it where Stripe had not said what it settled.
 */
export async function readPlatformPayoutLines(mode: PaymentModeName, payoutId: string, stripePayoutId: string, stripe: Stripe): Promise<number> {
  const lines: { id: string; kind: (typeof PAYOUT_LINE_KINDS)[number]; currency: string; amount: number; fee: number; net: number; saleId: string | null }[] = [];
  const intents = new Map<string, string | null>();
  let complete = true;
  for await (const bt of stripe.balanceTransactions.list({ payout: stripePayoutId, limit: 100, expand: ["data.source"] })) {
    if (lines.length >= PAYOUT_LINES_MAX) {
      complete = false;
      break;
    }
    const sourceId = typeof bt.source === "string" ? bt.source : (bt.source?.id ?? null);
    const kind = lineKindOf(bt.type, sourceId);
    const intent = kind === "charge" || kind === "refund" || kind === "dispute" ? paymentIntentOf(bt.source) : null;
    if (intent && !intents.has(intent)) intents.set(intent, await saleOfIntent(mode, intent, stripe));
    lines.push({ id: bt.id, kind, currency: bt.currency.toUpperCase(), amount: bt.amount, fee: bt.fee, net: bt.net, saleId: intent ? (intents.get(intent) ?? null) : null });
  }
  for (const l of lines) {
    await db().execute(sql`
      insert into commerce.platform_payout_lines (payout_id, stripe_balance_transaction_id, kind, currency, amount_minor, fee_minor, net_minor, sale_id)
      values (${payoutId}::uuid, ${l.id}, ${l.kind}, ${l.currency}, ${l.amount}, ${l.fee}, ${l.net}, ${l.saleId}::uuid)
      on conflict (payout_id, stripe_balance_transaction_id) do update set sale_id = excluded.sale_id`);
    if (l.kind === "charge" && l.saleId) {
      await db().execute(sql`
        update commerce.platform_sales set settled_minor = ${l.amount}, settled_currency = ${l.currency}, fee_minor = ${Math.max(l.fee, 0)}, updated_at = now()
         where id = ${l.saleId}::uuid and settled_minor is null`);
    }
  }
  const fee = lines.filter((l) => l.kind !== "payout").reduce((s, l) => s + l.fee, 0);
  await db().execute(sql`
    update commerce.platform_payouts set fee_minor = ${Math.max(fee, 0)}, lines_read_at = now(), lines_complete = ${complete}, updated_at = now()
     where id = ${payoutId}::uuid`);
  return lines.length;
}

/**
 * Kaizena Flow's own payouts made since a day, in one mode, read from its Stripe account and kept once (their status and arrival kept up);
 * a paid one's lines read once. Returns how many payouts were read; never throws.
 */
export async function readPlatformPayouts(mode: PaymentModeName, sinceDay: string, stripe: Stripe | null = platformStripe(mode)): Promise<number> {
  if (!stripe) return 0;
  let read = 0;
  try {
    for await (const payout of stripe.payouts.list({ created: { gte: Math.floor(Date.parse(`${sinceDay}T00:00:00Z`) / 1000) }, limit: 100 })) {
      const arrival = new Date(payout.arrival_date * 1000).toISOString().slice(0, 10);
      const row = await typedRow(
        z.object({ id: col.uuid, lines_read: col.bool }),
        sql`insert into commerce.platform_payouts (mode, stripe_payout_id, arrival_on, currency, amount_minor, status, automatic)
            values (${mode}, ${payout.id}, ${arrival}::date, ${payout.currency.toUpperCase()}, ${payout.amount}, ${payout.status}, ${payout.automatic})
            on conflict (mode, stripe_payout_id) do update
              set status = excluded.status, arrival_on = excluded.arrival_on, amount_minor = excluded.amount_minor, automatic = excluded.automatic, updated_at = now()
            returning id, lines_read_at is not null as lines_read`,
      );
      read += 1;
      if (row && payout.status === "paid" && payout.automatic && !row.lines_read) {
        try {
          await readPlatformPayoutLines(mode, row.id, payout.id, stripe);
        } catch (error) {
          log("warn", "platform_payouts.lines_failed", { mode }, error);
        }
      }
    }
  } catch (error) {
    log("warn", "platform_books.payouts_failed", { mode }, error);
  }
  return read;
}

export type PlatformPayoutRow = {
  id: string;
  mode: "live" | "test";
  stripePayoutId: string;
  arrivalOn: string;
  currency: string;
  amountMinor: number;
  feeMinor: number;
  status: PayoutStatus;
  sales: number;
  state: PayoutState;
};

const PAYOUT_ROW = z.object({
  id: col.uuid,
  mode: z.enum(["live", "test"]),
  stripe_payout_id: col.text,
  arrival_on: col.text,
  currency: col.currency,
  amount_minor: col.minor,
  fee_minor: col.minor,
  status: col.text,
  automatic: col.bool,
  lines_read: col.bool,
  lines_complete: col.bool,
  lines_net: col.minor,
  untied: col.int,
  sales: col.int,
});

const statusOf = (status: string): PayoutStatus => (isPayoutStatus(status) ? status : "pending");

/** A year's payouts by the day they arrive (newest first), live and test apart, each with how many sales it carried and whether it adds up. */
export async function platformPayoutsView(year: number): Promise<{ live: PlatformPayoutRow[]; test: PlatformPayoutRow[] }> {
  const rows = await typedRows(
    PAYOUT_ROW,
    sql`select p.id, p.mode, p.stripe_payout_id, p.arrival_on::text, p.currency, p.amount_minor, p.fee_minor, p.status, p.automatic,
               p.lines_read_at is not null as lines_read, p.lines_complete,
               coalesce(sum(l.net_minor) filter (where l.kind <> 'payout'), 0) as lines_net,
               count(l.id) filter (where l.kind in ('charge', 'refund', 'dispute') and l.sale_id is null)::int as untied,
               count(distinct l.sale_id) filter (where l.kind = 'charge')::int as sales
          from commerce.platform_payouts p left join commerce.platform_payout_lines l on l.payout_id = p.id
         where p.arrival_on >= make_date(${year}, 1, 1) and p.arrival_on < make_date(${year + 1}, 1, 1)
         group by p.id order by p.arrival_on desc, p.created_at desc limit 400`,
  );
  const all = rows.map(
    (r): PlatformPayoutRow => ({
      id: r.id,
      mode: r.mode,
      stripePayoutId: r.stripe_payout_id,
      arrivalOn: r.arrival_on,
      currency: r.currency,
      amountMinor: r.amount_minor,
      feeMinor: r.fee_minor,
      status: statusOf(r.status),
      sales: r.sales,
      state:
        statusOf(r.status) === "paid"
          ? platformPayoutState({ amountMinor: r.amount_minor, status: "paid", automatic: r.automatic, linesRead: r.lines_read, linesComplete: r.lines_complete, linesNetMinor: r.lines_net, untiedCount: r.untied })
          : "not_read",
    }),
  );
  return { live: all.filter((r) => r.mode === "live"), test: all.filter((r) => r.mode === "test") };
}

export type PlatformPayoutDetail = {
  payout: PlatformPayoutRow & { automatic: boolean };
  reconciliation: Reconciliation;
  lines: {
    id: string;
    kind: (typeof PAYOUT_LINE_KINDS)[number];
    currency: string;
    amountMinor: number;
    feeMinor: number;
    netMinor: number;
    sale: { number: string | null; kind: string; paidOn: string; storeSlug: string | null; storeName: string | null } | null;
  }[];
};

/** One payout with every line it carried and the sale (and the store that bought it) each was for. */
export async function platformPayoutDetail(id: string): Promise<PlatformPayoutDetail | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [row] = await typedRows(
    PAYOUT_ROW,
    sql`select p.id, p.mode, p.stripe_payout_id, p.arrival_on::text, p.currency, p.amount_minor, p.fee_minor, p.status, p.automatic,
               p.lines_read_at is not null as lines_read, p.lines_complete, 0::bigint as lines_net, 0 as untied, 0 as sales
          from commerce.platform_payouts p where p.id = ${id}::uuid`,
  );
  if (!row) return null;
  const lines = await typedRows(
    z.object({
      id: col.uuid,
      kind: z.enum(PAYOUT_LINE_KINDS),
      currency: col.currency,
      amount_minor: col.minor,
      fee_minor: col.minor,
      net_minor: col.minor,
      sale_id: col.uuid.nullable(),
      number: col.textOrNull,
      sale_kind: col.textOrNull,
      paid_on: col.textOrNull,
      slug: col.textOrNull,
      name: col.textOrNull,
    }),
    sql`select l.id, l.kind, l.currency, l.amount_minor, l.fee_minor, l.net_minor, l.sale_id, s.number, s.kind as sale_kind,
               (s.paid_at at time zone 'Europe/Oslo')::date::text as paid_on, st.slug, st.name
          from commerce.platform_payout_lines l
          left join commerce.platform_sales s on s.id = l.sale_id
          left join commerce.stores st on st.id = s.buyer_store_id
         where l.payout_id = ${id}::uuid order by l.kind = 'payout', l.amount_minor desc, l.id`,
  );
  const status = statusOf(row.status);
  const facts = { amountMinor: row.amount_minor, status, automatic: row.automatic, linesRead: row.lines_read, linesComplete: row.lines_complete };
  const reconciliation = reconcilePlatformPayout(
    facts,
    lines.map((l) => ({ kind: l.kind, amountMinor: l.amount_minor, feeMinor: l.fee_minor, netMinor: l.net_minor, saleId: l.sale_id })),
  );
  return {
    payout: {
      id: row.id,
      mode: row.mode,
      stripePayoutId: row.stripe_payout_id,
      arrivalOn: row.arrival_on,
      currency: row.currency,
      amountMinor: row.amount_minor,
      feeMinor: row.fee_minor,
      status,
      automatic: row.automatic,
      sales: new Set(lines.filter((l) => l.kind === "charge" && l.sale_id).map((l) => l.sale_id)).size,
      state: status === "paid" ? reconciliation.state : "not_read",
    },
    reconciliation,
    lines: lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      currency: l.currency,
      amountMinor: l.amount_minor,
      feeMinor: l.fee_minor,
      netMinor: l.net_minor,
      sale: l.sale_id ? { number: l.number, kind: l.sale_kind ?? "other", paidOn: l.paid_on ?? "", storeSlug: l.slug, storeName: l.name } : null,
    })),
  };
}
