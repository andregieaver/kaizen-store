import { EXPORT_SECTIONS, type ExportSection } from "./personal-data";
import { informationBlock, notIncludedText, type InformationBlock, type InformationFacts, type NotIncluded } from "./privacy-text";

/**
 * The export of a person's data (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.2), pure: rows in, one JSON file out. The server
 * (`exportCustomerData()`) reads each section's rows by `store_id` and hands them over in the shapes below (camel-case column names); this
 * module decides what the file says. Every field of the file is written out here by name (a whitelist), so a column the query over-selects
 * (a password hash, a token, a client secret, a staff cost figure, a provider id) never reaches the file, and a deep scan (`findExcluded()`)
 * holds that. Amounts are `{ amountMinor, currency }` in the order's own currency, never converted; dates are ISO 8601 UTC; ids are the
 * store's own. Every section is always present: an empty list or null, never missing.
 *
 * Nothing here reads a database or another store. A person who shops in two stores has two files.
 */

export const EXPORT_SCHEMA = "kaizen.customer-export";
export const EXPORT_VERSION = 1;
/** A subject with more rows than this across all sections is refused with a plain sentence, never cut short. */
export const EXPORT_ROW_LIMIT = 100_000;

type Ts = Date | string | null | undefined;
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type Money = { amountMinor: number; currency: string };
type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------------------------------------------
// What the server hands over (one row type per source; extra keys are ignored)
// ---------------------------------------------------------------------------------------------------------------------------------

export type ExportStore = { name: string; legalName: string | null; organisationNumber: string | null; contactEmail: string | null; country: string | null };
export type ExportSubject = { kind: "account" | "guest"; email: string | null; accountId: string | null };

export type ProfileRow = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  address: unknown;
  locale: string | null;
  createdAt: Ts;
  lastSignInAt: Ts;
  emailVerifiedAt: Ts;
  hasPassword: boolean;
  hasAvatar: boolean;
  companyName: string | null;
  organisationNumber: string | null;
  groupName: string | null;
  groupPercent: number | string | null;
  membershipCompanyName: string | null;
  membershipRole: string | null;
};

export type OrderLineRow = {
  id: string;
  sku: string | null;
  title: string;
  quantity: number;
  unitPriceMinor: number;
  taxRate: number | string | null;
  taxMinor: number;
  totalMinor: number;
  bookedStartsAt?: Ts;
  bookedEndsAt?: Ts;
};
export type OrderRow = {
  id: string;
  number: string;
  placedAt: Ts;
  status: string;
  currency: string;
  subtotalMinor: number;
  shippingMinor: number;
  discountMinor: number;
  memberDiscountMinor: number;
  campaignDiscountMinor: number;
  creditMinor: number;
  referralDiscountMinor: number;
  vatReliefMinor: number;
  taxMinor: number;
  totalMinor: number;
  vatKind: string;
  vatReason: string | null;
  deliveryLabel: string | null;
  billingAddress: unknown;
  shippingAddress: unknown;
  email: string;
  companyName: string | null;
  organisationNumber: string | null;
  discountCode: string | null;
  copied: boolean;
  host: boolean;
  restrictedAt: Ts;
  keptUntil: string | null;
  anonymisedAt: Ts;
  /** The buyer's gift (D173): the buyer's own words, and the name of another person (the recipient). Staff tags on the order (staff text, which can name a person). */
  gift?: { to: string | null; from: string | null; message: string | null } | null;
  tags?: string[];
  lines: OrderLineRow[];
  payments: { provider: string; amountMinor: number; currency: string; status: string; createdAt: Ts; providerReference: string | null }[];
  refunds: { amountMinor: number; currency: string; status: string; createdAt: Ts; reason: string | null }[];
  /**
   * Each parcel with what was in it (D174; none for a parcel recorded before parcels named their lines). A parcel staff undid (D174 follow-up: it was not sent
   * after all) is kept in the record and marked with when, and staff's reason when one was given.
   */
  shipments: {
    carrier: string | null;
    trackingNumber: string | null;
    createdAt: Ts;
    lines?: { sku: string | null; title: string; quantity: number }[];
    undoneAt?: Ts;
    undoReason?: string | null;
  }[];
  /** The order's changes after purchase (D174): number, date, difference and state; never staff's note. */
  changes?: { label: string; status: string; createdAt: Ts; appliedAt: Ts; differenceMinor: number; currency: string }[];
  downloads: { fileName: string | null; downloads: number }[];
  terms: { mode: string; acceptedAt: Ts; locale: string | null } | null;
  events: { type: string; createdAt: Ts; reason: string | null; note: string | null }[];
};

