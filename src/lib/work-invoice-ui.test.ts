import { describe, expect, it } from "vitest";

import type { InvoiceEvent, InvoiceLine } from "@/server/work-invoices";

import { computeInvoice } from "./work-calc";
import {
  INVOICE_SHOWS,
  blankRow,
  creditAmounts,
  creditableOf,
  dropRow,
  eventText,
  headerFromInvoice,
  invoiceListFilter,
  invoiceListQuery,
  languageName,
  liveExtra,
  mergeServerRows,
  moveRow,
  parseInvoiceListParams,
  paymentAmountProblem,
  previewRows,
  problemHref,
  quantityField,
  readCreditLines,
  readDraft,
  readFxRate,
  readQuantity,
  readRow,
  refundable,
  rowFromLine,
  sameRows,
  statusView,
  vatGroupLabel,
  type DraftHeaderValues,
  type LineRow,
} from "./work-invoice-ui";
import type { VatContext } from "./work-vat";

const CLIENT = "6f1c0f37-5f39-4d0e-9d55-7f0d0f6a1001";
const ASSIGNMENT = "6f1c0f37-5f39-4d0e-9d55-7f0d0f6a1002";
const LINE_A = "6f1c0f37-5f39-4d0e-9d55-7f0d0f6a2001";
const LINE_B = "6f1c0f37-5f39-4d0e-9d55-7f0d0f6a2002";
const LINE_C = "6f1c0f37-5f39-4d0e-9d55-7f0d0f6a2003";

const line = (over: Partial<InvoiceLine> = {}): InvoiceLine => ({
  id: LINE_A,
  position: 0,
  assignmentId: ASSIGNMENT,
  taskId: null,
  description: "Design workshop",
  unit: "hour",
  quantityHundredths: 175,
  unitPriceMinor: 120_000,
  discountBp: 0,
  vatCategory: "standard",
  vatBp: 2500,
  exclMinor: 210_000,
  vatMinor: 52_500,
  inclMinor: 262_500,
  discountMinor: 0,
  quantityManual: false,
  timeMinutes: 0,
  creditedQuantityHundredths: 0,
  ...over,
});

const row = (over: Partial<LineRow> = {}): LineRow => ({ ...rowFromLine(line(), "NOK"), ...over });

const header = (over: Partial<DraftHeaderValues> = {}): DraftHeaderValues => ({
  currency: "NOK",
  paymentDays: "",
  serviceFrom: "",
  serviceTo: "",
  reference: "",
  notes: "",
  ...over,
});

const domestic: VatContext = {
  sellerVatRegistered: true,
  clientTreatment: "domestic",
  clientBusiness: true,
  standardRateBp: 2500,
};

