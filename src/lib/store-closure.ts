/**
 * Closing a store (D171, `docs/store-closure.md`), pure: what stands in the way, what is only worth a warning, who may reopen and until when,
 * what a typed confirmation must say, and what a member may still do in a store that is not open. The database holds the steps a status may take
 * (`commerce.stores_status_rules()`) and refuses new orders (`orders_store_open()`); the service is `src/server/store-closure.ts`.
 */
import { countWords } from "./admin-fill";
import { settingsEn, type SettingsMessages } from "./admin-messages/settings.en";
import type { PermissionKey } from "./permission-keys";

/** How long the owner may reopen a store they closed. After that only the platform can. */
export const REOPEN_DAYS = 30;

export type StoreStatus = "active" | "suspended" | "closed";

/** What a store still has open, counted by the database (`storeObligations()`). */
export type Obligations = {
  /** Paid orders with goods still to send. */
  paidUnshipped: number;
  /** Subscriptions that are live (active, past due or paused): customers expect their next delivery. */
  runningSubscriptions: number;
  /** Weekly delivery lists that are live. */
  runningDeliveries: number;
  /** Orders waiting for payment: closing cancels them. */
  openCheckouts: number;
  /** Bookings that have not happened yet. */
  futureBookings: number;
  /** Returns still being handled. */
  openReturns: number;
  /** The store has a Kaizen plan that is not cancelled: closing ends it at the end of the period it has paid for. */
  livePlan: boolean;
  /** Domains of the store's own: closing releases them. */
  domains: number;
};

export const NO_OBLIGATIONS: Obligations = {
  paidUnshipped: 0,
  runningSubscriptions: 0,
  runningDeliveries: 0,
  openCheckouts: 0,
  futureBookings: 0,
  openReturns: 0,
  livePlan: false,
  domains: 0,
};

/** The words of the closing page's sentences (D312 A8, `settings.close`); English, as the AI manager and the platform read them, unless given. */
export type ClosureWords = Pick<SettingsMessages["close"], "blockers" | "warnings">;

/** What blocks an owner from closing the store, as plain sentences: goods paid for and not sent, and customers who expect deliveries. Empty: nothing stands in the way. */
export function closureBlockers(o: Obligations, w: ClosureWords = settingsEn.close): string[] {
  const out: string[] = [];
  if (o.paidUnshipped > 0) out.push(countWords(o.paidUnshipped, w.blockers.paidUnshipped));
  if (o.runningSubscriptions > 0) out.push(countWords(o.runningSubscriptions, w.blockers.subscriptions));
  if (o.runningDeliveries > 0) out.push(countWords(o.runningDeliveries, w.blockers.deliveries));
  return out;
}

/** What is worth knowing before closing, but does not stop it. */
export function closureWarnings(o: Obligations, w: ClosureWords = settingsEn.close): string[] {
  const t = w.warnings;
  const out: string[] = [];
  if (o.openCheckouts > 0) out.push(countWords(o.openCheckouts, t.openCheckouts));
  if (o.futureBookings > 0) out.push(countWords(o.futureBookings, t.futureBookings));
  if (o.openReturns > 0) out.push(countWords(o.openReturns, t.openReturns));
  if (o.livePlan) out.push(t.livePlan);
  if (o.domains > 0) out.push(countWords(o.domains, t.domains));
  out.push(t.stripe);
  return out;
}

/** The last day the owner may reopen a store closed at `closedAt`. */
export const reopenDeadline = (closedAt: Date): Date => new Date(closedAt.getTime() + REOPEN_DAYS * 24 * 60 * 60 * 1000);

/** Whether the owner may still reopen: a closed store, within the period. A suspended store only the platform reopens; the platform may reopen a closed one at any time. */
export function ownerMayReopen(status: StoreStatus, closedAt: Date | null, now: Date): boolean {
  return status === "closed" && closedAt !== null && now.getTime() <= reopenDeadline(closedAt).getTime();
}

/** Whether what was typed is the store's address (its slug): trimmed, case ignored. */
export const confirmationMatches = (typed: string, slug: string): boolean => typed.trim().toLowerCase() === slug.toLowerCase() && slug.length > 0;

/** The longest reason a platform admin may give, and the shortest that says anything. */
export const REASON_MAX = 500;
export const REASON_MIN = 5;

/** A reason as typed, trimmed and checked, or null. */
export function cleanReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length >= REASON_MIN && text.length <= REASON_MAX ? text : null;
}

/**
 * What a member may still do in a store that is not open (suspended or closed): read and handle what already happened (orders, customers' data,
 * the analytics, returns are under orders) and what only the owner holds (to reopen). Nothing that sells, publishes or changes the shop. Keys are
 * the areas of `permission-keys.ts`.
 */
const WHEN_NOT_OPEN: readonly string[] = ["owner", "orders:read", "orders:write", "customers:read", "customers:write", "analytics:read", "analytics:write", "support:read", "billing:read", "staff:read"];

export const allowedWhenNotOpen = (key: PermissionKey): boolean => WHEN_NOT_OPEN.includes(key);

/** Whether a page of a store that is not open is offered in its navigation: the same keys, by the page's own key. */
export const keyAllowedWhenNotOpen = (key: PermissionKey | null): boolean => key === null || allowedWhenNotOpen(key);

/** The words for a status, as the owner and the platform read them. */
export const STATUS_WORDS: Record<StoreStatus, string> = { active: "Open", suspended: "Suspended", closed: "Closed" };