export type DocumentRow = {
  id: string;
  documentNumber: string;
  series: string;
  number: number;
  orderNumber: string | null;
  issuedOn: string;
  issuedAt: Ts;
  currency: string;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
  vatKind?: string | null;
  anonymised: boolean;
  snapshot: unknown;
  /** Credit notes only: the invoice it credits and why. */
  invoiceNumber?: string | null;
  source?: string | null;
};

export type ReturnRow = {
  id: string;
  number: string;
  orderNumber: string | null;
  kind: string;
  status: string;
  reason: string | null;
  reasonNote: string | null;
  decisionNote: string | null;
  refundNote: string | null;
  /** The internal staff note: personal data about the person, included, with a warning to staff before the download. */
  staffNote: string | null;
  refundMinor: number | null;
  currency: string;
  refundedAt: Ts;
  createdAt: Ts;
  closedAt: Ts;
  lines: { sku: string | null; title: string | null; quantity: number; decision: string; condition: string | null; reason: string | null }[];
};
export type WithdrawalRow = {
  id: string;
  orderNumber: string | null;
  name: string;
  email: string;
  channel: string;
  status: string;
  submittedAt: Ts;
  confirmedAt: Ts;
  acknowledgedAt: Ts;
  lines: { sku: string | null; title: string | null; quantity: number }[];
};

export type SubscriptionRow = {
  id: string;
  number: string;
  status: string;
  interval: string;
  intervalCount: number;
  currency: string;
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  email: string;
  shippingAddress: unknown;
  currentPeriodEnd: Ts;
  cancelledAt: Ts;
  createdAt: Ts;
  lines: { sku: string | null; title: string; quantity: number; unitPriceMinor: number }[];
};

export type StandingListRow = {
  id: string;
  scheduleName: string | null;
  status: string;
  shippingAddress: unknown;
  cardLabel: string | null;
  consentAt: Ts;
  skipDates: string[];
  createdAt: Ts;
  lines: { sku: string | null; title: string; quantity: number }[];
  deliveries: { deliveryDate: string; outcome: string | null; orderNumber: string | null }[];
};

export type WishlistRow = {
  id: string;
  name: string | null;
  createdAt: Ts;
  items: { sku: string | null; title: string; quantity: number; addedAt: Ts }[];
};
export type WishlistAddRow = { title: string; sku: string | null; quantity: number; currency: string; unitPriceMinor: number; createdAt: Ts };

export type BonusRow = { kind: string; amountMinor: number; availableAt: Ts; expiresAt: Ts; orderNumber: string | null; note: string | null; createdAt: Ts };
export type BonusSource = { currency: string; balanceMinor: number; entries: BonusRow[] } | null;

export type ReferralSource = {
  affiliate: { code: string; blocked: boolean; blockedReason: string | null; createdAt: Ts } | null;
  /** Counts and amounts only: who a friend is, or who referred the person, is another person's data. */
  rewards: { count: number; rewardMinor: number; discountMinor: number; currency: string } | null;
  wasReferred: boolean;
};

export type ConsentRow = { kind: string; source: string; at: Ts; detail: string | null };
export type EmailRow = { id: string; kind: string; subject: string; sentAt: Ts; createdAt: Ts; status: string; body: string | null; orderNumber: string | null };
export type CartRow = {
  id: string;
  status: string;
  currency: string;
  createdAt: Ts;
  updatedAt: Ts;
  lines: { sku: string | null; title: string; quantity: number }[];
};
/** A draft order staff made for the person (D173), by the customer account only: the contact data staff typed, and what was on it. */
export type DraftExportRow = {
  number: string;
  status: string;
  currency: string;
  createdAt: Ts;
  email: string | null;
  phone: string | null;
  shippingAddress: unknown;
  billingAddress: unknown;
  companyName: string | null;
  organisationNumber: string | null;
  noteToBuyer: string | null;
  internalNote: string | null;
  lines: { sku: string | null; title: string; quantity: number; unitPriceMinor: number }[];
};
export type AbandonedRow = { capturedAt: Ts; remindersSent: number; clickedAt: Ts; recoveredAt: Ts; optedOutAt: Ts };
export type FormRow = { kind: string; createdAt: Ts; status: string };
export type CompanySource = {
  company: { name: string; role: string | null } | null;
  invites: { status: string; createdAt: Ts; expiresAt: Ts; acceptedAt: Ts }[];
};
export type CustomFieldRow = { entity: "customer" | "order"; reference: string | null; group: string; label: string; value: string | null; locale: string | null };