describe("lines as text", () => {
  it("writes a quantity without trailing zeros", () => {
    expect(quantityField(100)).toBe("1");
    expect(quantityField(150)).toBe("1.5");
    expect(quantityField(33)).toBe("0.33");
    expect(quantityField(5)).toBe("0.05");
    expect(quantityField(0)).toBe("0");
    expect(quantityField(12_345)).toBe("123.45");
  });

  it("turns a saved line into a row and back into what was typed", () => {
    const r = rowFromLine(line({ description: "Line item", discountBp: 1250, unitPriceMinor: 95_050 }), "NOK");
    expect(r).toMatchObject({
      id: LINE_A,
      key: LINE_A,
      description: "",
      quantity: "1.75",
      price: "950.50",
      discount: "12.5",
    });
    expect(readRow(r, "NOK")).toEqual({ ok: true, quantityHundredths: 175, unitPriceMinor: 95_050, discountBp: 1250 });
  });

  it("reads hours as a number or as a time, and units only as a number", () => {
    expect(readQuantity("1,5", "hour")).toBe(150);
    expect(readQuantity("1h30", "hour")).toBe(150);
    expect(readQuantity("90m", "hour")).toBe(150);
    expect(readQuantity("20m", "hour")).toBe(33);
    expect(readQuantity("1h30", "unit")).toBeNull();
    expect(readQuantity("abc", "hour")).toBeNull();
    expect(readQuantity("100 001", "hour")).toBeNull();
  });

  it("says what is wrong in a field, in words", () => {
    const bad = readRow(row({ quantity: "", price: "12x", discount: "101" }), "NOK");
    expect(bad).toEqual({
      ok: false,
      errors: {
        quantity: "Enter the hours, such as 1.5 or 1h30.",
        price: "Enter a price without VAT, such as 950 or 950,50.",
        discount: "A discount is 0 to 100 %.",
      },
    });
    expect(readRow(row({ unit: "unit", quantity: "x" }), "NOK")).toMatchObject({
      errors: { quantity: "Enter a quantity, such as 3 or 1.5." },
    });
    // A new line starts with no price: it is 0 until typed.
    expect(readRow(row({ price: "", discount: "" }), "NOK")).toMatchObject({
      ok: true,
      unitPriceMinor: 0,
      discountBp: 0,
    });
  });

  it("starts a new line at the client's rate, or with no price", () => {
    expect(blankRow("new-1", { rateMinor: 110_000, currency: "SEK", assignmentId: ASSIGNMENT })).toMatchObject({
      id: null,
      quantity: "1",
      price: "1100.00",
      unit: "hour",
      quantityManual: false,
      assignmentId: ASSIGNMENT,
    });
    expect(blankRow("new-2", { rateMinor: null, currency: "SEK", assignmentId: null }).price).toBe("");
  });

  it("moves and drops rows", () => {
    const rows = [row({ key: "a" }), row({ key: "b" }), row({ key: "c" })];
    const keys = (list: readonly LineRow[]) => list.map((r) => r.key);
    expect(keys(moveRow(rows, "b", -1))).toEqual(["b", "a", "c"]);
    expect(keys(moveRow(rows, "b", 1))).toEqual(["a", "c", "b"]);
    expect(keys(moveRow(rows, "a", -1))).toEqual(["a", "b", "c"]);
    expect(keys(moveRow(rows, "x", 1))).toEqual(["a", "b", "c"]);
    expect(keys(dropRow(rows, "a", "c"))).toEqual(["b", "c", "a"]);
    expect(keys(dropRow(rows, "c", "a"))).toEqual(["c", "a", "b"]);
    expect(keys(dropRow(rows, "a", "a"))).toEqual(["a", "b", "c"]);
  });
});

describe("reading a draft", () => {
  const args = (rows: LineRow[], h = header()) => ({ clientId: CLIENT, assignmentId: ASSIGNMENT, header: h, rows });

  it("makes what the save takes: the header and every line in order, with the numbers as integers", () => {
    const rows = [
      row(),
      row({
        id: null,
        key: "new-1",
        description: "Travel",
        quantity: "1",
        price: "250",
        unit: "unit",
        quantityManual: true,
      }),
    ];
    const read = readDraft(
      args(
        rows,
        header({ paymentDays: "30", reference: " PO-7 ", serviceFrom: "2026-09-01", serviceTo: "2026-09-30" }),
      ),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.input).toMatchObject({
      clientId: CLIENT,
      assignmentId: ASSIGNMENT,
      currency: "NOK",
      paymentDays: 30,
      serviceFrom: "2026-09-01",
      serviceTo: "2026-09-30",
      reference: " PO-7 ",
    });
    expect(read.input.lines).toEqual([
      expect.objectContaining({
        id: LINE_A,
        quantityHundredths: 175,
        unitPriceMinor: 120_000,
        discountBp: 0,
        unit: "hour",
        quantityManual: false,
      }),
      expect.objectContaining({
        id: null,
        description: "Travel",
        quantityHundredths: 100,
        unitPriceMinor: 25_000,
        unit: "unit",
        quantityManual: true,
      }),
    ]);
    // No amount or total is ever part of what is sent.
    expect(JSON.stringify(read.input)).not.toMatch(/exclMinor|inclMinor|vatMinor|totalMinor|vatBp/);
  });

  it("keeps the same key when a new line is given its id, so it is not saved twice", () => {
    const fresh = row({ id: null, key: "new-1" });
    const before = readDraft(args([fresh]));
    const after = readDraft(args([{ ...fresh, id: LINE_B }]));
    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) expect(after.key).toBe(before.key);
    const changed = readDraft(args([{ ...fresh, description: "Other" }]));
    if (before.ok && changed.ok) expect(changed.key).not.toBe(before.key);
  });

  it("finds each thing that is wrong, in the header and on the lines, by field", () => {
    const read = readDraft(
      args(
        [row({ key: "k1", quantity: "x" }), row({ key: "k2", price: "y" })],
        header({ paymentDays: "0", serviceFrom: "2026-09-30", serviceTo: "2026-09-01" }),
      ),
    );
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems.header).toEqual({
      paymentDays: "Payment terms are 1 to 90 days.",
      serviceTo: "The period ends before it starts.",
    });
    expect(Object.keys(read.problems.lines)).toEqual(["k1", "k2"]);
    expect(read.problems.lines.k1.quantity).toBeTruthy();
    expect(read.problems.lines.k2.price).toBeTruthy();
    expect(readDraft(args([], header({ serviceFrom: "not a date" }))).ok).toBe(false);
    expect(readDraft(args([], header({ paymentDays: "1.5" }))).ok).toBe(false);
  });

  it("reads an invoice with no lines (it can be saved, and cannot be issued)", () => {
    expect(readDraft(args([])).ok).toBe(true);
  });

  it("puts the header back as text", () => {
    expect(
      headerFromInvoice({
        currency: "SEK",
        paymentDays: 21,
        serviceFrom: "2026-09-01",
        serviceTo: null,
        reference: null,
        notes: "Thanks",
      }),
    ).toEqual({
      currency: "SEK",
      paymentDays: "21",
      serviceFrom: "2026-09-01",
      serviceTo: "",
      reference: "",
      notes: "Thanks",
    });
  });
});

