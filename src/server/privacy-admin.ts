import "server-only";

import type { ErasurePlan } from "@/lib/erasure-plan";
import { countsLine } from "@/lib/erasure-plan";
import { EXPORT_SECTIONS } from "@/lib/personal-data";
import { countsOf, type ExportCounts } from "@/lib/privacy-export";
import { erasureConfirmed } from "@/lib/privacy-request";
import { privacyLanguage } from "@/lib/privacy-text";

import { eraseSubject, planErasure, type EraseResult } from "./privacy-erasure";
import { exportCustomerData, gatherExport, type ExportResult } from "./privacy-export";
import { requestFor, type RequestView } from "./privacy-requests";
import { privacyStore, subjectOf, type PrivacySubject } from "./privacy-subject";

/**
 * What the staff pages of one customer need (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3): the Privacy card, the erasure preview, the
 * download and the two-step erase. The customer is named by the page's own key (`findCustomer()`: an account, an order or a subscription of
 * this store); the pages and routes call these behind `requirePermission(slug, "customers:read")` for the card and the preview and
 * `customers:write` for the download and the erase, check `sameSite()` on the POSTs, and pass the signed-in staff member as `accountId`.
 * Nothing here returns a person's data: counts, dates and the plan.
 */

/** The English names of the export sections the card counts ("3 orders, 2 emails"). */
export const SECTION_LABELS: Record<(typeof EXPORT_SECTIONS)[number], string> = {
  profile: "account",
  addresses: "addresses",
  orders: "orders",
  invoices: "invoices",
  creditNotes: "credit notes",
  returns: "returns and withdrawals",
  subscriptions: "subscriptions",
  deliveries: "standing lists",
  wishlists: "wishlist entries",
  bonus: "credit entries",
  referrals: "referral records",
  consents: "consents",
  emails: "emails",
  carts: "carts",
  forms: "form submissions",
  company: "company records",
  customFields: "custom fields",
};

export type PrivacyCard = {
  subject: { kind: "account" | "guest"; customerId: string | null; email: string | null };
  /** What the file would hold, per section, and the line the card shows ("3 orders, 2 emails"). */
  counts: ExportCounts;
  countsLine: string;
  /** The open request for this person, if staff logged one. */
  request: RequestView | null;
  /** The request is open and past its day: the banner of the customer page. */
  overdue: boolean;
  /** The language the person is written to (the account's, else the latest order's, else the store's). */
  language: string;
};

/** The Privacy card of a customer's page, or null when the key is nobody's in this store. */
export async function privacyCard(storeId: string, key: string, now: Date = new Date()): Promise<PrivacyCard | null> {
  const subject = await subjectOf(storeId, key);
  if (!subject) return null;
  const store = await privacyStore(storeId);
  if (!store) return null;
  const language = privacyLanguage(subject.locale ?? store.mainLocale);
  const input = await gatherExport(subject, language, now);
  const counts = input ? countsOf(input) : (Object.fromEntries(EXPORT_SECTIONS.map((s) => [s, 0])) as ExportCounts);
  const request = await requestFor(storeId, { customerId: subject.customerId, email: subject.email }, now);
  return {
    subject: { kind: subject.customerId ? "account" : "guest", customerId: subject.customerId, email: subject.email },
    counts,
    countsLine: countsLine(counts, EXPORT_SECTIONS.map((s) => ({ key: s, label: SECTION_LABELS[s] }))),
    request,
    overdue: request?.overdue ?? false,
    language,
  };
}

/** Step 1 of the erase page: what erasing would do, read-only, by the same code as the run. */
export async function erasurePreview(storeId: string, key: string, now: Date = new Date()): Promise<{ plan: ErasurePlan; email: string | null; request: RequestView | null } | null> {
  const subject: PrivacySubject | null = await subjectOf(storeId, key);
  if (!subject) return null;
  const planned = await planErasure(subject, now);
  if (!planned) return null;
  return { plan: planned.plan, email: subject.email, request: await requestFor(storeId, { customerId: subject.customerId, email: subject.email }, now) };
}

export type StaffActor = { storeId: string; accountId: string; requestId?: string | null; adminUrl?: string | null };

/** The file for staff (`customers:write`): audit-logged, completes the open request, tells the owners. */
export async function staffExport(actor: StaffActor, key: string, deps: { rowLimit?: number; now?: Date } = {}): Promise<ExportResult> {
  const subject = await subjectOf(actor.storeId, key);
  if (!subject) return { ok: false, problem: "not_found" };
  return exportCustomerData(
    actor.storeId,
    { customerId: subject.customerId, email: subject.email },
    { channel: "staff", accountId: actor.accountId, requestId: actor.requestId ?? null, adminUrl: actor.adminUrl ?? null, rowLimit: deps.rowLimit, now: deps.now },
  );
}

export type StaffEraseResult = EraseResult | { ok: false; problem: "confirm"; message: string; requestId: null };

/**
 * Step 2 of the erase page (`customers:write`): the staff member types the person's email address (or the word ERASE for a subject with none)
 * and the run starts. A wrong confirmation changes nothing. Owners are told, the log holds counts and ids only.
 */
export async function staffErase(actor: StaffActor, key: string, typed: string, deps: { now?: Date } = {}): Promise<StaffEraseResult> {
  const subject = await subjectOf(actor.storeId, key);
  if (!subject) return { ok: false, problem: "not_found", message: "There is nobody with that key in this store.", requestId: null };
  if (!erasureConfirmed(typed, subject.email)) {
    return { ok: false, problem: "confirm", message: subject.email ? "Type the customer's email address exactly to confirm." : "Type ERASE to confirm.", requestId: null };
  }
  return eraseSubject(
    actor.storeId,
    { customerId: subject.customerId, email: subject.email },
    { channel: "staff", accountId: actor.accountId, requestId: actor.requestId ?? null, adminUrl: actor.adminUrl ?? null, now: deps.now },
  );
}
