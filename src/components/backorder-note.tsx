import type { Messages } from "@/lib/i18n";

/**
 * What a cart or checkout line says when some of its units are on backorder (wave 3, D172): the units and the days the store states, in
 * the words of `m.backorder.line()` (hand-written, flagged for legal review). Draws nothing for a line wholly in stock.
 */
export function BackorderLine({ backorder, m }: { backorder: { units: number; days: number } | null; m: Pick<Messages, "backorder"> }) {
  if (!backorder) return null;
  return (
    <span className="block text-sm" data-backorder>
      {m.backorder.line(backorder.units, backorder.days)}
    </span>
  );
}

/** The same on an order, a confirmation page or My account: "{n} of {quantity} on backorder: expected to ship within {days} days of your order". */
export function BackorderOrderLine({
  backorder,
  quantity,
  m,
}: {
  backorder: { units: number; days: number } | null;
  quantity: number;
  m: Pick<Messages, "backorder">;
}) {
  if (!backorder) return null;
  return (
    <span className="block text-sm" data-backorder>
      {m.backorder.order(backorder.units, quantity, backorder.days)}
    </span>
  );
}