describe("the live totals are the server's preview", () => {
  it("prices a line exactly as the invoice formula says, with the store's VAT", () => {
    const p = previewRows(domestic, "NOK", [row()]);
    expect(p?.totals).toMatchObject({ subtotalMinor: 210_000, vatMinor: 52_500, totalMinor: 262_500 });
    expect(p?.lines[0]).toMatchObject({
      exclMinor: 210_000,
      vatMinor: 52_500,
      inclMinor: 262_500,
      vatBp: 2500,
      readable: true,
    });
  });

  it("gives the same figures as computeInvoice on the resolved lines, with a discount and rounding", () => {
    const rows = [
      row({ key: "1", quantity: "0.33", price: "1 199,99", discount: "12,5" }),
      row({ key: "2", quantity: "3", price: "9.95", unit: "unit", discount: "0" }),
      row({ key: "3", quantity: "1.01", price: "0.99", discount: "33.33", vatCategory: "exempt" }),
    ];
    const p = previewRows(domestic, "NOK", rows)!;
    const expected = computeInvoice([
      { quantityHundredths: 33, unitPriceMinor: 119_999, discountBp: 1250, vatBp: 2500, vatCategory: "standard" },
      { quantityHundredths: 300, unitPriceMinor: 995, discountBp: 0, vatBp: 2500, vatCategory: "standard" },
      { quantityHundredths: 101, unitPriceMinor: 99, discountBp: 3333, vatBp: 0, vatCategory: "exempt" },
    ]);
    expect(p.totals).toEqual(expected.totals);
    expect(p.lines.map((l) => l.inclMinor)).toEqual(expected.lines.map((l) => l.inclMinor));
    expect(p.totals.totalMinor).toBe(p.lines.reduce((sum, l) => sum + l.inclMinor, 0));
  });

  it("follows the client's VAT treatment and the store's registration", () => {
    const reverse = previewRows({ ...domestic, clientTreatment: "reverse_charge" }, "NOK", [row()])!;
    expect(reverse.lines[0]).toMatchObject({ vatBp: 0, vatCategory: "reverse_charge", vatMinor: 0 });
    expect(reverse.totals.totalMinor).toBe(210_000);
    expect(reverse.noteKeys).toEqual(["reverse_charge"]);
    // A private customer is always domestic, whatever the treatment says.
    const consumer = previewRows({ ...domestic, clientBusiness: false, clientTreatment: "reverse_charge" }, "NOK", [
      row(),
    ])!;
    expect(consumer.lines[0].vatBp).toBe(2500);
    const unregistered = previewRows({ ...domestic, sellerVatRegistered: false }, "NOK", [row()])!;
    expect(unregistered.totals).toMatchObject({ vatMinor: 0, totalMinor: 210_000 });
    expect(unregistered.noteKeys).toEqual(["not_registered"]);
    // A line the person set to exempt stays exempt for a domestic client.
    expect(previewRows(domestic, "NOK", [row({ vatCategory: "exempt" })])!.lines[0]).toMatchObject({
      vatBp: 0,
      vatCategory: "exempt",
    });
  });

  it("counts a field that cannot be read as 0 until it is fixed", () => {
    const p = previewRows(domestic, "NOK", [row({ key: "1" }), row({ key: "2", quantity: "x" })])!;
    expect(p.lines[1]).toMatchObject({ readable: false, exclMinor: 0 });
    expect(p.totals.totalMinor).toBe(262_500);
  });

  it("adds a running clock's time to the line it belongs to, and only that", () => {
    const rows = [
      row({ key: "task", taskId: "t1", timeMinutes: 60, quantity: "1" }),
      row({ key: "typed", taskId: "t2", timeMinutes: 60, quantityManual: true }),
      row({ key: "fixed", taskId: "t3", assignmentId: "fixed-1", timeMinutes: 0 }),
      row({ key: "units", taskId: "t4", unit: "unit" }),
      row({ key: "none", taskId: null }),
    ];
    const extra = liveExtra(
      rows,
      (assignmentId, taskId) => (taskId === "t1" || taskId === "t2" || taskId === "t3" || taskId === "t4" ? 20 : 0),
      new Set(["fixed-1"]),
    );
    expect([...extra.entries()]).toEqual([["task", 33]]);
    const live = previewRows(domestic, "NOK", rows.slice(0, 1), extra)!;
    // 1 h 20 min is 1.33 h.
    expect(live.lines[0].exclMinor).toBe(Math.round((133 * 120_000) / 100));
    expect(previewRows(domestic, "NOK", rows.slice(0, 1))!.lines[0].exclMinor).toBe(120_000);
  });

  it("does not fail on sums too large to add up: it says so", () => {
    const big = Array.from({ length: 300 }, (_, i) => row({ key: `k${i}`, quantity: "100000", price: "10000000" }));
    expect(previewRows(domestic, "NOK", big)).toBeNull();
  });
});

