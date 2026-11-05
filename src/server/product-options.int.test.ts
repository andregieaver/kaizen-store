import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/db/client";
import { productInput, type ProductInput } from "@/lib/product-input";
import { editorOptions } from "@/lib/variant-grid";

import { makeStore, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { getEditorContext, emptyProduct, getProductForEdit, saveProduct } = await import("./products");
const { getStore } = await import("./stores");

/**
 * An option value taken out in the product editor stays out after a reload (docs/audits/docs-writing-findings.md, behaviour 7): the editor
 * opens with the options of the variants that are sold (`editorOptions()`), so the switched-off ones a removed value leaves behind (kept for
 * orders and price history, and in the product file as they are) do not bring it back. The stored product is read as before.
 */

let fx: Fixture;

const variant = (sku: string, size: string, o: Record<string, unknown> = {}) => ({
  id: null,
  options: { Size: size },
  sku,
  gtin: null,
  measure: null,
  prices: { NO: "199" },
  cost: "",
  stock: 3,
  active: true,
  weightGrams: null,
  hsCode: null,
  originCountry: null,
  delivery: "physical",
  rentalPeriod: "day",
  image: null,
  ...o,
});

async function save(productId: string | null, over: Partial<ProductInput> & Record<string, unknown>): Promise<string> {
  const store = (await getStore(fx.slug))!;
  const ctx = await getEditorContext(store);
  const base = productId ? (await getProductForEdit(store, ctx, productId))! : emptyProduct(ctx);
  const saved = await saveProduct(store, ctx, productId, productInput.parse({ ...base, ...over }));
  if (!saved.ok) throw new Error(saved.problems.join(" "));
  return saved.productId;
}

async function reload(productId: string) {
  const store = (await getStore(fx.slug))!;
  return (await getProductForEdit(store, await getEditorContext(store), productId))!;
}

/** The options the editor opens with, their values sorted: their order follows the variants', which is another matter. */
const sorted = (options: { name: string; values: string[] }[]) => options.map((o) => ({ name: o.name, values: [...o.values].sort() }));
const optionsOf = async (productId: string) => {
  const product = await reload(productId);
  return sorted(editorOptions(product.options, product.variants));
};

beforeAll(async () => {
  fx = await makeStore("options");
});

afterAll(async () => {
  await closeDb();
});

describe("an option value taken out in the editor", () => {
  it("does not come back after a reload, though its variants are kept switched off", async () => {
    const id = await save(null, {
      handle: "opt-tee",
      translations: [{ locale: "nb-NO", title: "T-skjorte", description: "", safetyInformation: "", seoTitle: "", seoDescription: "" }],
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [variant("OPT-S", "S"), variant("OPT-M", "M")],
    } as never);
    expect(await optionsOf(id)).toEqual([{ name: "Size", values: ["M", "S"] }]);

    const before = await reload(id);
    await save(id, { options: [{ name: "Size", values: ["S"] }], variants: before.variants.filter((v) => v.options.Size === "S") });
    const after = await reload(id);
    expect(await optionsOf(id)).toEqual([{ name: "Size", values: ["S"] }]);
    // The M variant is still there, switched off, for its orders and price history; the stored product (what the file exports) keeps M.
    expect(sorted(after.options)).toEqual([{ name: "Size", values: ["M", "S"] }]);
    expect(after.variants.map((v) => [v.sku, v.active])).toEqual([
      ["OPT-S", true],
      ["OPT-M", false],
    ]);
  });

  it("keeps a value while any of its variants is sold", async () => {
    const id = await save(null, {
      handle: "opt-mug",
      translations: [{ locale: "nb-NO", title: "Kopp", description: "", safetyInformation: "", seoTitle: "", seoDescription: "" }],
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [variant("MUG-S", "S"), variant("MUG-M", "M", { active: false })],
    } as never);
    expect(await optionsOf(id)).toEqual([{ name: "Size", values: ["S"] }]);
    const both = await save(id, { variants: (await reload(id)).variants.map((v) => ({ ...v, active: true })), options: [{ name: "Size", values: ["S", "M"] }] });
    expect(await optionsOf(both)).toEqual([{ name: "Size", values: ["M", "S"] }]);
  });
});
