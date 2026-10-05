import { describe, expect, it } from "vitest";

import { t } from "./i18n";
import { cartLabels, cartLines, cartableReason, handoffBody, quoteBody, stockOf, toLines } from "./wordpress-cart";

const A = "123e4567-e89b-12d3-a456-426614174000";
const B = "223e4567-e89b-12d3-a456-426614174000";

describe("which products go in a cart held on another site", () => {
  const goods = { kind: "goods", subscriptionOnly: false, audience: "all" };
  it("takes shipped goods and downloads", () => {
    expect(cartableReason(goods, "consumers", ["physical"])).toBeNull();
    expect(cartableReason(goods, "both", ["physical", "digital"])).toBeNull();
  });
  it("sends a product that needs a time, a plan or a business buyer to the store", () => {
    expect(cartableReason({ ...goods, kind: "appointment" }, "consumers", ["service"])).toBe("booking");
    expect(cartableReason({ ...goods, kind: "stay" }, "consumers", ["service"])).toBe("booking");
    expect(cartableReason({ ...goods, subscriptionOnly: true }, "consumers", ["physical"])).toBe("subscription");
    expect(cartableReason({ ...goods, audience: "businesses" }, "both", ["physical"])).toBe("business_only");
    // A store that sells only to businesses sells everything to them: its goods are not "business only" next to others.
    expect(cartableReason({ ...goods, audience: "businesses" }, "businesses", ["physical"])).toBeNull();
    expect(cartableReason(goods, "consumers", ["service"])).toBe("service");
  });
});

describe("the lines of a cart", () => {
  it("are variants and quantities of 1 to 20, each variant once, at most thirty", () => {
    expect(cartLines.safeParse([{ variant_id: A, quantity: 2 }]).success).toBe(true);
    for (const bad of [[], [{ variant_id: "x", quantity: 1 }], [{ variant_id: A, quantity: 0 }], [{ variant_id: A, quantity: 21 }], [{ variant_id: A, quantity: 1 }, { variant_id: A.toUpperCase(), quantity: 1 }], Array.from({ length: 31 }, (_, i) => ({ variant_id: `${i.toString(16).padStart(8, "0")}-e89b-12d3-a456-426614174000`, quantity: 1 }))]) {
      expect(cartLines.safeParse(bad).success, JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
  });
  it("are read into lower-case ids", () => {
    const body = quoteBody.parse({ market: "dk", lines: [{ variant_id: A.toUpperCase(), quantity: "3" }, { variant_id: B, quantity: 1 }] });
    expect(toLines(body.lines)).toEqual([{ variantId: A, quantity: 3 }, { variantId: B, quantity: 1 }]);
  });
  it("hand over to the checkout unless the cart page is asked for", () => {
    expect(handoffBody.parse({ lines: [{ variant_id: A, quantity: 1 }] }).to).toBe("checkout");
    expect(handoffBody.parse({ lines: [{ variant_id: A, quantity: 1 }], to: "cart" }).to).toBe("cart");
    expect(handoffBody.safeParse({ lines: [{ variant_id: A, quantity: 1 }], to: "elsewhere" }).success).toBe(false);
  });
});

describe("stock for the product page", () => {
  it("is a level, how many can be bought at once and, when low, how many are left", () => {
    expect(stockOf(0)).toEqual({ level: "out", max: 0, low: null });
    expect(stockOf(3)).toEqual({ level: "low", max: 3, low: 3 });
    expect(stockOf(8)).toEqual({ level: "in_stock", max: 8, low: null });
    expect(stockOf(500).max).toBe(20);
  });
});

describe("the cart's words", () => {
  it("are the storefront's own in the market's language, with the numbers left for the plugin", () => {
    const nb = cartLabels(t("nb"), { viewInStore: "x" });
    expect(nb.addToCart).toBe(t("nb").addToCart);
    expect(nb.checkout).toBe(t("nb").checkout);
    expect(nb.onlyAvailable).toContain("{n}");
    expect(nb.lowStock).toContain("{n}");
    expect(cartLabels(t("sv"), { viewInStore: "x" }).cart).toBe(t("sv").cart);
    expect(cartLabels(t("da"), { viewInStore: "x" }).emptyCart).not.toBe(nb.emptyCart);
  });
});
