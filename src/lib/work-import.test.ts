import { describe, expect, it } from "vitest";

import { computeLine, splitInclAmount } from "./work-calc";
import {
  bpToRate,
  DEFAULT_OPTIONS,
  hoursToHundredths,
  hoursToMinutes,
  importId,
  type ImportOptions,
  IMPORTED_LABEL,
  lineAmounts,
  majorToMinor,
  minutesToHundredths,
  netOfGross,
  percentToBp,
  planImport,
  renderReport,
  renderSql,
  scaleDecimal,
  uuidV5,
} from "./work-import";
import { LIFE, sampleLifeExport } from "./work-import-fixture";

const STORE = "fad2dec2-aaa4-48a4-9f86-62f9c0645c08";
const options: ImportOptions = {
  ...DEFAULT_OPTIONS,
  storeId: STORE,
  storeSlug: "human-web",
  accountEmail: "andre@humanweb.no",
};
const plan = () => planImport(sampleLifeExport(), options);

describe("converting Life's numbers", () => {
  it("turns major units into minor units exactly, half up, with no floats", () => {
    expect(majorToMinor(4693.51)).toBe(469351);
    expect(majorToMinor("18774.00")).toBe(1877400);
    expect(majorToMinor(2011.5)).toBe(201150);
    expect(majorToMinor(0)).toBe(0);
    // 1.005 * 100 is 100.49999999999999 as a float; as a decimal it is 100.5, which rounds up.
    expect(majorToMinor(1.005)).toBe(101);
    expect(majorToMinor("0.004")).toBe(0);
    expect(majorToMinor("0.005")).toBe(1);
    expect(majorToMinor(1e-7)).toBe(0);
    expect(majorToMinor(-2.345)).toBe(-235);
    expect(() => majorToMinor(null)).toThrow(/missing/);
    expect(() => majorToMinor("12,5")).toThrow(/decimal/);
    expect(() => majorToMinor(Number.NaN)).toThrow(/Not a number/);
    expect(() => majorToMinor(1e17)).toThrow(/too large/);
  });

  it("scales any decimal", () => {
    expect(scaleDecimal("12.3456", 2)).toBe(BigInt(1235));
    expect(scaleDecimal(".5", 2)).toBe(BigInt(50));
    expect(scaleDecimal("7", 4)).toBe(BigInt(70000));
  });

  it("turns hours into hundredths and minutes, percentages into basis points", () => {
    expect(hoursToHundredths(1.5)).toBe(150);
    expect(hoursToHundredths("0.75")).toBe(75);
    expect(hoursToMinutes(1.5)).toBe(90);
    expect(hoursToMinutes(0.33)).toBe(20); // 19.8 minutes
    expect(hoursToMinutes(8.25)).toBe(495);
    expect(hoursToMinutes(0)).toBe(0);
    expect(percentToBp(25)).toBe(2500);
    expect(percentToBp("12.5")).toBe(1250);
    expect(percentToBp(0.01)).toBe(1);
    expect(bpToRate(2500)).toBe("0.2500");
    expect(bpToRate(150)).toBe("0.0150");
    expect(bpToRate(0)).toBe("0.0000");
    // Life's minutesToHours: 20 minutes are 0.33 h.
    expect(minutesToHundredths(20)).toBe(33);
    expect(minutesToHundredths(90)).toBe(150);
    expect(minutesToHundredths(1)).toBe(2);
  });

  it("works a recurring template's net price out of Life's VAT-inclusive amount", () => {
    expect(netOfGross(373875, 2500)).toBe(299100);
    expect(netOfGross(123750, 2500)).toBe(99000);
    expect(netOfGross(100, 2500)).toBe(80);
    expect(netOfGross(1237, 0)).toBe(1237);
    expect(netOfGross(125, 2500)).toBe(100);
    // The same rule as Store's own split (work-calc.ts), on many amounts.
    for (const incl of [1, 99, 100, 101, 12345, 123456, 999999, 373875]) {
      for (const bp of [0, 1200, 2500]) {
        expect(netOfGross(incl, bp)).toBe(splitInclAmount(incl, bp).exclMinor);
      }
    }
  });

  it("prices a line exactly as work-calc does (4.3)", () => {
    const quantities = [0, 1, 33, 50, 75, 100, 150, 175, 333, 1000, 12345];
    const prices = [0, 1, 99, 1490 * 100, 99050, 333_33, 1_000_000_000];
    const discounts = [0, 1, 1000, 3333, 10_000];
    for (const q of quantities) {
      for (const p of prices) {
        for (const d of discounts) {
          for (const v of [0, 1200, 2500]) {
            const mine = lineAmounts(q, p, d, v);
            const theirs = computeLine({ quantityHundredths: q, unitPriceMinor: p, discountBp: d, vatBp: v, vatCategory: "standard" });
            expect(mine).toEqual({ exclMinor: theirs.exclMinor, vatMinor: theirs.vatMinor, inclMinor: theirs.inclMinor });
          }
        }
      }
    }
  });
});

