/**
 * Payment terms for company accounts (wave 4 unit F, D293, `docs/wave-4-payments.md` 8): a company may buy now and pay within 15, 30 or 60 days.
 * Who may is only `termsOffer()`; when the money is due is only `termsDueOn()`; where an order on terms stands is only `termsState()`. Pure and
 * without imports: `src/db/schema.ts` reads `PAYMENT_TERMS` for its checks, and drizzle-kit loads this file without the app's path aliases. Staff
 * words are English; the shopper's are in the message files, hand-written.
 */

export const PAYMENT_TERMS = ["net_15", "net_30", "net_60"] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];
export const isPaymentTerms = (value: unknown): value is PaymentTerms => (PAYMENT_TERMS as readonly unknown[]).includes(value);

/** The days each gives, counted from the store's day the order is placed. */
export const TERMS_DAYS: Record<PaymentTerms, number> = { net_15: 15, net_30: 30, net_60: 60 };

/** The staff words for each, on the company's page and the order's. */
export const TERMS_LABELS: Record<PaymentTerms, string> = { net_15: "15 days", net_30: "30 days", net_60: "60 days" };

/** The reminder goes this many days before the due day. */
export const REMINDER_DAYS_BEFORE = 3;

/** A day `YYYY-MM-DD` moved by `days` (calendar arithmetic on the date alone, no time zone). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const moved = new Date(Date.UTC(y!, m! - 1, d! + days));
  return moved.toISOString().slice(0, 10);
}

/** A day `YYYY-MM-DD` in words in a locale ("19 November 2026"), the same wherever the reader is (the day is a calendar day, not a moment). */
export const dayWords = (day: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

/** The day the money is due: the store's day the order is placed plus the terms' days. */
export const termsDueOn = (placedDay: string, terms: PaymentTerms): string => addDays(placedDay, TERMS_DAYS[terms]);

/**
 * Where an order on terms stands on the store's `today`: `paid` once its money arrived, `cancelled` when it was cancelled first, `overdue` after its
 * due day, `due_soon` from `REMINDER_DAYS_BEFORE` days before it, else `due`.
 */
export type TermsState = "due" | "due_soon" | "overdue" | "paid" | "cancelled";

export function termsState(input: { dueOn: string; today: string; paid: boolean; cancelled: boolean }): TermsState {
  if (input.paid) return "paid";
  if (input.cancelled) return "cancelled";
  if (input.today > input.dueOn) return "overdue";
  if (input.today >= addDays(input.dueOn, -REMINDER_DAYS_BEFORE)) return "due_soon";
  return "due";
}

/** The staff words of a state, for chips and lists. */
export const TERMS_STATE_LABELS: Record<TermsState, string> = {
  due: "Due",
  due_soon: "Due soon",
  overdue: "Overdue",
  paid: "Paid",
  cancelled: "Cancelled",
};

/** The company's side, as the server read it for the signed-in customer. */
export type TermsCompany = {
  /** The customer's role in it: only an owner or an employee buys for it. */
  role: "owner" | "employee" | null;
  active: boolean;
  terms: PaymentTerms | null;
  /** The most it may owe on terms at once, in the limit's currency; null is no limit. */
  creditLimitMinor: number | null;
};

/** What is being bought: only goods are sold on terms (no booking, subscription, deposit, weekly box or host's listing). */
export type TermsBasket = { goodsOnly: boolean; totalMinor: number };

/** Why a basket cannot be bought on terms; each is said to the shopper in their own words, or not at all where nothing is offered. */
export type TermsRefusal = "not_business" | "no_company" | "inactive" | "no_terms" | "basket" | "nothing_to_pay" | "limit" | "no_rate";

export type TermsOffer =
  | { ok: true; terms: PaymentTerms; dueOn: string; /** What the company may still owe after this order, in the limit's currency; null with no limit. */ roomMinor: number | null }
  | { ok: false; reason: TermsRefusal };

/**
 * May this basket be bought on terms? `businessOn` is the store's `business` feature with businesses among whom it sells to. `owedMinor` and
 * `orderMinor` are what the company already owes on terms and this order, both in the limit's currency (null: an amount could not be converted, so
 * the limit cannot be checked and nothing is guessed); neither is read without a limit.
 */
export function termsOffer(input: {
  businessOn: boolean;
  company: TermsCompany | null;
  basket: TermsBasket;
  today: string;
  owedMinor?: number | null;
  orderMinor?: number | null;
}): TermsOffer {
  const { company, basket } = input;
  if (!input.businessOn) return { ok: false, reason: "not_business" };
  if (!company || company.role === null) return { ok: false, reason: "no_company" };
  if (!company.active) return { ok: false, reason: "inactive" };
  if (!company.terms) return { ok: false, reason: "no_terms" };
  if (!basket.goodsOnly) return { ok: false, reason: "basket" };
  if (basket.totalMinor <= 0) return { ok: false, reason: "nothing_to_pay" };
  let roomMinor: number | null = null;
  if (company.creditLimitMinor !== null) {
    if (input.owedMinor === null || input.owedMinor === undefined || input.orderMinor === null || input.orderMinor === undefined) {
      return { ok: false, reason: "no_rate" };
    }
    roomMinor = company.creditLimitMinor - input.owedMinor - input.orderMinor;
    if (roomMinor < 0) return { ok: false, reason: "limit" };
  }
  return { ok: true, terms: company.terms, dueOn: termsDueOn(input.today, company.terms), roomMinor };
}

/** The staff sentence for a refusal, on the order list's help and the AI manager's answers. */
export const TERMS_REFUSAL_WORDS: Record<TermsRefusal, string> = {
  not_business: "The store does not sell to businesses.",
  no_company: "The customer is not signed in as a member of a company.",
  inactive: "The company is switched off.",
  no_terms: "The company has no payment terms.",
  basket: "Only goods are sold on terms: not bookings, subscriptions, deposits, weekly boxes or hosts' listings.",
  nothing_to_pay: "There is nothing to pay.",
  limit: "The order would take the company past its credit limit.",
  no_rate: "An amount could not be converted to the credit limit's currency, so the limit cannot be checked.",
};
