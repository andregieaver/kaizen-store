/**
 * What Kaizena Flow itself sold (C3 of `docs/platform-parity-plan.md`, D507). Pure: a paid invoice of its own Stripe account as a sale (what
 * it was, before VAT, its VAT and its total, when it was paid), and a year's sales by month and currency, each kind apart, with the VAT
 * charged and what credit notes gave back.
 */

export const PLATFORM_SALE_KINDS = ["plan", "theme", "domain", "other"] as const;
export type PlatformSaleKind = (typeof PLATFORM_SALE_KINDS)[number];

/** The parts of a Stripe invoice a sale is read from. */
export type InvoiceLike = {
  id: string;
  number?: string | null;
  currency: string;
  total: number;
  subtotal: number;
  total_excluding_tax?: number | null;
  created: number;
  status_transitions?: { paid_at?: number | null } | null;
  metadata?: Record<string, string> | null;
  parent?: { type?: string | null } | null;
};

export type PlatformSale = {
  stripeInvoiceId: string;
  number: string | null;
  kind: PlatformSaleKind;
  currency: string;
  netMinor: number;
  vatMinor: number;
  totalMinor: number;
  paidAt: string;
};

/**
 * What an invoice sold: a premium theme or a domain by the purchase it names (`kaizen_theme_purchase`, `kaizen_domain_purchase`), a plan
 * when a subscription made it, else other; before VAT as Stripe says (`total_excluding_tax`, its subtotal for an older invoice), the VAT the
 * rest. None for an invoice that charged nothing.
 */
export function saleOf(invoice: InvoiceLike): PlatformSale | null {
  if (!invoice.id || !Number.isSafeInteger(invoice.total) || invoice.total <= 0) return null;
  const kind: PlatformSaleKind = invoice.metadata?.kaizen_theme_purchase
    ? "theme"
    : invoice.metadata?.kaizen_domain_purchase
      ? "domain"
      : invoice.parent?.type === "subscription_details"
        ? "plan"
        : "other";
  const before = invoice.total_excluding_tax ?? invoice.subtotal;
  const net = Number.isSafeInteger(before) ? Math.min(Math.max(before, 0), invoice.total) : invoice.total;
  const paid = invoice.status_transitions?.paid_at ?? invoice.created;
  return {
    stripeInvoiceId: invoice.id,
    number: invoice.number?.trim() ? invoice.number.trim().slice(0, 60) : null,
    kind,
    currency: invoice.currency.toUpperCase(),
    netMinor: net,
    vatMinor: invoice.total - net,
    totalMinor: invoice.total,
    paidAt: new Date(paid * 1000).toISOString(),
  };
}

export type SaleRow = { month: string; kind: PlatformSaleKind; currency: string; netMinor: number; vatMinor: number; totalMinor: number; creditedMinor: number };

export type SalesMonth = { month: string; currency: string; byKind: Record<PlatformSaleKind, number>; vat: number; total: number; credited: number };

/**
 * A year's sales by month and currency (months with none left out), each kind before VAT, the VAT charged, the total paid and what credit
 * notes gave back; and the year's totals per currency. Amounts in different currencies are never added together.
 */
export function salesByMonth(rows: readonly SaleRow[]): { months: SalesMonth[]; totals: SalesMonth[] } {
  const empty = (month: string, currency: string): SalesMonth => ({ month, currency, byKind: { plan: 0, theme: 0, domain: 0, other: 0 }, vat: 0, total: 0, credited: 0 });
  const months = new Map<string, SalesMonth>();
  const totals = new Map<string, SalesMonth>();
  for (const r of rows) {
    for (const [map, key, month] of [
      [months, `${r.month}|${r.currency}`, r.month],
      [totals, r.currency, ""],
    ] as const) {
      const m = map.get(key) ?? empty(month, r.currency);
      m.byKind[r.kind] += r.netMinor;
      m.vat += r.vatMinor;
      m.total += r.totalMinor;
      m.credited += r.creditedMinor;
      map.set(key, m);
    }
  }
  const order = (a: SalesMonth, b: SalesMonth) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency);
  return { months: [...months.values()].sort(order), totals: [...totals.values()].sort(order) };
}
