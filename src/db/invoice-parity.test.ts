/* eslint-disable @typescript-eslint/no-explicit-any -- a snapshot is JSON and the tests read it as such */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { creditNoteSnapshot, parseWorking } from "@/lib/credit-allocation";
import { buildInvoiceSnapshot, type InvoiceFacts, type OrderInvoiceSnapshot, type SnapshotBucket } from "@/lib/invoice-snapshot";

import { createInvoiceStore, creditNotesOf, invoiceOf, one, placeOrder, refund, refundReturn, refundReturnOutside, scalar, startReturn, workingOf, type DocRow, type OrderSpec } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * The invoice's snapshot is built twice: in SQL, inside the payment transaction (`commerce.build_invoice_snapshot()`), and by the
 * pure oracle `buildInvoiceSnapshot()` that the document's tests and unit 1c read the contract from. Here both are given the same
 * rows and must produce the same JSON; the same for the credit notes (`creditNoteSnapshot()`).
 */

let db: PGlite;
let no: string;
let dk: string;
let ee: string;

beforeAll(async () => {
  db = await createTestDatabase();
  no = await createInvoiceStore(db, "par-no", { footerNote: "Bank 1503.12.34567" });
  dk = await createInvoiceStore(db, "par-dk", { country: "DK", organisationNumber: "12345678", vatNumber: "DK12345678", timeZone: "Europe/Copenhagen", rates: { DKK: 7.46, NOK: 11.7 } });
  ee = await createInvoiceStore(db, "par-ee", { registered: false, rates: { NOK: 11.7 }, ratesAuto: true });
});

