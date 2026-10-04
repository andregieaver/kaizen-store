import { PERSONAL_DATA, type ErasureAction, type PersonalEntry } from "./personal-data";
import { RETENTION_SEED, keptUntil, periodFor, type RetentionRuleRow } from "./retention";

/**
 * The erasure preview (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 step 1 and 2.4), pure: what erasing a person does to every register
 * entry that has data about them, in counts and sentences, before anything is changed. The server (`planErasure()`) counts the rows and
 * lists the orders; this module decides, so the preview and the real run (`eraseSubject()`) cannot disagree: the real run asks the database
 * the same question (`commerce.anonymise_order()` restricts a sale whose day has not come and anonymises the rest), and a test holds them
 * equal. Only counts and dates are ever written down from a plan (`summarisePlan()`), never a value.
 */

export type PlanAction = "deleted" | "anonymised" | "restricted" | "kept";

/** What an order is for the schedule (`commerce.order_class()`): history copied from another store, never paid, or a sale. */
export type PlanOrderClass = "copied" | "unpaid" | "sale";

export type PlanOrder = {
  id: string;
  class: PlanOrderClass;
  /** The sale's anchor day (`commerce.order_anchor()`), `YYYY-MM-DD` in the store's time zone. */
  anchorDay: string;
  /** A host's order has its own retention kind. */
  host: boolean;
  currency: string;
  totalMinor: number;
};

export type PlanWarningKind = "staff_account" | "host" | "work_client" | "company_main" | "copies_in_other_stores" | "copied_orders_elsewhere";

export const PLAN_WARNING_TEXT: Record<PlanWarningKind, string> = {
  staff_account: "This email is also a staff or owner account of the store. The account is not touched.",
  host: "This email is also a host of the store. The host is another subject and is not touched.",
  work_client: "This person is a client in the owner's Work area (the owner's own accounting). Nothing there is touched.",
  company_main: "This person is the main account of a company. The company stays with its other members and has no owner until staff promote another.",
  copies_in_other_stores: "Copies of this customer exist in other stores of the same owner. They are separate and are not erased here.",
  copied_orders_elsewhere: "Orders copied from this store to other stores are history there. They are not erased here.",
};

export type PlanRow = {
  /** A register table, or `orders` split by what happens to each. */
  table: string;
  label: string;
  count: number;
  action: PlanAction;
  /** One sentence, from the register. */
  reason: string;
  /** For restricted rows: the first and last day the data may go, `YYYY-MM-DD`. */
  keptUntil?: { first: string; last: string };
};

export type MoneyByCurrency = { currency: string; amountMinor: number; count?: number };

export type ErasurePlan = {
  subject: { kind: "account" | "guest"; customerId: string | null; hasEmail: boolean };
  rows: PlanRow[];
  /** What else happens, beyond the rows. */
  alsoHappens: {
    subscriptionsCancelled: number;
    savedCardsDetached: number;
    /** Credits that are forfeited, per currency (never added across currencies). */
    bonusForfeited: MoneyByCurrency[];
    /** Restricted orders' totals, per currency (never added across currencies). */
    restrictedTotals: MoneyByCurrency[];
    /** Paid orders still to be fulfilled: they continue (restricted from the person). */
    openOrders: number;
    /** Orders still waiting for payment: cancelled now, their checkout closed (an unpaid order is not a sale). */
    ordersCancelled: number;
    openReturns: number;
    emailOptOutKept: boolean;
  };
  warnings: PlanWarningKind[];
};

export type PlanInput = {
  subject: ErasurePlan["subject"];
  /** Row counts per register table (`customers`, `wishlists`, `email_messages`, ...), by the subject's links. Missing means zero. */
  counts: Record<string, number>;
  orders: PlanOrder[];
  country: string | null;
  /** The store's day, `YYYY-MM-DD`. */
  today: string;
  rules?: readonly RetentionRuleRow[];
  subscriptionsLive: number;
  savedCards: number;
  bonus: MoneyByCurrency[];
  openOrders: number;
  ordersCancelled: number;
  openReturns: number;
  warnings: PlanWarningKind[];
};