describe("ids", () => {
  it("is a real version 5 uuid", () => {
    // RFC 4122's example: the DNS namespace and "python.org".
    expect(uuidV5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
  });

  it("is the same for the same Life row and store, and different for anything else", () => {
    const a = importId(STORE, "invoice", LIFE.paidNumbered);
    expect(a).toBe(importId(STORE, "invoice", LIFE.paidNumbered));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(importId(STORE, "line", LIFE.paidNumbered)).not.toBe(a);
    expect(importId(STORE, "invoice", LIFE.paidUnnumbered)).not.toBe(a);
    expect(importId("00000000-0000-4000-8000-000000000001", "invoice", LIFE.paidNumbered)).not.toBe(a);
  });

  it("gives every planned row its own id, the same on every run", () => {
    const first = plan();
    const ids = [
      ...first.clients.map((c) => c.id),
      ...first.assignments.map((a) => a.id),
      ...first.tasks.map((t) => t.id),
      ...first.entries.map((e) => e.id),
      ...first.recurring.map((r) => r.id),
      ...first.invoices.map((i) => i.id),
      ...first.invoices.flatMap((i) => i.lines.map((l) => l.id)),
      ...first.invoices.flatMap((i) => (i.payment ? [i.payment.id] : [])),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan()).toEqual(first);
    expect(renderSql(plan())).toBe(renderSql(first));
  });
});

describe("the plan", () => {
  const byLife = (id: string) => {
    const found = plan().invoices.find((i) => i.lifeId === id);
    if (!found) throw new Error(`no invoice ${id}`);
    return found;
  };

  it("maps clients without inventing more than the defaults it reports", () => {
    const { clients, notes } = plan();
    expect(clients.map((c) => c.name)).toEqual(["Alfa AS", "Beta & Sønn", "Gamma O'Neil"]);
    expect(clients[0]).toMatchObject({ billingEmail: "regnskap@alfa.example", paymentDays: 21, defaultHourlyRateMinor: 149000, country: "NO", locale: "nb-NO", notes: "Betaler sent" });
    expect(clients[1].billingEmail).toBeNull();
    expect(clients[2].defaultHourlyRateMinor).toBe(99050);
    expect(notes.some((n) => n.scope === "client Beta & Sønn" && /not an address/.test(n.message))).toBe(true);
    expect(notes.some((n) => n.scope === "clients" && /Norwegian business/.test(n.message))).toBe(true);
  });

  it("maps assignments: invoiced becomes done, the estimate becomes minutes, warnings follow the invoice", () => {
    const { assignments } = plan();
    expect(assignments.map((a) => a.status)).toEqual(["done", "active", "paused"]);
    expect(assignments[0]).toMatchObject({ hourlyRateMinor: 149000, estimatedMinutes: 600, startDate: "2026-05-01", endDate: "2026-05-31" });
    expect(assignments[1]).toMatchObject({ alertMinutes: 10, alertPopup: true, alertSound: true });
    expect(assignments[2]).toMatchObject({ billingType: "fixed_fee", fixedAmountMinor: 1250000, estimatedMinutes: 495 });
  });

  it("maps a recurring template to its net price and keeps the schedule", () => {
    const [r] = plan().recurring;
    expect(r).toMatchObject({ unitPriceMinor: 99000, lifeAmountMinor: 123750, interval: 1, period: "month", startDate: "2026-04-02", isActive: true });
  });

  it("imports sent and paid invoices as issued ones with Life's own number, dates and amounts", () => {
    const numbered = byLife(LIFE.paidNumbered);
    expect(numbered).toMatchObject({
      status: "paid", imported: true, legacyNumber: "2154", label: "2154", issuedOn: "2026-06-08", dueOn: "2026-06-20", paymentDays: 12,
      subtotalMinor: 402300, vatMinor: 100575, totalMinor: 502875,
    });
    const unnumbered = byLife(LIFE.sentUnnumbered);
    expect(unnumbered).toMatchObject({ status: "sent", imported: true, legacyNumber: null, label: IMPORTED_LABEL, sentAt: null, paymentDays: 14, payment: null });
    const sent = byLife(LIFE.sentNumbered);
    expect(sent).toMatchObject({ legacyNumber: "2026-041", label: "2026-041", sentAt: "2026-05-02T06:00:55.412+00:00", recurringPeriod: "2026-05-02" });
    expect(sent.recurringId).toBe(importId(STORE, "recurring", LIFE.recurring));
  });

  it("keeps a repeating invoice's fee as one unit, not one hour", () => {
    expect(byLife(LIFE.paidUnnumbered).lines[0]).toMatchObject({ unit: "unit", quantityHundredths: 100 });
    expect(byLife(LIFE.sentNumbered).lines[0].unit).toBe("unit");
    expect(byLife(LIFE.paidNumbered).lines[0].unit).toBe("hour");
    expect(plan().notes.some((n) => /repeating-invoice instances are kept as one unit/.test(n.message))).toBe(true);
  });

  it("keeps Life's own line amounts on an issued invoice, and reports where Store's formula differs", () => {
    const sent = byLife(LIFE.sentUnnumbered);
    expect(sent.lines[0]).toMatchObject({ exclMinor: 134133, vatMinor: 33533, inclMinor: 167666, quantityHundredths: 100, unitPriceMinor: 149000, discountBp: 1000 });
    expect(sent.totalMinor).toBe(167666);
    const rec = plan().reconciliation.find((r) => r.lifeId === LIFE.sentUnnumbered);
    expect(rec?.lines[0]).toMatchObject({ differs: false, formulaDiffers: true, life: { inclMinor: 167666 }, recomputed: { exclMinor: 134100, vatMinor: 33525, inclMinor: 167625 } });
    expect(rec?.recomputed.inclMinor).toBe(167625);
    expect(rec?.headerMatchesLines).toBe(true);
    expect(rec?.totalDifferenceMinor).toBe(0);
  });

  it("makes a 0 % line exempt and lists the statutory note", () => {
    const sent = byLife(LIFE.sentUnnumbered);
    expect(sent.lines[1]).toMatchObject({ vatCategory: "exempt", vatBp: 0 });
    expect(sent.vatNotes).toEqual(["exempt"]);
    expect(byLife(LIFE.paidNumbered).vatNotes).toEqual([]);
  });

  it("gives a paid invoice one payment dated by paid date, else the linked transaction, else the due date", () => {
    expect(byLife(LIFE.paidNumbered).payment).toMatchObject({ amountMinor: 502875, receivedOn: "2026-06-25", dateSource: "paid_at", method: "other", reference: "imported", currency: "NOK" });
    expect(byLife(LIFE.paidUnnumbered).payment).toMatchObject({ receivedOn: "2026-04-17", dateSource: "finance_transaction", amountMinor: 123750 });
    expect(byLife(LIFE.paidBare).payment).toMatchObject({ receivedOn: "2026-07-15", dateSource: "due_on" });
    expect(byLife(LIFE.sentNumbered).payment).toBeNull();
  });

  it("leaves a draft an ordinary draft, priced by Store's formula, with no number or dates", () => {
    const draft = byLife(LIFE.draft);
    expect(draft).toMatchObject({ status: "draft", imported: false, legacyNumber: null, label: null, issuedOn: null, dueOn: null, payment: null });
    expect(draft.lines.map((l) => [l.description, l.quantityHundredths, l.exclMinor, l.vatMinor, l.inclMinor])).toEqual([
      ["Design av forside", 150, 201150, 50288, 251438],
      ["Line item", 0, 0, 0, 0],
    ]);
    expect(draft.totalMinor).toBe(251438);
    expect(draft.assignmentId).toBe(importId(STORE, "assignment", LIFE.asgActive));
  });

  it("attaches a task's billable time to that task's line, and leaves the rest unbilled", () => {
    const { entries, invoices } = plan();
    const line = invoices.find((i) => i.lifeId === LIFE.draft)?.lines[0];
    expect(entries.map((e) => [e.minutes, e.invoiceLineId === line?.id ? "on the line" : e.invoiceLineId === null ? "unbilled" : "?"])).toEqual([
      [45, "unbilled"],
      [90, "on the line"],
      [30, "unbilled"], // not billable
    ]);
    expect(line?.quantityManual).toBe(false);
    // A line whose hours differ from its time is kept as typed.
    const life = sampleLifeExport();
    life.invoice_lines.find((l) => l.description === "Design av forside")!.quantity_hours = 2;
    const changed = planImport(life, options);
    expect(changed.invoices.find((i) => i.lifeId === LIFE.draft)?.lines[0].quantityManual).toBe(true);
    expect(changed.notes.some((n) => /marked as typed by hand/.test(n.message))).toBe(true);
  });

  it("leaves out what cannot be imported faithfully, with the reason", () => {
    const { skipped, invoices, reconciliation } = plan();
    expect(invoices.some((i) => i.lifeId === LIFE.voided)).toBe(false);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].message).toMatch(/void/);
    expect(reconciliation.find((r) => r.lifeId === LIFE.voided)?.skipped).toMatch(/credit note/);

    const broken = sampleLifeExport();
    broken.invoices.find((i) => i.id === LIFE.paidBare)!.total_incl_vat = 1500;
    const again = planImport(broken, options);
    expect(again.skipped.map((n) => n.message).some((m) => /not its subtotal plus VAT/.test(m))).toBe(true);
    expect(again.invoices.some((i) => i.lifeId === LIFE.paidBare)).toBe(false);
    // Its payment goes with it.
    expect(again.counts.payments.imported).toBe(2);
  });

  it("keeps a frozen total that is not the sum of its lines, and says so", () => {
    const life = sampleLifeExport();
    const target = life.invoices.find((i) => i.id === LIFE.sentNumbered)!;
    target.subtotal_excl_vat = 1000;
    target.total_vat = 250;
    target.total_incl_vat = 1250;
    const result = planImport(life, options);
    const imported = result.invoices.find((i) => i.lifeId === LIFE.sentNumbered)!;
    expect(imported.totalMinor).toBe(125000);
    const rec = result.reconciliation.find((r) => r.lifeId === LIFE.sentNumbered)!;
    expect(rec.headerMatchesLines).toBe(false);
    expect(result.notes.some((n) => /is not the sum of its lines/.test(n.message))).toBe(true);
  });

  it("skips rows whose parents were left out", () => {
    const life = sampleLifeExport();
    life.clients = life.clients.filter((c) => c.id !== LIFE.gamma);
    const result = planImport(life, options);
    expect(result.assignments.map((a) => a.lifeId)).not.toContain(LIFE.asgFixed);
    expect(result.invoices.some((i) => i.lifeId === LIFE.paidBare)).toBe(false);
    expect(result.skipped.length).toBeGreaterThanOrEqual(2);
  });

  it("counts what it read and what it kept", () => {
    const { counts } = plan();
    expect(counts.clients).toEqual({ life: 3, imported: 3 });
    expect(counts.invoices).toEqual({ life: 7, imported: 6 });
    expect(counts["invoice lines"]).toEqual({ life: 9, imported: 8 });
    expect(counts.payments).toEqual({ life: 3, imported: 3 });
  });
});