/** What `exportCustomerData()` gathers, by `store_id`, before shaping. */
export type ExportInput = {
  generatedAt: Date;
  /** The shopper's language for the `information` block and `notIncluded`: nb, sv, da or en (anything else is English). */
  language: string;
  store: ExportStore;
  subject: ExportSubject;
  /** The seller's bookkeeping period in years (from the retention rule), for the information block. */
  bookkeepingYears: number;
  authority?: string | null;
  profile: ProfileRow | null;
  orders: OrderRow[];
  invoices: DocumentRow[];
  creditNotes: DocumentRow[];
  returns: ReturnRow[];
  withdrawals: WithdrawalRow[];
  subscriptions: SubscriptionRow[];
  standingLists: StandingListRow[];
  wishlists: WishlistRow[];
  wishlistAdds: WishlistAddRow[];
  bonus: BonusSource;
  referrals: ReferralSource;
  consents: ConsentRow[];
  emails: EmailRow[];
  carts: CartRow[];
  abandoned: AbandonedRow[];
  /** Draft orders of the customer account (D173); absent is none. */
  drafts?: DraftExportRow[];
  forms: FormRow[];
  company: CompanySource;
  customFields: CustomFieldRow[];
};

// ---------------------------------------------------------------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------------------------------------------------------------

export type AddressEntry = {
  address: Json;
  sources: { source: "account" | "order_billing" | "order_shipping" | "subscription" | "standing_list"; reference: string | null }[];
};

export type ExportSections = {
  profile: Json | null;
  addresses: AddressEntry[];
  orders: Json[];
  invoices: Json[];
  creditNotes: Json[];
  returns: { returns: Json[]; withdrawals: Json[] };
  subscriptions: Json[];
  deliveries: Json[];
  wishlists: { lists: Json[]; cartAdds: Json[] };
  bonus: Json | null;
  referrals: Json;
  consents: Json[];
  emails: Json[];
  carts: { carts: Json[]; abandonedCheckouts: Json[]; draftOrders: Json[] };
  forms: Json[];
  company: { company: Json | null; invites: Json[] };
  customFields: Json[];
};

export type ExportCounts = Record<ExportSection, number>;

export type ExportFile = {
  schema: typeof EXPORT_SCHEMA;
  version: typeof EXPORT_VERSION;
  generatedAt: string;
  store: ExportStore;
  subject: ExportSubject;
  information: InformationBlock;
  sections: ExportSections;
  counts: ExportCounts;
  notIncluded: NotIncluded[];
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Whitelisted conversion
// ---------------------------------------------------------------------------------------------------------------------------------

/** Keys that never appear in a file, at any depth (the deep scan of the tests, and what `cleanJson()` removes from addresses and snapshots). */
export const EXCLUDED_KEYS: readonly string[] = [
  "password", "passwordHash", "password_hash", "token", "tokens", "tokenHash", "token_hash", "browserToken", "browserTokenHash", "browser_token_hash",
  "clientSecret", "client_secret", "providerAccount", "provider_account", "unitCostMinor", "unit_cost_minor", "costMinor", "cost_minor",
  "manageToken", "manage_token", "publicToken", "public_token", "pdfPath", "pdf_path", "pdfSha256", "pdf_sha256", "codeHash", "code_hash",
  "stripeCustomer", "stripe_customer", "paymentMethod", "payment_method", "stripeAccount", "stripe_account", "setupSession", "setup_session",
  "authUserId", "auth_user_id", "lockedUntil", "failedSignIns", "failed_sign_ins", "avatarPath", "avatar_path", "labelUrl", "label_url",
  "returnToken",
];

const iso = (v: Ts): string | null => {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const day = (v: string | null | undefined): string | null => (v ? String(v).slice(0, 10) : null);
const text = (v: unknown): string | null => (v == null ? null : String(v));
const int = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
const money = (amountMinor: unknown, currency: unknown): Money => ({ amountMinor: int(amountMinor), currency: String(currency ?? "").toUpperCase() });

/** A JSON value copied with the excluded keys removed at every depth, and dates written as ISO text. */
export function cleanJson(value: unknown): Json {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(cleanJson);
  if (typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Row)) {
      if (EXCLUDED_KEYS.includes(k)) continue;
      out[k] = cleanJson(v);
    }
    return out;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  return String(value);
}

const addressOf = (v: unknown): Json | null => {
  const c = cleanJson(v);
  if (c == null || typeof c !== "object" || Array.isArray(c)) return null;
  const values = Object.values(c);
  return values.length > 0 && values.some((x) => x !== null && x !== "") ? c : null;
};

const canonical = (v: Json): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, Json>)[k])}`)
      .join(",")}}`;
  }
  return typeof v === "string" ? JSON.stringify(v.trim().toLowerCase()) : JSON.stringify(v);
};