describe("merging what the server changed into what is on screen", () => {
  const base = [
    row({ key: LINE_A, id: LINE_A, quantity: "1" }),
    row({ key: LINE_B, id: LINE_B, description: "B", quantity: "2" }),
  ];
  const same = (a: LineRow[], b: LineRow[]) => sameRows(a, b, "NOK");

  it("takes what the server changed in a field nobody touched, keeps what was typed", () => {
    const server = [
      { ...base[0], quantity: "4.5", timeMinutes: 270 },
      { ...base[1], description: "B renamed on the server", quantity: "7" },
    ];
    const local = [base[0], { ...base[1], quantity: "3" }];
    const merged = mergeServerRows(local, base, server, "NOK");
    expect(merged[0]).toMatchObject({ quantity: "4.5", timeMinutes: 270 });
    // The person typed the quantity of B, so it stays theirs; the description they left alone follows the server.
    expect(merged[1]).toMatchObject({ quantity: "3", description: "B renamed on the server" });
  });

  it("keeps how a number was typed when the server has the same number written differently", () => {
    const local = [{ ...base[0], quantity: "1", price: "950" }, base[1]];
    const stored = [{ ...base[0], quantity: "1", price: "950.00" }, base[1]];
    const merged = mergeServerRows(local, base, stored, "NOK");
    expect(merged[0].price).toBe("950");
  });

  it("adds lines the server made, after the ones on screen when the person moved things", () => {
    const made = row({ key: LINE_C, id: LINE_C, description: "From time" });
    const untouched = mergeServerRows(base, base, [...base, made], "NOK");
    expect(untouched.map((r) => r.id)).toEqual([LINE_A, LINE_B, LINE_C]);
    const reordered = mergeServerRows([base[1], base[0]], base, [...base, made], "NOK");
    expect(reordered.map((r) => r.id)).toEqual([LINE_B, LINE_A, LINE_C]);
  });

  it("follows the server's order when nobody reordered, and keeps lines not saved yet at the end", () => {
    const fresh = row({ key: "new-1", id: null, description: "typing…" });
    const merged = mergeServerRows([...base, fresh], base, [base[1], base[0]], "NOK");
    expect(merged.map((r) => r.key)).toEqual([LINE_B, LINE_A, "new-1"]);
  });

  it("drops a line that is gone on the server unless it was being edited, then keeps it as a new line", () => {
    expect(mergeServerRows(base, base, [base[0]], "NOK").map((r) => r.id)).toEqual([LINE_A]);
    const edited = [base[0], { ...base[1], description: "still mine" }];
    const kept = mergeServerRows(edited, base, [base[0]], "NOK");
    expect(kept.map((r) => r.id)).toEqual([LINE_A, null]);
    expect(kept[1].description).toBe("still mine");
  });

  it("does not bring back a line the person removed", () => {
    expect(mergeServerRows([base[0]], base, base, "NOK").map((r) => r.id)).toEqual([LINE_A]);
  });

  it("knows two lists are the same lines", () => {
    expect(same(base, [...base])).toBe(true);
    expect(same(base, [base[0]])).toBe(false);
    expect(same(base, [base[0], { ...base[1], quantity: "2.00" }])).toBe(true);
    expect(same(base, [base[0], { ...base[1], description: "x" }])).toBe(false);
  });
});

