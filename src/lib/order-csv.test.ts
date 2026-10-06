import { describe, expect, it } from "vitest";

import { parseCsv, writeCsv } from "./csv";
import { toRates } from "./currency";
import {
  ALL_ORDER_COLUMNS,
  PERSONAL_ORDER_COLUMNS,
  REMOVED,
  mainRateText,
  orderColumns,
  orderFileRows,
  orderRowCount,
  orderRows,
  orderTotalsProblems,
  parseOrderNumbers,
  ratePercentText,
  shippingVatOf,
  type ExportOrder,
} from "./order-csv";

const rates = toRates([{ currency: "NOK", rate: 11.5, roundTo: 1 }, { currency: "SEK", rate: 11.0, roundTo: 1 }]);
const main = { currency: "NOK", rates };

const address = { name: "Kari Nordmann", line1: "Storgata 1", line2: "2. etasje", postalCode: "0150", city: "Oslo", country: "NO", phone: "+4790000000" };

function order(over: Partial<ExportOrder> = {}): ExportOrder {
  return {
    number: "1001",
    placedAt: "2026-10-01T21:30:15.123Z",
    placedOn: "2026-10-01",
    status: "paid",
    paymentStatus: "captured",
    paidAt: "2026-10-01T21:31:00.000Z",
    market: "NO",
    currency: "NOK",
    locale: "nb-NO",
    copied: false,
    hostOrder: false,
    testPayment: false,
    invoiceNumber: "INV-1",
    customerType: "private",
    companyName: null,
    buyerVatNumber: null,
    erased: false,
    email: "kari@example.com",
    billing: address,
    shipping: address,
    discountCode: "WELCOME10",
    subtotalMinor: 300_000,
    shippingMinor: 9_900,
    discountMinor: 30_000,
    memberDiscountMinor: 5_000,
    campaignDiscountMinor: 10_000,
    creditMinor: 0,
    referralDiscountMinor: 0,
    vatReliefMinor: 0,
    vatKind: "standard",
    taxMinor: 55_980,
    totalMinor: 279_900,
    refundedMinor: 10_000,
    refundCount: 1,
    lastRefundAt: "2026-10-03T08:00:00Z",
    balanceMinor: 0,
    commissionMinor: 0,
    deliveryService: "Pakke til hentested",
    paymentReference: "pi_123",
    lines: [
      { lineNumber: 1, sku: "A-1", title: "Boot", quantity: 2, unitPriceMinor: 100_000, discountMinor: 15_000, totalMinor: 185_000, taxMinor: 37_000, taxRate: 0.25, unitCostMinor: 60_000, gift: false, delivery: "physical" },
      { lineNumber: 2, sku: "B-1", title: "Sock", quantity: 1, unitPriceMinor: 100_000, discountMinor: 15_000, totalMinor: 85_000, taxMinor: 17_000, taxRate: 0.25, unitCostMinor: null, gift: false, delivery: "physical" },
    ],
    ...over,
  };
}

const cell = (cols: string[], row: unknown[], name: string) => row[cols.indexOf(name)];
const OPTS = { layout: "lines", profile: "accounting", main } as const;

