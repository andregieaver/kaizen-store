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
/** A draft order whose pay link ends within this many days is said to be expiring (D173, wave 3). */
export const DRAFT_EXPIRING_DAYS = 2;
/** An order change waiting for the customer's payment whose pay link ends within this many days is said to be ending (D174, wave 3). */
export const EDIT_EXPIRING_DAYS = 2;

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
  /** Variants with no warning level of their own that have 1 to `LOW_STOCK_AT` left: a variant that is gone is out, not low (D172; it used to be counted in both). */
  lowStock: number;
  /** Variants that cannot be sold: stock stops at zero (`deny`) and none is left over the active locations. A variant that sells on backorder is not out. */
  outOfStock: number;
  /** Variants at or below the warning level their owner set (`stock_alerts` in state `low`, D172): the Inventory page's *low* count. */
  belowLevel: number;
  /** Units on backorder that paid orders still wait for (D172): what the store has to receive. */
  owedUnits: number;
  /**
   * What this member may not see of the store, from the area keys their role holds (wave 1, 1f): `sales` (sales, orders waiting to be
   * sent, the latest orders and returns), `stock`, `plan`. Left out of the figures, never shown as zero; absent for the owner.
   */
  hides?: ("sales" | "stock" | "plan")[];
  /** The store is a website (D178 step 5: the online shop off): no sales, stock or payments to show. */
  website?: boolean;
  /**
   * What needs attention in the Work area (D122, docs/work.md 6.5), only for a store with the module on: the Work
   * overview's own items (`workOverview().attention`, worded with the store's name and pointing at its Work pages).
   */
  work?: AttentionItem[];
  /**
   * What waits in Returns (D153), only when something does: withdrawals past the legal deadline for the refund, confirmed
   * withdrawals whose acknowledgement was not sent, and return requests waiting for an answer.
   */
  returns?: ReturnFigures;
  /** What is wrong with the store's tax profile (D157, `checkupFindings()`), only when something is: for its owner. */
  tax?: string[];
  /**
   * Invoices (D159), only when something waits and only for the owner: paid orders still without an invoice, and how many of them are
   * reverse-charge ones past the deadline (the 15th of the month after payment, Directive Art. 222).
   */
  invoices?: InvoiceFigures;
  /**
   * OSS and IOSS returns whose data was not exported (D161, `returnsDue()`), only when there are some and only for the owner. Each says
   * what is known (the period has ended, the due date is near or past, no export was made here) and never that a return is late.
   */
  taxReturns?: { text: string; path: string }[];
  /**
   * Privacy requests waiting (D162, wave 1g), only when one is overdue or due this week, and only for a member who may open the
   * Privacy requests page (`customers:read`): counts, never a name or an email.
   */
  privacy?: PrivacyFigures;
  /** Draft orders waiting for payment (D173), only when some do and only for a member who may read orders (`sales` is not in `hides`). */
  drafts?: DraftFigures;
  /**
   * Orders partly sent (D174): paid orders with a parcel and units still to send, only when there are some and only for a member who may read orders
   * (`sales` is not in `hides`). Counts only, never a customer.
   */
  partlySent?: PartlySentFigures;
  /** Order changes waiting for the customer's payment (D174), only when some do and only for a member who may read orders. Counts only. */
  orderChanges?: OrderChangeFigures;
};

/** Paid orders partly sent (D174): how many, and when the oldest one's first parcel left. */
export type PartlySentFigures = { orders: number; oldestFirstParcelAt: string | null };

/** Order changes waiting for the customer's payment (D174): how many, and how many of their pay links end within `EDIT_EXPIRING_DAYS`. */
export type OrderChangeFigures = { waiting: number; expiringSoon: number };

export type InvoiceFigures = { waiting: number; overdue: number };

/**
 * Draft orders that were sent and are still unpaid (D173, wave 3), only when there are some and only for a member who may read orders: how
 * many, when the oldest was sent, and how many of their pay links end within `DRAFT_EXPIRING_DAYS`. Counts only, never a customer.
 */
