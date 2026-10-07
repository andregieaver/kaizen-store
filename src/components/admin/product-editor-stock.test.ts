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

import { BACKORDER_LONG_HINT } from "@/lib/inventory";
import { productInput, type ProductInput } from "@/lib/product-input";
import type { EditorContext } from "@/server/products";

import { ProductEditor } from "./product-editor";

const flat = (html: string) => html.replace(/&nbsp;|\s| /g, " ").replace(/<!-- -->/g, "");

const baseContext = {
  locales: ["nb"],
  primaryLocale: "nb",
  markets: [{ code: "NO", currency: "NOK", name: "Norway", vatRates: { standard: 0.25, food: 0.15, exempt: 0 }, vatRows: { standard: true, food: true, exempt: true } }],
  vatCategories: [],
  audience: "consumers",
  mainCurrency: "NOK",
  operators: [],
  locationName: null,
  activeLocations: 1,
  terms: [],
  appointmentsOn: false,
  staysOn: false,
  subscriptionsOn: false,
  staff: [],
  places: [],
  hosts: [],
  layouts: [],
  aiWriting: false,
} as unknown as EditorContext;
const contextWith = (change: Partial<EditorContext>): EditorContext => ({ ...baseContext, ...change });

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

const render = (initial: ProductInput, context: EditorContext = baseContext) =>
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


const shipped = (change: Record<string, unknown> = {}) => ({ ...product().variants[0], ...change });

describe("the product editor's stock rules (wave 3, D172)", () => {
  it("lets a store with one location type the stock in the row, with the stock rules under it", () => {
    const html = render(product());
    expect(html).toMatch(/<input[^>]*aria-label="Stock for/);
    expect(html).not.toContain("By location");
    expect(html).toContain("Stock rules for");
    expect(html).toContain("Keep selling when sold out");
    expect(html).toContain("Warn me when stock is at or below");
    // Not set: the days box is only there for a variant that keeps selling.
    expect(html).not.toContain("Expected to ship within (days)");
  });

  it("shows the total read-only, with a link to the Inventory page, when the store has several active locations", () => {
    const html = render(product(), contextWith({ activeLocations: 3 }));
    expect(html).not.toMatch(/<input[^>]*aria-label="Stock for/);
    expect(html).toContain("the total over the active locations");
    expect(html).toContain('href="/admin/demo/inventory?q=KAFFE-250"');
    expect(html).toContain("By location");
    expect(html).toContain("This store has several stock locations");
  });

  it("asks for the delivery time of a variant that keeps selling, and says what it means when shipping and transport may pass 30 days", () => {
    const keeps = render(product({ variants: [shipped({ stockPolicy: "continue", backorderDays: 7 }) as never] }));
    expect(keeps).toContain("keeps selling, ships within 7 days");
    expect(keeps).toContain("Expected to ship within (days)");
    expect(keeps).not.toContain(BACKORDER_LONG_HINT);
    // The 30 days run until the goods are delivered (review): 23 days to ship plus the usual transport is still inside them, 24 may not be.
    expect(render(product({ variants: [shipped({ stockPolicy: "continue", backorderDays: 23 }) as never] }))).not.toContain(BACKORDER_LONG_HINT);
    expect(render(product({ variants: [shipped({ stockPolicy: "continue", backorderDays: 24 }) as never] }))).toContain("The 30 days run until the goods are delivered, not until they are shipped.");
    const long = render(product({ variants: [shipped({ stockPolicy: "continue", backorderDays: 45 }) as never] }));
    expect(long).toContain("the customer agrees to a longer time by ordering. Say it clearly.");
  });

  it("shows the warning level in the summary", () => {
    expect(render(product({ variants: [shipped({ lowStockThreshold: 5 }) as never] }))).toContain("warns at 5 or below");
  });

  it("has no stock rules for a download or an appointment", () => {
    const digital = render(product({ delivery: "digital", variants: [shipped({ delivery: "digital" }) as never] }));
    expect(digital).not.toContain("Keep selling when sold out");
    expect(digital).not.toContain("Warn me when stock");
    const booked = render(product({ kind: "appointment", delivery: "service", variants: [shipped({ delivery: "service" }) as never] }));
    expect(booked).not.toContain("Keep selling when sold out");
  });

  it("offers a product-wide switch only when there is more than one variant that is shipped", () => {
    expect(render(product())).not.toContain("Keep selling every variant when sold out");
    const two = product({ options: [{ name: "Size", values: ["S", "M"] }], variants: [shipped({ options: { Size: "S" }, sku: "A-S" }) as never, shipped({ options: { Size: "M" }, sku: "A-M" }) as never] });
    expect(render(two)).toContain("Keep selling every variant when sold out");
  });
});