/** The staff screen's name of each register table (English). */
export const TABLE_LABELS: Record<string, string> = {
  customers: "Account",
  "storage:avatars": "Profile picture",
  orders: "Orders",
  order_lines: "Order lines",
  payments: "Payments",
  refunds: "Refunds",
  shipments: "Shipments",
  bookings: "Bookings",
  order_terms: "Accepted terms",
  order_events: "Order events",
  order_downloads: "Download links",
  invoices: "Invoices",
  credit_notes: "Credit notes",
  withdrawal_requests: "Withdrawals",
  returns: "Returns",
  subscriptions: "Subscriptions",
  standing_orders: "Standing lists",
  standing_deliveries: "Standing deliveries",
  customer_sessions: "Signed-in browsers",
  customer_codes: "Sign-in codes",
  customer_sign_in_links: "Sign-in links",
  wishlists: "Wishlists",
  wishlist_cart_adds: "Wishlist cart additions",
  carts: "Carts",
  delivery_quotes: "Delivery quotes",
  abandoned_checkouts: "Abandoned checkouts",
  bonus_entries: "Bonus credits",
  affiliates: "Referral code",
  affiliate_attributions: "Referral records",
  company_invites: "Company invitations",
  email_messages: "Emails sent",
  email_opt_outs: "Email opt-out",
  form_submissions: "Form submissions",
  field_values: "Custom fields",
  vat_checks: "VAT number checks",
};

export const labelOf = (table: string): string => TABLE_LABELS[table] ?? table;

const ACTION_OF: Record<Exclude<ErasureAction, "none">, PlanAction> = { delete: "deleted", anonymise: "anonymised", restrict: "restricted", keep: "kept" };

const entryOf = (table: string): PersonalEntry | undefined => PERSONAL_DATA.find((e) => e.table === table);

/** What hangs on an order and follows it (kept, restricted or anonymised with it): the preview shows it under the orders, not row by row. */
export const FOLDED_INTO_ORDERS: readonly string[] = ["order_lines", "payments", "refunds", "shipments", "bookings", "order_terms", "order_events", "order_downloads", "order_terms"];

/** Tables the preview shows a row for: the subject's own data, with an action. The rest (not personal, or kept untouched) are not listed. */
export const PLAN_TABLES: readonly string[] = PERSONAL_DATA.filter((e) => e.subject === "shopper" && e.erasure !== "none" && e.export !== null && !FOLDED_INTO_ORDERS.includes(e.table))
  .map((e) => e.table)
  .concat(["customer_sessions", "customer_codes", "customer_sign_in_links", "checkout_accounts", "storage:avatars"])
  .filter((t, i, all) => all.indexOf(t) === i);

/** The first day the personal data of an order of this class may go, in the seller's country's period (the day the schedule would anonymise it). */
export function orderDueOn(order: PlanOrder, country: string | null, today: string, rules: readonly RetentionRuleRow[] = RETENTION_SEED): string {
  if (order.class !== "sale") return order.anchorDay; // anonymised at once (copied: history; unpaid: not a sale)
  const kind = order.host ? "host_bookkeeping" : "bookkeeping";
  return keptUntil(order.anchorDay, periodFor(kind, country, today, rules));
}

const addMoney = (list: MoneyByCurrency[], currency: string, amountMinor: number): MoneyByCurrency[] => {
  const hit = list.find((m) => m.currency === currency);
  if (hit) {
    hit.amountMinor += amountMinor;
    hit.count = (hit.count ?? 0) + 1;
  } else list.push({ currency, amountMinor, count: 1 });
  return list;
};

