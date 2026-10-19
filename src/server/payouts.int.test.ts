import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

/** Kaizena Flow's platform Stripe client, faked: a payout's balance transactions, an account's payouts, and the session behind an intent. */
const fake = vi.hoisted(() => {
  const state = { lines: new Map<string, unknown[]>(), payouts: new Map<string, unknown[]>(), down: false, listed: 0 };
  const iterable = <T>(items: readonly T[]) => ({
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  });
  const client = {
    balanceTransactions: {
      list: ({ payout }: { payout: string }) => {
        state.listed += 1;
        if (state.down) throw new Error("Stripe is down");
        return iterable(state.lines.get(payout) ?? []);
      },
    },
    payouts: { list: (_q: unknown, o: { stripeAccount: string }) => iterable(state.payouts.get(o.stripeAccount) ?? []) },
    checkout: {
      sessions: {
        list: async ({ payment_intent }: { payment_intent: string }) => ({ data: payment_intent.startsWith("pi_for_") ? [{ id: payment_intent.slice("pi_for_".length) }] : [] }),
        retrieve: async () => ({ payment_intent: null, invoice: null }),
      },
    },
    paymentIntents: { retrieve: async () => null },
    charges: { retrieve: async () => null },
  };
  return { client, state };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const { handleStripeEvent } = await import("./stripe-webhooks");
const payouts = await import("./payouts");
const { payoutsReport, payoutDetail } = await import("./payouts-report");
const { getStore } = await import("./stores");
const { periodTotals } = await import("./analytics-totals");
const { customPeriod, todayIn } = await import("@/lib/analytics-period");
const { DEFAULT_ANALYTICS_SETTINGS } = await import("@/lib/analytics-kpi");

type Row = Record<string, unknown>;

/**
 * Payouts and reconciliation (wave 4 unit C, D290, `docs/wave-4-payments.md` 5), through the real server code with a faked Stripe: a paid payout's lines
 * kept once and tied to payments (by charge or by the session behind the intent), refunds and their orders; Stripe's fee kept on the payment; a payout
 * that does not add up or holds money no order explains; a manual payout; an account that is not the store's; the daily read; Finance's real fees; and a
 * payout in euro.
 */

let n = 0;
/** Payout and line ids of this run, so a database used before never holds the same ones. */
const RUN = Math.random().toString(36).slice(2, 8);
const now = () => Math.floor(Date.now() / 1000);
/** Stripe's arrival date is midnight UTC of the day the money arrives: today in the store's time zone (Europe/Oslo), so a run near midnight UTC still means today. */
const arrivalToday = () => Date.parse(`${todayIn(new Date(), "Europe/Oslo")}T00:00:00Z`) / 1000;
const eventOf = (type: string, object: unknown, account: string): Stripe.Event =>
  ({ id: `evt_po_${++n}_${Math.random().toString(36).slice(2, 8)}`, type, account, data: { object } }) as unknown as Stripe.Event;

const payoutOf = (id: string, amount: number, over: Record<string, unknown> = {}) => ({
  id,
  object: "payout",
  amount,
  currency: "nok",
  status: "paid",
  automatic: true,
  arrival_date: arrivalToday(),
  created: now() - 86_400,
  livemode: true,
  ...over,
});

const bt = (id: string, type: string, amount: number, fee: number, source: unknown, currency = "nok", details?: { type: string; amount: number }[]) => ({
  id,
  object: "balance_transaction",
  type,
  amount,
  fee,
  net: amount - fee,
  currency,
  created: now() - 3_600,
  source,
  fee_details: details ?? (fee ? [{ type: "stripe_fee", amount: fee }] : []),
});

async function sessionOf(storeId: string, orderId: string): Promise<string> {
  const [p] = await db().execute<Row>(sql`select provider_reference from commerce.payments where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid`);
  return String(p.provider_reference);
}

afterAll(async () => {
  await closeDb();
});

describe("a paid payout", () => {
  it("keeps what it settles once, tied to its payments, refunds and orders, keeps Stripe's fee on each payment, and adds up", async () => {
    const own = await fx.makeStore("po-paid");
    const a = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const b = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]]);
    const sessionA = await sessionOf(own.storeId, a.orderId);
    const sessionB = await sessionOf(own.storeId, b.orderId);
    // A's charge is known from its facts (D288); B's is found by the session behind its intent.
    await db().execute(sql`update commerce.payments set charge_reference = ${`ch_${sessionA}`} where provider_reference = ${sessionA}`);
    const [pay] = await db().execute<Row>(sql`select id from commerce.payments where provider_reference = ${sessionA}`);
    const [refund] = await db().execute<Row>(sql`
      insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, provider_reference) values (${own.storeId}::uuid, ${String(pay.id)}::uuid, 5000, 'Test', 'succeeded', ${`re_${sessionA}`}) returning id
    `);
    const lines = [
      bt(`txn_a_${n}`, "charge", a.total, 340, `ch_${sessionA}`, "nok", [{ type: "stripe_fee", amount: 290 }, { type: "application_fee", amount: 50 }]),
      bt(`txn_b_${n}`, "charge", b.total, 500, { id: `ch_other_${sessionB}`, payment_intent: `pi_for_${sessionB}` }),
      bt(`txn_r_${n}`, "refund", -5000, 0, `re_${sessionA}`),
    ];
    const net = lines.reduce((s, l) => s + l.net, 0);
    const reference = `po_paid_${RUN}_${n}`;
    fake.state.lines.set(reference, [...lines, bt(`txn_p_${n}`, "payout", -net, 0, reference)]);

    await handleStripeEvent(own.storeId, eventOf("payout.paid", payoutOf(reference, net), own.account));
    // Stripe sends it again: nothing more.
    await handleStripeEvent(own.storeId, eventOf("payout.updated", payoutOf(reference, net), own.account));

    const kept = await db().execute<Row>(sql`
      select l.kind, l.order_id, l.payment_id, l.refund_id from commerce.payout_lines l join commerce.payouts p on p.id = l.payout_id
       where p.store_id = ${own.storeId}::uuid and p.provider_reference = ${reference} order by l.provider_reference
    `);
    expect(kept).toHaveLength(4);
    expect(kept.find((l) => l.kind === "refund")).toMatchObject({ order_id: a.orderId, refund_id: String(refund.id) });
    expect(kept.filter((l) => l.kind === "charge").map((l) => l.order_id).sort()).toEqual([a.orderId, b.orderId].sort());
    const fees = await db().execute<Row>(sql`
      select order_id, provider_fee_minor::int as fee, application_fee_minor::int as app, fee_currency from commerce.payments where order_id in (${a.orderId}::uuid, ${b.orderId}::uuid) order by order_id
    `);
    expect(fees.find((f) => f.order_id === a.orderId)).toMatchObject({ fee: 290, app: 50, fee_currency: "NOK" });
    expect(fees.find((f) => f.order_id === b.orderId)).toMatchObject({ fee: 500, app: 0, fee_currency: "NOK" });

    const store = (await getStore(own.slug))!;
    const today = todayIn(new Date(), store.timeZone);
    const report = await payoutsReport(store, customPeriod(today, today));
    expect(report.payouts).toHaveLength(1);
    expect(report.payouts[0]).toMatchObject({ reference, status: "paid", amountMinor: net, payments: 2, refunds: 1 });
    expect(report.payouts[0].reconciliation).toMatchObject({ state: "reconciles", differenceMinor: 0, untiedCount: 0, feesMinor: 840 });
    expect(report.totals).toEqual({ paidMinor: net, feesMinor: 840, paid: 1 });
    expect(report.flagged).toBe(0);
    const detail = await payoutDetail(store, report.payouts[0].id);
    expect(detail?.lines.find((l) => l.kind === "refund")?.orderNumber).toBe(a.number);

    // Finance takes Stripe's own fee (not the application fee, which is the platform's) for the orders whose every payment has one.
    const { totals } = await periodTotals(store, customPeriod(today, today), { ...DEFAULT_ANALYTICS_SETTINGS, paymentFeeBps: 0, paymentFeeFixedMinor: 0, saved: true, updatedAt: null });
    expect(totals.realFeeOrders).toBe(2);
    expect(totals.paymentFeesMinor).toBe(790);
  });

  it("says by how much it does not add up, and names money no order explains", async () => {
    const own = await fx.makeStore("po-flag");
    const a = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const sessionA = await sessionOf(own.storeId, a.orderId);
    await db().execute(sql`update commerce.payments set charge_reference = ${`ch_${sessionA}`} where provider_reference = ${sessionA}`);
    const lines = [bt(`txn_fa_${n}`, "charge", a.total, 300, `ch_${sessionA}`), bt(`txn_fx_${n}`, "charge", 7000, 200, `ch_unknown_${n}`)];
    const net = lines.reduce((s, l) => s + l.net, 0);
    fake.state.lines.set(`po_untied_${RUN}_${n}`, lines);
    await payouts.applyPayout(own.storeId, payoutOf(`po_untied_${RUN}_${n}`, net) as never, own.account);
    fake.state.lines.set(`po_off_${RUN}_${n}`, [bt(`txn_fb_${n}`, "charge", 1000, 0, `ch_unknown_b_${n}`)]);
    await payouts.applyPayout(own.storeId, payoutOf(`po_off_${RUN}_${n}`, 1500) as never, own.account);

    const store = (await getStore(own.slug))!;
    const today = todayIn(new Date(), store.timeZone);
    const report = await payoutsReport(store, customPeriod(today, today));
    const untied = report.payouts.find((p) => p.reference === `po_untied_${RUN}_${n}`)!;
    expect(untied.reconciliation).toMatchObject({ state: "untied", untiedMinor: 6800, untiedCount: 1, differenceMinor: 0 });
    const off = report.payouts.find((p) => p.reference === `po_off_${RUN}_${n}`)!;
    expect(off.reconciliation).toMatchObject({ state: "difference", differenceMinor: 500 });
    expect(report.flagged).toBe(2);
  });

  it("reads nothing for a manual payout or one still on its way, and skips an account that is not the store's", async () => {
    const own = await fx.makeStore("po-manual");
    const listed = fake.state.listed;
    await payouts.applyPayout(own.storeId, payoutOf(`po_manual_${RUN}_${n}`, 5000, { automatic: false }) as never, own.account);
    await payouts.applyPayout(own.storeId, payoutOf(`po_transit_${RUN}_${n}`, 5000, { status: "in_transit" }) as never, own.account);
    expect(fake.state.listed).toBe(listed);
    expect(await payouts.applyPayout(own.storeId, payoutOf(`po_other_${RUN}_${n}`, 5000) as never, "acct_not_the_store")).toEqual({ outcome: "skipped" });

    const store = (await getStore(own.slug))!;
    const today = todayIn(new Date(), store.timeZone);
    const report = await payoutsReport(store, customPeriod(today, today));
    expect(report.payouts.map((p) => [p.status, p.reconciliation.state]).sort()).toEqual([
      ["in_transit", "not_read"],
      ["paid", "manual"],
    ]);
    // Only paid payouts are summed.
    expect(report.totals.paid).toBe(1);
  });

  it("keeps a payout whose lines Stripe could not give for the job, which reads them later", async () => {
    const own = await fx.makeStore("po-later");
    fake.state.down = true;
    fake.state.lines.set(`po_later_${RUN}_${n}`, [bt(`txn_l_${n}`, "adjustment", 2500, 0, `ia_${n}`)]);
    const applied = await payouts.applyPayout(own.storeId, payoutOf(`po_later_${RUN}_${n}`, 2500) as never, own.account);
    expect(applied.lines).toBeUndefined();
    fake.state.down = false;
    const run = await payouts.runPayoutJobs({ storeIds: [own.storeId] });
    expect(run.lines).toBeGreaterThanOrEqual(1);
    const [p] = await db().execute<Row>(sql`select lines_read_at is not null as read, lines_complete from commerce.payouts where store_id = ${own.storeId}::uuid and provider_reference = ${`po_later_${RUN}_${n}`}`);
    expect(p).toMatchObject({ read: true, lines_complete: true });
  });
});