afterAll(async () => {
  await db.close();
});

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** The rows an invoice reads, as the oracle takes them. */
async function factsOf(orderId: string): Promise<InvoiceFacts> {
  const o = await one<Record<string, any>>(
    db,
    `select o.*, o.total_minor::text as total_t, to_char(commerce.store_day(o.store_id, o.placed_at), 'YYYY-MM-DD') as placed_on,
            to_char(commerce.store_day(o.store_id, (select min(e.created_at) from commerce.order_events e where e.order_id = o.id and e.type = 'order.paid')), 'YYYY-MM-DD') as paid_on,
            commerce.vat_rate(o.market_code, 'standard', o.placed_at)::text as market_rate,
            (select p.provider from commerce.payments p where p.order_id = o.id and p.provider <> 'venue' and p.status not in ('failed', 'cancelled') order by p.created_at, p.id limit 1) as online_provider,
            (select p.method from commerce.payments p where p.order_id = o.id and p.provider = 'manual' and p.status not in ('failed', 'cancelled') order by p.created_at, p.id limit 1) as online_method
       from commerce.orders o where o.id = $1`,
    [orderId],
  );
  const store = o.store_id as string;
  const lines = (
    await db.query<Record<string, any>>(
      `select ol.ctid, ol.*, p.vat_category, bk.starts_at, bk.ends_at,
              to_char(bk.starts_at at time zone s.time_zone, 'YYYY-MM-DD"T"HH24:MI') as starts_local, to_char(bk.ends_at at time zone s.time_zone, 'YYYY-MM-DD"T"HH24:MI') as ends_local
         from commerce.order_lines ol
         join commerce.stores s on s.id = ol.store_id
         left join commerce.product_variants v on v.store_id = ol.store_id and v.id = ol.variant_id
         left join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
         left join lateral (select b.starts_at, b.ends_at from commerce.bookings b where b.store_id = ol.store_id and b.order_line_id = ol.id order by b.starts_at limit 1) bk on true
        where ol.order_id = $1 order by ol.ctid`,
      [orderId],
    )
  ).rows;
  const s = await one<Record<string, any>>(db, "select s.*, c.currency::text as home from commerce.stores s left join commerce.countries c on c.code = s.country where s.id = $1", [store]);
  const profile = await one<Record<string, any>>(db, "select * from commerce.store_tax_profile where store_id = $1", [store]);
  const cfg = await one<Record<string, any>>(db, "select * from commerce.invoice_settings where store_id = $1", [store]);
  const rates = Object.fromEntries((await db.query<{ currency: string; rate: string | null }>("select currency, rate::text as rate from commerce.store_currencies where store_id = $1", [store])).rows.map((r) => [r.currency, r.rate]));
  const home = s.home as string | null;
  const asOf = await scalar<string>(db, "select to_char(commerce.fx_as_of($1::uuid, $2, $3), 'YYYY-MM-DD')", [store, o.currency, home ?? o.currency]);
  const t = o.vat_treatment as Record<string, any> | null;
  return {
    order: {
      id: o.id, number: o.number, marketCode: o.market_code, currency: o.currency, locale: o.locale, email: o.email, placedOn: o.placed_on, paidOn: o.paid_on,
      shippingMinor: num(o.shipping_minor)!, discountMinor: num(o.discount_minor)!, taxMinor: num(o.tax_minor)!, totalMinor: num(o.total_minor)!,
      memberDiscountMinor: num(o.member_discount_minor)!, memberLabel: o.member_label, campaignDiscountMinor: num(o.campaign_discount_minor)!, campaignLabel: o.campaign_label,
      creditMinor: num(o.credit_minor)!, referralDiscountMinor: num(o.referral_discount_minor)!, staffDiscountMinor: num(o.staff_discount_minor)!, staffLabel: o.staff_discount_label, discountCode: o.discount_code, vatKind: o.vat_kind,
      vatReliefMinor: num(o.vat_relief_minor)!, shippingTaxRate: num(o.shipping_tax_rate), marketStandardRate: num(o.market_rate), companyName: o.company_name,
      organisationNumber: o.organisation_number, balanceMinor: num(o.balance_minor)!, billingAddress: o.billing_address, shippingAddress: o.shipping_address,
      deliveryLabel: (o.delivery as { label?: string } | null)?.label ?? null, onlineProvider: o.online_provider ?? "stripe", onlineMethod: o.online_method ?? null,
    },
    lines: lines.map((l) => ({
      id: l.id, sku: l.sku, title: l.title, quantity: l.quantity, unitPriceMinor: num(l.unit_price_minor)!, totalMinor: num(l.total_minor)!, taxMinor: num(l.tax_minor)!,
      taxRate: num(l.tax_rate)!, delivery: l.delivery, gift: l.gift, planned: l.selling_plan_id !== null, bookedCount: l.booked_count, vatCategory: l.vat_category,
      booking: l.starts_at ? { startsAt: l.starts_local, endsAt: l.ends_local } : null,
    })),
    seller: { legalName: s.legal_name, organisationNumber: s.organisation_number, postalAddress: s.postal_address, country: s.country, email: s.contact_email, footerNote: cfg?.footer_note ?? null },
    profile: profile ? { vatRegistered: profile.vat_registered, vatNumber: profile.vat_number } : null,
    treatment: t ? { reason: t.reason ?? null, sellerVatNumber: t.sellerVatNumber ?? null, buyerVatNumber: t.buyerVatNumber ?? null, iossNumber: t.iossNumber ?? null } : null,
    fx: {
      homeCurrency: home,
      mainCurrency: await scalar<string>(db, "select commerce.main_currency($1)", [store]),
      rates,
      ratesAuto: s.rates_auto,
      ratesAsOf: asOf,
    },
  };
}

async function expectParity(storeId: string, spec: OrderSpec, check?: (snap: OrderInvoiceSnapshot) => void) {
  const o = await placeOrder(db, storeId, spec);
  expect(o.invoiceId, "the invoice was issued").not.toBeNull();
  const inv = await invoiceOf(db, o.id);
  const facts = await factsOf(o.id);
  const oracle = buildInvoiceSnapshot(facts, { number: inv.document_number, issuedOn: inv.issued_on, supplyDate: inv.supply_date! });
  expect(inv.snapshot).toEqual(JSON.parse(JSON.stringify(oracle)));
  // The row's columns are the snapshot's.
  expect([Number(inv.total_minor), Number(inv.tax_minor), Number(inv.net_minor)]).toEqual([oracle.totals.grossMinor, oracle.totals.vatMinor, oracle.totals.netMinor]);
  expect(Number(inv.total_minor)).toBe(o.total);
  check?.(oracle);
  return { order: o, invoice: inv, oracle };
}

