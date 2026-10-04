import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { VariantInput } from "@/lib/product-input";
import type { Term } from "@/lib/taxonomy";
import type { ContentState } from "@/lib/unit-price-editor";
import { allowSmallBase } from "@/lib/unit-price-test-support";

import { NeedsContentList, NeedsContentNotice } from "./unit-price-gaps-view";
import { TermsManager } from "./terms";
import { ContentFields, ContentPreviewList, SoldByMeasureField, type ContentContext } from "./unit-price-fields";

const flat = (html: string) => html.replace(/&nbsp;|\s| /g, " ").replace(/<!-- -->/g, "");

const context: ContentContext = {
  markets: [
    { code: "NO", name: "Norway", currency: "NOK", vatRates: { standard: 0.25 } },
    { code: "DE", name: "Germany", currency: "EUR", vatRates: { standard: 0.19 } },
  ],
  audience: "consumers",
  vatCategory: "standard",
  locale: "nb",
};
const variant = (change: Partial<VariantInput> = {}): VariantInput =>
  ({
    id: null,
    options: {},
    sku: "KAFFE-250",
    gtin: null,
    measure: null,
    prices: { NO: "49,90", DE: "4,35" },
    cost: "",
    stock: 3,
    active: true,
    weightGrams: null,
    hsCode: null,
    originCountry: null,
    delivery: "physical",
    rentalPeriod: "day",
    image: null,
    ...change,
  }) as unknown as VariantInput;

const renderFields = (v: VariantInput, c: ContentContext = context) =>
  renderToString(createElement(ContentFields, { name: "Kaffe 250 g", variant: v, context: c, onChange: () => {} }));