describe("the columns", () => {
  it("are fixed, English snake_case, and have no duplicate", () => {
    for (const layout of ["lines", "orders"] as const) {
      for (const profile of ["accounting", "full"] as const) {
        const cols = orderColumns(layout, profile);
        expect(new Set(cols).size).toBe(cols.length);
        for (const c of cols) expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it("start with the identity, then the buyer, then the amounts, then the line (lines layout), and end with the payment reference", () => {
    const cols = orderColumns("lines", "accounting");
    expect(cols.slice(0, 13)).toEqual(["order_number", "placed_at", "placed_on", "status", "payment_status", "paid_at", "market", "currency", "locale", "copied", "host_order", "test_payment", "invoice_number"]);
    expect(cols.slice(13, 18)).toEqual(["customer_type", "company_name", "buyer_vat_number", "billing_country", "shipping_country"]);
    expect(cols).toContain("subtotal_main");
    expect(cols.slice(-14)).toEqual(["line_number", "sku", "title", "quantity", "unit_price", "line_discount", "line_total", "line_tax_rate", "line_net", "line_tax", "unit_cost_main", "gift", "line_delivery", "payment_reference"]);
    expect(orderColumns("orders", "accounting")).toContain("line_count");
    expect(orderColumns("orders", "accounting")).not.toContain("sku");
    expect(orderColumns("orders", "accounting")).not.toContain("payment_reference");
  });

  it("add the contact details only in the Full profile", () => {
    const accounting = orderColumns("lines", "accounting");
    const full = orderColumns("lines", "full");
    for (const c of ["email", "billing_name", "billing_line1", "billing_postal_code", "shipping_phone", "shipping_city"]) {
      expect(accounting).not.toContain(c);
      expect(full).toContain(c);
    }
    expect(full.length).toBeGreaterThan(accounting.length);
  });

  it("never name a secret, a token, a key or card data", () => {
    for (const c of ALL_ORDER_COLUMNS) expect([c, /secret|token|password|hash|session|card|key|cookie|auth/i.test(c)]).toEqual([c, false]);
  });
});

describe("a row per line", () => {
  const cols = orderColumns("lines", "accounting");
  const rows = orderRows([order()], OPTS);

  it("has a row per line, the order's amounts on the first line only so a column sums correctly", () => {
    expect(rows).toHaveLength(2);
    expect(cell(cols, rows[0], "total")).toEqual({ num: "2799.00" });
    expect(cell(cols, rows[1], "total")).toBeNull();
    expect(cell(cols, rows[1], "subtotal")).toBeNull();
    expect(cell(cols, rows[1], "order_number")).toBe("1001");
    expect(cell(cols, rows[1], "currency")).toBe("NOK");
    expect(cell(cols, rows[0], "line_number")).toBe(1);
    expect(cell(cols, rows[1], "line_number")).toBe(2);
  });

  it("writes every amount as a decimal of the order's own currency, and dates as ISO in UTC and the store's day", () => {
    expect(cell(cols, rows[0], "subtotal")).toEqual({ num: "3000.00" });
    expect(cell(cols, rows[0], "shipping")).toEqual({ num: "99.00" });
    expect(cell(cols, rows[0], "discount_total")).toEqual({ num: "300.00" });
    expect(cell(cols, rows[0], "member_discount")).toEqual({ num: "50.00" });
    expect(cell(cols, rows[0], "campaign_discount")).toEqual({ num: "100.00" });
    expect(cell(cols, rows[0], "credit_used")).toEqual({ num: "0.00" });
    expect(cell(cols, rows[0], "refunded")).toEqual({ num: "100.00" });
    expect(cell(cols, rows[0], "refund_count")).toBe(1);
    expect(cell(cols, rows[0], "placed_at")).toBe("2026-10-01T21:30:15Z");
    expect(cell(cols, rows[0], "placed_on")).toBe("2026-10-01");
    expect(cell(cols, rows[0], "paid_at")).toBe("2026-10-01T21:31:00Z");
    expect(cell(cols, rows[0], "last_refund_at")).toBe("2026-10-03T08:00:00Z");
  });

  it("splits the VAT out: each line's rate, net and VAT as stored, and the shipping VAT as the order's less the lines'", () => {
    expect(cell(cols, rows[0], "line_tax_rate")).toEqual({ num: "25" });
    expect(cell(cols, rows[0], "line_total")).toEqual({ num: "1850.00" });
    expect(cell(cols, rows[0], "line_tax")).toEqual({ num: "370.00" });
    expect(cell(cols, rows[0], "line_net")).toEqual({ num: "1480.00" });
    expect(cell(cols, rows[1], "line_net")).toEqual({ num: "680.00" });
    expect(cell(cols, rows[0], "unit_price")).toEqual({ num: "1000.00" });
    expect(cell(cols, rows[0], "line_discount")).toEqual({ num: "150.00" });
    expect(cell(cols, rows[0], "tax_total")).toEqual({ num: "559.80" });
    expect(cell(cols, rows[0], "shipping_vat")).toEqual({ num: "19.80" });
    expect(shippingVatOf(order())).toBe(1_980);
    // The sum of the lines' VAT plus the shipping VAT is the order's VAT, for every row set.
    const lineTax = [rows[0], rows[1]].map((r) => Number((cell(cols, r, "line_tax") as { num: string }).num.replace(".", ""))).reduce((a, b) => a + b, 0);
    expect(lineTax + 1_980).toBe(55_980);
  });

  it("says the main currency: rate, converted, and the order's figures in it (and the unit cost, which is already in it)", () => {
    const usd = order({ currency: "SEK", subtotalMinor: 100_000, taxMinor: 20_000, totalMinor: 99_000, shippingMinor: 0, discountMinor: 1_000, refundedMinor: 5_000, lines: [order().lines[0]] });
    const r = orderRows([usd], OPTS)[0];
    expect(cell(cols, r, "currency")).toBe("SEK");
    expect(cell(cols, r, "main_currency")).toBe("NOK");
    // 11.5 NOK per EUR and 11.0 SEK per EUR: 1 SEK = 1.045455 NOK.
    expect(cell(cols, r, "main_rate")).toEqual({ num: "1.045455" });
    expect(cell(cols, r, "main_converted")).toBe("true");
    expect(cell(cols, r, "subtotal_main")).toEqual({ num: "1045.45" });
    expect(cell(cols, r, "total_main")).toEqual({ num: "1035.00" });
    expect(cell(cols, r, "refunded_main")).toEqual({ num: "52.27" });
    expect(cell(cols, r, "unit_cost_main")).toEqual({ num: "600.00" });
    expect(cell(cols, r, "total")).toEqual({ num: "990.00" });
  });

  it("is blank with no_rate for a currency the store has no rate for, and never guesses one", () => {
    const eur = order({ currency: "DKK" });
    const r = orderRows([eur], OPTS)[0];
    expect(cell(cols, r, "main_converted")).toBe("no_rate");
    expect(cell(cols, r, "main_rate")).toBeNull();
    expect(cell(cols, r, "total_main")).toBeNull();
    expect(cell(cols, r, "subtotal_main")).toBeNull();
    expect(cell(cols, r, "total")).toEqual({ num: "2799.00" });
  });

  it("is the order's own figures, rate 1, in the main currency (the euro scenario's other half)", () => {
    const r = orderRows([order()], OPTS)[0];
    expect(cell(cols, r, "main_rate")).toEqual({ num: "1" });
    expect(cell(cols, r, "main_converted")).toBe("true");
    expect(cell(cols, r, "total_main")).toEqual({ num: "2799.00" });
  });

  it("converts a euro order of a store whose main currency is not euro at the store's rate", () => {
    const e = order({ currency: "EUR", totalMinor: 10_000, subtotalMinor: 10_000, discountMinor: 0, shippingMinor: 0, taxMinor: 2_000, refundedMinor: 0, lines: [] });
    const r = orderRows([e], OPTS)[0];
    expect(cell(cols, r, "main_rate")).toEqual({ num: "11.5" });
    expect(cell(cols, r, "total_main")).toEqual({ num: "1150.00" });
    expect(cell(cols, r, "tax_total_main")).toEqual({ num: "230.00" });
  });

  it("marks an order paid in Stripe's test mode and no other", () => {
    expect(cell(cols, orderRows([order({ testPayment: true })], OPTS)[0], "test_payment")).toBe("true");
    expect(cell(cols, orderRows([order()], OPTS)[0], "test_payment")).toBe("false");
  });

  it("marks copied history and a host's order with its commission", () => {
    const copied = orderRows([order({ number: "C-1001", copied: true })], OPTS)[0];
    expect(cell(cols, copied, "copied")).toBe("true");
    expect(cell(cols, copied, "order_number")).toBe("C-1001");
    const host = orderRows([order({ hostOrder: true, commissionMinor: 12_000 })], OPTS)[0];
    expect(cell(cols, host, "host_order")).toBe("true");
    expect(cell(cols, host, "commission")).toEqual({ num: "120.00" });
    expect(cell(cols, orderRows([order()], OPTS)[0], "commission")).toBeNull();
  });

  it("shows a reverse-charge order's kind and the VAT not charged", () => {
    const rc = order({ vatKind: "reverse_charge", vatReliefMinor: 50_000, taxMinor: 0, customerType: "business", buyerVatNumber: "SE556677889901", lines: order().lines.map((l) => ({ ...l, taxMinor: 0 })) });
    const r = orderRows([rc], OPTS)[0];
    expect(cell(cols, r, "vat_kind")).toBe("reverse_charge");
    expect(cell(cols, r, "vat_relief")).toEqual({ num: "500.00" });
    expect(cell(cols, r, "tax_total")).toEqual({ num: "0.00" });
    expect(cell(cols, r, "buyer_vat_number")).toBe("SE556677889901");
    expect(cell(cols, r, "customer_type")).toBe("business");
  });

  it("writes a zero-decimal total as the order holds it: every currency here is counted in hundredths", () => {
    const huf = order({ currency: "HUF", totalMinor: 1_234_500, subtotalMinor: 1_234_500, discountMinor: 0, shippingMinor: 0, taxMinor: 0, refundedMinor: 0, lines: [] });
    expect(cell(cols, orderRows([huf], OPTS)[0], "total")).toEqual({ num: "12345.00" });
  });

  it("writes the payment reference (a reference, not a credential) on the lines and nothing about the card", () => {
    expect(cell(cols, rows[0], "payment_reference")).toBe("pi_123");
  });

  it("makes one row of an order with no lines", () => {
    expect(orderRows([order({ lines: [] })], OPTS)).toHaveLength(1);
    expect(orderRowCount([order(), order({ lines: [] })], "lines")).toBe(3);
    expect(orderRowCount([order(), order({ lines: [] })], "orders")).toBe(2);
  });
});

describe("a row per order", () => {
  it("has the amounts once, the line count, and no line columns", () => {
    const cols = orderColumns("orders", "accounting");
    const rows = orderRows([order(), order({ number: "1002", lines: [order().lines[0]] })], { layout: "orders", profile: "accounting", main });
    expect(rows).toHaveLength(2);
    expect(cell(cols, rows[0], "line_count")).toBe(2);
    expect(cell(cols, rows[1], "line_count")).toBe(1);
    expect(cell(cols, rows[0], "total")).toEqual({ num: "2799.00" });
  });
});

describe("profiles and the person who was erased", () => {
  const full = orderColumns("lines", "full");
  const acc = orderColumns("lines", "accounting");

  it("keeps contact details out of the Accounting file, and puts them in the Full one", () => {
    const a = orderRows([order()], OPTS)[0];
    expect(a).not.toContain("kari@example.com");
    expect(a).not.toContain("Storgata 1");
    expect(cell(acc, a, "billing_country")).toBe("NO");
    const f = orderRows([order()], { ...OPTS, profile: "full" })[0];
    expect(cell(full, f, "email")).toBe("kari@example.com");
    expect(cell(full, f, "billing_name")).toBe("Kari Nordmann");
    expect(cell(full, f, "shipping_line2")).toBe("2. etasje");
    expect(cell(full, f, "shipping_phone")).toBe("+4790000000");
    expect(cell(full, f, "discount_code")).toBe("WELCOME10");
  });

  it("exports an erased person's order without any personal field in either profile, and keeps the country", () => {
    const erased = order({ erased: true, companyName: "Nordmann AS", buyerVatNumber: "NO123456789MVA", customerType: "business" });
    for (const profile of ["accounting", "full"] as const) {
      const cols = orderColumns("lines", profile);
      const r = orderRows([erased], { ...OPTS, profile })[0];
      for (const c of PERSONAL_ORDER_COLUMNS.filter((x) => cols.includes(x))) expect([profile, c, cell(cols, r, c) === null || cell(cols, r, c) === REMOVED]).toEqual([profile, c, true]);
      const text = JSON.stringify(r);
      for (const secret of ["kari@example.com", "Kari", "Storgata", "0150", "Oslo", "+4790000000", "Nordmann AS", "NO123456789MVA"]) expect([profile, secret, text.includes(secret)]).toEqual([profile, secret, false]);
      expect(cell(cols, r, "billing_country")).toBe("NO");
      expect(cell(cols, r, "shipping_country")).toBe("NO");
    }
  });
});

describe("formula safety", () => {
  it("never lets a cell start with a formula character, whatever the order holds (the canary)", () => {
    const hostile = order({
      companyName: "=cmd|' /C calc'!A0",
      buyerVatNumber: "+SE1",
      email: "@evil.com",
      billing: { ...address, name: "-2+3", line1: "=1+1", city: "@SUM(1)" },
      shipping: { ...address, name: "+x", line2: "-y" },
      discountCode: "=DISCOUNT",
      deliveryService: "@carrier",
      lines: order().lines.map((l) => ({ ...l, sku: "=SKU", title: "+title" })),
    });
    for (const profile of ["accounting", "full"] as const) {
      const csv = writeCsv(orderFileRows([hostile], { layout: "lines", profile, main }), "excel_nordic");
      for (const row of parseCsv(csv).rows.slice(1)) for (const c of row) expect([profile, c, /^[=+@\t\r\n]/.test(c)]).toEqual([profile, c, false]);
      // A negative amount stays a number: nothing is escaped that is a number.
    }
    const refund = order({ refundedMinor: -5 });
    const csv = writeCsv(orderFileRows([refund], { layout: "lines", profile: "accounting", main }));
    expect(csv).toContain(",-0.05,");
  });
});

describe("an order's own figures", () => {
  it("are consistent for a good order and a problem is said for a bad one", () => {
    expect(orderTotalsProblems(order())).toEqual([]);
    expect(orderTotalsProblems(order({ totalMinor: 1 }))[0]).toMatch(/not the total/);
    expect(orderTotalsProblems(order({ taxMinor: 100 }))[0]).toMatch(/more VAT than the order/);
  });
});

describe("helpers", () => {
  it("writes a rate as a percentage with the decimals it needs", () => {
    expect([0.25, 0.125, 0.12, 0, 0.255, 0.065].map(ratePercentText)).toEqual(["25", "12.5", "12", "0", "25.5", "6.5"]);
  });

  it("works out the rate used", () => {
    expect(mainRateText("NOK", "NOK", rates)).toBe("1");
    expect(mainRateText("EUR", "NOK", rates)).toBe("11.5");
    expect(mainRateText("DKK", "NOK", rates)).toBeNull();
  });

  it("reads a pasted list of order numbers: any separator, no duplicates, at most the limit, the rest counted", () => {
    expect(parseOrderNumbers("1001, 1002;1003\n1001  C-1004", 10)).toEqual({ numbers: ["1001", "1002", "1003", "C-1004"], over: 0 });
    expect(parseOrderNumbers("1,2,3,4,5", 3)).toEqual({ numbers: ["1", "2", "3"], over: 2 });
    expect(parseOrderNumbers("", 3)).toEqual({ numbers: [], over: 0 });
  });
});

describe("what wave 3 added to an order: tags, archived, source and gift (D173)", () => {
  const colsOf = (layout: "lines" | "orders", profile: "accounting" | "full") => orderColumns(layout, profile);
  const one = (over: Partial<ExportOrder>, profile: "accounting" | "full" = "accounting", layout: "lines" | "orders" = "orders") =>
    orderRows([order(over)], { layout, profile, main })[0];

  it("has tags, archived, source and gift_order in both profiles, and the gift's words in the Full profile only", () => {
    for (const layout of ["lines", "orders"] as const) {
      for (const c of ["tags", "archived", "source", "gift_order"]) {
        expect(colsOf(layout, "accounting"), `${layout} accounting ${c}`).toContain(c);
        expect(colsOf(layout, "full"), `${layout} full ${c}`).toContain(c);
      }
      for (const c of ["gift_to", "gift_from", "gift_message"]) {
        expect(colsOf(layout, "accounting"), `${layout} accounting ${c}`).not.toContain(c);
        expect(colsOf(layout, "full"), `${layout} full ${c}`).toContain(c);
        expect(PERSONAL_ORDER_COLUMNS).toContain(c);
      }
    }
    // The column `gift` stays the free-gift line's: the order's gift is another column.
    expect(colsOf("lines", "accounting")).toContain("gift");
    expect(colsOf("orders", "accounting")).not.toContain("gift");
    // The line columns and the payment reference still end the lines layout.
    expect(colsOf("lines", "full").at(-1)).toBe("payment_reference");
  });

  it("writes the tags as written, the archive and the gift as true or false, and the source as checkout, draft or copied", () => {
    const cols = colsOf("orders", "accounting");
    const plain = one({});
    expect([cell(cols, plain, "tags"), cell(cols, plain, "archived"), cell(cols, plain, "source"), cell(cols, plain, "gift_order")]).toEqual([null, "false", "checkout", "false"]);
    const marked = one({ tags: ["VIP", "gift wrap"], archived: true, source: "draft", isGift: true });
    expect([cell(cols, marked, "tags"), cell(cols, marked, "archived"), cell(cols, marked, "source"), cell(cols, marked, "gift_order")]).toEqual(["VIP, gift wrap", "true", "draft", "true"]);
    // Copied history is `copied` whatever it was before it was copied.
    expect(cell(cols, one({ copied: true, source: "draft" }), "source")).toBe("copied");
  });

  it("puts the order's columns on every row of the lines layout (a label is no amount), so a filter on a line's row finds the order", () => {
    const rows = orderRows([order({ tags: ["VIP"], archived: true })], { layout: "lines", profile: "accounting", main });
    const cols = colsOf("lines", "accounting");
    expect(rows).toHaveLength(2);
    for (const row of rows) expect([cell(cols, row, "tags"), cell(cols, row, "archived")]).toEqual(["VIP", "true"]);
  });

  it("keeps the gift's words out of the accounting file and puts them in the full one, with a formula escaped by the writer", () => {
    const gifted = { isGift: true, giftTo: "Mormor", giftFrom: "Kari", giftMessage: "=cmd|' /C calc'!A0" };
    expect(colsOf("orders", "accounting")).not.toContain("gift_message");
    const full = colsOf("orders", "full");
    const row = one(gifted, "full");
    expect([cell(full, row, "gift_to"), cell(full, row, "gift_from"), cell(full, row, "gift_message")]).toEqual(["Mormor", "Kari", "=cmd|' /C calc'!A0"]);
    // The file never opens a formula: the writer prefixes it (OWASP), whatever the cell says.
    const text = writeCsv(orderFileRows([order(gifted)], { layout: "orders", profile: "full", main }));
    const parsed = parseCsv(text).rows;
    const header = parsed[0];
    const written = parsed[1][header.indexOf("gift_message")];
    expect(written.startsWith("=")).toBe(false);
    expect(written).toContain("cmd|");
    // The same for a tag a person typed.
    const tagged = parseCsv(writeCsv(orderFileRows([order({ tags: ["=1+1"] })], { layout: "orders", profile: "accounting", main }))).rows;
    expect(tagged[1][tagged[0].indexOf("tags")].startsWith("=")).toBe(false);
  });

  it("carries nothing a person typed of an erased person's order: no tags, no gift words, in either profile; the flags stay", () => {
    for (const profile of ["accounting", "full"] as const) {
      const cols = colsOf("orders", profile);
      const row = one({ erased: true, tags: ["calls on Fridays"], isGift: true, giftTo: "Mormor", giftFrom: "Kari", giftMessage: "Gratulerer" }, profile);
      expect([profile, cell(cols, row, "tags")]).toEqual([profile, REMOVED]);
      expect([cell(cols, row, "gift_order"), cell(cols, row, "archived"), cell(cols, row, "source")]).toEqual(["true", "false", "checkout"]);
      for (const c of ["gift_to", "gift_from", "gift_message"].filter((x) => cols.includes(x))) expect([profile, c, cell(cols, row, c)]).toEqual([profile, c, REMOVED]);
    }
  });

  it("leaves an order with no wave-3 fields (an older caller) as no tags, not archived, a checkout order and no gift", () => {
    const cols = colsOf("orders", "full");
    const row = orderRows([order({ tags: undefined, archived: undefined, source: undefined, isGift: undefined })], { layout: "orders", profile: "full", main })[0];
    expect([cell(cols, row, "tags"), cell(cols, row, "archived"), cell(cols, row, "source"), cell(cols, row, "gift_order"), cell(cols, row, "gift_message")]).toEqual([null, "false", "checkout", "false", null]);
  });
});