describe("credit notes", () => {
  const l = line({
    quantityHundredths: 175,
    unitPriceMinor: 120_000,
    exclMinor: 210_000,
    vatMinor: 52_500,
    inclMinor: 262_500,
  });
  const noteOf = (qty: number, excl: number, vat: number) => ({
    lines: [{ lineId: LINE_A, quantityHundredths: qty, exclMinor: excl, vatMinor: vat, inclMinor: excl + vat }],
  });

  it("says what is left of a line to credit", () => {
    expect(creditableOf(l, [])).toEqual({
      quantityHundredths: 175,
      exclMinor: 210_000,
      vatMinor: 52_500,
      inclMinor: 262_500,
    });
    expect(creditableOf(l, [noteOf(75, 90_000, 22_500)])).toEqual({
      quantityHundredths: 100,
      exclMinor: 120_000,
      vatMinor: 30_000,
      inclMinor: 150_000,
    });
  });

  it("works out a part at the line's own rate and the last part as exactly what is left", () => {
    expect(creditAmounts(l, [], 75)).toEqual({ exclMinor: 90_000, vatMinor: 22_500, inclMinor: 112_500 });
    const first = noteOf(75, 90_000, 22_500);
    // The rest of it is what is left, so the notes add up to the invoice.
    const rest = creditAmounts(l, [first], 100);
    expect(rest.inclMinor + 112_500).toBe(262_500);
    expect(creditAmounts(l, [first], 500)).toEqual(rest);
  });

  it("reads the quantities typed, refusing more than is left and nothing at all", () => {
    const lines = [
      l,
      line({
        id: LINE_B,
        description: "Other",
        unit: "unit",
        quantityHundredths: 200,
        exclMinor: 20_000,
        vatMinor: 5_000,
        inclMinor: 25_000,
        unitPriceMinor: 10_000,
      }),
    ];
    expect(
      readCreditLines(
        lines,
        [],
        [
          { lineId: LINE_A, quantity: "1" },
          { lineId: LINE_B, quantity: "" },
        ],
      ),
    ).toEqual({
      ok: true,
      lines: [{ lineId: LINE_A, quantityHundredths: 100 }],
      inclMinor: creditAmounts(l, [], 100).inclMinor,
    });
    expect(readCreditLines(lines, [], [{ lineId: LINE_A, quantity: "2" }])).toEqual({
      ok: false,
      errors: { [LINE_A]: "At most 1.75 is left to credit." },
      general: null,
    });
    expect(readCreditLines(lines, [], [{ lineId: LINE_B, quantity: "abc" }])).toMatchObject({
      ok: false,
      errors: { [LINE_B]: expect.any(String) },
    });
    expect(readCreditLines(lines, [], [])).toEqual({
      ok: false,
      errors: {},
      general: "Enter a quantity for at least one line.",
    });
  });

  it("says how much can be paid back: what was paid beyond what is still owed", () => {
    const amounts = { totalMinor: 262_500, paidMinor: 262_500, creditedMinor: 0 };
    expect(refundable(amounts, 262_500)).toBe(262_500);
    expect(refundable(amounts, 112_500)).toBe(112_500);
    expect(refundable({ ...amounts, paidMinor: 100_000 }, 112_500)).toBe(0);
    expect(refundable({ ...amounts, paidMinor: 200_000 }, 112_500)).toBe(50_000);
    expect(refundable({ ...amounts, paidMinor: 0 }, 262_500)).toBe(0);
  });
});