/** The distinct addresses, with where each came from (the account, an order's billing or delivery address, a subscription, a standing list). */
export function collectAddresses(input: Pick<ExportInput, "profile" | "orders" | "subscriptions" | "standingLists">): AddressEntry[] {
  const found = new Map<string, AddressEntry>();
  const add = (raw: unknown, source: AddressEntry["sources"][number]["source"], reference: string | null) => {
    const address = addressOf(raw);
    if (!address) return;
    const key = canonical(address);
    const entry = found.get(key) ?? { address, sources: [] };
    if (!entry.sources.some((s) => s.source === source && s.reference === reference)) entry.sources.push({ source, reference });
    found.set(key, entry);
  };
  if (input.profile) add(input.profile.address, "account", null);
  for (const o of input.orders) {
    add(o.billingAddress, "order_billing", o.number);
    add(o.shippingAddress, "order_shipping", o.number);
  }
  for (const s of input.subscriptions) add(s.shippingAddress, "subscription", s.number);
  for (const l of input.standingLists) add(l.shippingAddress, "standing_list", l.scheduleName);
  return [...found.values()];
}

const shapeProfile = (p: ProfileRow): Json => ({
  id: p.id,
  email: p.email,
  name: text(p.name),
  phone: text(p.phone),
  address: addressOf(p.address),
  locale: text(p.locale),
  createdAt: iso(p.createdAt),
  lastSignInAt: iso(p.lastSignInAt),
  emailVerifiedAt: iso(p.emailVerifiedAt),
  hasPassword: Boolean(p.hasPassword),
  hasAvatar: Boolean(p.hasAvatar),
  company: { name: text(p.companyName), organisationNumber: text(p.organisationNumber) },
  customerGroup: p.groupName ? { name: p.groupName, percent: num(p.groupPercent) } : null,
  companyMembership: p.membershipCompanyName ? { companyName: p.membershipCompanyName, role: text(p.membershipRole) } : null,
});

const shapeOrder = (o: OrderRow): Json => {
  const cur = o.currency;
  return {
    id: o.id,
    number: o.number,
    placedAt: iso(o.placedAt),
    status: o.status,
    currency: cur,
    subtotal: money(o.subtotalMinor, cur),
    shipping: money(o.shippingMinor, cur),
    discount: money(o.discountMinor, cur),
    discountParts: {
      member: money(o.memberDiscountMinor, cur),
      campaign: money(o.campaignDiscountMinor, cur),
      credit: money(o.creditMinor, cur),
      referral: money(o.referralDiscountMinor, cur),
      vatRelief: money(o.vatReliefMinor, cur),
    },
    tax: money(o.taxMinor, cur),
    total: money(o.totalMinor, cur),
    vatKind: o.vatKind,
    vatReason: text(o.vatReason),
    deliveryService: text(o.deliveryLabel),
    billingAddress: addressOf(o.billingAddress),
    shippingAddress: addressOf(o.shippingAddress),
    email: o.email,
    company: o.companyName || o.organisationNumber ? { name: text(o.companyName), organisationNumber: text(o.organisationNumber) } : null,
    discountCode: text(o.discountCode),
    copied: Boolean(o.copied),
    host: Boolean(o.host),
    restrictedSince: iso(o.restrictedAt),
    keptUntil: day(o.keptUntil),
    anonymisedAt: iso(o.anonymisedAt),
    // The buyer's gift (D173): their own words and the recipient's name, kept with the order and exported with it; staff's tags on it.
    gift: o.gift ? { to: text(o.gift.to), from: text(o.gift.from), message: text(o.gift.message) } : null,
    tags: o.tags ?? [],
    lines: o.lines.map((l) => ({
      id: l.id,
      sku: text(l.sku),
      title: l.title,
      quantity: int(l.quantity),
      unitPrice: money(l.unitPriceMinor, cur),
      taxRate: num(l.taxRate),
      tax: money(l.taxMinor, cur),
      total: money(l.totalMinor, cur),
      booked: l.bookedStartsAt ? { startsAt: iso(l.bookedStartsAt), endsAt: iso(l.bookedEndsAt) } : null,
    })),
    payments: o.payments.map((p) => ({ provider: p.provider, amount: money(p.amountMinor, p.currency), status: p.status, createdAt: iso(p.createdAt), reference: text(p.providerReference) })),
    refunds: o.refunds.map((r) => ({ amount: money(r.amountMinor, r.currency), status: r.status, createdAt: iso(r.createdAt), reason: text(r.reason) })),
    shipments: o.shipments.map((s) => ({
      carrier: text(s.carrier),
      trackingNumber: text(s.trackingNumber),
      createdAt: iso(s.createdAt),
      lines: (s.lines ?? []).map((l) => ({ sku: text(l.sku), title: l.title, quantity: int(l.quantity) })),
      ...(s.undoneAt ? { undone: { at: iso(s.undoneAt), reason: text(s.undoReason ?? null) } } : {}),
    })),
    changes: (o.changes ?? []).map((c) => ({ change: c.label, status: c.status, createdAt: iso(c.createdAt), appliedAt: iso(c.appliedAt), difference: money(c.differenceMinor, c.currency) })),
    downloads: o.downloads.map((d) => ({ fileName: text(d.fileName), count: int(d.downloads) })),
    termsAccepted: o.terms ? { mode: o.terms.mode, acceptedAt: iso(o.terms.acceptedAt), locale: text(o.terms.locale) } : null,
    events: o.events.map((e) => ({ type: e.type, createdAt: iso(e.createdAt), reason: text(e.reason), note: text(e.note) })),
  };
};

