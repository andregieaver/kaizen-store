import { countWords, fillWords } from "./admin-fill";
import type { HomeMessages } from "./admin-messages/home.en";
import { withoutStoreName } from "./home";
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
  /** Order changes whose refund failed and still owe the customer money (D392), only when some do, for a member who may read orders. A count only. */
  editRefundsOwed?: number;
  /** Support conversations waiting for a person (D216, step 14), only when some do and only for a member who may read the desk. A count only. */
  supportWaiting?: number;
  /** Requests the chat assistant passed to the team, waiting for a decision (ecosystem plan E1.7). */
  supportRequests?: number;
  /** Hard limits of its plan the store has used up this month (D314), only when one is: for its owner. */
  limitsReached?: number;
  /**
   * Orders the store hands over itself (D237), only when some wait and only for a member who may read orders: paid orders to be collected at a pickup
   * place (the Orders page's *To hand over*) and local deliveries not delivered yet (*Local deliveries*). They are not in `toSend`. Counts only.
   */
  handOver?: HandOverFigures;
  /** Invoices on payment terms past their due day and not paid (D293), only when some are and only for a member who may read orders. A count only. */
  termsOverdue?: number;
  /** Reviews waiting to be checked (D301 G3), only when some do, the feature is on and the member may read products. A count only. */
  reviewsWaiting?: number;
  /**
   * The store's own books (D478), only for its owner and only when some of their documents differ from Tripletex (an entry that stands, not
   * one reversed) or have waited more than a week to be posted (a payment waiting for its payout is posted within days), or when bills wait to
   * be paid past their due day or within the week (D492, by the store's day). Counts only.
   */
  books?: { differ: number; waiting: number; billsOverdue?: number; billsDue?: number };
  /**
   * The threshold watch (D514): the books' turnover over twelve months near or just past a threshold that changes the owner's duties (the
   * law's, or their own), each already worded in the member's language; only when there is one, for a member who may read the books.
   */
  turnover?: string[];
  /** Payment disputes waiting for the store's answer (D288, D417; ecosystem plan E2.1), only when some do and only for a member who may read orders. */
  disputes?: DisputeFigures;
  /** People in the leads inbox (D475; E2.1), not yet a deal or dismissed: only while Deals (`sales`) is on, for a member who may read customers. A count only. */
  leads?: number;
  /** The AI manager's calls kept for a yes and its plans' questions (D309; E2.1), only for an owner: the Autopilot page's *Waiting for you*. A count only. */
  aiDecisions?: number;
  /** Visitors' comments on the store's articles held for a check (D341; E2.1), for a member who may read the website. A count only. */
  blogComments?: number;
  /** Calls, meetings and tasks not done that are overdue or due today (D468; E2.1), only while Deals is on, for a member who may read customers. */
  activities?: ActivityFigures;
  /** Questions the chat assistant could not answer, still open (ecosystem plan E4.3, D729), for a member who may read support. A count only. */
  unansweredQuestions?: number;
  /**
   * Flows switched on that are losing readers (D767, email plan M3.8: `LOSING`, the flow report's `space_out`), for a member who may read
   * marketing: how many, and the one's id when there is just one, so the item opens it.
   */
  flowsLosing?: { flows: number; only: string | null };
  /** Flows the flow guard switched off in the last 14 days and still off (email plan M3.9), for a member who may read marketing. */
  flowsPaused?: { flows: number; only: string | null };
};

/**
 * Payment disputes the bank waits on the store to answer (`disputeNeedsResponse()`, closed and answered ones left out): how many, the soonest
 * evidence deadline, and, when there is just the one, its order and id, so the item opens the dispute's own page.
 */
export type DisputeFigures = { waiting: number; dueBy: string | null; only: { orderId: string; disputeId: string } | null };

/**
 * Activities not done (D468): `overdue` as the *Today* card counts late (`activityWhen()`), `today` the rest due today. The member's own on
 * Home (the card's *Mine*); the whole team's (`team`) where the figures are for everyone who works the store, as in the briefing.
 */
export type ActivityFigures = { overdue: number; today: number; team?: boolean };