describe("payments", () => {
  it("reads the amount received, at most what is outstanding", () => {
    expect(paymentAmountProblem("1 250,50", "NOK", 200_000)).toEqual({ minor: 125_050, message: null });
    expect(paymentAmountProblem("2500", "NOK", 200_000)).toMatchObject({
      minor: null,
      message: "That is more than what is outstanding.",
    });
    expect(paymentAmountProblem("", "NOK", 200_000).message).toMatch(/Enter the amount/);
    expect(paymentAmountProblem("0", "NOK", 200_000).minor).toBeNull();
    expect(paymentAmountProblem("-5", "NOK", 200_000).minor).toBeNull();
  });
});

describe("the list's address", () => {
  it("reads filters from the address and ignores what it cannot read", () => {
    expect(parseInvoiceListParams({})).toEqual({ show: "all", clientId: "", from: "", to: "", q: "", page: 1 });
    expect(
      parseInvoiceListParams({
        show: "overdue",
        client: CLIENT,
        from: "2026-09-01",
        to: "nope",
        q: "  acme ",
        page: "3",
      }),
    ).toEqual({
      show: "overdue",
      clientId: CLIENT,
      from: "2026-09-01",
      to: "",
      q: "acme",
      page: 3,
    });
    expect(parseInvoiceListParams({ show: "bogus", page: "-2" })).toMatchObject({ show: "all", page: 1 });
    expect(parseInvoiceListParams({ show: ["paid", "void"], page: ["2"] })).toMatchObject({ show: "paid", page: 2 });
    expect(INVOICE_SHOWS).toEqual(["all", "drafts", "sent", "overdue", "paid", "void"]);
  });

  it("asks the reader for the right thing for each tab", () => {
    const p = parseInvoiceListParams({});
    expect(invoiceListFilter(p, 25)).toMatchObject({ status: undefined, overdue: undefined, page: 1, pageSize: 25 });
    expect(invoiceListFilter({ ...p, show: "drafts" }, 25).status).toBe("draft");
    expect(invoiceListFilter({ ...p, show: "sent" }, 25).status).toBe("sent");
    expect(invoiceListFilter({ ...p, show: "overdue" }, 25)).toMatchObject({ overdue: true, status: undefined });
    expect(invoiceListFilter({ ...p, show: "void", clientId: CLIENT, from: "2026-09-01", q: "x" }, 10)).toMatchObject({
      status: "void",
      clientId: CLIENT,
      issuedFrom: "2026-09-01",
      search: "x",
      pageSize: 10,
    });
  });

  it("writes the address back, leaving out the defaults and going back to page 1 when a filter changes", () => {
    const p = parseInvoiceListParams({});
    expect(invoiceListQuery(p)).toBe("");
    expect(invoiceListQuery(p, { show: "overdue" })).toBe("?show=overdue");
    const filtered = { ...p, show: "paid" as const, clientId: CLIENT, q: "acme corp", page: 4 };
    expect(invoiceListQuery(filtered)).toBe(`?show=paid&client=${CLIENT}&q=acme+corp`);
    expect(invoiceListQuery(filtered, { page: 5 })).toBe(`?show=paid&client=${CLIENT}&q=acme+corp&page=5`);
    expect(invoiceListQuery(filtered, { clientId: "", q: "", show: "all" })).toBe("");
  });
});