const shapeDocument = (d: DocumentRow): Json => ({
  id: d.id,
  documentNumber: d.documentNumber,
  series: d.series,
  number: int(d.number),
  orderNumber: text(d.orderNumber),
  issuedOn: day(d.issuedOn),
  issuedAt: iso(d.issuedAt),
  currency: d.currency,
  net: money(d.netMinor, d.currency),
  vat: money(d.taxMinor, d.currency),
  total: money(d.totalMinor, d.currency),
  vatKind: text(d.vatKind),
  invoiceNumber: text(d.invoiceNumber),
  source: text(d.source),
  anonymised: Boolean(d.anonymised),
  snapshot: cleanJson(d.snapshot),
});

const shapeReturn = (r: ReturnRow): Json => ({
  id: r.id,
  number: r.number,
  orderNumber: text(r.orderNumber),
  kind: r.kind,
  status: r.status,
  reason: text(r.reason),
  shopperNote: text(r.reasonNote),
  decisionNote: text(r.decisionNote),
  refundNote: text(r.refundNote),
  internalStaffNote: text(r.staffNote),
  refund: r.refundMinor == null ? null : money(r.refundMinor, r.currency),
  refundedAt: iso(r.refundedAt),
  createdAt: iso(r.createdAt),
  closedAt: iso(r.closedAt),
  lines: r.lines.map((l) => ({ sku: text(l.sku), title: text(l.title), quantity: int(l.quantity), decision: l.decision, condition: text(l.condition), reason: text(l.reason) })),
});

const shapeWithdrawal = (w: WithdrawalRow): Json => ({
  id: w.id,
  orderNumber: text(w.orderNumber),
  name: w.name,
  email: w.email,
  channel: w.channel,
  status: w.status,
  submittedAt: iso(w.submittedAt),
  confirmedAt: iso(w.confirmedAt),
  acknowledgedAt: iso(w.acknowledgedAt),
  lines: w.lines.map((l) => ({ sku: text(l.sku), title: text(l.title), quantity: int(l.quantity) })),
});

const shapeSubscription = (s: SubscriptionRow): Json => ({
  id: s.id,
  number: s.number,
  status: s.status,
  interval: s.interval,
  intervalCount: int(s.intervalCount),
  currency: s.currency,
  subtotal: money(s.subtotalMinor, s.currency),
  shipping: money(s.shippingMinor, s.currency),
  tax: money(s.taxMinor, s.currency),
  total: money(s.totalMinor, s.currency),
  email: s.email,
  shippingAddress: addressOf(s.shippingAddress),
  nextDate: iso(s.currentPeriodEnd),
  cancelledAt: iso(s.cancelledAt),
  createdAt: iso(s.createdAt),
  lines: s.lines.map((l) => ({ sku: text(l.sku), title: l.title, quantity: int(l.quantity), unitPrice: money(l.unitPriceMinor, s.currency) })),
});

const shapeStandingList = (l: StandingListRow): Json => ({
  id: l.id,
  schedule: text(l.scheduleName),
  status: l.status,
  shippingAddress: addressOf(l.shippingAddress),
  cardLabel: text(l.cardLabel),
  consentAt: iso(l.consentAt),
  skippedDates: (l.skipDates ?? []).map((d) => String(d).slice(0, 10)),
  createdAt: iso(l.createdAt),
  lines: l.lines.map((x) => ({ sku: text(x.sku), title: x.title, quantity: int(x.quantity) })),
  deliveries: l.deliveries.map((d) => ({ date: day(d.deliveryDate), outcome: text(d.outcome), orderNumber: text(d.orderNumber) })),
});