/** Orders to hand over (D237): to be collected (and when the oldest was placed), and local deliveries not delivered yet. */
export type HandOverFigures = { pickup: number; oldestPickupAt: string | null; local: number };

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

/**
 * What each attention item is about (ecosystem plan E2.1, D713): one name per queue, so a reader other than Home (the briefing, and push,
 * Slack and the notices bell after it) takes the items it wants by kind instead of reading the queue again.
 */
export const ATTENTION_KINDS = [
  "suspended",
  "not_open",
  "plan",
  "payments",
  "to_send",
  "pickup",
  "local",
  "withdrawals_overdue",
  "unacknowledged",
  "limits",
  "support_waiting",
  "support_requests",
  "reviews",
  "disputes",
  "ai_decisions",
  "leads",
  "activities_overdue",
  "activities_today",
  "blog_comments",
  "unanswered_questions",
  "flows_losing",
  "flows_paused",
  "books",
  "bills",
  "turnover",
  "return_requests",
  "terms_overdue",
  "drafts",
  "drafts_ending",
  "partly_sent",
  "order_changes",
  "edit_refunds_owed",
  "privacy_overdue",
  "privacy_due",
  "tax",
  "invoices",
  "tax_returns",
  "out_of_stock",
  "low_stock",
  "below_level",
  "owed",
  "work",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export type AttentionItem = { kind?: AttentionKind; text: string; href: string; action: string; urgent?: boolean };

/** An item as `attentionFor()` gives it: always with its kind. */
export type KindedAttentionItem = AttentionItem & { kind: AttentionKind };

/** One store's item said inside the store (no store name in front), typed for the readers beside Home. */
export type StoreAttentionItem = { kind: AttentionKind; text: string; href: string; action: string; urgent: boolean };

/** Whether a figure of the store is withheld from this member. */
export const hidden = (store: Pick<StoreFigures, "hides">, what: "sales" | "stock" | "plan"): boolean => Boolean(store.hides?.includes(what));

const daysSince = (iso: string, now: number) => Math.floor((now - new Date(iso).getTime()) / 86_400_000);

/** The words `attentionFor()` writes in (D312 A3): the `home` catalogue's `attention`, English unless given. */
export type AttentionWords = HomeMessages["attention"];

/** What needs the owner, across their stores, most urgent first. Staff see only what they can act on. */
export function attentionFor(stores: StoreFigures[], now = Date.now(), w: AttentionWords): KindedAttentionItem[] {
  const items: KindedAttentionItem[] = [];
  const a = w.actions;
  for (const s of stores) {
    const base = `/admin/${s.slug}`;
    const owner = s.role === "owner";
    const store = s.name;
    const say = (template: string, values: Record<string, string | number> = {}) => fillWords(template, { store, ...values });
    const count = (n: number, words: { one: string; many: string }, values: Record<string, string | number> = {}) => countWords(n, words, { store, ...values });
    const days = (n: number) => countWords(n, w.days);
    if (s.suspended) items.push({ kind: "suspended", text: say(w.suspended), href: base, action: a.open, urgent: true });
    if (owner && !s.open) items.push({ kind: "not_open", text: say(w.notOpen), href: `${base}/setup`, action: a.finishSetup });
    if (owner && s.open && s.plan?.status && ["past_due", "unpaid"].includes(s.plan.status)) {
      items.push({ kind: "plan", text: say(w.planOverdue), href: `${base}/billing`, action: a.openBilling, urgent: true });
    } else if (owner && s.open && !s.plan) {
      items.push({ kind: "plan", text: say(w.noPlan), href: `${base}/billing`, action: a.choosePlan });
    } else if (owner && s.plan?.cancelling) {
      items.push({ kind: "plan", text: s.plan.endsAt ? say(w.planEndsOn, { date: s.plan.endsAt.slice(0, 10) }) : say(w.planEnds), href: `${base}/billing`, action: a.openBilling });
    }
    if (owner && s.open && s.payments === "setup") items.push({ kind: "payments", text: say(w.stripeSetup), href: `${base}/settings/payments`, action: a.setUpPayments, urgent: true });
    else if (owner && s.open && s.payments === "off") items.push({ kind: "payments", text: say(w.paymentsOff), href: `${base}/settings/payments`, action: a.openPayments });
    if (s.toSend > 0 && !hidden(s, "sales")) {
      const late = s.oldestToSend ? daysSince(s.oldestToSend, now) : 0;
      items.push({
        kind: "to_send",
        text: count(s.toSend, w.toSend, { late: late >= 1 ? countWords(late, w.toSendLate) : "" }),
        href: `${base}/orders?show=to-send`,
        action: a.send,
        urgent: late >= LATE_TO_SEND_DAYS,
      });
    }
    // Orders handed over by the store itself (D237): not sent, so not in "waiting to be sent" above.
    const hand = s.handOver;
    if (hand && hand.pickup > 0 && !hidden(s, "sales")) {
      const age = hand.oldestPickupAt ? daysSince(hand.oldestPickupAt, now) : 0;
      items.push({
        kind: "pickup",
        text: count(hand.pickup, w.pickup, { late: age >= 1 ? countWords(age, w.pickupLate) : "" }),
        href: `${base}/orders?show=to-hand-over`,
        action: a.handOver,
      });
    }
    if (hand && hand.local > 0 && !hidden(s, "sales")) {
      items.push({ kind: "local", text: count(hand.local, w.local), href: `${base}/orders?show=local`, action: a.deliver });
    }
    // Withdrawals are a legal duty (D153): the deadline and the acknowledgement come before everything else of the store's own.
    const returns = s.returns;
    if (returns && returns.overdue > 0) {
      items.push({ kind: "withdrawals_overdue", text: count(returns.overdue, w.withdrawalsOverdue), href: `${base}/returns?overdue=1`, action: a.refund, urgent: true });
    }
    if (returns && returns.unacknowledged > 0) {
      items.push({ kind: "unacknowledged", text: count(returns.unacknowledged, w.unacknowledged), href: `${base}/returns`, action: a.sendAgain, urgent: true });
    }
    // Customers waiting in the support chat for a person (D216): urgent, since they are waiting now.
    // A limit of the plan used up (D314): adding more waits until the owner frees room or chooses more.
    if (owner && s.limitsReached && s.limitsReached > 0) {
      items.push({ kind: "limits", text: count(s.limitsReached, w.limitsReached), href: `${base}/billing`, action: a.openBilling });
    }
    if (s.supportWaiting && s.supportWaiting > 0) {
      items.push({ kind: "support_waiting", text: say(w.supportWaiting, { n: s.supportWaiting }), href: `${base}/support`, action: a.answer, urgent: true });
    }
    // A refund, a cancellation or a new address the chat assistant passed on (E1.7): the customer was told someone will decide.
    if (s.supportRequests && s.supportRequests > 0) {
      items.push({ kind: "support_requests", text: count(s.supportRequests, w.supportRequests), href: `${base}/support/requests`, action: a.openRequests });
    }
    // Reviews waiting to be checked (D301 G3): not urgent, but a buyer is waiting to see theirs shown.
    if (s.reviewsWaiting && s.reviewsWaiting > 0) {
      items.push({ kind: "reviews", text: count(s.reviewsWaiting, w.reviewsWaiting), href: `${base}/reviews?state=pending`, action: a.check });
    }
    // The queues of ecosystem plan E2.1: disputes, the AI manager's decisions, leads, the day's activities and blog comments.
    items.push(...queueItems(s, now, w));
    // The store's own books (D478): what differs from Tripletex, or waits long to be posted, is the owner's to look at with the accountant.
    if (owner && s.books && s.books.differ > 0) {
      items.push({ kind: "books", text: count(s.books.differ, w.booksDiffer), href: `${base}/settings/books`, action: a.openBooks });
    }
    if (owner && s.books && s.books.waiting > 0) {
      items.push({ kind: "books", text: count(s.books.waiting, w.booksWaiting), href: `${base}/settings/books`, action: a.openBooks });
    }
    // Bills to pay (D492): overdue first, then those falling due within the week.
    if (owner && s.books && (s.books.billsOverdue ?? 0) > 0) {
      items.push({ kind: "bills", text: count(s.books.billsOverdue ?? 0, w.billsOverdue), href: `${base}/settings/books`, action: a.openBills });
    }
    if (owner && s.books && (s.books.billsDue ?? 0) > 0) {
      items.push({ kind: "bills", text: count(s.books.billsDue ?? 0, w.billsDue), href: `${base}/settings/books`, action: a.openBills });
    }
    for (const text of s.turnover ?? []) items.push({ kind: "turnover", text: say(w.turnover, { text }), href: `${base}/settings/books`, action: a.openBooks });
    if (returns && returns.requested > 0) {
      items.push({ kind: "return_requests", text: count(returns.requested, w.returnRequests), href: `${base}/returns?status=requested`, action: a.answer });
    }
    // Invoices on payment terms not paid by their due day (D293): the customer was sent a notice; money that came outside Kaizena Flow is recorded on the order.
    if (s.termsOverdue && s.termsOverdue > 0 && !hidden(s, "sales")) {
      items.push({ kind: "terms_overdue", text: count(s.termsOverdue, w.termsOverdue), href: `${base}/orders?pay=terms_overdue`, action: a.seeOrders, urgent: true });
    }
    // Draft orders sent to a customer and not yet paid (D173): the stock they hold is released when the link ends, so the ones about to end are said apart.
    const drafts = s.drafts;
    if (drafts && drafts.waiting > 0 && !hidden(s, "sales")) {
      const age = drafts.oldestSentAt ? daysSince(drafts.oldestSentAt, now) : 0;
      items.push({
        kind: "drafts",
        text: count(drafts.waiting, w.drafts, { late: age >= 1 ? countWords(age, w.draftsLate) : "" }),
        href: `${base}/orders/drafts?status=sent`,
        action: a.openDrafts,
      });
      if (drafts.expiringSoon > 0) {
        items.push({
          kind: "drafts_ending",
          text: count(drafts.expiringSoon, w.draftsEnding, { days: days(DRAFT_EXPIRING_DAYS) }),
          href: `${base}/orders/drafts?status=sent`,
          action: a.openDrafts,
        });
      }
    }
    // Orders partly sent (D174): the rest is still to send. Not urgent by itself: the orders are among those waiting to be sent above.
    const partly = s.partlySent;
    if (partly && partly.orders > 0 && !hidden(s, "sales")) {
      const age = partly.oldestFirstParcelAt ? daysSince(partly.oldestFirstParcelAt, now) : 0;
      items.push({
        kind: "partly_sent",
        text: count(partly.orders, w.partlySent, { late: age >= 1 ? countWords(age, w.partlySentLate) : "" }),
        href: `${base}/orders?ship=partly_sent`,
        action: a.sendTheRest,
      });
    }
    // Order changes waiting for the customer's payment (D174): the order stays as it was until they pay; when the link ends the held items are released.
    const changes = s.orderChanges;
    if (changes && changes.waiting > 0 && !hidden(s, "sales")) {
      items.push({
        kind: "order_changes",
        text: count(changes.waiting, w.changes, {
          ending: changes.expiringSoon > 0 ? countWords(changes.expiringSoon, w.changesEnding, { days: days(EDIT_EXPIRING_DAYS) }) : "",
        }),
        href: `${base}/orders?ship=edit_pending`,
        action: a.openOrders,
      });
    }
    // A change's refund that failed (D392): the order reads lower and the customer has not been paid back, so it is urgent.
    if (s.editRefundsOwed && s.editRefundsOwed > 0 && !hidden(s, "sales")) {
      items.push({ kind: "edit_refunds_owed", text: count(s.editRefundsOwed, w.editRefundsOwed), href: `${base}/orders?ship=edit_refund_owed`, action: a.openOrders, urgent: true });
    }
    // A privacy request has a legal clock of one month (GDPR Art. 12(3)): overdue is urgent, due this week is a heads-up.
    const privacy = s.privacy;
    if (privacy && privacy.overdue > 0) {
      items.push({ kind: "privacy_overdue", text: count(privacy.overdue, w.privacyOverdue), href: `${base}/privacy`, action: a.answer, urgent: true });
    }
    if (privacy && privacy.dueSoon > 0) {
      items.push({ kind: "privacy_due", text: count(privacy.dueSoon, w.privacyDueSoon), href: `${base}/privacy`, action: a.openRequests });
    }
    // A VAT number nobody has checked, or an IOSS or OSS registration left half done (D157): only an owner can change them.
    if (owner && s.tax && s.tax.length > 0) {
      items.push({ kind: "tax", text: say(w.tax, { findings: s.tax.join(" ") }), href: `${base}/settings/tax`, action: a.openTax });
    }
    // Paid orders still waiting for an invoice (D159): the owner can fix what holds them (details, tax profile). Not urgent, unless a
    // reverse-charge invoice is past its legal deadline.
    if (owner && s.invoices && s.invoices.waiting > 0) {
      const overdue = s.invoices.overdue;
      items.push({
        kind: "invoices",
        text: count(s.invoices.waiting, w.invoices, { overdue: overdue > 0 ? fillWords(w.invoicesOverdue, { n: overdue }) : "" }),
        href: `${base}/invoices?tab=waiting`,
        action: a.openInvoices,
        urgent: overdue > 0,
      });
    }
    // OSS and IOSS data not yet exported, near its due date or just past it (D161): not urgent, and never a claim that a return is late.
    if (owner) {
      for (const r of s.taxReturns ?? []) items.push({ kind: "tax_returns", text: say(w.taxReturn, { text: r.text }), href: `${base}${r.path}`, action: a.openVatReport });
    }
    // Nothing of the stock is shown to a member who may not open Products.
    if (!hidden(s, "stock")) {
      if (s.outOfStock > 0) items.push({ kind: "out_of_stock", text: count(s.outOfStock, w.outOfStock), href: `${base}/products`, action: a.openProducts });
      if (s.lowStock > 0) items.push({ kind: "low_stock", text: count(s.lowStock, w.lowStock), href: `${base}/products`, action: a.openProducts });
      // The owner's own levels (D172): said apart, since the owner asked to be told, and they open the Inventory page filtered to them.
      if (s.belowLevel > 0) items.push({ kind: "below_level", text: count(s.belowLevel, w.belowLevel), href: `${base}/inventory?status=low`, action: a.openInventory });
      // Units sold that the store has not received yet: never a 0 that hides them, and not urgent by itself (the delivery time was stated at the sale).
      if (s.owedUnits > 0) items.push({ kind: "owed", text: count(s.owedUnits, w.owed), href: `${base}/inventory?status=backorder`, action: a.openInventory });
    }
    // Every member can open Work's pages, so staff are shown these too.
    items.push(...(s.work ?? []).map((item) => ({ ...item, kind: "work" as const })));
  }
  return items.sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)));
}