describe("the invoice's snapshot: SQL and the oracle agree", () => {
  it("mixed rates, a shipping rate of its own, a code's discount, a gift and a quantity of three at an odd price", async () => {
    await expectParity(no, {
      lines: [
        { sku: "A", unit: 12999, quantity: 3, discount: 1500, rate: 0.25 },
        { sku: "B", unit: 4950, rate: 0.15, category: "food" },
        { sku: "C", unit: 999, quantity: 7, rate: 0.12 },
        { sku: "G", unit: 3000, gift: true },
        { sku: "X", unit: 2500, category: "exempt", rate: 0 },
      ],
      shipping: 9900,
      shippingRate: 0.15,
      deliveryLabel: "Posten Servicepakke",
      discountCode: "SAVE",
    }, (snap) => {
      expect(snap.buckets.length).toBeGreaterThanOrEqual(4);
      expect(snap.notes).toContain("unit_price_rounded");
      expect(snap.treatment.statements).toContain("exempt");
    });
  });

  it("discounts of every kind, with free shipping", async () => {
    await expectParity(no, {
      lines: [
        { sku: "D1", unit: 20000, quantity: 2, member: 2000, campaign: 3000, bonus: 500, referral: 1000, discount: 700 },
        { sku: "D2", unit: 1990 },
      ],
      shipping: 4900,
      shippingDiscount: 4900,
      memberLabel: "Gold",
      campaignLabel: "Autumn sale",
      discountCode: "FREESHIP",
    }, (snap) => {
      expect(snap.discounts.map((d) => d.kind)).toEqual(["campaign", "member", "welcome", "code", "credit"]);
      expect(snap.shipping?.discountNetMinor).toBeGreaterThan(0);
    });
  });

  it("a staff discount (D173) is its own kind with the name staff gave it, never an unnamed discount code; the code keeps only its own share", async () => {
    await expectParity(no, {
      lines: [{ sku: "S1", unit: 20000, quantity: 2, staff: 4000 }, { sku: "S2", unit: 1990 }],
      shipping: 4900,
      staffLabel: "Spring offer",
    }, (snap) => {
      expect(snap.discounts).toEqual([{ kind: "staff", label: "Spring offer", grossMinor: 4000 }]);
    });
    // Beside a code, each is only its own: the staff discount is never counted twice.
    await expectParity(no, {
      lines: [{ sku: "S3", unit: 20000, discount: 700, staff: 1000 }],
      discountCode: "SAVE",
      staffLabel: "Friend of the shop",
    }, (snap) => {
      expect(snap.discounts).toEqual([
        { kind: "code", label: "SAVE", grossMinor: 700 },
        { kind: "staff", label: "Friend of the shop", grossMinor: 1000 },
      ]);
    });
  });

  it("reverse charge: rate 0 on the document, the rate it would have had on the line, both numbers", async () => {
    await expectParity(no, {
      lines: [{ sku: "R1", unit: 25000, quantity: 2, discount: 2500 }, { sku: "R2", unit: 4000, rate: 0.15 }],
      shipping: 7500,
      vatKind: "reverse_charge",
      market: "DE",
      currency: "EUR",
      company: { name: "Muster GmbH", number: "DE-HRB 123", vatNumber: "DE123456789" },
    }, (snap) => {
      expect(snap.totals.vatMinor).toBe(0);
      expect(snap.lines.every((l) => l.vatRate === 0 && l.wouldHaveRate !== null)).toBe(true);
      expect(snap.treatment.buyerVatNumber).toBe("DE123456789");
      expect(snap.treatment.statements).toContain("reverse_charge");
      expect(JSON.stringify(snap)).not.toContain("VIES");
    });
  });

  it("IOSS: the VAT is charged and the number is stated", async () => {
    await expectParity(no, { lines: [{ sku: "I1", unit: 9900, rate: 0.19 }], shipping: 1500, shippingRate: 0.19, vatKind: "ioss", market: "DE", currency: "EUR" }, (snap) => {
      expect(snap.treatment.iossNumber).toBe("IM5780000001");
      expect(snap.treatment.statements).toEqual(["ioss"]);
    });
  });

  it("an order in euros in a store whose country keeps kroner: the VAT in kroner, at the store's rate, bucket by bucket", async () => {
    await expectParity(no, { lines: [{ sku: "E1", unit: 3333, quantity: 3, rate: 0.24 }, { sku: "E2", unit: 1717, rate: 0.14 }], shipping: 595, shippingRate: 0.24, market: "FI", currency: "EUR" }, (snap) => {
      expect(snap.vatHome?.currency).toBe("NOK");
      expect(snap.vatHome?.fxRate).toBeCloseTo(11.7, 8);
      expect(snap.vatHome?.source).toBe("owner");
      expect(snap.vatMain?.currency).toBe("NOK");
    });
  });

  it("a Danish seller invoicing in euro needs no kroner line; in Swedish kronor it does", async () => {
    await expectParity(dk, { lines: [{ sku: "K1", unit: 5000 }], market: "FI", currency: "EUR", shipping: 500 }, (snap) => expect(snap.vatHome).toBeNull());
    await expectParity(dk, { lines: [{ sku: "K2", unit: 5000 }], market: "NO", currency: "NOK", shipping: 500 }, (snap) => {
      expect(snap.vatHome?.currency).toBe("DKK");
      expect(snap.vatMain?.currency).toBe("DKK");
    });
  });

  it("a booking and a venue balance: two payment lines, the booked time", async () => {
    await expectParity(no, {
      lines: [{ sku: "ROOM", unit: 180000, delivery: "service", booking: { startsAt: "2026-10-12T14:00", endsAt: "2026-10-14T11:00", count: 2 }, rate: 0.12, category: "accommodation" }],
      balance: 130000,
    }, (snap) => {
      expect(snap.lines[0].kind).toBe("booking");
      expect(snap.lines[0].serviceDate).toBe("2026-10-12");
      expect(snap.payments.map((p) => p.kind)).toEqual(["paid_online", "pay_at_venue"]);
    });
  });

  it("a payment recorded outside Kaizen is stated as paid outside, with its method, never as paid online (D173)", async () => {
    for (const method of ["bank_transfer", "cash", "other"] as const) {
      await expectParity(no, { lines: [{ sku: `MAN-${method}`, unit: 15000, quantity: 2, rate: 0.25 }], shipping: 5900, provider: "manual", method }, (snap) => {
        expect(snap.payments).toEqual([{ kind: "paid_outside", amountMinor: snap.totals.grossMinor, provider: "manual", method }]);
      });
    }
    // The same goods paid through Stripe keep their kind.
    await expectParity(no, { lines: [{ sku: "MAN-STRIPE", unit: 15000 }], provider: "stripe" }, (snap) => {
      expect(snap.payments.map((p) => p.kind)).toEqual(["paid_online"]);
      expect(snap.payments[0]).not.toHaveProperty("method");
    });
  });

  it("a free trial: the trial line is deferred and the sign-up fee is a line", async () => {
    await expectParity(no, {
      lines: [{ sku: "BOX", unit: 29900, plan: "trial" }, { sku: "SIGNUP-FEE", unit: 4900, delivery: "digital", plan: "fee" }],
    }, (snap) => {
      expect(snap.deferred).toHaveLength(1);
      expect(snap.lines.map((l) => l.kind)).toEqual(["fee"]);
      expect(snap.notes).toContain("trial_deferred");
    });
  });

  it("a buyer with no street address is incomplete and nothing is invented; a download has no place of delivery", async () => {
    await expectParity(no, { lines: [{ sku: "DL", unit: 1900, delivery: "digital" }], billing: { name: "Ola", country: "SE" }, shipTo: {} }, (snap) => {
      expect(snap.buyer.complete).toBe(false);
      expect(snap.buyer.address.country).toBe("SE");
      expect(snap.order.deliveryPlace).toBeNull();
      expect(snap.notes).toContain("buyer_incomplete");
      expect(snap.lines[0].kind).toBe("download");
    });
  });

  it("an order from before shipping kept its rate takes the market's standard rate", async () => {
    await expectParity(no, { lines: [{ sku: "OLD", unit: 8000 }], shipping: 5000, shippingRate: null, noTreatment: true });
  });

  it("a store that is not VAT-registered: an order with no VAT says so", async () => {
    await expectParity(ee, { lines: [{ sku: "NV", unit: 5000, rate: 0, category: "exempt" }], shipping: 0, shippingRate: 0, market: "NO", currency: "NOK" }, (snap) => {
      expect(snap.treatment.statements).toEqual(["not_registered", "exempt"]);
      expect(snap.seller.vatNumber).toBeNull();
    });
  });

  it("a renewal has no treatment: the seller's number is the live profile's", async () => {
    await expectParity(no, { lines: [{ sku: "REN", unit: 19900, plan: "renewing" }], noTreatment: true }, (snap) => expect(snap.seller.vatNumber).toBe("NO923456789MVA"));
  });
});

