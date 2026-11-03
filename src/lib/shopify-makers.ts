/**
 * *Who makes your products?* (D445 step 6, `docs/moving-from-shopify.md` 4.5), pure: the copied products without a manufacturer, grouped
 * by the vendor Shopify named, so the owner says who makes them once per vendor instead of once per product. A vendor is never taken to
 * be the manufacturer: that is a legal designation (GPSR Art. 19) the owner makes by pressing *Yes*. No database.
 */
import type { VendorLine } from "./shopify-copy";

/** A product here as the screen needs it. */
export type HereProduct = { id: string; handle: string; manufacturerId: string | null; status: "draft" | "active" | "archived" };

/** One vendor's products still without a maker here, and the ones among them that were on sale in Shopify and are a draft here. */
export type MakerGroup = { vendor: string; productIds: string[]; publishIds: string[] };

/** The vendors with products still to name a maker for, most products first; a product without a vendor is in the group `""`. */
export function makerGroups(lines: readonly VendorLine[], here: readonly HereProduct[]): MakerGroup[] {
  const byHandle = new Map(here.map((p) => [p.handle, p]));
  const groups = new Map<string, MakerGroup>();
  const seen = new Set<string>();
  for (const line of lines) {
    const product = byHandle.get(line.handle);
    if (!product || product.manufacturerId !== null || product.status === "archived" || seen.has(product.id)) continue;
    seen.add(product.id);
    const group = groups.get(line.vendor) ?? { vendor: line.vendor, productIds: [], publishIds: [] };
    group.productIds.push(product.id);
    if (line.active && product.status === "draft") group.publishIds.push(product.id);
    groups.set(line.vendor, group);
  }
  return [...groups.values()].sort((a, b) => b.productIds.length - a.productIds.length || a.vendor.localeCompare(b.vendor));
}

/** Ids in pieces a bulk action takes at once. */
export function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
