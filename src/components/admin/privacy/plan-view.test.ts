import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ErasurePlanView } from "./plan-view";
import { BAD, plain, plan } from "./test-fixtures";

const draw = (p = plan()) => {
  const html = renderToString(h(ErasurePlanView, { plan: p }));
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

describe("the erasure preview", () => {
  it("has a row per kind of data with its count, what happens and why", () => {
    const { text } = draw();
    expect(text).toContain("What happens to each kind of data");
    expect(text).toContain("Orders kept for the bookkeeping rules");
    expect(text).toContain("Kept restricted");
    expect(text).toContain("Orders made anonymous now");
    expect(text).toContain("Made anonymous");
    expect(text).toContain("Wishlists");
  });

  it("says until when restricted orders are kept", () => {
    // A sale placed on 2026-03-01 in Norway: five years after the end of 2026, so the first of January 2032.
    expect(draw().text).toContain("until 1 Jan 2032");
  });

  it("lists what else happens: subscriptions, cards, credits, the sale's total in its own currency", () => {
    const { text } = draw();
    expect(text).toContain("1 subscription is cancelled now and not refunded.");
    expect(text).toContain("1 saved card is detached");
    expect(text).toContain("Bonus credits worth");
    // The sale was placed in euro: its total is shown in euro, never converted into the store's currency or added to the NOK credits.
    expect(text).toContain("1 sale worth €129.00 stays in the accounts, cut loose from the person");
    expect(text).toContain("Bonus credits worth NOK 50.00");
  });

  it("says that Stripe keeps its own records, and that erasing cannot be undone", () => {
    const { text } = draw();
    expect(text).toContain("Stripe");
    expect(text).toContain("Erasure cannot be undone");
  });

  it("lists the warnings", () => {
    expect(draw().text).toContain("also a staff or owner account of the store");
    expect(draw(plan({ warnings: [] })).text).not.toContain("Check before you erase");
  });

  it("says nothing is held when the plan is empty", () => {
    const { text } = draw(plan({ counts: {}, orders: [], subscriptionsLive: 0, savedCards: 0, bonus: [], warnings: [] }));
    expect(text).toContain("Nothing is held about this person");
  });

  it("has a caption and headers for assistive technology", () => {
    const { html } = draw();
    expect(html).toContain("<caption");
    expect(html).toContain('scope="col"');
  });
});
