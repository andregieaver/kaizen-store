import { formatMoney } from "./money";

/**
 * The owner's control center (D107, docs/admin-navigation.md): the pure
 * parts. What each store shows, what needs the owner first, and the change on
 * the week before; the figures themselves are counted in
 * `src/server/control-center.ts`.
 */

/** A variant with this much stock or less is running out. */
export const LOW_STOCK_AT = 3;
/** An order waiting to be sent this many days is late. */
export const LATE_TO_SEND_DAYS = 3;

export type SalesFigure = { currency: string; week: number; prior: number; orders: number; priorOrders: number };

export type StoreFigures = {
  slug: string;
  name: string;
  role: "owner" | "admin";
  suspended: boolean;
  /** The owner has finished the setup wizard. */
  open: boolean;
  plan: { name: string; status: string; endsAt: string | null; cancelling: boolean } | null;
  /** `off`: switched off; `test`/`live`: taking payments; `setup`: switched on for real payments but Stripe is not ready. */
  payments: "off" | "test" | "live" | "setup";
  sales: SalesFigure[];
  toSend: number;
  /** When the oldest order waiting to be sent was placed. */
  oldestToSend: string | null;
  lowStock: number;
  outOfStock: number;
  /**
   * What needs attention in the Work area (D122, docs/work.md 6.5), only for a store with the module on: the Work
   * overview's own items (`workOverview().attention`, worded with the store's name and pointing at its Work pages).
   */
  work?: AttentionItem[];
};

export type AttentionItem = { text: string; href: string; action: string; urgent?: boolean };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const daysSince = (iso: string, now: number) => Math.floor((now - new Date(iso).getTime()) / 86_400_000);

/** What needs the owner, across their stores, most urgent first. Staff see only what they can act on. */
export function attentionFor(stores: StoreFigures[], now = Date.now()): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of stores) {
    const base = `/admin/${s.slug}`;
    const owner = s.role === "owner";
    if (s.suspended) items.push({ text: `${s.name} is suspended, so shoppers cannot use it.`, href: base, action: "Open", urgent: true });
    if (owner && !s.open) items.push({ text: `${s.name} is not open yet.`, href: `${base}/setup`, action: "Finish setup" });
    if (owner && s.open && s.plan?.status && ["past_due", "unpaid"].includes(s.plan.status)) {
      items.push({ text: `${s.name}: the plan payment is overdue.`, href: `${base}/billing`, action: "Open billing", urgent: true });
    } else if (owner && s.open && !s.plan) {
      items.push({ text: `${s.name} has no plan yet.`, href: `${base}/billing`, action: "Choose a plan" });
    } else if (owner && s.plan?.cancelling) {
      items.push({ text: `${s.name}: the plan ends${s.plan.endsAt ? ` on ${s.plan.endsAt.slice(0, 10)}` : " at the end of the period"}.`, href: `${base}/billing`, action: "Open billing" });
    }
    if (owner && s.open && s.payments === "setup") items.push({ text: `${s.name} cannot take real payments until Stripe is set up.`, href: `${base}/settings/payments`, action: "Set up payments", urgent: true });
    else if (owner && s.open && s.payments === "off") items.push({ text: `Payments are switched off in ${s.name}.`, href: `${base}/settings/payments`, action: "Open payments" });
    if (s.toSend > 0) {
      const late = s.oldestToSend ? daysSince(s.oldestToSend, now) : 0;
      items.push({
        text: `${s.name}: ${plural(s.toSend, "order is", "orders are")} waiting to be sent${late >= 1 ? `, the oldest for ${plural(late, "day", "days")}` : ""}.`,
        href: `${base}/orders?show=to-send`,
        action: "Send",
        urgent: late >= LATE_TO_SEND_DAYS,
      });
    }
    if (s.outOfStock > 0) items.push({ text: `${s.name}: ${plural(s.outOfStock, "product is", "products are")} out of stock.`, href: `${base}/products`, action: "Open products" });
    else if (s.lowStock > 0) items.push({ text: `${s.name}: ${plural(s.lowStock, "product is", "products are")} running low.`, href: `${base}/products`, action: "Open products" });
    // Every member can open Work's pages, so staff are shown these too.
    items.push(...(s.work ?? []));
  }
  return items.sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)));
}

/** The sales of all stores added up per currency, biggest first (amounts of different currencies are never added). */
export function totalSales(stores: Pick<StoreFigures, "sales">[]): SalesFigure[] {
  const totals = new Map<string, SalesFigure>();
  for (const s of stores) {
    for (const f of s.sales) {
      const t = totals.get(f.currency) ?? { currency: f.currency, week: 0, prior: 0, orders: 0, priorOrders: 0 };
      t.week += f.week;
      t.prior += f.prior;
      t.orders += f.orders;
      t.priorOrders += f.priorOrders;
      totals.set(f.currency, t);
    }
  }
  return [...totals.values()].sort((a, b) => b.week - a.week || a.currency.localeCompare(b.currency));
}

/** The change on the week before, in words: "+12 %", "−5 %", "New" when there was nothing before, or null when both are nothing. */
export function changeText(current: number, prior: number): string | null {
  if (prior <= 0) return current > 0 ? "New this week" : null;
  const change = Math.round(((current - prior) / prior) * 100);
  if (change === 0) return "Same as the week before";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)} % on the week before`;
}

export const money = (minor: number, currency: string) => formatMoney(minor, currency, "en");