describe("the SQL", () => {
  const sql = renderSql(plan());

  it("is one transaction that says it is importing, checks the store and checks itself", () => {
    expect(sql).toMatch(/^begin;$/m);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).toContain("select set_config('commerce.work_importing', 'on', true);");
    expect(sql).toContain(`s.id = '${STORE}'::uuid and s.slug = 'human-web'`);
    expect(sql).toContain("work_import.store_not_empty");
    expect(sql).toContain("work_import.check");
    expect(sql.match(/\bbegin;/g)).toHaveLength(1);
  });

  it("is idempotent: every insert does nothing on a second run", () => {
    const inserts = sql.match(/^insert into commerce\.\w+/gm) ?? [];
    expect(inserts.length).toBeGreaterThan(10);
    const conflicts = sql.match(/^on conflict do nothing;$/gm) ?? [];
    // Every insert but the history's, which guards itself with `where not exists`.
    expect(conflicts.length).toBe(inserts.length - 1);
    expect(sql).toContain("where not exists (select 1 from commerce.work_events");
  });

  it("takes no number from the series, sends nothing and writes nothing to Life", () => {
    expect(sql).not.toMatch(/next_document_number|issue_work_invoice|work_set_series|sendEmail|email_messages/);
    expect(sql).not.toMatch(/update\s+commerce\.document_series/i);
    expect(sql).toContain("the work_invoice series moved");
    expect(sql).toContain("an integration event was queued");
    // Imported invoices are inserted with no number, as `sent`, and imported.
    expect(sql).toMatch(/'sent', 'work_invoice',\n  null, '2154', true, '2154'/);
    expect(sql).toMatch(/null, 'Imported', true, null/);
  });

  it("quotes text safely", () => {
    expect(sql).toContain("'Gamma O''Neil'");
    expect(sql).toContain("'Beta & Sønn'");
  });

  it("writes the amounts it planned", () => {
    expect(sql).toContain("402300, 100575, 502875");
    expect(sql).toContain("(select ds.next_number from commerce.document_series");
    // The paid invoice's payment, with method other.
    expect(sql).toContain("502875::bigint, 'NOK'::char(3), '2026-06-25'::date, 'other', 'imported'");
  });

  it("cannot be tricked by a hostile text", () => {
    const life = sampleLifeExport();
    life.clients[0].name = "x'); drop table commerce.work_clients; --";
    const hostile = renderSql(planImport(life, options));
    expect(hostile).toContain("'x''); drop table commerce.work_clients; --'");
    expect(hostile).not.toMatch(/^drop table/m);
  });
});

describe("the report", () => {
  it("lists every invoice with Life's total against the store's, and everything altered or left out", () => {
    const text = renderReport(plan());
    expect(text).toContain("INVOICES");
    expect(text).toMatch(/2154 .*paid .*Alfa AS .*5028\.75 .*5028\.75 .*5028\.75 .*5028\.75 .*0\.00 .*total equal/);
    expect(text).toMatch(/SKIPPED: Life status void/);
    expect(text).toContain("LINE ROUNDING");
    expect(text).toMatch(/line 1 "Oppsett": Life 1341\.33 \+ 335\.33 = 1676\.66; store 1341\.33 \+ 335\.33 = 1676\.66; formula 1341\.00 \+ 335\.25 = 1676\.25/);
    expect(text).toContain("LEFT OUT");
    expect(text).toContain("ASSUMPTIONS");
    expect(text).toContain("Total, issued");
  });
});
