/* eslint-disable @typescript-eslint/no-explicit-any -- a snapshot is JSON */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, creditNotesOf, invoiceOf, one, placeOrder, refund, scalar } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

let db: PGlite;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.close();
});

describe("money review", () => {
  it("home-currency VAT: credit notes of a split refund add up to the invoice's", async () => {
    const shop = await createInvoiceStore(db, "rv-home");
    // Several small VAT buckets so rounding differs between whole and parts.
    const o = await placeOrder(db, shop, {
      market: "FI",
      currency: "EUR",
      lines: [
        { sku: "A", unit: 1999, rate: 0.24 },
        { sku: "B", unit: 1333, rate: 0.14 },
        { sku: "C", unit: 777, rate: 0.1 },
      ],
      shipping: 599,
    });
    const inv = await invoiceOf(db, o.id);
    for (const a of [101, 333, 777, 1001, 500]) await refund(db, o.id, a);
    const rest = o.total - (101 + 333 + 777 + 1001 + 500);
    await refund(db, o.id, rest);
    const notes = await creditNotesOf(db, o.id);
    const sumTax = notes.reduce((s, n) => s + Number(n.tax_minor), 0);
    const sumHome = notes.reduce((s, n) => s + Number(n.snapshot.vatHome?.vatMinor ?? 0), 0);
    const sumMain = notes.reduce((s, n) => s + Number(n.snapshot.vatMain?.vatMinor ?? 0), 0);
    expect(sumTax).toBe(Number(inv.tax_minor));
    expect(sumHome).toBe(inv.snapshot.vatHome.vatMinor);
    expect(sumMain).toBe(inv.snapshot.vatMain.vatMinor);
  });

  it("a refund of a no-show fee payment does not credit the invoice", async () => {
    const shop = await createInvoiceStore(db, "rv-noshow");
    const o = await placeOrder(db, shop, { lines: [{ sku: "S", unit: 100000, delivery: "service" }] });
    const pay = await one<{ id: string; store_id: string }>(db, "select id, store_id from commerce.payments where order_id = $1", [o.id]);
    const fee = await one<{ id: string }>(
      db,
      "insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status) values ($1,$2,'stripe','pi_noshow',null,5000,'NOK','captured') returning id",
      [pay.store_id, o.id],
    );
    await db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values ($1,$2,5000,'dash','re_noshow','succeeded')", [pay.store_id, fee.id]);
    const notes = await creditNotesOf(db, o.id);
    expect(notes.length).toBe(0);
    // The order says why, once, and the retry job does not keep trying it.
    const events = await db.query<{ data: { key: string; amountMinor: number } }>("select data from commerce.order_events where order_id = $1 and type = 'credit_note.not_invoiced'", [o.id]);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].data.amountMinor).toBe(5000);
    await db.query("select commerce.issue_missing_credit_notes($1::uuid)", [pay.store_id]);
    expect(await creditNotesOf(db, o.id)).toHaveLength(0);
    expect(await scalar<number>(db, "select count(*)::int from commerce.order_events where order_id = $1 and type = 'credit_note.not_invoiced'", [o.id])).toBe(1);
    // The goods' own refund still gets its note, and the fee's refund did not use up what the invoice has left.
    await refund(db, o.id, 100000);
    const after = await creditNotesOf(db, o.id);
    expect(after).toHaveLength(1);
    expect(Number(after[0].total_minor)).toBe(100000);
  });

  it("a fee charged before a waiting invoice was issued is still named by its no-show event and not credited", async () => {
    const shop = await createInvoiceStore(db, "rv-noshow-wait");
    const o = await placeOrder(db, shop, { lines: [{ sku: "S2", unit: 100000, delivery: "service" }] });
    const pay = await one<{ id: string; store_id: string; created_at: string }>(db, "select id, store_id, created_at::text from commerce.payments where order_id = $1", [o.id]);
    // A fee payment older than the invoice (as if the invoice had waited), named by the no-show event as markNoShow() writes it.
    const fee = await one<{ id: string }>(
      db,
      "insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status, created_at) values ($1,$2,'stripe','pi_noshow2',null,5000,'NOK','captured', now() - interval '1 day') returning id",
      [pay.store_id, o.id],
    );
    await db.query("insert into commerce.order_events (store_id, order_id, type, data, actor) values ($1,$2,'booking.no_show',$3::jsonb,'staff')", [pay.store_id, o.id, JSON.stringify({ charged: 5000, payment: fee.id })]);
    await db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values ($1,$2,5000,'dash','re_noshow2','succeeded')", [pay.store_id, fee.id]);
    expect(await creditNotesOf(db, o.id)).toHaveLength(0);
  });

  it("a refund of the order's own payment, and of a payment made before its invoice, is credited as always", async () => {
    const shop = await createInvoiceStore(db, "rv-own");
    const o = await placeOrder(db, shop, { lines: [{ sku: "OWN", unit: 20000 }] });
    await refund(db, o.id, 5000);
    expect(await creditNotesOf(db, o.id)).toHaveLength(1);
    expect(await scalar<number>(db, "select count(*)::int from commerce.order_events where order_id = $1 and type = 'credit_note.not_invoiced'", [o.id])).toBe(0);
  });
});

