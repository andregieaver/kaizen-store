/**
 * The discount staff gave on a draft order (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1), as its own row under the name staff gave it: it is part of the order's discount in the database but is
 * left out of `OrderView.discountMinor` (as bonus credits are), so the order page, My account and the pay page draw it here. The label is staff's own text, drawn as text. Nothing for an order without one.
 */
export function StaffDiscountRow({
  order,
  fallback,
  money,
}: {
  order: { staffDiscountMinor: number; staffDiscountLabel: string | null };
  /** The words for a discount when staff gave it no name (`m.discount`). */
  fallback: string;
  money: (minor: number) => string;
}) {
  if (!(order.staffDiscountMinor > 0)) return null;
  return (
    <div className="flex justify-between gap-4" data-staff-discount>
      <dt>{order.staffDiscountLabel ?? fallback}</dt>
      <dd>−{money(order.staffDiscountMinor)}</dd>
    </div>
  );
}
