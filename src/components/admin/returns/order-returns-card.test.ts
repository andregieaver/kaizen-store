import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OrderReturnsOverview } from "@/server/order-returns";

import { OrderReturnsCard, windowSentence } from "./order-returns-card";
import { plain } from "./test-fixtures";

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;

const overview = (over: Partial<OrderReturnsOverview> = {}): OrderReturnsOverview => ({
  orderId: "33333333-3333-4333-8333-333333333333",
  sent: true,
  deliveredOn: "2026-10-01",
  heldBack: [],
  lines: [{ lineId: "44444444-4444-4444-8444-444444444444", title: "Lamp", quantity: 2, remaining: 2, maxQuantity: 2, refusal: null }],
  returns: [],
  window: { state: "statutory", basis: "delivered", startDay: "2026-10-01", statutoryEndDay: "2026-10-15", voluntaryEndDay: "2026-10-15", daysLeft: 10 },
  right: "withdrawal",
  unitsLeft: 2,
  unitsBought: 2,
  business: false,
  copied: false,
  ...over,
});

const draw = (o = overview()) => {
  const html = renderToString(h(OrderReturnsCard, { base: "/admin/s", overview: o, withdrawalPage: "https://example.com/s/s/no/withdraw", timeZone: "Europe/Oslo" }));
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

describe("where an order stands in the 14 days", () => {
  it("says the right is open before the goods are sent", () => {
    expect(windowSentence(overview({ window: { state: "before_delivery", basis: "not_sent", startDay: null, statutoryEndDay: null, voluntaryEndDay: null, daysLeft: null } }))).toMatch(/at any time before it arrives/);
  });

  it("counts the days to the last day of the statutory period", () => {
    expect(windowSentence(overview())).toBe("The customer can withdraw until 15 October 2026 (10 days left).");
    expect(windowSentence(overview({ window: { ...overview().window!, daysLeft: 1 } }))).toContain("(1 day left)");
  });

  it("says the store's own window is the store's to decline once the legal days are over", () => {
    const sentence = windowSentence(overview({ window: { state: "voluntary", basis: "delivered", startDay: "2026-09-01", statutoryEndDay: "2026-09-15", voluntaryEndDay: "2026-09-30", daysLeft: 3 }, right: "return" }));
    expect(sentence).toContain("The 14 days of the right of withdrawal are over");
    expect(sentence).toContain("30 September 2026");
    expect(sentence).toContain("approve or decline");
  });

  it("says when it is all over, when the order is unpaid, copied or a company's", () => {
    expect(windowSentence(overview({ window: { state: "closed", basis: "delivered", startDay: "2026-08-01", statutoryEndDay: "2026-08-15", voluntaryEndDay: "2026-08-15", daysLeft: null }, right: "none", unitsLeft: 0 }))).toBe("The return period is over.");
    expect(windowSentence(overview({ window: null }))).toContain("not paid");
    expect(windowSentence(overview({ copied: true }))).toContain("copied from another store");
    expect(windowSentence(overview({ business: true, right: "none" }))).toContain("no legal right of withdrawal");
    expect(windowSentence(overview({ business: true, right: "return" }))).toContain("Your own return window is open");
  });
});

describe("the order page's returns", () => {
  it("says the 14 days have not started for goods sent and not recorded as received, and never gives an end day (an estimate is not a deadline)", () => {
    const sent = overview({
      sent: true,
      deliveredOn: null,
      window: { state: "statutory", basis: "sent", startDay: null, statutoryEndDay: null, voluntaryEndDay: null, daysLeft: null, estimatedEndDay: "2026-10-18" },
    });
    const sentence = windowSentence(sent);
    expect(sentence).toContain("the customer's 14 days have not started and they can withdraw");
    expect(sentence).toContain("an estimate, not a deadline");
    expect(sentence).toContain("18 October 2026");
    expect(sentence).not.toContain("can withdraw until");
  });

  it("offers staff the day the goods were received, once the order is sent, and the registration of a withdrawal made outside the form", () => {
    const action = (async () => ({ status: "idle", messages: [] })) as never;
    const html = renderToString(
      h(OrderReturnsCard, {
        base: "/admin/s",
        overview: overview({ deliveredOn: null }),
        withdrawalPage: "https://example.com/s/s/no/withdraw",
        timeZone: "Europe/Oslo",
        today: "2026-10-03",
        actions: { markDelivered: action, registerWithdrawal: action },
      }),
    );
    const text = plain(html);
    expect(text).toContain("Mark the goods as received by the customer");
    expect(text).toContain("never from the day you sent it");
    expect(text).toContain("Register a withdrawal the customer made outside the form");
    expect(html).toContain('name="informedOn"');
    expect(html).toContain('name="late"');
    // Nothing for an order that has not been sent: there is no receipt to record.
    const unsent = plain(
      renderToString(
        h(OrderReturnsCard, {
          base: "/admin/s",
          overview: overview({ sent: false, deliveredOn: null }),
          withdrawalPage: "x",
          timeZone: "Europe/Oslo",
          today: "2026-10-03",
          actions: { markDelivered: action, registerWithdrawal: action },
        }),
      ),
    );
    expect(unsent).not.toContain("Mark the goods as received");
    expect(unsent).toContain("Register a withdrawal the customer made outside the form");
  });

  it("tells staff to leave out of the parcel what was withdrawn before it was sent", () => {
    const { text } = draw(overview({ sent: false, deliveredOn: null, heldBack: [{ title: "Lamp", quantity: 2 }] }));
    expect(text).toContain("Withdrawn before sending: 2 × Lamp");
    expect(text).toContain("Leave it out of the parcel");
    expect(draw(overview()).text).not.toContain("Withdrawn before sending");
  });

  it("says so when nothing was made, and where the customer does it", () => {
    const { html, text } = draw();
    expect(text).toContain("Returns and withdrawals");
    expect(text).toContain("No withdrawal or return has been made on this order.");
    expect(text).toContain("2 of 2 units can still be withdrawn or returned");
    expect(html).toContain('href="https://example.com/s/s/no/withdraw"');
    expect(html).toContain('href="/admin/s/returns"');
  });

  it("lists each one with its status, linking to its screen", () => {
    const { html, text } = draw(
      overview({
        returns: [
          { id: "r1", number: "1001-R1", kind: "withdrawal", status: "received", token: "t", createdAt: "2026-10-05T10:00:00.000Z" },
          { id: "r2", number: "1001-R2", kind: "return", status: "requested", token: "t", createdAt: "2026-10-06T10:00:00.000Z" },
        ],
        unitsLeft: 0,
      }),
    );
    expect(html).toContain('href="/admin/s/returns/r1"');
    expect(text).toContain("1001-R1");
    expect(text).toContain("Received");
    expect(text).toContain("Withdrawal");
    expect(text).toContain("1001-R2");
    expect(text).toContain("Return request");
    // Nothing is left to withdraw, so the customer is not pointed at the page.
    expect(text).not.toContain("can still be withdrawn");
  });

  it("uses the singular for one unit", () => {
    expect(draw(overview({ unitsLeft: 1, unitsBought: 1 })).text).toContain("1 of 1 unit can still");
  });
});
