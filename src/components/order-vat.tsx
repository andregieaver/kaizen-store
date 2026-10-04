import { VatNotes } from "@/components/vat-notes";
import { IMPORT_NOTICE_REASONS, vatRowsWhenMixed } from "@/lib/order-vat";
import type { VatText } from "@/lib/vat-text";
import type { OrderView } from "@/server/orders";

/**
 * An order's VAT on the order page and in My account (D157): the row for the VAT a reverse-charge order did not charge,
 * the VAT (one row, or one per rate when the order has more than one), and under the totals the reverse-charge statement
 * with both VAT numbers or the IOSS statement. Amounts are the order's own (`order_lines.tax_minor`, `vat_relief_minor`):
 * nothing is worked out again. The buyer's number comes only from the shopper's own order page.
 */
type VatOrder = Pick<OrderView, "vatKind" | "vatReliefMinor" | "taxMinor" | "shippingVatRate" | "lines" | "vat" | "status">;

/** An order whose VAT has been collected: paid, sent or closed. Anything else (waiting for payment, cancelled) has collected nothing. */
export const vatCollected = (order: Pick<OrderView, "status">): boolean =>
  order.status === "paid" || order.status === "fulfilled" || order.status === "closed";

/** The VAT not charged, before the total (the shopper sees prices with VAT, the total is without it). */
export function OrderVatRelief({ order, text, money }: { order: VatOrder; text: VatText; money: (minor: number) => string }) {
  if (order.vatReliefMinor <= 0) return null;
  return (
    <div className="flex justify-between">
      <dt>{text.reliefRow}</dt>
      <dd>−{money(order.vatReliefMinor)}</dd>
    </div>
  );
}

/** The order's VAT, muted: "of which VAT", per rate when there are several, or with the words for reverse charge. */
export function OrderVatRows({
  order,
  text,
  money,
  label,
}: {
  order: VatOrder;
  text: VatText;
  money: (minor: number) => string;
  /** The ordinary single row's label (`m.vatAmount`). */
  label: string;
}) {
  const rows = vatRowsWhenMixed(order);
  if (rows.length > 0) {
    return (
      <>
        {rows.map((row) => (
          <div key={row.rate} className="flex justify-between text-sm text-muted">
            <dt>{text.vatAtRate(row.rate)}</dt>
            <dd>{money(row.taxMinor)}</dd>
          </div>
        ))}
      </>
    );
  }
  return (
    <div className="flex justify-between text-sm text-muted">
      <dt>{order.vatKind === "reverse_charge" ? text.vatLineReverse : label}</dt>
      <dd>{money(order.taxMinor)}</dd>
    </div>
  );
}

/**
 * What the order says under its totals: the reverse-charge statement with both numbers, the IOSS statement, the import notice.
 * The IOSS statement says the VAT *has been collected*, so it is said only of a paid order; one waiting for payment gets the
 * neutral line, and a cancelled one none.
 */
export function OrderVatNotes({ order, text }: { order: VatOrder; text: VatText }) {
  const cancelled = order.status === "cancelled";
  return (
    <VatNotes
      text={text}
      reverseCharge={order.vatKind === "reverse_charge"}
      sellerNumber={order.vat?.sellerVatNumber ?? null}
      buyerNumber={order.vat?.buyerVatNumber ?? null}
      iossNumber={order.vatKind === "ioss" && !cancelled ? (order.vat?.iossNumber ?? null) : null}
      iossPaid={vatCollected(order)}
      importNotice={order.vat !== null && IMPORT_NOTICE_REASONS.includes(order.vat.reason)}
    />
  );
}