const shapeWishlist = (w: WishlistRow): Json => ({
  id: w.id,
  name: text(w.name),
  createdAt: iso(w.createdAt),
  items: w.items.map((i) => ({ sku: text(i.sku), title: i.title, quantity: int(i.quantity), addedAt: iso(i.addedAt) })),
});

const shapeBonus = (b: BonusSource): Json | null =>
  b
    ? {
        balance: money(b.balanceMinor, b.currency),
        entries: b.entries.map((e) => ({
          kind: e.kind,
          amount: money(e.amountMinor, b.currency),
          availableAt: iso(e.availableAt),
          expiresAt: iso(e.expiresAt),
          orderNumber: text(e.orderNumber),
          reason: text(e.note),
          createdAt: iso(e.createdAt),
        })),
      }
    : null;

const shapeReferrals = (r: ReferralSource): Json => ({
  affiliate: r.affiliate ? { code: r.affiliate.code, blocked: Boolean(r.affiliate.blocked), blockedReason: text(r.affiliate.blockedReason), createdAt: iso(r.affiliate.createdAt) } : null,
  rewards: r.rewards ? { count: int(r.rewards.count), reward: money(r.rewards.rewardMinor, r.rewards.currency), discount: money(r.rewards.discountMinor, r.rewards.currency) } : null,
  wasReferred: Boolean(r.wasReferred),
});

/** How many source rows a section has (what `counts` reports): the top-level rows of the section, composite sections summed. */
export function countsOf(input: ExportInput): ExportCounts {
  const addresses = collectAddresses(input).length;
  return {
    profile: input.profile ? 1 : 0,
    addresses,
    orders: input.orders.length,
    invoices: input.invoices.length,
    creditNotes: input.creditNotes.length,
    returns: input.returns.length + input.withdrawals.length,
    subscriptions: input.subscriptions.length,
    deliveries: input.standingLists.length,
    wishlists: input.wishlists.length + input.wishlistAdds.length,
    bonus: input.bonus ? input.bonus.entries.length : 0,
    referrals: (input.referrals.affiliate ? 1 : 0) + (input.referrals.rewards ? input.referrals.rewards.count : 0),
    consents: input.consents.length,
    emails: input.emails.length,
    carts: input.carts.length + input.abandoned.length + (input.drafts ?? []).length,
    forms: input.forms.length,
    company: (input.company.company ? 1 : 0) + input.company.invites.length,
    customFields: input.customFields.length,
  };
}

export const totalRows = (counts: ExportCounts): number => EXPORT_SECTIONS.reduce((sum, s) => sum + counts[s], 0);
export const overLimit = (counts: ExportCounts): boolean => totalRows(counts) > EXPORT_ROW_LIMIT;