describe("the credit note's snapshot: SQL and the oracle agree", () => {
  async function creditParity(orderId: string, invoice: DocRow, notes: DocRow[], expected: { refundMinor: number; source: "refund" | "return_outside"; returnNumber?: string | null; working?: unknown }, n: number) {
    const note = notes[n];
    const earlier = notes.slice(0, n).map((c) => c.snapshot.buckets as SnapshotBucket[]);
    const result = creditNoteSnapshot({
      invoice: { id: invoice.id, snapshot: invoice.snapshot },
      earlier,
      source: expected.source,
      returnNumber: expected.returnNumber ?? null,
      refundMinor: expected.refundMinor,
      working: parseWorking(expected.working ?? null),
      number: note.document_number,
      issuedOn: note.issued_on,
    });
    expect(note.snapshot).toEqual(JSON.parse(JSON.stringify(result.snapshot)));
    expect(Number(note.total_minor)).toBe(result.creditedMinor);
    void orderId;
  }

  it("partial refunds over several rates, then the rest: the buckets end at exactly zero", async () => {
    const { order, invoice } = await expectParity(no, {
      lines: [{ sku: "P1", unit: 12999, quantity: 3, rate: 0.25 }, { sku: "P2", unit: 4950, rate: 0.15, category: "food" }, { sku: "P3", unit: 999, quantity: 7, rate: 0.12 }],
      shipping: 9900,
      shippingRate: 0.25,
    });
    await refund(db, order.id, 10001);
    await refund(db, order.id, 25555);
    const left = order.total - 10001 - 25555;
    await refund(db, order.id, left);
    const notes = await creditNotesOf(db, order.id);
    expect(notes).toHaveLength(3);
    await creditParity(order.id, invoice, notes, { refundMinor: 10001, source: "refund" }, 0);
    await creditParity(order.id, invoice, notes, { refundMinor: 25555, source: "refund" }, 1);
    await creditParity(order.id, invoice, notes, { refundMinor: left, source: "refund" }, 2);
    const credited = notes.reduce((s, c) => ({ vat: s.vat + Number(c.tax_minor), gross: s.gross + Number(c.total_minor) }), { vat: 0, gross: 0 });
    expect(credited).toEqual({ vat: Number(invoice.tax_minor), gross: Number(invoice.total_minor) });
  });

  it("a refund larger than what is left is credited up to what is left", async () => {
    const { order, invoice } = await expectParity(no, { lines: [{ sku: "S1", unit: 10000 }] });
    await refund(db, order.id, 6000);
    await refund(db, order.id, 9000);
    const notes = await creditNotesOf(db, order.id);
    expect(notes.map((c) => Number(c.total_minor))).toEqual([6000, 4000]);
    await creditParity(order.id, invoice, notes, { refundMinor: 9000, source: "refund" }, 1);
    expect(notes[1].snapshot.notes).toContain("credit_capped");
  });

  it("a reverse-charge invoice's credit note has no VAT and says what the invoice says, with both numbers", async () => {
    const { order, invoice } = await expectParity(no, {
      lines: [{ sku: "RC1", unit: 25000, quantity: 2, rate: 0.19 }],
      shipping: 7500,
      shippingRate: 0.19,
      vatKind: "reverse_charge",
      market: "DE",
      currency: "EUR",
      company: { name: "Muster GmbH", number: "DE-HRB 123", vatNumber: "DE123456789" },
    });
    await refund(db, order.id, 12345);
    const notes = await creditNotesOf(db, order.id);
    await creditParity(order.id, invoice, notes, { refundMinor: 12345, source: "refund" }, 0);
    expect(Number(notes[0].tax_minor)).toBe(0);
    expect(notes[0].snapshot.treatment).toEqual(invoice.snapshot.treatment);
    expect(notes[0].snapshot.buyer.vatNumber).toBe("DE123456789");
  });

  it("an order in euros in a store of kroner: the credit note's VAT in kroner is at the invoice's rate", async () => {
    const { order, invoice } = await expectParity(no, { lines: [{ sku: "EU1", unit: 7777, quantity: 2, rate: 0.24 }], shipping: 595, shippingRate: 0.24, market: "FI", currency: "EUR" });
    await refund(db, order.id, 5000);
    const notes = await creditNotesOf(db, order.id);
    await creditParity(order.id, invoice, notes, { refundMinor: 5000, source: "refund" }, 0);
    expect(notes[0].snapshot.vatHome.fxRate).toBe(invoice.snapshot.vatHome.fxRate);
  });

  it("an order in euros refunded in six parts: every note agrees with the oracle and the VAT in kroner and in the main currency adds up to the invoice's", async () => {
    const { order, invoice } = await expectParity(no, {
      market: "FI",
      currency: "EUR",
      lines: [{ sku: "SP1", unit: 1999, rate: 0.24 }, { sku: "SP2", unit: 1333, rate: 0.14 }, { sku: "SP3", unit: 777, rate: 0.1 }],
      shipping: 599,
      shippingRate: 0.24,
    });
    const parts = [101, 333, 777, 1001, 500];
    for (const a of parts) await refund(db, order.id, a);
    const rest = order.total - parts.reduce((s, a) => s + a, 0);
    await refund(db, order.id, rest);
    const notes = await creditNotesOf(db, order.id);
    expect(notes).toHaveLength(6);
    const amounts = [...parts, rest];
    for (let i = 0; i < notes.length; i += 1) await creditParity(order.id, invoice, notes, { refundMinor: amounts[i], source: "refund" }, i);
    const sum = (pick: (n: DocRow) => number) => notes.reduce((s, n) => s + pick(n), 0);
    expect(sum((n) => Number(n.snapshot.vatHome.vatMinor))).toBe(invoice.snapshot.vatHome.vatMinor);
    expect(sum((n) => Number(n.snapshot.vatMain.vatMinor))).toBe(invoice.snapshot.vatMain.vatMinor);
    expect(sum((n) => Number(n.tax_minor))).toBe(Number(invoice.tax_minor));
    // The columns the reports read are the snapshot's.
    expect(await scalar<string>(db, "select coalesce(sum(c.vat_home_minor), 0)::text from commerce.credit_notes c join commerce.invoices i on i.id = c.invoice_id where i.order_id = $1", [order.id])).toBe(String(invoice.snapshot.vatHome.vatMinor));
  });
});