describe("random orders and refunds keep the invariants", () => {
  it("holds", async () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    const shop = await createInvoiceStore(db, "rv-rand");
    const problems: string[] = [];
    let counted = 0;
    for (let i = 0; i < 120; i += 1) {
      const n = 1 + Math.floor(rnd() * 4);
      const rc = rnd() < 0.2;
      const lines: any[] = [];
      for (let k = 0; k < n; k += 1) {
        const unit = 100 + Math.floor(rnd() * 20000);
        const l: any = { sku: `R${i}-${k}`, unit, quantity: 1 + Math.floor(rnd() * 4), rate: pick([0, 0.06, 0.12, 0.15, 0.25, 0.255, 0.19, 0.21]) };
        const gross = l.unit * l.quantity;
        if (rnd() < 0.4) l.discount = Math.floor(rnd() * gross * 0.5);
        if (rnd() < 0.2) l.member = Math.floor(rnd() * 200);
        if (rnd() < 0.2) l.bonus = Math.floor(rnd() * 300);
        if (rnd() < 0.1) l.gift = true;
        if (rnd() < 0.15) l.category = "exempt";
        lines.push(l);
      }
      if (lines.every((l) => l.gift)) lines[0].gift = false;
      const mk = pick([{ market: "NO" }, { market: "FI", currency: "EUR" }, { market: "SE" }]);
      const spec: any = { ...mk, lines, shipping: rnd() < 0.7 ? Math.floor(rnd() * 15000) : 0 };
      if (spec.shipping && rnd() < 0.3) spec.shippingDiscount = Math.floor(rnd() * spec.shipping);
      if (rc) { spec.vatKind = "reverse_charge"; spec.company = { name: "B AS", vatNumber: "SE123456789001" }; }
      let o;
      try { o = await placeOrder(db, shop, spec); } catch (e) { continue; }
      if (o.total <= 0) continue;
      counted += 1;
      const inv = await invoiceOf(db, o.id);
      if (!inv) { problems.push(`no invoice order ${i} total ${o.total}`); continue; }
      if (Number(inv.total_minor) !== o.total) problems.push(`total mismatch ${i}`);
      const bsum = inv.snapshot.buckets.reduce((s: number, b: any) => s + b.grossMinor, 0);
      if (bsum !== o.total) problems.push(`bucket sum ${bsum} vs ${o.total}`);
      if (!rc && Number(inv.tax_minor) !== o.tax) problems.push(`tax ${inv.tax_minor} vs ${o.tax} order ${i}`);
      for (const b of inv.snapshot.buckets) if (b.netMinor + b.vatMinor !== b.grossMinor || b.vatMinor < 0 || b.netMinor < 0) problems.push(`bucket bad ${JSON.stringify(b)} order ${i}`);
      // refunds
      let left = o.total;
      const parts = 1 + Math.floor(rnd() * 4);
      for (let p = 0; p < parts && left > 0; p += 1) {
        const a = p === parts - 1 ? left : Math.max(1, Math.floor(rnd() * left));
        await refund(db, o.id, a);
        left -= a;
      }
      const notes = await creditNotesOf(db, o.id);
      const sumTotal = notes.reduce((s, n) => s + Number(n.total_minor), 0);
      const sumTax = notes.reduce((s, n) => s + Number(n.tax_minor), 0);
      if (sumTotal !== o.total) problems.push(`credit sum ${sumTotal} vs ${o.total} order ${i}`);
      if (sumTax !== Number(inv.tax_minor)) problems.push(`credit tax ${sumTax} vs ${inv.tax_minor} order ${i}`);
      for (const nt of notes) if (Number(nt.net_minor) + Number(nt.tax_minor) !== Number(nt.total_minor)) problems.push(`note net+tax ${nt.document_number}`);
    }
    console.log("ran", counted, problems.slice(0, 20).join("\n"));
    expect(problems).toEqual([]);
  });
});

describe("test-mode venue orders", () => {
  it("are not numbered when the store later goes live", async () => {
    const shop = await createInvoiceStore(db, "rv-testlive");
    await db.query("insert into commerce.payment_providers (store_id, provider, enabled, active_mode) values ($1,'stripe',true,'test') on conflict (store_id, provider) do update set active_mode='test'", [shop]);
    const t = await placeOrder(db, shop, { lines: [{ sku: "T1", unit: 3000 }], provider: "venue" });
    expect(t.invoiceId).toBeNull();
    await db.query("update commerce.payment_providers set active_mode = 'live' where store_id = $1 and provider = 'stripe'", [shop]);
    await db.query("select commerce.issue_waiting_invoices($1::uuid)", [shop]);
    const n = await scalar<number>(db, "select count(*)::int from commerce.invoices where order_id = $1", [t.id]);
    expect(n).toBe(0);
    expect(await scalar(db, "select commerce.invoice_eligibility($1::uuid)", [t.id])).toBe("test_mode");
    // The mode is frozen with the payment, not read when the invoice is asked for.
    expect(await scalar(db, "select test_mode from commerce.payments where order_id = $1", [t.id])).toBe(true);
    // And an order confirmed after the switch is invoiced, as before.
    const live = await placeOrder(db, shop, { lines: [{ sku: "T2", unit: 3000 }], provider: "venue" });
    expect(live.invoiceId).not.toBeNull();
    expect(await scalar(db, "select test_mode from commerce.payments where order_id = $1", [live.id])).toBe(false);
  });

  it("a Stripe payment's mode is its account's: the column stays false for it", async () => {
    const shop = await createInvoiceStore(db, "rv-stripe-mode");
    const o = await placeOrder(db, shop, { lines: [{ sku: "ST", unit: 3000 }] });
    expect(await scalar(db, "select bool_or(test_mode) from commerce.payments where order_id = $1", [o.id])).toBe(false);
  });
});
