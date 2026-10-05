import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import type { BatchSummary } from "@/server/bulk-edit";

import { BulkFailures, BulkResult, RecentBatches } from "./bulk-result";
import { ProductsGrid, type GridRowView } from "./products-grid";
import { ProductsTable, type BulkTools, type ProductRowView } from "./products-bulk";

const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/ /g, " ");

const rows: ProductRowView[] = [
  { id: "p1", title: "Red shirt", status: "active", image: null, variants: 3, digitalVariants: 0, stock: 12, price: { min: 19900, max: 24900, currency: "NOK" } },
  { id: "p2", title: "<b>Gift card</b>", status: "draft", image: null, variants: 1, digitalVariants: 1, stock: 0, price: null },
];

const tools: BulkTools = {
  preview: async () => ({ ok: false, problem: "x" }),
  start: async () => ({ ok: false, problem: "x" }),
  next: async () => ({ ok: false, problem: "x" }),
  matching: async () => ({ ids: [], total: 0 }),
  undo: async () => ({ ok: false as const, problem: "x" }),
  terms: [{ id: "c1", name: "Shirts", kind: "category" }],
  markets: [{ code: "NO", name: "Norway", currency: "NOK" }],
};

const summary = (over: Partial<BatchSummary> = {}): BatchSummary => ({
  id: "b1",
  action: "price",
  createdAt: "2026-10-05T10:00:00Z",
  undoneAt: null,
  undoOf: null,
  total: 4,
  processed: 4,
  done: true,
  counts: { products: 4, changed: 2, unchanged: 1, failed: 1 },
  failures: [{ productId: "p9", handle: "old-hat", title: "Old hat", sku: "HAT-1", field: "price:NO", reason: "The price cannot be below 0." }],
  undoable: true,
  ...over,
});

describe("the products list", () => {
  it("is the plain list, with no tick boxes, for a member who cannot change products", () => {
    const out = html(createElement(ProductsTable, { slug: "shop", rows, archived: false, priceHeader: "Price (Norway)", locale: "en-GB", bulk: null }));
    expect(out).toContain("<caption");
    expect(out).toContain("Red shirt");
    expect(out).toContain("3 variants");
    expect(out).not.toContain('type="checkbox"');
    expect(out).not.toContain("Choose all");
  });

  it("has a tick box for each product, one to choose the whole page and one to choose all matching", () => {
    const out = html(createElement(ProductsTable, { slug: "shop", rows, archived: false, priceHeader: "Price", locale: "en-GB", bulk: tools }));
    expect(out).toContain('aria-label="Choose Red shirt"');
    expect(out).toContain('aria-label="Choose all products shown"');
    expect(out).toContain("Choose all 2 listed products");
    // Nothing is chosen yet, so no bar.
    expect(out).not.toContain("Bulk actions");
  });

  it("escapes a title that is markup", () => {
    const out = renderToString(createElement(ProductsTable, { slug: "shop", rows, archived: false, priceHeader: "Price", locale: "en-GB", bulk: tools }));
    expect(out).not.toContain("<b>Gift card</b>");
    expect(out).toContain("&lt;b&gt;Gift card&lt;/b&gt;");
  });

  it("shows prices as money in the product's currency, a range for several, and digital and no-price cases", () => {
    const out = html(createElement(ProductsTable, { slug: "shop", rows, archived: false, priceHeader: "Price", locale: "en-GB", bulk: null }));
    expect(out).toMatch(/199[.,]00/);
    expect(out).toMatch(/249[.,]00/);
    expect(out).toContain("Digital");
    expect(out).toContain("No price");
  });
});

describe("a bulk result", () => {
  it("says how many products were changed, left as they were and failed, with every failure's reason", () => {
    const out = html(createElement(BulkResult, { summary: summary(), undo: async () => ({ ok: false as const, problem: "x" }) }));
    expect(out).toContain("Change price: done");
    expect(out).toContain("4 products: 2 changed, 1 left as they were, 1 failed.");
    expect(out).toContain("Old hat");
    expect(out).toContain("(HAT-1)");
    expect(out).toContain("The price cannot be below 0.");
    expect(out).toContain("Undo this change");
    expect(out).toContain("7 days");
  });

  it("offers no undo once undone or past the seven days", () => {
    expect(html(createElement(BulkResult, { summary: summary({ undoable: false }), undo: async () => ({ ok: false as const, problem: "x" }) }))).not.toContain("Undo this change");
  });

  it("lists failures only when there are some", () => {
    expect(html(createElement(BulkFailures, { failures: [] }))).toBe("");
  });

  it("lists the recent changes, Undo only for one inside the seven days", () => {
    const out = html(
      createElement(RecentBatches, {
        batches: [
          { summary: summary(), when: "5 Oct 2026, 12:00" },
          { summary: summary({ id: "b2", action: "undo", undoable: false, undoneAt: "2026-10-05T11:00:00Z" }), when: "5 Oct 2026, 11:00" },
        ],
        undo: async () => ({ ok: false as const, problem: "x" }),
      }),
    );
    expect(out).toContain("<caption");
    expect(out).toContain("Change price");
    expect(out).toContain("Undo</button>");
    expect(out.match(/Undo<\/button>/g)).toHaveLength(1);
    expect(html(createElement(RecentBatches, { batches: [], undo: async () => ({ ok: false as const, problem: "x" }) }))).toContain("No bulk changes yet.");
  });
});

describe("the grid", () => {
  const grid: GridRowView[] = [
    { productId: "p1", variantId: "v1", title: "Red shirt", handle: "red-shirt", options: "M", active: true, cells: { sku: "RS-M", stock: "4", cost: "50,00", prices: { NO: "199,00", SE: "" } } },
    { productId: "p1", variantId: "v2", title: "Red shirt", handle: "red-shirt", options: "L", active: false, cells: { sku: "RS-L", stock: "0", cost: "", prices: { NO: "199,00", SE: "" } } },
  ];
  const gridTools = { preview: async () => ({ ok: false as const, problem: "x" }), apply: async () => ({ ok: false as const, problem: "x" }), undo: async () => ({ ok: false as const, problem: "x" }) };
  const markets = [
    { code: "NO", currency: "NOK" },
    { code: "SE", currency: "SEK" },
  ];

  it("has a row for each variant and a column for SKU, each chosen market's price, stock and cost, every cell labelled", () => {
    const out = html(createElement(ProductsGrid, { rows: grid, markets, mainCurrency: "NOK", tools: gridTools, locale: "en-GB" }));
    expect(out).toContain("<caption");
    expect(out).toContain("Price NO (NOK)");
    expect(out).toContain("Price SE (SEK)");
    expect(out).toContain("Cost (NOK, excl. VAT)");
    expect(out).toContain('aria-label="SKU, Red shirt M"');
    expect(out).toContain('aria-label="Price SE, Red shirt L"');
    expect(out).toContain('value="199,00"');
    expect(out).toContain("Switched off");
  });

  it("holds Review changes until something is edited, and writes nothing from the page", () => {
    const out = html(createElement(ProductsGrid, { rows: grid, markets, mainCurrency: "NOK", tools: gridTools, locale: "en-GB" }));
    expect(out).toMatch(/<button type="button" disabled=""[^>]*>Review changes<\/button>/);
    expect(out).not.toContain("Apply");
    expect(out).toContain("a price changes only through the price history");
  });
});
