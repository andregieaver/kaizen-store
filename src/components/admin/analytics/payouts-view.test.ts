import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { payoutReportOf, type PayoutInput } from "@/lib/payouts";

import { PayoutDetailView, PayoutsView, settlesWords } from "./payouts-view";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

const input = (over: Partial<PayoutInput> = {}): PayoutInput => ({
  id: "p1",
  reference: "po_1",
  arrivalOn: "2026-10-19",
  status: "paid",
  amountMinor: 18_850,
  currency: "NOK",
  testMode: false,
  automatic: true,
  linesRead: true,
  linesComplete: true,
  lines: [
    { kind: "charge", amountMinor: 10_000, feeMinor: 450, netMinor: 9_550, orderId: "o1" },
    { kind: "charge", amountMinor: 10_000, feeMinor: 450, netMinor: 9_550, orderId: "o2" },
    { kind: "refund", amountMinor: -250, feeMinor: 0, netMinor: -250, orderId: "o1" },
  ],
  ...over,
});

const toMain = (currency: string, minor: number) => (currency === "NOK" ? minor : currency === "EUR" ? Math.round(minor * 11.5) : null);
const draw = (inputs: PayoutInput[]) => renderToString(h(PayoutsView, { base: "/admin/s", currency: "NOK", locale: "nb-NO", report: payoutReportOf(inputs, toMain) }));

describe("the Payouts page (D290)", () => {
  it("lists a payout with its date, amount, Stripe's fees, what it settles and that it adds up", () => {
    const html = draw([input()]);
    const t = text(html);
    expect(t).toContain("2026-10-19");
    expect(t).toContain("188,50");
    expect(t).toContain("9,00");
    expect(t).toContain("2 payments, 1 refund");
    expect(t).toContain("Adds up");
    expect(html).toContain('href="/admin/s/analytics/payouts/p1"');
  });

  it("flags one that does not add up, with the difference, and one with money not tied to an order", () => {
    const off = input({ id: "p2", amountMinor: 20_000 });
    const untied = input({ id: "p3", lines: [{ kind: "charge", amountMinor: 19_300, feeMinor: 450, netMinor: 18_850, orderId: null }] });
    const t = text(draw([off, untied]));
    expect(t).toContain("Does not add up by 11,50");
    expect(t).toContain("Money not tied to an order: 188,50");
    expect(t).toContain("2 payouts do not add up");
  });

  it("shows each payout in its own currency, sums the paid live ones in the main currency, and leaves test payouts and unknown currencies out", () => {
    const euro = input({ id: "e", currency: "EUR", amountMinor: 1_900, lines: [{ kind: "charge", amountMinor: 2_000, feeMinor: 100, netMinor: 1_900, orderId: "o" }] });
    const test = input({ id: "t", testMode: true });
    const sek = input({ id: "s", currency: "SEK" });
    const report = payoutReportOf([euro, test, sek], toMain);
    expect(report.totals).toEqual({ paidMinor: 21_850, feesMinor: 1_150, paid: 1 });
    expect(report).toMatchObject({ unconverted: 1, missingCurrencies: ["SEK"], testPayouts: 1 });
    const t = text(renderToString(h(PayoutsView, { base: "/admin/s", currency: "NOK", locale: "nb-NO", report })));
    expect(t).toContain("€");
    expect(t).toContain("Paid (test)");
    expect(t).toContain("1 test payout is listed but not in the totals.");
    expect(t).toContain("left out of the totals");
  });

  it("says when it cannot tell", () => {
    expect(settlesWords(payoutReportOf([input({ linesRead: false, lines: [] })], toMain).payouts[0])).toBe("Not read yet");
    expect(settlesWords(payoutReportOf([input({ automatic: false, lines: [] })], toMain).payouts[0])).toMatch(/manual payout/);
    expect(text(draw([]))).toContain("No payout arrives in this period");
  });
});

describe("one payout (D290)", () => {
  it("lists its lines with the order each settles, and says which no order explains", () => {
    const p = input({ lines: [{ kind: "charge", amountMinor: 19_300, feeMinor: 450, netMinor: 18_850, orderId: null }] });
    const [row] = payoutReportOf([p], toMain).payouts;
    const detail = {
      payout: { ...p, failure: null },
      lines: [
        { id: "l1", kind: "charge" as const, providerType: "charge", sourceReference: "ch_1", amountMinor: 19_300, feeMinor: 450, netMinor: 18_850, orderId: null, orderNumber: null, createdAt: "2026-10-19T10:00:00.000Z" },
        { id: "l2", kind: "refund" as const, providerType: "refund", sourceReference: "re_1", amountMinor: -250, feeMinor: 0, netMinor: -250, orderId: "o1", orderNumber: "1042", createdAt: "2026-10-19T10:00:00.000Z" },
      ],
    };
    const html = renderToString(h(PayoutDetailView, { base: "/admin/s", locale: "nb-NO", detail, row }));
    const t = text(html);
    expect(t).toContain("Not tied to an order");
    expect(html).toContain('href="/admin/s/orders/o1"');
    expect(t).toContain("ch_1");
    expect(t).toContain("1 line (188,50 kr) could not be tied to an order");
  });
});
