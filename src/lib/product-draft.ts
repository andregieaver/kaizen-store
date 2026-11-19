/**
 * The product editor's draft kept in the browser (code review 1.16, D787, `src/lib/browser-draft.ts`): what it holds, the saved version
 * a draft is made from, and the stock a restored draft shows.
 */
import type { FieldData } from "./custom-fields";
import type { ProductInput } from "./product-input";
import { canonical, fingerprint } from "./browser-draft";

/** What the product editor keeps in the browser: the product, its custom fields and its variants' fields, and whether its address was typed. */
export type ProductDraft = { product: ProductInput; fieldData: FieldData; variantData: Record<string, FieldData>; handleTouched: boolean };

/** A product as far as its stock goes: each variant's count, and with several locations the count at each (`ProductInput`). */
type Stocked = { variants: { id: string | null; stock: number; locationStock?: ProductInput["variants"][number]["locationStock"] }[] };

/**
 * The saved product a draft is made from, as a stamp: everything the editor saves but the stock, which sales change while the editor is
 * closed. Anything else saved since (a price, a text, a field) makes it another version, and the draft is dropped.
 */
export function productDraftBase(product: Stocked, fieldData: FieldData, variantData: Record<string, FieldData>): string {
  const withoutStock = { ...product, variants: product.variants.map((variant) => ({ ...variant, stock: 0, locationStock: undefined })) };
  return fingerprint(canonical([withoutStock, fieldData, variantData]));
}

/** A restored draft's product with each saved variant's stock as it stands now: a draft never brings back a count from before a sale. */
export function withSavedStock<P extends Stocked>(draft: P, saved: Stocked): P {
  const now = new Map(saved.variants.flatMap((variant) => (variant.id ? [[variant.id, variant] as const] : [])));
  return {
    ...draft,
    variants: draft.variants.map((variant) => {
      const counted = variant.id ? now.get(variant.id) : undefined;
      return counted ? { ...variant, stock: counted.stock, locationStock: counted.locationStock } : variant;
    }),
  };
}
