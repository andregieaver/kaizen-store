/**
 * What the WordPress plugin's product page and cart ask and are told (D170, `docs/wordpress-plugin.md`), pure: which products may be put in a
 * cart held on another site, the lines it may hold, and the shopper's words in the market's language (the storefront's own, so the plugin
 * writes none of its own). Nothing here reads the database or a request.
 */
import { z } from "zod";

import type { Messages } from "./i18n";
import { MAX_LINE_QUANTITY } from "./cart";
import { LOW_STOCK_THRESHOLD, stockLevel, type StockLevel } from "./pricing";
import { audienceOffered, parseProductAudience, parseStoreAudience } from "./b2b";

/** Most lines one cart holds when handed over: a basket on another site is a few things, not a catalogue. */
export const CART_LINES_MAX = 30;
/** Handed-over carts a connection may make in a clock hour. */
export const HANDOFFS_PER_HOUR = 60;
/** How long a hand-over link works. */
export const HANDOFF_MINUTES = 15;
export const HANDOFF_PREFIX = "kzwh_";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A cart's lines as the plugin sends them: variants and quantities, each variant once. */
export const cartLines = z
  .array(z.object({ variant_id: z.string().regex(UUID), quantity: z.coerce.number().int().min(1).max(MAX_LINE_QUANTITY) }))
  .min(1)
  .max(CART_LINES_MAX)
  .refine((lines) => new Set(lines.map((l) => l.variant_id.toLowerCase())).size === lines.length, "A variant is in the cart once.");

export const quoteBody = z.object({ market: z.string().max(40).regex(/^[a-z0-9-]*$/i).optional(), lines: cartLines });
export const handoffBody = quoteBody.extend({ to: z.enum(["cart", "checkout"]).default("checkout") });

export type CartLineInput = { variantId: string; quantity: number };

/** Lines as the server works with them. */
export const toLines = (lines: z.output<typeof cartLines>): CartLineInput[] => lines.map((l) => ({ variantId: l.variant_id.toLowerCase(), quantity: l.quantity }));

/**
 * Whether a product may be put in a cart on another site, and if not why (the plugin then sends the shopper to the store's own page to buy
 * it). Goods that are shipped or downloaded, bought once, for anyone: an appointment, stay or rental needs a time, a subscription a plan, and
 * a product for businesses only a business buyer, all chosen on the store's page.
 */
export type NotCartable = "booking" | "subscription" | "business_only" | "service";

export function cartableReason(product: { kind: string; subscriptionOnly: boolean; audience: string }, storeAudience: string, deliveries: readonly string[]): NotCartable | null {
  if (product.kind !== "goods") return "booking";
  if (product.subscriptionOnly) return "subscription";
  // A product for one kind of buyer where the store sells to both, or one the store does not offer at all (D178: a business-only product
  // with Sell to businesses off), is never put in a cart from another site.
  if (product.audience !== "all" && (storeAudience === "both" || !audienceOffered(parseStoreAudience(storeAudience), parseProductAudience(product.audience)))) return "business_only";
  if (deliveries.some((d) => d !== "physical" && d !== "digital")) return "service";
  return null;
}

/** How much of a variant can be bought at once: the stock, or the line's most; and its level for the words. */
export function stockOf(available: number): { level: StockLevel; max: number; low: number | null } {
  const level = stockLevel(available);
  return { level, max: Math.min(MAX_LINE_QUANTITY, Math.max(0, available)), low: level === "low" ? available : null };
}

export { LOW_STOCK_THRESHOLD };

/**
 * The words the product page and the cart need, in the market's language, from the storefront's own messages (nb, sv, da and en by hand,
 * the other languages by the AI catalogue). `{n}` stands for a number the plugin fills in.
 */
export type CartLabels = {
  cart: string;
  addToCart: string;
  adding: string;
  added: string;
  capped: string;
  unavailable: string;
  tryAgain: string;
  emptyCart: string;
  quantity: string;
  remove: string;
  subtotal: string;
  shippingAtCheckout: string;
  onlyAvailable: string;
  noLongerAvailable: string;
  continueShopping: string;
  checkout: string;
  inStock: string;
  lowStock: string;
  outOfStock: string;
  soldOut: string;
  chooseOptions: string;
  description: string;
  viewInStore: string;
};

const MARK = 987654;

export function cartLabels(m: Messages, extra: { viewInStore: string }): CartLabels {
  return {
    cart: m.cart,
    addToCart: m.addToCart,
    adding: m.adding,
    added: m.added,
    capped: m.capped,
    unavailable: m.unavailable,
    tryAgain: m.tryAgain,
    emptyCart: m.emptyCart,
    quantity: m.quantity,
    remove: m.remove,
    subtotal: m.subtotal,
    shippingAtCheckout: m.shippingAtCheckout,
    onlyAvailable: m.onlyAvailable(MARK).replace(String(MARK), "{n}"),
    noLongerAvailable: m.noLongerAvailable,
    continueShopping: m.continueShopping,
    checkout: m.checkout,
    inStock: m.inStock,
    lowStock: m.lowStock(MARK).replace(String(MARK), "{n}"),
    outOfStock: m.outOfStock,
    soldOut: m.soldOut,
    chooseOptions: m.chooseVariantLabel,
    description: m.description,
    viewInStore: extra.viewInStore,
  };
}