describe("the daily read", () => {
  it("reads a store's payouts of the last 30 days once a day", async () => {
    const own = await fx.makeStore("po-daily");
    const a = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const sessionA = await sessionOf(own.storeId, a.orderId);
    await db().execute(sql`update commerce.payments set charge_reference = ${`ch_${sessionA}`} where provider_reference = ${sessionA}`);
    const line = bt(`txn_d_${n}`, "charge", a.total, 300, `ch_${sessionA}`);
    fake.state.lines.set(`po_daily_${RUN}_${n}`, [line]);
    fake.state.payouts.set(own.account, [payoutOf(`po_daily_${RUN}_${n}`, line.net)]);
    const first = await payouts.runPayoutJobs({ storeIds: [own.storeId] });
    expect(first).toMatchObject({ stores: 1, payouts: 1, failed: 0 });
    const second = await payouts.runPayoutJobs({ storeIds: [own.storeId] });
    expect(second.stores).toBe(0);
    const [r] = await db().execute<Row>(sql`select problem from commerce.payout_reads where store_id = ${own.storeId}::uuid`);
    expect(r.problem).toBeNull();
  });
});

describe("a payout in euro", () => {
  it("is listed in euro and summed in the store's main currency at its rate", async () => {
    const own = await fx.makeStore("po-euro", { rates: true });
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { market: fx.noInEuro });
    const session = await sessionOf(own.storeId, order.orderId);
    await db().execute(sql`update commerce.payments set charge_reference = ${`ch_${session}`} where provider_reference = ${session}`);
    const line = bt(`txn_e_${n}`, "charge", 2000, 100, `ch_${session}`, "eur");
    fake.state.lines.set(`po_euro_${RUN}_${n}`, [line]);
    await payouts.applyPayout(own.storeId, payoutOf(`po_euro_${RUN}_${n}`, line.net, { currency: "eur" }) as never, own.account);

    const store = (await getStore(own.slug))!;
    const today = todayIn(new Date(), store.timeZone);
    const report = await payoutsReport(store, customPeriod(today, today));
    expect(report.payouts[0]).toMatchObject({ currency: "EUR", amountMinor: 1900 });
    expect(report.payouts[0].reconciliation.state).toBe("reconciles");
    // 19,00 EUR and 1,00 EUR at 11.5 NOK.
    expect(report.totals).toEqual({ paidMinor: 21_850, feesMinor: 1_150, paid: 1 });
    const [fee] = await db().execute<Row>(sql`select provider_fee_minor::int as fee, fee_currency from commerce.payments where provider_reference = ${session}`);
    expect(fee).toMatchObject({ fee: 100, fee_currency: "EUR" });
  });
});
