/**
 * Where "Send by email" goes on an issued invoice (docs/work.md 4.7, WP7b, later). Draws nothing until then; the
 * invoice page already places it, so the email step only fills this in.
 */
export function SendInvoiceSlot(props: { storeSlug: string; invoiceId: string; clientEmail: string | null }) {
  void props;
  return null;
}