/** The whole file, from the rows. Never reads anything else; the same rows always give the same file (stable key order and row order are the caller's). */
export function shapeExport(input: ExportInput): ExportFile {
  const facts: InformationFacts = {
    storeName: input.store.name,
    legalName: input.store.legalName,
    contactEmail: input.store.contactEmail,
    country: input.store.country,
    authority: input.authority ?? null,
    bookkeepingYears: input.bookkeepingYears,
  };
  const sections: ExportSections = {
    profile: input.profile ? shapeProfile(input.profile) : null,
    addresses: collectAddresses(input),
    orders: input.orders.map(shapeOrder),
    invoices: input.invoices.map(shapeDocument),
    creditNotes: input.creditNotes.map(shapeDocument),
    returns: { returns: input.returns.map(shapeReturn), withdrawals: input.withdrawals.map(shapeWithdrawal) },
    subscriptions: input.subscriptions.map(shapeSubscription),
    deliveries: input.standingLists.map(shapeStandingList),
    wishlists: {
      lists: input.wishlists.map(shapeWishlist),
      cartAdds: input.wishlistAdds.map((a) => ({ title: a.title, sku: text(a.sku), quantity: int(a.quantity), unitPrice: money(a.unitPriceMinor, a.currency), createdAt: iso(a.createdAt) })),
    },
    bonus: shapeBonus(input.bonus),
    referrals: shapeReferrals(input.referrals),
    consents: input.consents.map((c) => ({ kind: c.kind, source: c.source, at: iso(c.at), detail: text(c.detail) })),
    emails: input.emails.map((e) => ({ id: e.id, kind: e.kind, subject: e.subject, sentAt: iso(e.sentAt ?? e.createdAt), status: e.status, orderNumber: text(e.orderNumber), body: text(e.body) })),
    carts: {
      carts: input.carts.map((c) => ({ id: c.id, status: c.status, currency: c.currency, createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt), lines: c.lines.map((l) => ({ sku: text(l.sku), title: l.title, quantity: int(l.quantity) })) })),
      abandonedCheckouts: input.abandoned.map((a) => ({ capturedAt: iso(a.capturedAt), remindersSent: int(a.remindersSent), clickedAt: iso(a.clickedAt), recoveredAt: iso(a.recoveredAt), optedOutAt: iso(a.optedOutAt) })),
      draftOrders: (input.drafts ?? []).map((d) => ({
        number: d.number,
        status: d.status,
        currency: d.currency,
        createdAt: iso(d.createdAt),
        email: text(d.email),
        phone: text(d.phone),
        billingAddress: addressOf(d.billingAddress),
        shippingAddress: addressOf(d.shippingAddress),
        company: d.companyName || d.organisationNumber ? { name: text(d.companyName), organisationNumber: text(d.organisationNumber) } : null,
        noteToBuyer: text(d.noteToBuyer),
        internalNote: text(d.internalNote),
        lines: d.lines.map((l) => ({ sku: text(l.sku), title: l.title, quantity: int(l.quantity), unitPrice: money(l.unitPriceMinor, d.currency) })),
      })),
    },
    forms: input.forms.map((f) => ({ kind: f.kind, createdAt: iso(f.createdAt), status: f.status })),
    company: {
      company: input.company.company ? { name: input.company.company.name, role: text(input.company.company.role) } : null,
      invites: input.company.invites.map((i) => ({ status: i.status, createdAt: iso(i.createdAt), expiresAt: iso(i.expiresAt), acceptedAt: iso(i.acceptedAt) })),
    },
    customFields: input.customFields.map((f) => ({ entity: f.entity, reference: text(f.reference), group: f.group, label: f.label, value: text(f.value), locale: text(f.locale) })),
  };
  return {
    schema: EXPORT_SCHEMA,
    version: EXPORT_VERSION,
    generatedAt: input.generatedAt.toISOString(),
    store: { name: input.store.name, legalName: input.store.legalName, organisationNumber: input.store.organisationNumber, contactEmail: input.store.contactEmail, country: input.store.country },
    subject: { kind: input.subject.kind, email: input.subject.email, accountId: input.subject.accountId },
    information: informationBlock(input.language, facts),
    sections,
    counts: countsOf(input),
    notIncluded: notIncludedText(input.language),
  };
}

/** An empty subject's file: every section present, every count zero, `subject.kind: "guest"`. */
export function emptyExportInput(base: Pick<ExportInput, "generatedAt" | "language" | "store" | "subject" | "bookkeepingYears" | "authority">): ExportInput {
  return {
    ...base,
    profile: null,
    orders: [],
    invoices: [],
    creditNotes: [],
    returns: [],
    withdrawals: [],
    subscriptions: [],
    standingLists: [],
    wishlists: [],
    wishlistAdds: [],
    bonus: null,
    referrals: { affiliate: null, rewards: null, wasReferred: false },
    consents: [],
    emails: [],
    carts: [],
    abandoned: [],
    forms: [],
    company: { company: null, invites: [] },
    customFields: [],
  };
}

/** The file's name: `{store-slug}-data-{YYYY-MM-DD}.json` for staff, `{store-slug}-my-data-{YYYY-MM-DD}.json` for the shopper. */
export function exportFileName(storeSlug: string, generatedAt: Date, who: "staff" | "shopper"): string {
  const slug = storeSlug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "store";
  return `${slug}-${who === "shopper" ? "my-data" : "data"}-${generatedAt.toISOString().slice(0, 10)}.json`;
}

/** The file as text: UTF-8 JSON, two-space indented, a trailing newline. */
export const serialiseExport = (file: ExportFile): string => `${JSON.stringify(file, null, 2)}\n`;

// ---------------------------------------------------------------------------------------------------------------------------------
// Checking a file (what the tests and a paranoid caller use)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Paths (`sections.orders[0].payments[0].clientSecret`) of keys in the file that must never be there, at any depth. */
export function findExcluded(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findExcluded(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value as Row).flatMap(([k, v]) => [...(EXCLUDED_KEYS.includes(k) ? [`${path}.${k}`] : []), ...findExcluded(v, `${path}.${k}`)]);
  }
  return [];
}

