import { organisationNumber } from "./b2b";
import { normaliseSellerVatNumber } from "./tax-profile";

/**
 * Changing the business behind a store (B8 of `docs/own-books-and-sales.md` section 4.5, D473), pure: an ENK that becomes an AS, or any new
 * legal business taking over the store, from a date. What the owner may type, what must be known before the change can take effect, and
 * the day it does. The database applies it (`commerce.apply_business_change()`); nothing here knows one.
 */

/** The legal forms a Norwegian business takes, and `other` for the rest (the country's own). */
export const BUSINESS_FORMS = ["enk", "as", "asa", "nuf", "da", "ans", "sa", "other"] as const;
export type BusinessForm = (typeof BUSINESS_FORMS)[number];
export const isBusinessForm = (value: unknown): value is BusinessForm => (BUSINESS_FORMS as readonly unknown[]).includes(value);

/** The document series a new business may give a prefix of its own; orders keep theirs (an order number is the store's, not a business's). */
export const BUSINESS_SERIES = ["invoice", "credit_note", "work_invoice", "work_credit_note"] as const;
export type BusinessSeries = (typeof BUSINESS_SERIES)[number];

export const LEGAL_NAME_MAX = 200;
/** As the series' own rule: up to 10 letters, digits or . _ / - (`commerce.work_series_guard()`). */
const PREFIX = /^[A-Za-z0-9._/-]{1,10}$/;
/** How far ahead a change may be planned: two years, so a typo in the year is caught. */
export const BUSINESS_CHANGE_AHEAD_DAYS = 2 * 366;

/** A change as the owner typed it, checked. */
export type BusinessChangeInput = {
  legalName: string;
  businessForm: BusinessForm;
  /** The new business's organisation number, digits only; null until it is registered (the change waits for it). */
  organisationNumber: string | null;
  vatRegistered: boolean;
  /** As the seller states it (Norway `NO…MVA`); null when not registered, or registered but not yet known. */
  vatNumber: string | null;
  /** The business address from the date; null keeps the store's. */
  postalAddress: string | null;
  /** The first day the new business sells, in the store's time zone (`YYYY-MM-DD`). */
  startsOn: string;
  /** A prefix of the new business's own for each series given; a series left out keeps its prefix. Numbers go on from where they are. */
  prefixes: Partial<Record<BusinessSeries, string>>;
};

