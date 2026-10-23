/**
 * What a payment was and its disputes (wave 4 unit A, D288, `docs/wave-4-payments.md` 3): the values Kaizena Flow keeps as the provider gave them and
 * the staff words for them. Pure, with no imports (`src/db/schema.ts` reads the lists for its checks, and drizzle-kit loads this file without the app's
 * path aliases). English, as the admin. Nothing here guesses: a value the provider did not give is *Unknown*.
 */

/** Stripe's `outcome.risk_level`, kept as given; `unknown` when Stripe gave something else. */
export const RISK_LEVELS = ["normal", "elevated", "highest", "not_assessed", "unknown"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** A risk level as Stripe gave it, or `unknown` for anything else (never a guess). */
export const riskLevelOf = (value: unknown): RiskLevel =>
  (RISK_LEVELS as readonly unknown[]).includes(value) ? (value as RiskLevel) : "unknown";

/** Whether staff are shown the risk: elevated or highest only (normal and not assessed show nothing). */
export const riskShown = (level: string | null | undefined): level is "elevated" | "highest" => level === "elevated" || level === "highest";

/** The chip's words. */
export const riskWords = (level: "elevated" | "highest"): string => (level === "highest" ? "Stripe: highest risk" : "Stripe: elevated risk");

/** Stripe's dispute statuses (`warning_*` are inquiries, which move no money). */
export const DISPUTE_STATUSES = [
  "warning_needs_response",
  "warning_under_review",
  "warning_closed",
  "needs_response",
  "under_review",
  "won",
  "lost",
  "prevented",
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const isDisputeStatus = (value: unknown): value is DisputeStatus => (DISPUTE_STATUSES as readonly unknown[]).includes(value);

/** A dispute is closed once Stripe says won, lost, prevented or an inquiry closed. */
export const disputeClosed = (status: DisputeStatus): boolean => status === "won" || status === "lost" || status === "warning_closed" || status === "prevented";

/** What a closed dispute came to: `lost` is money out; anything else closed takes nothing. Null while open. */
export function disputeOutcome(status: DisputeStatus): "won" | "lost" | null {
  if (status === "lost") return "lost";
  if (disputeClosed(status)) return "won";
  return null;
}

/** Whether the store must act: Stripe waits for evidence. */
export const disputeNeedsResponse = (status: DisputeStatus): boolean => status === "needs_response" || status === "warning_needs_response";

export const DISPUTE_STATUS_WORDS: Record<DisputeStatus, string> = {
  warning_needs_response: "Inquiry: needs a response",
  warning_under_review: "Inquiry: under review",
  warning_closed: "Inquiry closed",
  needs_response: "Needs a response",
  under_review: "Under review",
  won: "Won",
  lost: "Lost",
  prevented: "Prevented",
};

/** Stripe's dispute reasons in words; any other is shown as Stripe wrote it, spaced. */
const REASON_WORDS: Record<string, string> = {
  bank_cannot_process: "The bank cannot process it",
  check_returned: "Cheque returned",
  credit_not_processed: "The customer says a refund was not made",
  customer_initiated: "The customer started it",
  debit_not_authorized: "The customer says the debit was not authorised",
  duplicate: "The customer says they were charged twice",
  fraudulent: "The cardholder says they did not make the payment",
  general: "General",
  incorrect_account_details: "Incorrect account details",
  insufficient_funds: "Insufficient funds",
  noncompliant: "Not compliant with the card network's rules",
  product_not_received: "The customer says the goods did not arrive",
  product_unacceptable: "The customer says the goods were not as described",
  subscription_canceled: "The customer says the subscription was cancelled",
  unrecognized: "The customer does not recognise the payment",
};

export function disputeReasonWords(reason: string | null | undefined): string {
  if (!reason) return "Unknown";
  return REASON_WORDS[reason] ?? reason.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

/** Stripe's `payment_method_details.type` values with names of their own; any other is shown spaced. */
const METHOD_WORDS: Record<string, string> = {
  card: "Card",
  card_present: "Card in person",
  klarna: "Klarna",
  mobilepay: "MobilePay",
  link: "Link",
  ideal: "iDEAL",
  bancontact: "Bancontact",
  blik: "BLIK",
  eps: "EPS",
  p24: "Przelewy24",
  sepa_debit: "SEPA Direct Debit",
  paypal: "PayPal",
  swish: "Swish",
  vipps: "Vipps",
  twint: "TWINT",
  revolut_pay: "Revolut Pay",
  amazon_pay: "Amazon Pay",
  billie: "Billie",
  customer_balance: "Bank transfer",
};

const WALLET_WORDS: Record<string, string> = {
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  samsung_pay: "Samsung Pay",
  link: "Link",
  masterpass: "Masterpass",
  visa_checkout: "Visa Checkout",
  amex_express_checkout: "Amex Express Checkout",
};

const MANUAL_WORDS: Record<string, string> = { cash: "Cash", bank_transfer: "Bank transfer", other: "Other" };

const spaced = (value: string) => value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

/** A payment as the report groups it. */
export type PaymentFacts = {
  provider: string;
  methodType: string | null;
  wallet: string | null;
  /** A manual payment's own method (`cash`, `bank_transfer`, `other`). */
  manualMethod: string | null;
};

/**
 * The report's group of a payment (D288 3): a wallet over its card (*Apple Pay*), a method by name, a payment staff recorded by its own method
 * (*Recorded by staff: Cash*), the credit an exchange moved, a venue payment, a gift card (D300 F3), and *Unknown* for a provider payment whose facts were never read.
 */
export function methodGroup(p: PaymentFacts): { key: string; label: string } {
  if (p.provider === "manual") {
    const m = p.manualMethod ?? "other";
    return { key: `manual:${m}`, label: `Recorded by staff: ${MANUAL_WORDS[m] ?? spaced(m)}` };
  }
  if (p.provider === "exchange") return { key: "exchange", label: "Credit from a return" };
  if (p.provider === "venue") return { key: "venue", label: "At the venue" };
  if (p.provider === "gift_card") return { key: "gift_card", label: "Gift card" };
  if (p.wallet) return { key: `wallet:${p.wallet}`, label: WALLET_WORDS[p.wallet] ?? spaced(p.wallet) };
  if (p.methodType) return { key: `method:${p.methodType}`, label: METHOD_WORDS[p.methodType] ?? spaced(p.methodType) };
  return { key: "unknown", label: "Unknown" };
}

/** A payment's method in words on the order page, with the card brand when Stripe gave one. */
export function methodWords(p: PaymentFacts & { cardBrand: string | null }): string {
  const group = methodGroup(p).label;
  if (p.provider === "stripe" && p.cardBrand && (p.methodType === "card" || p.wallet)) return `${group} (${spaced(p.cardBrand)})`;
  return group;
}

/** The days before the evidence deadline when staff are reminded (D288 3). */
export const DISPUTE_REMINDER_DAYS = 3;

/** A deadline in the store's time zone, e.g. *Thu 22 Oct 2026, 23:59*. */
export const dueWords = (at: Date, timeZone: string, locale = "en-GB"): string =>
  new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);

/** Whether a dispute's deadline reminder is due now: it still needs a response and the deadline is within the reminder's days, and not past. */
export function reminderDue(input: { status: DisputeStatus; evidenceDueBy: Date | null; remindedAt: Date | null; now: Date }): boolean {
  if (!input.evidenceDueBy || input.remindedAt || !disputeNeedsResponse(input.status)) return false;
  const left = input.evidenceDueBy.getTime() - input.now.getTime();
  return left > 0 && left <= DISPUTE_REMINDER_DAYS * 86_400_000;
}

/** The dispute's page in the store's Stripe Dashboard, where evidence is submitted (direct charges: the dispute is the connected account's). */
export function disputeDashboardUrl(reference: string, testMode: boolean): string {
  return `https://dashboard.stripe.com/${testMode ? "test/" : ""}payments/disputes/${encodeURIComponent(reference)}`;
}

// ---------------------------------------------------------------------------
// From Stripe's objects (shapes kept to what is read, so this file needs no Stripe import)
// ---------------------------------------------------------------------------

/** The parts of a Stripe charge that are read. */
export type ChargeLike = {
  id: string;
  payment_method_details?: { type?: string | null; card?: { brand?: string | null; wallet?: { type?: string | null } | null } | null } | null;
  outcome?: { risk_level?: string | null; risk_score?: number | null } | null;
};

export type ChargeFacts = {
  methodType: string | null;
  wallet: string | null;
  cardBrand: string | null;
  riskLevel: RiskLevel | null;
  riskScore: number | null;
  chargeReference: string;
};

const word = (value: unknown, max = 40): string | null => (typeof value === "string" && /^[a-z0-9_]+$/.test(value) && value.length <= max ? value : null);

/** What a charge says, as Stripe gave it: a value of an unexpected shape is left out (null), a risk level Stripe gave that is not known is `unknown`. */
export function factsOfCharge(charge: ChargeLike): ChargeFacts {
  const details = charge.payment_method_details ?? null;
  const score = charge.outcome?.risk_score;
  const level = charge.outcome?.risk_level;
  return {
    methodType: word(details?.type),
    wallet: word(details?.card?.wallet?.type),
    cardBrand: word(details?.card?.brand),
    riskLevel: level === undefined || level === null ? null : riskLevelOf(level),
    riskScore: typeof score === "number" && Number.isInteger(score) && score >= 0 && score <= 100 ? score : null,
    chargeReference: charge.id,
  };
}

/** The parts of a Stripe dispute that are read. */
export type DisputeLike = {
  id: string;
  amount: number;
  currency: string;
  reason?: string | null;
  status: string;
  created: number;
  livemode: boolean;
  charge: string | { id: string };
  payment_intent?: string | { id: string } | null;
  evidence_details?: { due_by?: number | null } | null;
  balance_transactions?: readonly { amount: number; fee: number; currency: string }[] | null;
};

export type DisputeRecord = {
  reference: string;
  chargeReference: string;
  intent: string | null;
  amountMinor: number;
  currency: string;
  reason: string | null;
  status: DisputeStatus;
  evidenceDueBy: Date | null;
  outcome: "won" | "lost" | null;
  /** What the balance transactions took and gave back in the dispute's currency (positive: taken); null when there are none in it. */
  fundsWithdrawnMinor: number | null;
  feeMinor: number | null;
  testMode: boolean;
  openedAt: Date;
};

const idOf = (value: string | { id: string } | null | undefined): string | null => (typeof value === "string" ? value : (value?.id ?? null));

/** A Stripe dispute as a row, or null for one of a status Kaizena Flow does not know (it is logged, never guessed). Amounts in minor units as Stripe's. */
export function disputeRecord(d: DisputeLike): DisputeRecord | null {
  if (!isDisputeStatus(d.status) || !Number.isInteger(d.amount) || d.amount <= 0) return null;
  const currency = d.currency.toUpperCase();
  const own = (d.balance_transactions ?? []).filter((t) => t.currency.toUpperCase() === currency);
  const withdrawn = own.length > 0 ? Math.max(0, -own.reduce((s, t) => s + t.amount, 0)) : null;
  const fee = own.length > 0 ? Math.max(0, own.reduce((s, t) => s + t.fee, 0)) : null;
  return {
    reference: d.id,
    chargeReference: idOf(d.charge) ?? "",
    intent: idOf(d.payment_intent),
    amountMinor: d.amount,
    currency,
    reason: word(d.reason, 80),
    status: d.status,
    evidenceDueBy: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null,
    outcome: disputeOutcome(d.status),
    fundsWithdrawnMinor: withdrawn,
    feeMinor: fee,
    testMode: !d.livemode,
    openedAt: new Date(d.created * 1000),
  };
}

/** The order history's words for a dispute event. */
export function disputeEventText(type: string, data: Record<string, unknown>, money: (minor: number) => string): string | null {
  const amount = Number(data.amount);
  const sum = Number.isFinite(amount) && amount > 0 ? ` ${money(amount)}` : "";
  if (type === "dispute.opened") return `Disputed${sum} with the bank: ${disputeReasonWords(typeof data.reason === "string" ? data.reason : null).toLowerCase()}`;
  if (type === "dispute.closed") return data.outcome === "lost" ? `Dispute lost:${sum} taken back by the bank` : `Dispute closed in the store's favour${sum ? `:${sum} kept` : ""}`;
  return null;
}