describe("a return's credit note: SQL and the oracle agree", () => {
  const returnParity = async (storeId: string, spec: OrderSpec, makeWorking: (lineIds: string[]) => ReturnType<typeof workingOf>, mode: "stripe" | "outside" = "stripe", amountOf?: (w: ReturnType<typeof workingOf>) => number) => {
    const { order, invoice } = await expectParity(storeId, spec);
    const ret = await startReturn(db, storeId, order.id);
    const w = makeWorking(order.lineIds);
    const amount = amountOf ? amountOf(w) : w.amountMinor;
    if (mode === "stripe") await refundReturn(db, storeId, order.id, ret.id, w, amount);
    else await refundReturnOutside(db, ret.id, { ...w, outside: true }, amount);
    const notes = await creditNotesOf(db, order.id);
    expect(notes).toHaveLength(1);
    const result = creditNoteSnapshot({
      invoice: { id: invoice.id, snapshot: invoice.snapshot },
      earlier: [],
      source: mode === "stripe" ? "refund" : "return_outside",
      returnNumber: ret.number,
      refundMinor: amount,
      working: parseWorking(mode === "stripe" ? w : { ...w, outside: true }),
      number: notes[0].document_number,
      issuedOn: notes[0].issued_on,
    });
    expect(notes[0].snapshot).toEqual(JSON.parse(JSON.stringify(result.snapshot)));
    expect(Number(notes[0].total_minor)).toBe(result.creditedMinor);
    return { notes, w, ret };
  };

  const twoRates: OrderSpec = { lines: [{ sku: "T1", unit: 10000, quantity: 2, rate: 0.25 }, { sku: "T2", unit: 5000, rate: 0.15, category: "food" }], shipping: 4900, shippingRate: 0.25 };

  it("lines at their own rates, a deduction, the delivery given back and the return shipping", async () => {
    const { notes } = await returnParity(no, twoRates, ([a, b]) => workingOf({ lines: [{ lineId: a, quantity: 1, valueMinor: 10000, deductionMinor: 1000 }, { lineId: b, quantity: 1, valueMinor: 5000, deductionMinor: 0 }], deliveryMinor: 4900, returnShippingMinor: 3900, amountMinor: 15000 }));
    expect(notes[0].snapshot.lines).toHaveLength(5);
  });

  it("a return shipping at a rate with nothing returned is taken off the goods (adjustment rows)", async () => {
    const { notes } = await returnParity(no, twoRates, ([, b]) => workingOf({ lines: [{ lineId: b, quantity: 1, valueMinor: 5000, deductionMinor: 0 }], deliveryMinor: 0, returnShippingMinor: 3900, amountMinor: 1100 }));
    expect(notes[0].snapshot.lines.filter((l: any) => l.kind === "adjustment")).toHaveLength(2);
  });

  it("an amount staff raised, and one lowered", async () => {
    await returnParity(no, twoRates, ([a]) => workingOf({ lines: [{ lineId: a, quantity: 1, valueMinor: 10000, deductionMinor: 0 }], deliveryMinor: 0, returnShippingMinor: 0, amountMinor: 10700 }));
    await returnParity(no, twoRates, ([a, b]) => workingOf({ lines: [{ lineId: a, quantity: 2, valueMinor: 20000, deductionMinor: 0 }, { lineId: b, quantity: 1, valueMinor: 5000, deductionMinor: 0 }], deliveryMinor: 0, returnShippingMinor: 0, amountMinor: 21111 }));
  });

  it("refunded outside Kaizen, in euros in a store of kroner", async () => {
    const { notes } = await returnParity(no, { lines: [{ sku: "OE", unit: 7777, quantity: 2, rate: 0.24 }, { sku: "OF", unit: 1717, rate: 0.14 }], shipping: 595, shippingRate: 0.24, market: "FI", currency: "EUR" }, ([a]) => workingOf({ lines: [{ lineId: a, quantity: 1, valueMinor: 7777, deductionMinor: 200 }], deliveryMinor: 0, returnShippingMinor: 0, amountMinor: 7577 }), "outside");
    expect(notes[0].snapshot.source).toBe("return_outside");
  });
});