export type BusinessChangeProblem = "legal_name" | "form" | "organisation_number" | "vat_number" | "postal_address" | "starts_on" | "prefix" | "same";

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Days from `from` to `to`, both `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * What the owner typed, checked against the store's country and today in its time zone: a legal name and form, the organisation number
 * once there is one, the VAT number when registered (a Norwegian business's is its number and MVA, filled in when left out), an address
 * or none (keep), a first day after today and within two years, and prefixes in the series' own shape. A change to the business it already
 * is (the same organisation number) is refused.
 */
export function cleanBusinessChange(
  raw: Record<string, unknown>,
  store: { country: string | null; today: string; organisationNumber: string | null },
): { ok: true; change: BusinessChangeInput } | { ok: false; problems: BusinessChangeProblem[] } {
  const problems: BusinessChangeProblem[] = [];
  const legalName = text(raw.legalName).replace(/\s+/g, " ");
  if (legalName.length < 1 || legalName.length > LEGAL_NAME_MAX) problems.push("legal_name");
  const form = text(raw.businessForm).toLowerCase();
  if (!isBusinessForm(form)) problems.push("form");

  let orgNumber: string | null = null;
  if (text(raw.organisationNumber)) {
    orgNumber = organisationNumber(store.country, text(raw.organisationNumber));
    if (!orgNumber) problems.push("organisation_number");
    else if (store.organisationNumber && orgNumber.replace(/\D/g, "") === store.organisationNumber.replace(/\D/g, "") && /\d/.test(orgNumber)) problems.push("same");
  }

  const vatRegistered = raw.vatRegistered === true || raw.vatRegistered === "on" || raw.vatRegistered === "true";
  let vatNumber: string | null = null;
  if (vatRegistered) {
    const typed = text(raw.vatNumber);
    // A Norwegian business's VAT number is its organisation number and MVA: written for the owner when they left it out.
    const wanted = typed || (store.country?.toUpperCase() === "NO" && orgNumber ? `${orgNumber}MVA` : "");
    if (wanted) {
      const checked = normaliseSellerVatNumber(store.country, wanted);
      if (checked.ok) vatNumber = checked.number;
      else problems.push("vat_number");
    }
  }

  const address = text(raw.postalAddress);
  if (address && (address.length < 5 || address.length > 300)) problems.push("postal_address");

  const startsOn = text(raw.startsOn);
  if (!DATE.test(startsOn) || Number.isNaN(Date.parse(`${startsOn}T00:00:00Z`))) problems.push("starts_on");
  else {
    const ahead = daysBetween(store.today, startsOn);
    if (ahead < 1 || ahead > BUSINESS_CHANGE_AHEAD_DAYS) problems.push("starts_on");
  }

  const prefixes: Partial<Record<BusinessSeries, string>> = {};
  const given = raw.prefixes && typeof raw.prefixes === "object" ? (raw.prefixes as Record<string, unknown>) : {};
  for (const series of BUSINESS_SERIES) {
    const prefix = text(given[series]);
    if (!prefix) continue;
    if (PREFIX.test(prefix)) prefixes[series] = prefix;
    else if (!problems.includes("prefix")) problems.push("prefix");
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    change: {
      legalName,
      businessForm: form as BusinessForm,
      organisationNumber: orgNumber,
      vatRegistered,
      vatNumber,
      postalAddress: address || null,
      startsOn,
      prefixes,
    },
  };
}

/** What must be known before a change can take effect (`commerce.apply_business_change()` waits for it): empty when it is ready. */
export type BusinessChangeMissing = "organisation_number" | "vat_number";

export function businessChangeMissing(change: Pick<BusinessChangeInput, "organisationNumber" | "vatRegistered" | "vatNumber">): BusinessChangeMissing[] {
  const missing: BusinessChangeMissing[] = [];
  if (!change.organisationNumber) missing.push("organisation_number");
  if (change.vatRegistered && !change.vatNumber) missing.push("vat_number");
  return missing;
}

/** Where a planned change stands on a day of the store: days left before it, today, or overdue (its day came and it could not take effect). */
export type BusinessChangeWhen = { kind: "ahead"; days: number } | { kind: "today" } | { kind: "overdue"; days: number };

export function businessChangeWhen(startsOn: string, today: string): BusinessChangeWhen {
  const days = daysBetween(today, startsOn);
  if (days > 0) return { kind: "ahead", days };
  if (days === 0) return { kind: "today" };
  return { kind: "overdue", days: -days };
}

// The checklist (step 2) ---------------------------------------------------------------------------------------------------------------

/**
 * What must be set up again for the new business, in the order an owner meets it. `auto` steps are known from the store itself (done
 * when the store shows it); the rest the owner ticks when done, since they happen elsewhere (the bank, Stripe, the accounting system,
 * the clients). `info` steps say what Kaizena Flow does on its own.
 */
export const BUSINESS_STEPS = ["numbers", "vat", "series", "bank", "payments", "accounting", "legal", "plan", "clients", "einvoices"] as const;
export type BusinessStep = (typeof BUSINESS_STEPS)[number];
/** The steps an owner ticks themselves. */
export const TICKED_STEPS: readonly BusinessStep[] = ["bank", "payments", "accounting", "plan", "clients"];

export type BusinessStepState = "done" | "todo" | "info";
export type BusinessChecklistItem = { step: BusinessStep; state: BusinessStepState; tickable: boolean };

export type BusinessChecklistFacts = {
  change: Pick<BusinessChangeInput, "organisationNumber" | "vatRegistered" | "vatNumber">;
  /** The steps the owner ticked. */
  checked: readonly string[];
  /** Work is on: its invoices carry a bank account. */
  workOn: boolean;
  /** The store takes payments through Stripe or another provider. */
  takesPayments: boolean;
  /** The accounting system the store is connected to, and the organisation number of the company it books into (when it says). */
  accounting: { organisationNumber: string | null } | null;
  /** The store's legal pages that still name the old business. */
  legalPagesNamingOld: number;
  /** The store pays Kaizena Flow for a plan (Kaizena Flow's own store does not). */
  paysPlan: boolean;
  /** The store invoices businesses (Work, or selling to businesses): they are told who invoices them now. */
  invoicesBusinesses: boolean;
};

/** The checklist for a change, from what the store shows: steps that do not apply to it are left out. */
export function businessChecklist(f: BusinessChecklistFacts): BusinessChecklistItem[] {
  const ticked = (step: BusinessStep) => f.checked.includes(step);
  const items: BusinessChecklistItem[] = [
    { step: "numbers", state: f.change.organisationNumber ? "done" : "todo", tickable: false },
    { step: "vat", state: !f.change.vatRegistered || f.change.vatNumber ? "done" : "todo", tickable: false },
    { step: "series", state: "info", tickable: false },
  ];
  if (f.workOn) items.push({ step: "bank", state: ticked("bank") ? "done" : "todo", tickable: true });
  if (f.takesPayments) items.push({ step: "payments", state: ticked("payments") ? "done" : "todo", tickable: true });
  if (f.accounting) {
    const same = !!f.change.organisationNumber && f.accounting.organisationNumber?.replace(/\D/g, "") === f.change.organisationNumber.replace(/\D/g, "");
    items.push({ step: "accounting", state: same || ticked("accounting") ? "done" : "todo", tickable: !same });
  }
  items.push({ step: "legal", state: f.legalPagesNamingOld === 0 ? "done" : "todo", tickable: false });
  if (f.paysPlan) items.push({ step: "plan", state: ticked("plan") ? "done" : "todo", tickable: true });
  if (f.invoicesBusinesses) items.push({ step: "clients", state: ticked("clients") ? "done" : "todo", tickable: true });
  items.push({ step: "einvoices", state: "info", tickable: false });
  return items;
}

// Reports split at the date (step 3) ---------------------------------------------------------------------------------------------------

/** A report's period cut at a change of business inside it: each business's part, as `[from, to)` days. */
export type BusinessSplit = {
  /** The new business's first day. */
  on: string;
  before: { name: string; from: string; to: string };
  after: { name: string; from: string; to: string };
};

/**
 * Where a report's period (`from` inclusive, `to` exclusive, `YYYY-MM-DD`) spans a change of business that took effect, the part of each:
 * the documents of a day are the business's that was behind the store that day (the issuers apply the change first), so a period cut at
 * the day is a period cut by business. The latest change inside the period, or null when it holds none.
 */
export function businessSplit(changes: readonly { startsOn: string; legalName: string; beforeName: string | null }[], from: string, to: string): BusinessSplit | null {
  const inside = changes.filter((c) => c.startsOn > from && c.startsOn < to).sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  const c = inside[0];
  if (!c) return null;
  return { on: c.startsOn, before: { name: c.beforeName ?? "—", from, to: c.startsOn }, after: { name: c.legalName, from: c.startsOn, to } };
}
