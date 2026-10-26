import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The server actions are not called while drawing.
vi.mock("@/app/s/[store]/[market]/cart/actions", () => ({ addToCart: async () => ({ status: "idle" }) }));
vi.mock("@/app/s/[store]/[market]/deliveries/actions", () => ({ addToDeliveryAction: async () => ({ status: "idle" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/" }));

import { VariantPurchase, type OfferedVariant } from "./variant-choice";

const labels = {
  addToCart: "Add to cart",
  adding: "Adding",
  added: "Added",
  capped: "As many as you can buy",
  unavailable: "Sold out",
  planConflict: "Another schedule",
  tryAgain: "Try again",
  goToCart: "Go to cart",
  chooseVariant: "Choose a variant",
  variantUnavailable: "Not available",
};

const variant = (id: string, label: string, options: Record<string, string> = {}, available = true): OfferedVariant => ({
  id,
  label,
  options,
  image: null,
  note: "In stock",
  available,
  priceIndex: 0,
});

const prices = [{ price: createElement("span", null, "199 kr"), amount: "199 kr" }];

const draw = (variants: OfferedVariant[], optionsFrom?: number) =>
  renderToString(createElement(VariantPurchase, { variants, prices, optionsFrom, store: "s", market: "no", cartHref: "/cart", openCart: false, labels }));

/** A product's buy box: a choice in a box for several variants, and for one only its stock, price and Add to cart. */
describe("VariantPurchase", () => {
  it("draws a product of one variant without a box or a choice", () => {
    const html = draw([variant("a", "")]);
    expect(html).not.toContain("border");
    expect(html).not.toContain("Choose a variant");
    expect(html).toContain("In stock");
    expect(html).toContain("199 kr");
    expect(html).toContain("Add to cart");
  });

  it("names a single variant by its options when it has them", () => {
    expect(draw([variant("a", "Size: M")])).toContain("<p>Size: M</p>");
  });

  it("draws several variants as a choice in a box", () => {
    const html = draw([variant("a", "Size: S"), variant("b", "Size: M")]);
    expect(html).toContain("rounded-lg border border-border p-3");
    expect(html).toContain("Choose a variant");
  });

  it("draws a list per option from the buy part's number of variants, the price once (D320)", () => {
    const grid = ["Red", "Blue", "Green"].flatMap((colour) =>
      ["S", "M", "L", "XL"].map((size) => variant(`${colour}-${size}`, `${colour} / ${size}`, { Colour: colour, Size: size }, colour !== "Green")),
    );
    const lists = draw(grid);
    expect(grid).toHaveLength(12);
    expect(lists).not.toContain("Choose a variant");
    expect(lists).toContain(">Colour<");
    expect(lists).toContain(">Size<");
    // The same 12 below the store's own number: one list of every variant.
    expect(draw(grid, 13)).toContain("Choose a variant");
    // One price for every variant that has it.
    expect(lists.match(/199 kr/g)).toHaveLength(1);
  });
});
