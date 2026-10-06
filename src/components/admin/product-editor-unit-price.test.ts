import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }) }));
vi.mock("@/app/admin/(gated)/[store]/products/actions", () => ({
  createProductTermAction: async () => ({ ok: false, problems: [] }),
  saveProductAction: async () => ({ status: "idle" }),
  startFileUploadAction: async () => ({ ok: false }),
  uploadImageAction: async () => ({ ok: false }),
  suggestTextAction: async () => ({ ok: false }),
}));
vi.mock("@/app/admin/(gated)/[store]/fields/actions", () => ({ startFieldFileUploadAction: async () => ({ ok: false }) }));

import { productInput, type ProductInput } from "@/lib/product-input";
import type { Term } from "@/lib/taxonomy";
import type { EditorContext } from "@/server/products";

import { ProductEditor } from "./product-editor";

const flat = (html: string) => html.replace(/&nbsp;|\s| /g, " ").replace(/<!-- -->/g, "");

const food: Term = { id: "11111111-1111-4111-8111-111111111111", kind: "category", name: "Food", slug: "food", parentId: null, requiresUnitPrice: true };
const context = {
  locales: ["nb"],
  primaryLocale: "nb",
  markets: [{ code: "NO", currency: "NOK", name: "Norway", vatRates: { standard: 0.25, food: 0.15, exempt: 0 }, vatRows: { standard: true, food: true, exempt: true } }],
  vatCategories: [],
  audience: "consumers",
  mainCurrency: "NOK",
  operators: [],
  locationName: null,
  activeLocations: 1,
  terms: [food],
  bookingsOn: false,
  staff: [],
  places: [],
  hosts: [],
  layouts: [],
  aiWriting: false,
} as unknown as EditorContext;

const product = (change: Partial<ProductInput> = {}): ProductInput => ({
  ...productInput.parse({
    handle: "kaffe",
    status: "active",
    translations: [{ locale: "nb", title: "Kaffe", description: "", safetyInformation: "" }],
    media: [],
    options: [],
    variants: [{ id: null, options: {}, sku: "KAFFE-250", gtin: "", prices: { NO: "49,90" }, stock: 3, active: true, weightGrams: null, hsCode: "", originCountry: "" }],
    taxCode: "txcd_99999999",
    withdrawalExclusion: "none",
    schemes: [],
    manufacturer: null,
    responsiblePerson: null,
  }),
  ...change,
});

const render = (initial: ProductInput) =>
  flat(
    renderToString(
      createElement(ProductEditor, {
        storeSlug: "demo",
        productId: null,
        initial,
        context,
        languageNames: { nb: "Norwegian" },
        countries: [],
        uploads: false,
        storefrontPath: null,
        siteOrigin: "",
        fields: { groups: [], data: { shared: {}, locales: {} } as never, lookups: {} as never, variants: null },
      }),
    ),
  );

describe("the product editor's unit price", () => {
  it("offers a goods variant its content, inside the variant's details, with the preview", () => {
    const html = render(product({ variants: [{ ...product().variants[0], measure: { amount: "250", unit: "g", base: null } }] }));
    expect(html).toContain("Barcode, cost, weight, content and customs for");
    expect(html).toContain("Content, for the price per kg or litre");
    expect(html).toContain("Unit price in Norway (NOK): 199,60 kr/kg");
  });

  it("offers the 'sold by measure' choice beside the VAT category, checked when it is set", () => {
    const off = render(product());
    expect(off).toContain("Sold by measure: every variant needs its content");
    expect(off).not.toContain("This product cannot be saved yet");
    const on = render(product({ soldByMeasure: true }));
    expect(on).toContain("This product cannot be saved yet:");
    expect(on).toContain("Add the content of Kaffe Default (SKU KAFFE-250)");
  });

  it("names the marked category that requires content, and refuses nothing for a draft", () => {
    const required = render(product({ categories: [food.id] }));
    expect(required).toContain("Its category Food needs a price per kg or litre");
    expect(required).toContain("because its category Food is marked as needing one");
    const draft = render(product({ categories: [food.id], status: "draft" }));
    expect(draft).toContain("Before you publish this product:");
    expect(draft).not.toContain("This product cannot be saved yet");
  });

  it("nudges food and says nothing for other products", () => {
    expect(render(product({ vatCategory: "food" }))).toContain("Food is usually sold with a price per kg or litre.");
    expect(render(product())).not.toContain("Food is usually sold");
  });

  it("has no content fields for a download or an appointment", () => {
    const digital = product({ delivery: "digital", variants: [{ ...product().variants[0], delivery: "digital" }] });
    expect(render(digital)).not.toContain("Content, for the price per kg or litre");
    const booked = product({ kind: "appointment", delivery: "service", variants: [{ ...product().variants[0], delivery: "service" }] });
    const html = render(booked);
    expect(html).not.toContain("Content, for the price per kg or litre");
    expect(html).not.toContain("Sold by measure");
  });
});