export type DraftFigures = { waiting: number; oldestSentAt: string | null; expiringSoon: number };

/** Open privacy requests (D162) past their one-month deadline, or due within `DUE_SOON_DAYS`; counts only, never a person. */
export type PrivacyFigures = { overdue: number; dueSoon: number };

export type ReturnFigures = { overdue: number; unacknowledged: number; requested: number };

export type AttentionItem = { text: string; href: string; action: string; urgent?: boolean };

/** Whether a figure of the store is withheld from this member. */
export const hidden = (store: Pick<StoreFigures, "hides">, what: "sales" | "stock" | "plan"): boolean => Boolean(store.hides?.includes(what));

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
    if (s.toSend > 0 && !hidden(s, "sales")) {
      const late = s.oldestToSend ? daysSince(s.oldestToSend, now) : 0;
      items.push({
        text: `${s.name}: ${plural(s.toSend, "order is", "orders are")} waiting to be sent${late >= 1 ? `, the oldest for ${plural(late, "day", "days")}` : ""}.`,
        href: `${base}/orders?show=to-send`,
        action: "Send",
        urgent: late >= LATE_TO_SEND_DAYS,
      });
    }
    // Withdrawals are a legal duty (D153): the deadline and the acknowledgement come before everything else of the store's own.
    const returns = s.returns;
    if (returns && returns.overdue > 0) {
      items.push({
        text: `${s.name}: ${plural(returns.overdue, "withdrawal is", "withdrawals are")} past the legal deadline for the refund.`,
        href: `${base}/returns?overdue=1`,
        action: "Refund",
        urgent: true,
      });
    }
    if (returns && returns.unacknowledged > 0) {
      items.push({
        text: `${s.name}: the acknowledgement of ${plural(returns.unacknowledged, "withdrawal was", "withdrawals were")} not sent.`,
        href: `${base}/returns`,
        action: "Send again",
        urgent: true,
      });
    }
    if (returns && returns.requested > 0) {
      items.push({
        text: `${s.name}: ${plural(returns.requested, "return request is", "return requests are")} waiting for an answer.`,
        href: `${base}/returns?status=requested`,
        action: "Answer",
      });
    }
    // Draft orders sent to a customer and not yet paid (D173): the stock they hold is released when the link ends, so the ones about to end are said apart.
    const drafts = s.drafts;
    if (drafts && drafts.waiting > 0 && !hidden(s, "sales")) {
      const age = drafts.oldestSentAt ? daysSince(drafts.oldestSentAt, now) : 0;
      items.push({
        text: `${s.name}: ${plural(drafts.waiting, "draft order is", "draft orders are")} waiting for payment${age >= 1 ? `, the oldest sent ${plural(age, "day", "days")} ago` : ""}.`,
        href: `${base}/orders/drafts?status=sent`,
        action: "Open drafts",
      });
      if (drafts.expiringSoon > 0) {
        items.push({
          text: `${s.name}: the pay ${drafts.expiringSoon === 1 ? "link" : "links"} of ${plural(drafts.expiringSoon, "draft order ends", "draft orders end")} within ${plural(DRAFT_EXPIRING_DAYS, "day", "days")}, and the order is then cancelled.`,
          href: `${base}/orders/drafts?status=sent`,
          action: "Open drafts",
        });
      }
    }
    // Orders partly sent (D174): the rest is still to send. Not urgent by itself: the orders are among those waiting to be sent above.
    const partly = s.partlySent;
    if (partly && partly.orders > 0 && !hidden(s, "sales")) {
      const age = partly.oldestFirstParcelAt ? daysSince(partly.oldestFirstParcelAt, now) : 0;
      items.push({
        text: `${s.name}: ${plural(partly.orders, "order is", "orders are")} partly sent, with items still to send${age >= 1 ? `; the oldest one's first parcel left ${plural(age, "day", "days")} ago` : ""}.`,
        href: `${base}/orders?ship=partly_sent`,
        action: "Send the rest",
      });
    }
    // Order changes waiting for the customer's payment (D174): the order stays as it was until they pay; when the link ends the held items are released.
    const changes = s.orderChanges;
    if (changes && changes.waiting > 0 && !hidden(s, "sales")) {
      items.push({
        text: `${s.name}: ${plural(changes.waiting, "order change is", "order changes are")} waiting for the customer's payment${
          changes.expiringSoon > 0 ? `; ${changes.expiringSoon === 1 ? "the pay link of 1 ends" : `the pay links of ${changes.expiringSoon} end`} within ${plural(EDIT_EXPIRING_DAYS, "day", "days")}, and the order then stays as it was` : ""
        }.`,
        href: `${base}/orders?ship=edit_pending`,
        action: "Open orders",
      });
    }
    // A privacy request has a legal clock of one month (GDPR Art. 12(3)): overdue is urgent, due this week is a heads-up.
    const privacy = s.privacy;
    if (privacy && privacy.overdue > 0) {
      items.push({
        text: `${s.name}: ${plural(privacy.overdue, "privacy request is", "privacy requests are")} past the one-month deadline for an answer.`,
        href: `${base}/privacy`,
        action: "Answer",
        urgent: true,
      });
    }
    if (privacy && privacy.dueSoon > 0) {
      items.push({
        text: `${s.name}: ${plural(privacy.dueSoon, "privacy request is", "privacy requests are")} due within the week.`,
        href: `${base}/privacy`,
        action: "Open requests",
      });
    }
    // A VAT number nobody has checked, or an IOSS or OSS registration left half done (D157): only an owner can change them.
    if (owner && s.tax && s.tax.length > 0) {
      items.push({ text: `${s.name}: the tax settings need a look. ${s.tax.join(" ")}`, href: `${base}/settings/tax`, action: "Open tax settings" });
    }
    // Paid orders still waiting for an invoice (D159): the owner can fix what holds them (details, tax profile). Not urgent, unless a
    // reverse-charge invoice is past its legal deadline.
    if (owner && s.invoices && s.invoices.waiting > 0) {
      const overdue = s.invoices.overdue;
      items.push({
        text: `${s.name}: ${plural(s.invoices.waiting, "paid order is", "paid orders are")} waiting for an invoice${overdue > 0 ? `, ${overdue} of them past the deadline for a reverse-charge invoice` : ""}.`,
        href: `${base}/invoices?tab=waiting`,
        action: "Open invoices",
        urgent: overdue > 0,
      });
    }
    // OSS and IOSS data not yet exported, near its due date or just past it (D161): not urgent, and never a claim that a return is late.
    if (owner) {
      for (const r of s.taxReturns ?? []) items.push({ text: `${s.name}: ${r.text}`, href: `${base}${r.path}`, action: "Open VAT report" });
    }
    // Nothing of the stock is shown to a member who may not open Products.
    if (hidden(s, "stock")) {
      // (no stock item)
    } else {
      if (s.outOfStock > 0) items.push({ text: `${s.name}: ${plural(s.outOfStock, "product is", "products are")} out of stock.`, href: `${base}/products`, action: "Open products" });
      if (s.lowStock > 0) items.push({ text: `${s.name}: ${plural(s.lowStock, "product is", "products are")} running low.`, href: `${base}/products`, action: "Open products" });
      // The owner's own levels (D172): said apart, since the owner asked to be told, and they open the Inventory page filtered to them.
      if (s.belowLevel > 0) items.push({ text: `${s.name}: ${plural(s.belowLevel, "variant is", "variants are")} at or below the warning level you set.`, href: `${base}/inventory?status=low`, action: "Open inventory" });
      // Units sold that the store has not received yet: never a 0 that hides them, and not urgent by itself (the delivery time was stated at the sale).
      if (s.owedUnits > 0) items.push({ text: `${s.name}: ${plural(s.owedUnits, "unit is", "units are")} owed on backorder, on orders that are paid and not sent.`, href: `${base}/inventory?status=backorder`, action: "Open inventory" });
    }
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