/** What `queueItems()` reads of a store: its name and the queues' figures (each left out where the member may not see it). */
export type QueueFigures = Pick<StoreFigures, "slug" | "name" | "role" | "disputes" | "leads" | "aiDecisions" | "blogComments" | "activities" | "unansweredQuestions" | "flowsLosing" | "flowsPaused">;

/**
 * The queues ecosystem plan E2.1 (D713) brought to Home, each with the page that acts on it: payment disputes waiting for the store's answer
 * (urgent: the bank decides without it, so the soonest deadline is said), the AI manager's decisions (an owner's), new leads, the day's
 * calls, meetings and tasks, and blog comments held for a check. A figure the member may not see is missing, so nothing is said of it.
 */
export function queueItems(s: QueueFigures, now: number, w: AttentionWords): KindedAttentionItem[] {
  const items: KindedAttentionItem[] = [];
  const a = w.actions;
  const base = `/admin/${s.slug}`;
  const count = (n: number, words: { one: string; many: string }, values: Record<string, string | number> = {}) => countWords(n, words, { store: s.name, ...values });
  const disputes = s.disputes;
  if (disputes && disputes.waiting > 0) {
    // Whole days left, rounded up (due tomorrow morning is "within 1 day"); a deadline already past is not said, as the provider closes it.
    const left = disputes.dueBy ? Math.ceil((Date.parse(disputes.dueBy) - now) / 86_400_000) : 0;
    const due = left > 0 ? countWords(left, disputes.waiting === 1 ? w.disputeDue : w.disputesFirstDue) : "";
    const only = disputes.waiting === 1 ? disputes.only : null;
    items.push({
      kind: "disputes",
      text: count(disputes.waiting, w.disputes, { due }),
      href: only ? `${base}/orders/${only.orderId}/dispute/${only.disputeId}` : `${base}/orders?pay=disputed`,
      action: only ? a.answer : a.seeOrders,
      urgent: true,
    });
  }
  if (s.role === "owner" && s.aiDecisions && s.aiDecisions > 0) {
    items.push({ kind: "ai_decisions", text: count(s.aiDecisions, w.aiDecisions), href: `${base}/assistant/autopilot`, action: a.decide });
  }
  if (s.leads && s.leads > 0) items.push({ kind: "leads", text: count(s.leads, w.leads), href: `${base}/deals?view=leads`, action: a.openLeads });
  const acts = s.activities;
  if (acts) {
    // The store's Home lists them under *Today*: the member's own, or the team's where the figures are everyone's.
    const href = `${base}?today=${acts.team ? "team" : "mine"}`;
    if (acts.overdue > 0) items.push({ kind: "activities_overdue", text: count(acts.overdue, acts.team ? w.teamActivitiesOverdue : w.activitiesOverdue), href, action: a.seeToday });
    if (acts.today > 0) items.push({ kind: "activities_today", text: count(acts.today, acts.team ? w.teamActivitiesToday : w.activitiesToday), href, action: a.seeToday });
  }
  if (s.blogComments && s.blogComments > 0) {
    items.push({ kind: "blog_comments", text: count(s.blogComments, w.blogComments), href: `${base}/articles/comments?status=pending`, action: a.check });
  }
  // E4.3 (D729): what the chat assistant could not answer, for the owner to answer once in its knowledge.
  if (s.unansweredQuestions && s.unansweredQuestions > 0) {
    items.push({ kind: "unanswered_questions", text: count(s.unansweredQuestions, w.unansweredQuestions), href: `${base}/chat/questions`, action: a.answer });
  }
  // M3.8 (D767): a flow whose readers leave the list on the way; its page says what to change.
  const losing = s.flowsLosing;
  if (losing && losing.flows > 0) {
    items.push({
      kind: "flows_losing",
      text: count(losing.flows, w.flowsLosing),
      href: losing.only ? `${base}/flows/${losing.only}` : `${base}/flows`,
      action: a.seeFlow,
    });
  }
  // M3.9: a flow the guard switched off because readers left after its emails; urgent, as its readers stopped getting it.
  const paused = s.flowsPaused;
  if (paused && paused.flows > 0) {
    items.push({
      kind: "flows_paused",
      text: count(paused.flows, w.flowsPaused),
      href: paused.only ? `${base}/flows/${paused.only}` : `${base}/flows`,
      action: a.seeFlow,
      urgent: true,
    });
  }
  return items;
}

