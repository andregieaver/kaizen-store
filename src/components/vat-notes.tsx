import type { VatText } from "@/lib/vat-text";

/**
 * What a cart, a checkout or an order says about its VAT beyond the amounts (D157): the reverse-charge statement with both
 * VAT numbers, the IOSS statement, and the import notice. LEGAL TEXT, hand-written (`vatText()`), unreviewed. Draws nothing
 * for an ordinary order. The buyer's number is only ever handed to this by the shopper's own cart, order page or email.
 */
export function VatNotes({
  text,
  reverseCharge,
  sellerNumber,
  buyerNumber,
  iossNumber,
  iossPaid = true,
  importNotice,
}: {
  text: VatText;
  reverseCharge: boolean;
  sellerNumber: string | null;
  buyerNumber: string | null;
  /** The store's IOSS number when the order was an IOSS sale. */
  iossNumber: string | null;
  /**
   * The order has been paid. "VAT has been collected" is only true then: an order still waiting for payment says what will
   * happen instead, with no promise about delivery. (A cancelled order is handed no IOSS number at all.)
   */
  iossPaid?: boolean;
  importNotice: boolean;
}) {
  if (!reverseCharge && !iossNumber && !importNotice) return null;
  return (
    <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm" data-vat-notes>
      {reverseCharge && (
        <>
          <p className="font-medium">{text.reverseCharge}</p>
          {sellerNumber && (
            <p className="text-muted">
              {text.sellerNumber}: {sellerNumber}
            </p>
          )}
          {buyerNumber && (
            <p className="text-muted">
              {text.buyerNumber}: {buyerNumber}
            </p>
          )}
        </>
      )}
      {iossNumber && <p>{iossPaid ? text.ioss(iossNumber) : text.iossPending(iossNumber)}</p>}
      {importNotice && <p className="text-muted">{text.importNotice}</p>}
    </div>
  );
}
