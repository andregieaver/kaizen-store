import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { paymentsByMethod } from "@/lib/analytics-payments";

import { PaymentsView } from "./payments-view";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/[  ]/g, " ").replace(/\s+/g, " ");
const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;

describe("payments by method on the Finance page (D288)", () => {
  it("lists each method with its money, says what is estimated, unknown and left out", () => {
    const report = paymentsByMethod(
      [
        { provider: "stripe", methodType: "card", wallet: null, manualMethod: null, currency: "NOK", payments: 2, receivedMinor: 30_000, refundedMinor: 0, feeShareMinor: 450, feePayments: 2 },
        { provider: "stripe", methodType: null, wallet: null, manualMethod: null, currency: "NOK", payments: 1, receivedMinor: 10_000, refundedMinor: 0, feeShareMinor: 150, feePayments: 1 },
        { provider: "stripe", methodType: "card", wallet: null, manualMethod: null, currency: "SEK", payments: 1, receivedMinor: 10_000, refundedMinor: 0, feeShareMinor: 150, feePayments: 1 },
      ],
      (currency, minor) => (currency === "NOK" ? minor : null),
      200,
    );
    const html = renderToString(h(PaymentsView, { currency: "NOK", locale: "nb-NO", report }));
    const words = text(html);
    expect(words).toContain("Payments by method");
    expect(words).toContain("Card");
    expect(words).toContain("Unknown");
    expect(words).toContain("1 payment's method is not known yet");
    expect(words).toContain("1 payment in SEK is left out");
    expect(words).toContain("Fees (estimated)");
    expect(words).not.toMatch(BAD);
  });

  it("says when nothing was paid", () => {
    const html = renderToString(h(PaymentsView, { currency: "NOK", locale: "nb-NO", report: paymentsByMethod([], () => 0, 0) }));
    expect(text(html)).toContain("No order was paid in this period.");
  });
});