/**
 * One store's items as said inside it (D454 N9: no store name in front), most urgent first, `urgent` always a yes or a no: what
 * `src/server/attention.ts` gives the readers beside Home. Only the queues of E2.1 for now; their figures as `queueItems()` reads them.
 */
export function storeAttentionItems(s: QueueFigures, now: number, w: AttentionWords): StoreAttentionItem[] {
  return queueItems(s, now, w)
    .sort((x, y) => Number(Boolean(y.urgent)) - Number(Boolean(x.urgent)))
    .map((item) => ({ kind: item.kind, text: withoutStoreName(item.text, s.name), href: item.href, action: item.action, urgent: Boolean(item.urgent) }));
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
export function changeText(current: number, prior: number, w: HomeMessages["common"]): string | null {
  if (prior <= 0) return current > 0 ? w.newThisWeek : null;
  const change = Math.round(((current - prior) / prior) * 100);
  if (change === 0) return w.sameAsBefore;
  return fillWords(w.change, { sign: change > 0 ? "+" : "−", n: Math.abs(change) });
}

/** An amount as the admin shows it, in a language's own number format (`ADMIN_LANG_FACTS[lang].locale`), English unless given. */
export const money = (minor: number, currency: string, locale = "en") => formatMoney(minor, currency, locale);