describe("how an invoice reads", () => {
  const today = "2026-09-29";
  it("says draft, issued, due soon, overdue, paid and void, with how late or how soon", () => {
    expect(statusView({ status: "draft", dueOn: null, today })).toMatchObject({ label: "Draft", tone: "neutral" });
    expect(statusView({ status: "sent", dueOn: "2026-10-30", today })).toMatchObject({
      label: "Issued",
      tone: "neutral",
      note: null,
    });
    expect(statusView({ status: "sent", dueOn: "2026-10-03", today })).toEqual({
      label: "Due soon",
      tone: "warn",
      note: "Due in 4 days",
    });
    expect(statusView({ status: "sent", dueOn: "2026-09-29", today })).toEqual({
      label: "Due soon",
      tone: "warn",
      note: "Due today",
    });
    expect(statusView({ status: "sent", dueOn: "2026-09-28", today })).toEqual({
      label: "Overdue",
      tone: "bad",
      note: "1 day late",
    });
    expect(statusView({ status: "sent", dueOn: "2026-09-01", today })).toEqual({
      label: "Overdue",
      tone: "bad",
      note: "28 days late",
    });
    expect(statusView({ status: "paid", dueOn: "2026-09-01", today })).toMatchObject({ label: "Paid", tone: "good" });
    expect(statusView({ status: "void", dueOn: "2026-09-01", today })).toMatchObject({ label: "Void" });
  });

  it("writes the history in words", () => {
    const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toFixed(2)}`;
    const event = (type: string, data: Record<string, unknown> = {}): InvoiceEvent => ({
      id: 1,
      type,
      data,
      at: "2026-09-29T10:00:00.000Z",
      accountName: null,
    });
    expect(eventText(event("invoice.created"), money)).toBe("Draft created");
    expect(eventText(event("invoice.issued", { document_number: "W-12" }), money)).toBe("Issued as W-12");
    expect(
      eventText(event("payment.recorded", { amount_minor: 125_000, currency: "NOK", method: "bank" }), money),
    ).toBe("Payment of NOK 1250.00 received by bank transfer");
    expect(eventText(event("payment.reversed", { amount_minor: -125_000, currency: "NOK" }), money)).toBe(
      "Payment of NOK 1250.00 reversed",
    );
    expect(eventText(event("payment.refunded", { amount_minor: -5_000, currency: "NOK" }), money)).toBe(
      "NOK 50.00 paid back",
    );
    expect(
      eventText(event("invoice.credited", { document_number: "WCN-1", total_minor: 262_500, currency: "NOK" }), money),
    ).toBe("Credit note WCN-1 issued for NOK 2625.00");
    expect(eventText(event("invoice.paid"), money)).toBe("Paid in full");
    expect(eventText(event("invoice.reopened"), money)).toMatch(/Reopened/);
    expect(eventText(event("something.new"), money)).toBe("something.new");
  });

  it("names VAT groups, languages, exchange rates and where problems are fixed", () => {
    expect(vatGroupLabel({ category: "standard", vatBp: 2500 })).toBe("VAT 25 %");
    expect(vatGroupLabel({ category: "standard", vatBp: 1250 })).toBe("VAT 12.5 %");
    expect(vatGroupLabel({ category: "standard", vatBp: 0 })).toBe("No VAT");
    expect(vatGroupLabel({ category: "reverse_charge", vatBp: 0 })).toBe("Reverse charge (0 %)");
    expect(languageName("nb-NO")).toBe("Norwegian");
    expect(languageName("de")).toBe("English");
    expect(readFxRate("11,5")).toBe("11.5");
    expect(readFxRate("0")).toBeNull();
    expect(readFxRate("abc")).toBeNull();
    expect(readFxRate("1.123456789")).toBeNull();
    expect(problemHref("company", { storeSlug: "kaffe", clientId: "c1" }).href).toBe("/admin/kaffe/settings/company");
    expect(problemHref("settings", { storeSlug: "kaffe", clientId: "c1" }).href).toBe("/admin/kaffe/settings/work");
    expect(problemHref("client", { storeSlug: "kaffe", clientId: "c1" }).href).toBe("/admin/kaffe/work/clients/c1");
    expect(problemHref("invoice", { storeSlug: "kaffe", clientId: "c1" }).href).toBe("#invoice-lines");
  });
});
