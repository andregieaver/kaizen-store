import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GiftCardsView } from "./gift-cards-view";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/[  ]/g, " ");

/** Gift cards on the Finance page (D300 F4): one row per currency, never added across, said not to be sales, and nothing drawn without a card. */
describe("the gift cards section", () => {
  it("draws nothing for a store with no card", () => {
    expect(renderToString(h(GiftCardsView, { base: "/admin/shop", locale: "nb-NO", lines: [] }))).toBe("");
  });

  it("shows each currency on its own row and says gift cards sold are not sales", () => {
    const out = html(
      h(GiftCardsView, {
        base: "/admin/shop",
        locale: "nb-NO",
        lines: [
          { currency: "NOK", outstandingMinor: 69_000, cards: 2, issuedMinor: 80_000, spentMinor: 12_500, refundedMinor: 2_500, adjustedMinor: -1_000, expiredMinor: 0, voidedMinor: 0 },
          { currency: "EUR", outstandingMinor: 4_000, cards: 1, issuedMinor: 5_000, spentMinor: 0, refundedMinor: 0, adjustedMinor: 0, expiredMinor: 700, voidedMinor: 300 },
        ],
      }),
    );
    expect(out).toContain("NOK");
    expect(out).toContain("EUR");
    expect(out).toContain("690,00");
    expect(out).toContain("40,00");
    expect(out).toContain("not in the sales above");
    expect(out).toContain('href="/admin/shop/gift-cards"');
    // No total row: currencies are never added together.
    expect(out).not.toContain(">Total<");
  });
});