/** The preview: one row per register entry that has data for the subject, then orders split by what happens to each. */
export function buildPlan(input: PlanInput): ErasurePlan {
  const rows: PlanRow[] = [];
  const rules = input.rules ?? RETENTION_SEED;

  // Orders: a sale whose period has not ended is restricted; everything else is anonymised now.
  const restricted: { order: PlanOrder; due: string }[] = [];
  const anonymised: PlanOrder[] = [];
  for (const order of input.orders) {
    const due = orderDueOn(order, input.country, input.today, rules);
    if (order.class === "sale" && due > input.today) restricted.push({ order, due });
    else anonymised.push(order);
  }
  const orders = entryOf("orders");
  if (restricted.length > 0) {
    const dues = restricted.map((r) => r.due).sort();
    rows.push({
      table: "orders",
      label: "Orders kept for the bookkeeping rules",
      count: restricted.length,
      action: "restricted",
      reason: orders?.reason ?? "",
      keptUntil: { first: dues[0], last: dues[dues.length - 1] },
    });
  }
  if (anonymised.length > 0) {
    rows.push({
      table: "orders",
      label: "Orders made anonymous now",
      count: anonymised.length,
      action: "anonymised",
      reason: "An order that was never paid, one copied from another store, or a sale whose bookkeeping period is over has its name, address and email replaced by a marker.",
    });
  }

  for (const table of PLAN_TABLES) {
    if (table === "orders") continue;
    const entry = entryOf(table);
    if (!entry || entry.erasure === "none") continue;
    // Documents and what hangs on an order are restricted or kept with it: shown once, under the orders, only when orders exist.
    const count = input.counts[table] ?? 0;
    if (count <= 0) continue;
    const row: PlanRow = { table, label: labelOf(table), count, action: ACTION_OF[entry.erasure], reason: entry.reason };
    if (entry.erasure === "restrict" && restricted.length > 0) {
      const dues = restricted.map((r) => r.due).sort();
      row.keptUntil = { first: dues[0], last: dues[dues.length - 1] };
    }
    rows.push(row);
  }

  const restrictedTotals: MoneyByCurrency[] = [];
  for (const { order } of restricted) addMoney(restrictedTotals, order.currency, order.totalMinor);

  return {
    subject: input.subject,
    rows,
    alsoHappens: {
      subscriptionsCancelled: input.subscriptionsLive,
      savedCardsDetached: input.savedCards,
      bonusForfeited: input.bonus.filter((b) => b.amountMinor > 0),
      restrictedTotals,
      openOrders: input.openOrders,
      ordersCancelled: input.ordersCancelled,
      openReturns: input.openReturns,
      emailOptOutKept: (input.counts.email_opt_outs ?? 0) > 0,
    },
    warnings: input.warnings,
  };
}

/** Nothing about this person is held (the request can be closed as "no data held"). */
export const isEmptyPlan = (plan: ErasurePlan): boolean => plan.rows.length === 0 && plan.alsoHappens.subscriptionsCancelled === 0 && plan.alsoHappens.savedCardsDetached === 0;

/** What the request row keeps of a plan: counts per table and action, the dates as a range, never a value, an amount or an address. */
export type PlanSummary = {
  rows: { table: string; action: PlanAction; count: number }[];
  keptUntil: { first: string; last: string } | null;
  subscriptionsCancelled: number;
  savedCardsDetached: number;
  warnings: PlanWarningKind[];
};

export function summarisePlan(plan: ErasurePlan): PlanSummary {
  const ranges = plan.rows.map((r) => r.keptUntil).filter((r): r is { first: string; last: string } => !!r);
  const firsts = ranges.map((r) => r.first).sort();
  const lasts = ranges.map((r) => r.last).sort();
  return {
    rows: plan.rows.map((r) => ({ table: r.table, action: r.action, count: r.count })),
    keptUntil: ranges.length > 0 ? { first: firsts[0], last: lasts[lasts.length - 1] } : null,
    subscriptionsCancelled: plan.alsoHappens.subscriptionsCancelled,
    savedCardsDetached: plan.alsoHappens.savedCardsDetached,
    warnings: plan.warnings,
  };
}

/** The one-line count the customer page shows next to the Privacy card: "3 orders, 2 emails". */
export function countsLine(counts: Record<string, number>, sections: { key: string; label: string }[]): string {
  return sections
    .map((s) => ({ ...s, n: counts[s.key] ?? 0 }))
    .filter((s) => s.n > 0)
    .map((s) => `${s.n} ${s.label}`)
    .join(", ");
}
