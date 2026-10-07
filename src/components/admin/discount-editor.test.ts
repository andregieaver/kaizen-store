import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { DiscountEditor, type DiscountDraft } from "./discount-editor";

const draft = (over: Partial<DiscountDraft> = {}): DiscountDraft => ({
  code: "SOMMER",
  kind: "percent",
  percent: "10",
  amounts: {},
  minSubtotals: {},
  productIds: null,
  recurring: false,
  startsAt: "",
  endsAt: "",
  usageLimit: "",
  oncePerCustomer: false,
  active: true,
  ...over,
});

const render = (initial: DiscountDraft, subscriptions?: boolean) =>
  renderToString(
    createElement(DiscountEditor, {
      initial,
      markets: [{ code: "NO", name: "Norway", currency: "NOK" }],
      products: [],
      used: 0,
      save: async () => ({ ok: true }) as never,
      back: "/admin/shop/discounts",
      ...(subscriptions === undefined ? {} : { subscriptions }),
    }),
  );

describe("the discount editor's renewals (D178)", () => {
  it("offers keeping the discount on every renewal only while Subscriptions is on", () => {
    expect(render(draft())).toContain("Keep the discount on every renewal");
    expect(render(draft(), true)).toContain("Keep the discount on every renewal");
    expect(render(draft(), false)).not.toContain("Keep the discount on every renewal");
  });

  it("keeps the tick of a code that already has it, with the feature off", () => {
    expect(render(draft({ recurring: true }), false)).toContain("Keep the discount on every renewal");
  });
});
