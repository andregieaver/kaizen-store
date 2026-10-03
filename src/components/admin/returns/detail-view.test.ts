import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReturnDetailView } from "./detail-view";
import { actions, detail, line, plain, preview } from "./test-fixtures";

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;

const draw = (d = detail(), p: ReturnType<typeof preview> | null = null) => {
  const html = renderToString(h(ReturnDetailView, { base: "/admin/s", detail: d, preview: p, actions, timeZone: "Europe/Oslo", today: "2026-10-05" }));
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

describe("a withdrawal that waits for the goods", () => {
  const { html, text } = draw();

  it("names the return, its order and its kind", () => {
    expect(text).toContain("Return 1001-R1");
    expect(text).toContain("Order #1001");
    expect(html).toContain('href="/admin/s/orders/33333333-3333-4333-8333-333333333333"');
    expect(text).toContain("Withdrawal");
    expect(text).toContain("You cannot refuse it");
  });

  it("shows the statement and its acknowledgement with the legal dates", () => {
    expect(text).toContain("The customer's withdrawal");
    expect(text).toContain("Kari Nordmann");
    expect(text).toContain("Acknowledgement");
    expect(text).toContain("Sent 5 Oct 2026");
    expect(text).toContain("Reference ack-1");
    expect(text).toContain("Goods to be sent back by");
    expect(text).toContain("19 Oct");
    expect(text).toContain("Refund due by");
  });

  it("offers only the steps the return can take: the goods, the instructions, closing, and never cancelling a withdrawal", () => {
    expect(text).toContain("Mark as on their way");
    expect(text).toContain("Mark as received");
    expect(text).toContain("Return instructions");
    expect(text).toContain("Close");
    expect(text).not.toContain("Cancel");
    expect(text).toContain("closed, never cancelled");
    // A withdrawal is not approved or declined, and nothing is refunded before the goods are back.
    expect(text).not.toContain("Approve the return");
    expect(text).not.toContain("Decline the return");
    expect(text).not.toContain("Inspect the goods");
    expect(text).not.toContain("Refund 350");
  });

  it("says nothing was sent, when the customer withdrew before the goods went, and hides the goods steps", () => {
    const { text: unsent } = draw(detail({ nothingSent: true }));
    expect(unsent).toContain("Nothing was sent");
    expect(unsent).toContain("no refund to hold back for the goods");
    expect(unsent).not.toContain("Mark as on their way");
    expect(unsent).not.toContain("The customer has sent them");
  });

  it("shows the return shipping rule as it was when the order was sold, not as the store has it now", () => {
    const { text: sold } = draw(detail({ whoPaysReturn: "store", settings: { ...detail().settings, whoPaysReturn: "shopper" } }));
    expect(sold).toContain("Return shipping, as sold");
    expect(sold).toContain("The store pays");
  });

  it("marks the step it is at and the history in words", () => {
    expect(html).toContain('aria-current="step"');
    expect(text).toContain("Withdrawal confirmed by the customer");
    expect(text).toContain("Approved automatically");
  });

  it("shows the lines with what was paid for them, and the rules and what the customer is told", () => {
    expect(text).toContain("White mug");
    expect(text).toContain("MUG-WHITE");
    expect(text.replace(/\s/g, "")).toContain("NOK300.00");
    expect(text).toContain("Store rules");
    expect(text).toContain("The customer pays");
    expect(text).toContain("Pack it well.");
    expect(text).toContain("Lager 1");
  });

  it("never gives a form a fixed colour: the admin's tokens carry the look", () => {
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});

describe("a return request that waits for an answer", () => {
  const d = detail({ kind: "return", status: "requested", request: null, reason: "too_small", reasonNote: "It does not fit", refundDeadline: null, due: { state: "not_applicable", deadline: null, daysToDeadline: null, waitingFor: null, clockStart: null } });
  const { text } = draw(d);

  it("offers to approve with instructions, or to decline with a reason", () => {
    expect(text).toContain("Approve or decline");
    expect(text).toContain("Approve the return");
    expect(text).toContain("Decline instead");
    expect(text).toContain("Return request");
  });

  it("shows what the customer wrote", () => {
    expect(text).toContain("The customer's request");
    expect(text).toContain("Too small");
    expect(text).toContain("It does not fit");
    expect(text).not.toContain("Acknowledgement");
  });

  it("does not show the instructions twice", () => {
    expect(text.match(/Return instructions/g)?.length ?? 0).toBe(0);
  });
});

describe("a withdrawal whose acknowledgement was not sent", () => {
  const request = { ...detail().request!, acknowledgedAt: null, acknowledgementReference: null, acknowledgement: "not_sent" as const };
  const { html, text } = draw(detail({ request }));

  it("says so as an alert, says the withdrawal stands, and offers to send it again", () => {
    expect(html).toContain('role="alert"');
    expect(text).toContain("The acknowledgement was not sent");
    expect(text).toContain("The withdrawal stands");
    expect(text).toContain("Send the acknowledgement again");
    expect(text).toContain("Not sent");
  });
});

describe("goods that are back", () => {
  const lines = [line({ condition: null })];
  const received = detail({ status: "received", receivedAt: "2026-10-06T10:00:00.000Z", lines, due: { state: "due", deadline: new Date("2026-10-19T10:00:00Z"), daysToDeadline: 14, waitingFor: null, clockStart: null } });

  it("asks for an inspection of each line, with the condition and the deduction", () => {
    const { text } = draw(received);
    expect(text).toContain("Inspect the goods");
    expect(text).toContain("Condition");
    expect(text).toContain("As new");
    expect(text).toContain("Opened, not used");
    expect(text).toContain("Put back in stock");
    expect(text).toContain("What the deduction is for");
    expect(text).toContain("Art. 14(2)");
  });

  it("shows the refund's working before its button", () => {
    const { text } = draw(received, preview());
    expect(text).toContain("How the refund is worked out");
    expect(text).toContain("What the customer paid for the returned goods");
    expect(text).toContain("Original standard delivery");
    expect(text).toContain("To refund");
    expect(text.replace(/\s/g, "")).toContain("Refund");
    expect(text).toContain("Amount to refund");
    expect(text).toContain("Put back in stock");
  });

  it("does not show a refund it cannot make", () => {
    const { text } = draw(received, null);
    expect(text).not.toContain("How the refund is worked out");
  });

  it("says when the order was paid outside Kaizen's Stripe", () => {
    const { text } = draw(received, preview({ canRefund: false }));
    expect(text).toContain("not paid through Kaizen's Stripe");
    expect(text).toContain("Record as refunded outside");
  });

  it("shows a deduction in the line and what it is for", () => {
    const { text } = draw(detail({ status: "inspected", lines: [line({ condition: "used", restock: false, deductionMinor: 2_000, deductionNote: "Used for a week" })] }), preview());
    expect(text).toContain("Used");
    expect(text.replace(/\s/g, "")).toContain("−NOK20.00");
    expect(text).toContain("Deduction on White mug: Used for a week");
    // Until the refund is made, the inspection can be corrected.
    expect(text).toContain("Change the inspection");
  });
});

describe("a return that is refunded and closed", () => {
  const d = detail({
    status: "closed",
    outcome: "refunded",
    closedAt: "2026-10-09T10:00:00.000Z",
    refund: { recorded: true, amountMinor: 33_000, computedMinor: 35_000, note: "Goodwill", at: "2026-10-08T10:00:00.000Z", outside: false, refundId: "r1", returnShippingMinor: 0 },
    lines: [line({ condition: "as_new", restock: true })],
    due: { state: "done", deadline: null, daysToDeadline: null, waitingFor: null, clockStart: null },
  });
  const { text } = draw(d);

  it("shows what was refunded, how, and what it was changed from and why", () => {
    expect(text).toContain("Refunded");
    expect(text.replace(/\s/g, "")).toContain("NOK330.00");
    expect(text).toContain("Through Stripe");
    expect(text).toContain("Changed from");
    expect(text).toContain("Goodwill");
    expect(text).toContain("Refunded");
  });

  it("offers no step, only the store's own note", () => {
    expect(text).not.toContain("Mark as received");
    expect(text).not.toContain("Cancel the return");
    expect(text).not.toContain("Close the return");
    expect(text).toContain("Save the note");
    expect(text).toContain("Back in stock");
  });
});

describe("a line the law excludes", () => {
  it("is listed with its reason, and can be declined as a line", () => {
    const excluded = line({ lineId: "55555555-5555-4555-8555-555555555555", title: "Made to order", withdrawalExclusion: "custom_made" });
    const { text } = draw(detail({ lines: [line(), excluded] }));
    expect(text).toContain("Made to the customer's order or personalised");
    expect(text).toContain("Decline: the law excludes it");
    // The line that has the right of withdrawal cannot be declined.
    expect(text.match(/Decline this line/g)?.length ?? 0).toBe(1);
  });

  it("shows a declined line with why, and no way to decline it again", () => {
    const declined = line({ decision: "decline", declineReason: "excluded_by_law", withdrawalExclusion: "custom_made", title: "Made to order" });
    const { text } = draw(detail({ lines: [line(), declined] }));
    expect(text).toContain("Declined: The law excludes this line from the right of withdrawal");
    expect(text).not.toContain("Decline: the law excludes it");
  });

  it("lets a voluntary return's lines be declined one by one", () => {
    const { text } = draw(detail({ kind: "return", status: "approved", request: null, lines: [line()] }));
    expect(text).toContain("Decline this line");
  });
});

describe("what the order says", () => {
  it("warns that a subscription is ended separately", () => {
    const d = detail();
    d.order.subscription = true;
    const { text } = draw(d);
    expect(text).toContain("part of a subscription");
    expect(text).toContain("does not end the subscription");
  });

  it("says a company has no statutory right", () => {
    const d = detail({ kind: "return", status: "requested", request: null });
    d.order.business = true;
    expect(draw(d).text).toContain("A company: no statutory right of withdrawal");
  });

  it("marks a refund past its legal deadline", () => {
    const { text, html } = draw(detail({ due: { state: "overdue", deadline: new Date("2026-10-19T10:00:00Z"), daysToDeadline: -2, waitingFor: null, clockStart: null } }));
    expect(text).toContain("Refund overdue by 2 days");
    expect(html).toContain("text-red-700");
  });
});