/** Paths of the strings in a file that contain a sentinel (a secret the fixture planted, or another store's marker). */
export function findStrings(value: unknown, needles: readonly string[], path = ""): string[] {
  if (typeof value === "string") return needles.some((n) => n && value.includes(n)) ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => findStrings(v, needles, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value as Row).flatMap(([k, v]) => findStrings(v, needles, `${path}.${k}`));
  return [];
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Every `{ amountMinor, currency }` in the file is an integer and a three-letter upper-case code; every `...At` is ISO 8601 UTC or null. */
function deepProblems(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => deepProblems(v, `${path}[${i}]`, out));
    return;
  }
  if (!value || typeof value !== "object") return;
  const o = value as Row;
  if ("amountMinor" in o) {
    if (!Number.isInteger(o.amountMinor)) out.push(`${path}.amountMinor is not an integer`);
    if (typeof o.currency !== "string" || !/^[A-Z]{3}$/.test(o.currency)) out.push(`${path}.currency is not a currency code`);
  }
  for (const [k, v] of Object.entries(o)) {
    // A document's snapshot and an address are the buyer's own text as it was issued; their keys are not this file's.
    if (k === "snapshot" || k === "address" || k === "billingAddress" || k === "shippingAddress") continue;
    if (/At$/.test(k) && v != null && !(typeof v === "string" && ISO.test(v))) out.push(`${path}.${k} is not an ISO 8601 UTC date`);
    deepProblems(v, `${path}.${k}`, out);
  }
}

/** The structural problems of a file against the schema of 2.2 (empty: valid). It checks shape, never meaning. */
export function validateExport(file: unknown): string[] {
  const out: string[] = [];
  if (!file || typeof file !== "object") return ["the file is not an object"];
  const f = file as Row;
  if (f.schema !== EXPORT_SCHEMA) out.push("schema is not kaizen.customer-export");
  if (f.version !== EXPORT_VERSION) out.push("version is not 1");
  if (typeof f.generatedAt !== "string" || !ISO.test(f.generatedAt)) out.push("generatedAt is not ISO 8601 UTC");
  for (const key of ["store", "subject", "information", "sections", "counts"]) {
    if (!f[key] || typeof f[key] !== "object") out.push(`${key} is missing`);
  }
  if (!Array.isArray(f.notIncluded) || f.notIncluded.some((n) => !n || typeof (n as Row).what !== "string" || typeof (n as Row).why !== "string")) out.push("notIncluded is not a list of what and why");
  const subject = f.subject as Row | undefined;
  if (subject && subject.kind !== "account" && subject.kind !== "guest") out.push("subject.kind is not account or guest");
  const sections = (f.sections ?? {}) as Row;
  const counts = (f.counts ?? {}) as Row;
  const keys = Object.keys(sections).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...EXPORT_SECTIONS].sort())) out.push(`sections has the keys ${keys.join(",")}, not exactly the sections of the register`);
  const countKeys = Object.keys(counts).sort();
  if (JSON.stringify(countKeys) !== JSON.stringify([...EXPORT_SECTIONS].sort())) out.push("counts does not have exactly one number for each section");
  for (const s of EXPORT_SECTIONS) {
    if (typeof counts[s] !== "number" || !Number.isInteger(counts[s])) out.push(`counts.${s} is not an integer`);
  }
  const listOf = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
  const expected: Partial<Record<ExportSection, number>> = {
    profile: sections.profile ? 1 : 0,
    addresses: listOf(sections.addresses),
    orders: listOf(sections.orders),
    invoices: listOf(sections.invoices),
    creditNotes: listOf(sections.creditNotes),
    returns: listOf((sections.returns as Row | undefined)?.returns) + listOf((sections.returns as Row | undefined)?.withdrawals),
    subscriptions: listOf(sections.subscriptions),
    deliveries: listOf(sections.deliveries),
    wishlists: listOf((sections.wishlists as Row | undefined)?.lists) + listOf((sections.wishlists as Row | undefined)?.cartAdds),
    bonus: listOf((sections.bonus as Row | null | undefined)?.entries),
    referrals: (sections.referrals && (sections.referrals as Row).affiliate ? 1 : 0) + Number((((sections.referrals as Row | undefined)?.rewards as Row | null | undefined)?.count as number | undefined) ?? 0),
    company: ((sections.company as Row | undefined)?.company ? 1 : 0) + listOf((sections.company as Row | undefined)?.invites),
    consents: listOf(sections.consents),
    emails: listOf(sections.emails),
    carts: listOf((sections.carts as Row | undefined)?.carts) + listOf((sections.carts as Row | undefined)?.abandonedCheckouts) + listOf((sections.carts as Row | undefined)?.draftOrders),
    forms: listOf(sections.forms),
    customFields: listOf(sections.customFields),
  };
  for (const [s, n] of Object.entries(expected)) {
    if (counts[s] !== n) out.push(`counts.${s} is ${String(counts[s])} but the section holds ${n}`);
  }
  for (const path of findExcluded(file)) out.push(`${path} must never be in a file`);
  deepProblems(file, "", out);
  return out;
}
