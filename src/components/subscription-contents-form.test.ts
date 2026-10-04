import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SubscriptionContentsForm } from "./subscription-contents-form";

const labels = { variant: "Swap", quantity: "Quantity", remove: "Remove", save: "Save", saving: "Saving", saved: "Saved", failed: "Failed" };
const draw = (unit: { text: string; spoken: string } | null | undefined) =>
  renderToString(
    createElement(SubscriptionContentsForm, {
      action: async () => ({ failed: false }),
      maxQuantity: 99,
      labels,
      lines: [{ id: "l1", title: "Coffee", quantity: 1, variantId: "v1", choices: [], ...(unit === undefined ? {} : { unit }) }],
    }),
  );

describe("a subscription line's unit price (D160)", () => {
  it("is drawn under the title, for the eye and in words for a screen reader", () => {
    const html = draw({ text: "199,60 kr/kg", spoken: "Unit price: 199,60 kr per kg" });
    expect(html).toContain("199,60 kr/kg");
    expect(html).toMatch(/sr-only[^>]*>Unit price: 199,60 kr per kg</);
    expect(html.indexOf("Coffee")).toBeLessThan(html.indexOf("199,60 kr/kg"));
  });

  it("is absent when the server found none", () => {
    expect(draw(null)).not.toContain("data-unit-price");
    expect(draw(undefined)).not.toContain("data-unit-price");
  });
});