describe("a variant's content in the product editor", () => {
  it("offers the content, its unit and what it is compared per, and the pack helper", () => {
    const html = renderFields(variant());
    expect(html).toContain("Content, for the price per kg or litre");
    expect(flat(html)).toContain("Total content of Kaffe 250 g");
    expect(html).toContain('aria-label="Unit of the content of Kaffe 250 g"');
    for (const unit of ["g", "kg", "ml", "cl", "l", "cm", "m", "m²", "piece"]) expect(html).toContain(`>${unit}</option>`);
    expect(html).toContain('aria-label="What the price of Kaffe 250 g is compared per"');
    expect(html).toContain("1 kg (usual)");
    // No market's country allows 100 g (Germany, Norway, Sweden read; Denmark closed): the choice is not offered.
    expect(html).not.toContain(">100 g</option>");
    expect(html).not.toContain(">100 ml</option>");
    expect(html).toContain("Multiply the content");
    expect(html).toContain("the content is the pack&#x27;s total");
  });

  it("explains that every market compares per kg or l, and offers 100 g only where a market's rule allows it", () => {
    const html = renderFields(variant());
    expect(html).toContain("compared per kg or l in every market");
    expect(html).not.toContain("allows it");
    const restore = allowSmallBase("NO");
    try {
      const open = renderFields(variant());
      expect(open).toContain(">100 g</option>");
      expect(open).toContain("only in the markets whose country&#x27;s rule allows it");
    } finally {
      restore();
    }
  });

  it("keeps a chosen 100 g visible, and says it is not shown in the owner's markets", () => {
    const html = renderFields(variant({ measure: { amount: "250", unit: "g", base: "100g" } }));
    expect(html).toContain("100 g (not shown in your markets: they compare per kg)");
  });

  it("says a variant with no content has no unit price", () => {
    expect(renderFields(variant())).toContain("No content: shoppers see no price per kg or litre for this variant.");
  });

  it("shows the live preview of every market with a price, from the same arithmetic as the shop", () => {
    const html = flat(renderFields(variant({ measure: { amount: "250", unit: "g", base: null } })));
    expect(html).toContain("Unit price in Norway (NOK): 199,60 kr/kg");
    expect(html).toContain("Unit price in Germany (EUR): 17,40 €/kg");
    expect(html).toContain('aria-live="polite"');
  });

  it("does not offer 100 g for a content that has none (a length)", () => {
    const html = renderFields(variant({ measure: { amount: "3", unit: "m", base: null } }));
    expect(html).not.toContain(">100 g</option>");
    expect(html).not.toContain("compared per kg or l in every market");
  });

  it("holds the preview's words in the admin's tokens, never a fixed colour", () => {
    const html = renderFields(variant({ measure: { amount: "250", unit: "g", base: null } }));
    expect(html).toContain("border-border");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it("lists nothing for an empty preview", () => {
    expect(renderToString(createElement(ContentPreviewList, { previews: [] }))).toBe("");
  });
});

const state = (change: Partial<ContentState> = {}): ContentState => ({ need: { required: false }, problems: [], pending: [], nudge: null, ...change });
const renderMeasure = (checked: boolean, s: ContentState) => renderToString(createElement(SoldByMeasureField, { checked, onChange: () => {}, state: s }));

describe("the product's 'sold by measure' choice", () => {
  it("is a checkbox with what it does", () => {
    const html = renderMeasure(false, state());
    expect(html).toContain("Sold by measure: every variant needs its content");
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("checked");
    expect(renderMeasure(true, state())).toContain('checked=""');
  });

  it("nudges food while nothing is required, and never refuses on a nudge", () => {
    const html = renderMeasure(false, state({ nudge: "Food is usually sold with a price per kg or litre. Add the content of each variant." }));
    expect(html).toContain("Food is usually sold with a price per kg or litre.");
    expect(html).not.toContain("role=\"alert\"");
  });

  it("names the marked category that asks for it", () => {
    const html = renderMeasure(false, state({ need: { required: true, reason: "category", category: "Food" } }));
    expect(html).toContain("Its category Food needs a price per kg or litre");
  });

  it("lists what is missing as an alert, and for a draft what it will need once published, as a hint", () => {
    const problems = [{ code: "unit_price.measure_required" as const, sku: "KAFFE-250", message: "Add the content of Kaffe 250 g (SKU KAFFE-250): this product needs a price per kg or litre because it is sold by measure." }];
    const on = renderMeasure(true, state({ need: { required: true, reason: "flag" }, problems }));
    expect(on).toContain('role="alert"');
    expect(on).toContain("This product cannot be saved yet:");
    expect(on).toContain("Add the content of Kaffe 250 g (SKU KAFFE-250)");
    expect(on).not.toContain("Before you publish");
    const draft = renderMeasure(true, state({ need: { required: true, reason: "flag" }, pending: problems }));
    expect(draft).toContain('role="status"');
    expect(draft).toContain("Before you publish this product:");
    expect(draft).toContain("Add the content of Kaffe 250 g (SKU KAFFE-250)");
    expect(draft).not.toContain('role="alert"');
  });
});

const term = (id: string, name: string, requiresUnitPrice?: boolean, parentId: string | null = null): Term => ({
  id,
  kind: "category",
  name,
  slug: name.toLowerCase(),
  parentId,
  ...(requiresUnitPrice === undefined ? {} : { requiresUnitPrice }),
});
const actions = { create: async () => ({ ok: false as const, problems: [] }), update: async () => ({ ok: false as const, problems: [] }), remove: async () => ({ ok: false as const, problems: [] }) };

describe("the categories screen", () => {
  const initial = [term("a", "Food", true), term("b", "Gifts", false), term("c", "Coffee", false, "a")];

  it("says on a marked category how many products still have no content, and links to them", () => {
    const html = renderToString(
      createElement(TermsManager, { initial, actions, usedBy: "products", unitPrice: { gaps: { a: 2 }, needsHref: "/admin/s/products?needs=unit-price" } }),
    );
    expect(html).toContain("Needs a price per kg or litre.");
    expect(html).toContain("2 active products in this category have no content yet.");
    expect(html).toContain('href="/admin/s/products?needs=unit-price"');
    expect(html).toContain("Show them");
    // Only the marked category says it; the others do not.
    expect(html.match(/Needs a price per kg or litre\./g)).toHaveLength(1);
  });

  it("says nothing of it where the screen does not offer the mark (pages, articles, tags)", () => {
    const html = renderToString(createElement(TermsManager, { initial, actions, usedBy: "pages" }));
    expect(html).not.toContain("price per kg or litre");
  });

  it("offers the mark when a new category is added, for categories only", () => {
    const html = renderToString(
      createElement(TermsManager, { initial, actions, usedBy: "products", unitPrice: { gaps: {}, needsHref: "/x" } }),
    );
    // One checkbox on the new-category form; the tags section has none.
    expect(html.match(/Products in this category need a price per kg or litre/g)).toHaveLength(1);
  });

  it("says every active product has its content when none lacks it", () => {
    const html = renderToString(
      createElement(TermsManager, { initial, actions, usedBy: "products", unitPrice: { gaps: { a: 0 }, needsHref: "/x" } }),
    );
    expect(html).toContain("Every active product in this category has its content.");
    expect(html).not.toContain("Show them");
  });
});

describe("the products page's unit price notice and list", () => {
  it("is silent when nothing needs content", () => {
    expect(renderToString(createElement(NeedsContentNotice, { count: 0, href: "/x" }))).toBe("");
  });

  it("counts the products and links to the filter", () => {
    const html = renderToString(createElement(NeedsContentNotice, { count: 3, href: "/admin/s/products?needs=unit-price" }));
    expect(html).toContain("3 active products still need their content for the price per kg or litre.");
    expect(html).toContain('href="/admin/s/products?needs=unit-price"');
    expect(html).toContain('role="status"');
  });

  it("lists each product with its reason and the variants that lack content, linking to its editor", () => {
    const html = renderToString(
      createElement(NeedsContentList, {
        base: "/admin/s/products",
        products: [
          { productId: "p1", handle: "kaffe", title: "Kaffe", reason: { kind: "flag" }, skus: ["K-250", "K-500"] },
          { productId: "p2", handle: "te", title: "Te", reason: { kind: "category", category: "Food" }, skus: ["T-1"] },
        ],
      }),
    );
    expect(html).toContain('href="/admin/s/products/p1"');
    expect(html).toContain("Sold by measure");
    expect(html).toContain("Category Food");
    expect(html).toContain("K-250, K-500");
    expect(html).toContain("stay on sale");
  });

  it("says so when the list is empty", () => {
    expect(renderToString(createElement(NeedsContentList, { products: [], base: "/x" }))).toContain("No product needs content for the unit price.");
  });
});
