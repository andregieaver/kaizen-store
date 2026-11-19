import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/wishlist-heart", () => ({ WishlistHeart: () => null }));

import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { priceView, WITH_VAT } from "@/lib/pricing";
import type { ProductSummary } from "@/server/catalog";

import { ProductCard } from "./product-card";

/** A listing card's price block carries the unit price of the variant its price is of (D160, docs/wave-1d-unit-price.md 2.1). */

const market = { slug: "no", code: "NO", currency: "NOK", locale: "nb-NO", lang: "nb" } as Market;
const m = t("nb");
const text = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const card = (product: Partial<ProductSummary>) =>
  renderToString(
    createElement(ProductCard, {
      product: { id: "p1", title: "Kaffe", audience: "all", image: null, priceVaries: false, ...product } as ProductSummary,
      href: "/s/demo/no/p/kaffe",
      market,
      m,
      store: "demo",
      base: "/s/demo/no",
    }),
  );

describe("a listing card's unit price", () => {
  it("is the cheapest variant's price per kg, under the price the card shows", () => {
    const copy = text(card({ price: priceView(4990, "NOK", null, WITH_VAT, { amount: "250", unit: "g", base: "kg" }) }));
    expect(copy).toContain("49,90 kr");
    expect(copy).toContain("199,60 kr/kg");
  });

  it("carries no 'from' of its own: it belongs to the one offer the price names", () => {
    const html = card({ price: priceView(4990, "NOK", null, WITH_VAT, { amount: "250", unit: "g", base: "kg" }), priceVaries: true });
    // The price says "Fra"; the unit line is a separate line without it.
    const unit = html.slice(html.indexOf("data-unit-price"));
    expect(text(html)).toContain("Fra 49,90 kr");
    expect(text(unit)).not.toMatch(/Fra/);
  });

  it("is absent for a product whose cheapest variant has no content", () => {
    expect(card({ price: priceView(4990, "NOK", null, WITH_VAT) })).not.toContain("data-unit-price");
  });

  it("follows a reduced price: the price charged, with the reference line apart", () => {
    const copy = text(card({ price: priceView(3990, "NOK", 4990, WITH_VAT, { amount: "250", unit: "g", base: "kg" }) }));
    expect(copy).toContain("159,60 kr/kg");
    expect(copy).not.toContain("199,60");
  });
});
