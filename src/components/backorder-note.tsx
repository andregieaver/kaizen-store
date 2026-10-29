import type { Messages } from "@/lib/i18n";
import { releaseDate } from "@/lib/stock-words";

type Backorder = { units: number; days: number; until?: string | null } | null;

/**
 * What a cart or checkout line says when some of its units are on backorder (wave 3, D172): the units and the days the store states, in
 * the words of `m.backorder.line()` (hand-written, flagged for legal review); a pre-order (D396) says its release date instead,
 * `m.preorder.line()`. Draws nothing for a line wholly in stock.
 */
export function BackorderLine({ backorder, m, locale = "en-GB" }: { backorder: Backorder; m: Pick<Messages, "backorder" | "preorder">; locale?: string }) {
  if (!backorder) return null;
  return (
    <span className="block text-sm" data-backorder={backorder.until ? "preorder" : ""}>
      {backorder.until ? m.preorder.line(backorder.units, releaseDate(backorder.until, locale)) : m.backorder.line(backorder.units, backorder.days)}
    </span>
  );
}

/** The same on an order, a confirmation page or My account: "{n} of {quantity} on backorder: expected to ship within {days} days of your order". */
export function BackorderOrderLine({
  backorder,
  quantity,
  m,
  locale = "en-GB",
}: {
  backorder: Backorder;
  quantity: number;
  m: Pick<Messages, "backorder" | "preorder">;
  locale?: string;
}) {
  if (!backorder) return null;
  return (
    <span className="block text-sm" data-backorder={backorder.until ? "preorder" : ""}>
      {backorder.until ? m.preorder.order(backorder.units, quantity, releaseDate(backorder.until, locale)) : m.backorder.order(backorder.units, quantity, backorder.days)}
    </span>
  );
}
