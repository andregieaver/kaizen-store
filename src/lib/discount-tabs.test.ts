import { describe, expect, it } from "vitest";

import { DISCOUNT_TABS, discountTab, discountTabHref } from "./discount-tabs";

describe("the Discounts page's tabs (ecosystem plan E3.7, D718)", () => {
  it("opens on Codes, the old Coupons address, and on Automatic only when the address names it", () => {
    expect(DISCOUNT_TABS[0]).toBe("codes");
    expect(discountTab(undefined)).toBe("codes");
    expect(discountTab("codes")).toBe("codes");
    expect(discountTab("automatic")).toBe("automatic");
    expect(discountTab(["automatic"])).toBe("codes");
    expect(discountTab("campaigns")).toBe("codes");
  });

  it("gives each tab an address of its own under /discounts", () => {
    expect(discountTabHref("kaffe", "codes")).toBe("/admin/kaffe/discounts");
    expect(discountTabHref("kaffe", "automatic")).toBe("/admin/kaffe/discounts?tab=automatic");
  });
});
