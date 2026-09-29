import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db, readDb, type Db } from "@/db/client";
import { formatMoney } from "@/lib/money";
import {
  computeLine,
  effectiveRate,
  lineDescription,
  lineFromTask,
  mayMirrorHours,
  minutesToHundredths,
  MAX_QUANTITY_HUNDREDTHS,
  planLineTaskSync,
  rateToBp,
  timeAmountMinor,
  totalsOf,
  type BillingType,
  type InvoiceTotals,
} from "@/lib/work-calc";
import { isOverdue, daysOverdue, resolvePaymentDays, tentativeDueOn } from "@/lib/work-dates";
import {
  addressText,
  creditNoteInput,
  invoiceInput,
  issueInvoiceInput,
  MANUAL_PAYMENT_METHODS,
  MAX_INVOICE_LINES,
  recordPaymentInput,
  reversePaymentInput,
  invoiceDraftInput,
  type BillingAddress,
  type InvoiceLineInput,
} from "@/lib/work-input";
import {
  creditNoteWording,
  defaultLatePaymentNote,
  documentLabels,
  documentLanguage,
  type DocumentLabels,
  type DocumentLanguage,
} from "@/lib/work-invoice-text";
import {
  alignCategory,
  priceInvoice,
  vatNotesFor,
  workInvoiceReadiness,
  type ReadinessProblem,
  type VatContext,
  type VatLineCategory,
  type VatNoteKey,
  type VatTreatment,
} from "@/lib/work-vat";

import { workEvent } from "./work";
import {
  notReadyCodes,
  problem,
  readinessMessage,
  workErrorCode,
  workErrorMessage,
  workErrorParts,
  workProblems,
  zodProblems,
} from "./work-errors";

type Row = Record<string, unknown>;
type Runner = Pick<Db, "execute">;

/**
 * Work's invoices (docs/work.md 4.2 to 4.9, 7.2 WP4): drafts, their lines, the
 * mirror between tasks and lines, time turned into lines, issuing, credit
 * notes, payments and everything the screens and documents read.
 *
 * The rules that make a document legal live in the database and are only
 * called from here: `commerce.issue_work_invoice()` numbers (gap-free), freezes
 * the amounts and snapshots seller and buyer in one transaction, and
 * `commerce.credit_work_invoice()` issues the credit notes; triggers keep the
 * status in step with the payments and write `payment.*`, `invoice.issued`,
 * `invoice.credited`, `invoice.paid` and `invoice.reopened` to `work_events`,
 * so nothing here writes those. Amounts on a draft are worked out with
 * `work-calc.ts` for the live preview only and written back so lists can show
 * them; at issue the database recomputes every line and the total it comes to
 * is what is issued, read back, never a total sent by a browser (a browser may
 * only say what total it saw, and issuing is refused if that moved).
 *
 * Money is integer minor units, quantities hundredths, time integer minutes,
 * days `YYYY-MM-DD` text and moments ISO text; everything returned is plain and
 * serialisable. Every query takes the store's id; a row of another store is not
 * found (the composite foreign keys refuse it as well).
 */

// --- Shapes ---------------------------------------------------------------------

/** Who does it: a member of the store, or nobody (the system: a cron issuing a repeating invoice). Any `Membership` fits. */
export type WorkActor = { account: { id: string } | null; store: { id: string } };

/** Like `WorkResult`, and a failure may carry a `code` for the one thing a person can confirm (`date_before_previous`). */
export type InvoiceResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; problems: string[]; code?: string };

const fail = (code: string, ...problems: string[]): { ok: false; problems: string[]; code: string } => ({
  ok: false,
  problems,
  code,
});

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export type InvoiceLine = {
  id: string;
  position: number;
  assignmentId: string | null;
  taskId: string | null;
  description: string;
  unit: "hour" | "unit";
  quantityHundredths: number;
  unitPriceMinor: number;
  discountBp: number;
  vatCategory: VatLineCategory;
  /** The VAT rate in basis points: frozen on an issued invoice, the preview's on a draft. */
  vatBp: number;
  exclMinor: number;
  vatMinor: number;
  inclMinor: number;
  /** Before the discount less the discounted amount, for display. */
  discountMinor: number;
  quantityManual: boolean;
  /** Minutes of logged time attached to the line, less what prepaid hours covered. */
  timeMinutes: number;
  /** How much of the quantity credit notes have taken back (issued invoices). */
  creditedQuantityHundredths: number;
};

export type SellerSnapshot = {
  legalName: string | null;
  organisationNumber: string | null;
  vatRegistered: boolean;
  vatNumber: string | null;
  address: string | null;
  country: string | null;
  email: string | null;
  bankAccount: string | null;
  bic: string | null;
  paymentNote: string | null;
  invoiceFooter: string | null;
  latePaymentNote: string | null;
};

export type BuyerSnapshot = {
  /** The name on the document: the client's legal name, else its name. */
  name: string | null;
  clientName: string | null;
  organisationNumber: string | null;
  vatNumber: string | null;
  address: Partial<BillingAddress>;
  country: string | null;
  email: string | null;
  contactName: string | null;
  business: boolean;
  vatTreatment: VatTreatment;
};

export type InvoiceHeader = {
  id: string;
  status: InvoiceStatus;
  documentNumber: string | null;
  number: number | null;
  clientId: string;
  assignmentId: string | null;
  recurringInvoiceId: string | null;
  currency: string;
  /** The document's language tag: frozen at issue, until then the client's, else the store's. */
  locale: string;
  /** The invoice's own payment terms; null follows the client's and the settings'. */
  paymentDays: number | null;
  /** The terms that apply: the invoice's, the client's, the settings', or 14. */
  effectivePaymentDays: number;
  issuedOn: string | null;
  dueOn: string | null;
  /** For a draft: what the due date would be if it were issued today. */
  tentativeDueOn: string | null;
  sentAt: string | null;
  paidAt: string | null;
  serviceFrom: string | null;
  serviceTo: string | null;
  notes: string | null;
  reference: string | null;
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
  vatHomeMinor: number | null;
  fxRate: string | null;
  vatNotes: VatNoteKey[];
  publicToken: string | null;
  sentTo: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceAmounts = { totalMinor: number; paidMinor: number; creditedMinor: number; outstandingMinor: number };

export type InvoicePayment = {
  id: string;
  amountMinor: number;
  currency: string;
  receivedOn: string;
  method: string;
  reference: string | null;
  /** The payment this row takes back. */
  reverses: string | null;
  /** A received payment that a later row has taken back. */
  reversed: boolean;
  /** Money paid back (a negative row that is not a reversal). */
  refund: boolean;
  recordedByName: string | null;
  createdAt: string;
};

export type CreditNoteLine = {
  lineId: string;
  position: number;
  description: string;
  unit: "hour" | "unit";
  quantityHundredths: number;
  unitPriceMinor: number;
  discountBp: number;
  vatCategory: VatLineCategory;
  vatBp: number;
  exclMinor: number;
  vatMinor: number;
  inclMinor: number;
};

export type CreditNoteSummary = {
  id: string;
  documentNumber: string;
  issuedOn: string;
  currency: string;
  reason: string | null;
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
  lines: CreditNoteLine[];
  createdAt: string;
  createdByName: string | null;
};

export type InvoiceEvent = {
  id: number;
  type: string;
  data: Record<string, unknown>;
  at: string;
  accountName: string | null;
};

/** One thing to fix before an invoice can be issued (or, as a warning, to look at). */
export type InvoiceProblem = Omit<ReadinessProblem, "code"> & { code: string };

export type InvoiceReadiness = {
  ready: boolean;
  problems: InvoiceProblem[];
  /** The invoice is in another currency than the seller's country's: issuing needs an exchange rate for the VAT. */
  needsFxRate: boolean;
  /** The seller's country's currency (what the VAT is also stated in). */
  homeCurrency: string | null;
};

export type InvoiceClient = {
  id: string;
  name: string;
  legalName: string | null;
  organisationNumber: string | null;
  vatNumber: string | null;
  country: string | null;
  billingAddress: Partial<BillingAddress>;
  billingEmail: string | null;
  contactName: string | null;
  locale: string | null;
  currency: string;
  business: boolean;
  vatTreatment: VatTreatment;
  archived: boolean;
};

export type InvoiceDetail = {
  invoice: InvoiceHeader;
  /** The client as it is now (links and drafts); an issued invoice's document is `invoice.seller`/`buyer`, frozen. */
  client: InvoiceClient;
  assignment: { id: string; name: string; billingType: BillingType } | null;
  /** The seller and buyer as they were when it was issued; null for a draft. */
  seller: SellerSnapshot | null;
  buyer: BuyerSnapshot | null;
  lines: InvoiceLine[];
  /** A draft's are the preview; an issued invoice's are read back from what was frozen. */
  totals: InvoiceTotals;
  amounts: InvoiceAmounts;
  payments: InvoicePayment[];
  creditNotes: CreditNoteSummary[];
  events: InvoiceEvent[];
  /** For a draft: the checklist before it can be issued. */
  readiness: InvoiceReadiness | null;
  /** For an issued invoice: today in the store's time zone, and whether it is overdue. */
  today: string;
  overdue: boolean;
  daysOverdue: number;
  /** Whether any credit note has been issued; and whether one covers the whole invoice. */
  credited: boolean;
};

// --- Small helpers -----------------------------------------------------------------

const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;
const iso = (value: unknown): string => new Date(String(value)).toISOString();
const isoOrNull = (value: unknown): string | null => (value ? iso(value) : null);
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

/** A whole number from the database (bigint arrives as text), refused if it could not be counted exactly. */
function int(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n)) throw new RangeError(`Not a safe integer: ${String(value)}`);
  return n;
}

const intOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : int(value));

const jsonb = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;

const isoDay = z.iso.date("Give the day as a date.");
const LINE_QTY_CAP = MAX_QUANTITY_HUNDREDTHS;

/** Thrown inside a transaction to roll it back and hand the person a message. */
class Abort extends Error {
  constructor(
    readonly problems: string[],
    readonly code?: string,
  ) {
    super(problems.join(" "));
  }
}

/** Runs a write: an `Abort` or what the database's rules refuse becomes a failed result, anything else is a bug and propagates. */
async function guarded<T extends object>(
  run: () => Promise<InvoiceResult<T>>,
  explain?: (error: unknown) => InvoiceResult<T> | null,
): Promise<InvoiceResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Abort) return { ok: false, problems: error.problems, code: error.code };
    const custom = explain?.(error);
    if (custom) return custom;
    const problems = workProblems(error);
    if (problems) return { ok: false, problems, code: workErrorCode(error) ?? undefined };
    throw error;
  }
}

async function today(run: Runner, storeId: string): Promise<string> {
  const [row] = await run.execute<Row>(sql`select commerce.work_today(${storeId}::uuid)::text as today`);
  return String(row.today);
}

// --- The seller, the client and the VAT they make (what a draft is priced with) ----------------

type SellerRow = {
  legalName: string | null;
  organisationNumber: string | null;
  postalAddress: string | null;
  country: string | null;
  contactEmail: string | null;
  vatRegistered: boolean;
  vatNumber: string | null;
  bankAccount: string | null;
  bic: string | null;
  paymentNote: string | null;
  invoiceFooter: string | null;
  latePaymentNote: string | null;
  defaultPaymentDays: number | null;
  defaultCurrency: string | null;
  mainLocale: string | null;
  homeCurrency: string | null;
  standardRateBp: number;
  timeZone: string;
};

async function loadSeller(run: Runner, storeId: string): Promise<SellerRow> {
  const [row] = await run.execute<Row>(sql`
    select st.legal_name, st.organisation_number, st.postal_address, st.country, st.contact_email, st.time_zone,
           st.locales[1] as main_locale,
           coalesce(ws.vat_registered, true) as vat_registered, ws.vat_number, ws.bank_account, ws.bic,
           ws.payment_note, ws.invoice_footer, ws.late_payment_note, ws.default_payment_days, ws.default_currency,
           co.currency as home_currency,
           coalesce(round(commerce.vat_rate(st.country, 'standard') * 10000), 0)::int as standard_bp
    from commerce.stores st
    left join commerce.work_settings ws on ws.store_id = st.id
    left join commerce.countries co on co.code = st.country
    where st.id = ${storeId}::uuid
  `);
  if (!row) throw new Error("The store does not exist.");
  return {
    legalName: text(row.legal_name),
    organisationNumber: text(row.organisation_number),
    postalAddress: text(row.postal_address),
    country: text(row.country),
    contactEmail: text(row.contact_email),
    vatRegistered: Boolean(row.vat_registered),
    vatNumber: text(row.vat_number),
    bankAccount: text(row.bank_account),
    bic: text(row.bic),
    paymentNote: text(row.payment_note),
    invoiceFooter: text(row.invoice_footer),
    latePaymentNote: text(row.late_payment_note),
    defaultPaymentDays: intOrNull(row.default_payment_days),
    defaultCurrency: text(row.default_currency),
    mainLocale: text(row.main_locale),
    homeCurrency: text(row.home_currency),
    standardRateBp: int(row.standard_bp),
    timeZone: String(row.time_zone),
  };
}

type ClientRow = InvoiceClient & { defaultHourlyRateMinor: number | null; paymentDays: number | null };

const toClient = (row: Row): ClientRow => ({
  id: String(row.id),
  name: String(row.name),
  legalName: text(row.legal_name),
  organisationNumber: text(row.organisation_number),
  vatNumber: text(row.vat_number),
  country: text(row.country),
  billingAddress: (row.billing_address ?? {}) as Partial<BillingAddress>,
  billingEmail: text(row.billing_email),
  contactName: text(row.contact_name),
  locale: text(row.locale),
  currency: String(row.currency),
  business: Boolean(row.business),
  vatTreatment: String(row.vat_treatment) as VatTreatment,
  archived: row.archived_at !== null && row.archived_at !== undefined,
  defaultHourlyRateMinor: intOrNull(row.default_hourly_rate_minor),
  paymentDays: intOrNull(row.payment_days),
});

async function loadClient(run: Runner, storeId: string, clientId: string): Promise<ClientRow | null> {
  if (!isUuid(clientId)) return null;
  const [row] = await run.execute<Row>(sql`
    select id, name, legal_name, organisation_number, vat_number, country::text as country, billing_address, billing_email,
           contact_name, locale, currency::text as currency, business, vat_treatment, archived_at,
           default_hourly_rate_minor, payment_days
    from commerce.work_clients where store_id = ${storeId}::uuid and id = ${clientId}::uuid
  `);
  return row ? toClient(row) : null;
}

const vatContext = (seller: SellerRow, client: Pick<ClientRow, "business" | "vatTreatment">): VatContext => ({
  sellerVatRegistered: seller.vatRegistered,
  clientTreatment: client.vatTreatment,
  clientBusiness: client.business,
  standardRateBp: seller.standardRateBp,
});

/** The category a line must have for the client's VAT treatment: in `work-vat.ts`, shared with the editor's live totals. */
export { alignCategory };

type PricedLine = {
  id: string;
  vatCategory: VatLineCategory;
  vatBp: number;
  exclMinor: number;
  vatMinor: number;
  inclMinor: number;
  discountMinor: number;
};

type DraftLine = {
  id: string;
  quantityHundredths: number;
  unitPriceMinor: number;
  discountBp: number;
  vatCategory: VatLineCategory;
};

/** A draft's lines priced as the database will issue them (the live preview). Exact integer arithmetic. */
function priceDraft(
  ctx: VatContext,
  lines: readonly DraftLine[],
): { lines: PricedLine[]; totals: InvoiceTotals; noteKeys: VatNoteKey[] } {
  const priced = priceInvoice(
    ctx,
    lines.map((l) => ({
      quantityHundredths: l.quantityHundredths,
      unitPriceMinor: l.unitPriceMinor,
      discountBp: l.discountBp,
      category: alignCategory(ctx, l.vatCategory),
    })),
  );
  return {
    lines: priced.lines.map((p, i) => ({
      id: lines[i].id,
      vatCategory: p.vatCategory,
      vatBp: p.vatBp,
      exclMinor: p.exclMinor,
      vatMinor: p.vatMinor,
      inclMinor: p.inclMinor,
      discountMinor: p.discountMinor,
    })),
    totals: priced.totals,
    noteKeys: priced.noteKeys,
  };
}

async function draftLines(run: Runner, storeId: string, invoiceId: string): Promise<DraftLine[]> {
  const rows = await run.execute<Row>(sql`
    select id, quantity_hundredths, unit_price_minor, discount_bp, vat_category
    from commerce.work_invoice_lines
    where store_id = ${storeId}::uuid and invoice_id = ${invoiceId}::uuid
    order by position, created_at, id
  `);
  return rows.map((r) => ({
    id: String(r.id),
    quantityHundredths: int(r.quantity_hundredths),
    unitPriceMinor: int(r.unit_price_minor),
    discountBp: int(r.discount_bp),
    vatCategory: String(r.vat_category) as VatLineCategory,
  }));
}

/**
 * Aligns a draft's lines with the client's VAT treatment, prices them, and writes the amounts
 * back to the lines and the header (kept current while it is a draft; the database recomputes
 * everything at issue). Returns the preview. The caller holds the invoice's row lock.
 */
async function refreshDraft(run: Runner, storeId: string, invoiceId: string, clientId: string) {
  // One after another: a transaction has one connection, which takes one query at a time.
  const seller = await loadSeller(run, storeId);
  const client = await loadClient(run, storeId, clientId);
  const lines = await draftLines(run, storeId, invoiceId);

  if (!client) throw new Abort(["The client of this invoice no longer exists."]);
  const ctx = vatContext(seller, client);
  const preview = priceDraft(ctx, lines);
  if (lines.length > 0) {
    const rows = preview.lines.map((p) => ({
      id: p.id,
      category: p.vatCategory,
      rate: `${Math.floor(p.vatBp / 10_000)}.${String(p.vatBp % 10_000).padStart(4, "0")}`,
      excl: p.exclMinor,
      vat: p.vatMinor,
      incl: p.inclMinor,
    }));
    await run.execute(sql`
      update commerce.work_invoice_lines l
         set vat_category = v.category, vat_rate = v.rate, excl_minor = v.excl, vat_minor = v.vat, incl_minor = v.incl,
             updated_at = now()
        from jsonb_to_recordset(${jsonb(rows)}) as v(id uuid, category text, rate numeric, excl bigint, vat bigint, incl bigint)
       where l.store_id = ${storeId}::uuid and l.id = v.id
         and (l.vat_category, l.vat_rate, l.excl_minor, l.vat_minor, l.incl_minor)
             is distinct from (v.category, v.rate, v.excl, v.vat, v.incl)
    `);
  }
  await run.execute(sql`
    update commerce.work_invoices
       set subtotal_minor = ${preview.totals.subtotalMinor}, vat_minor = ${preview.totals.vatMinor},
           total_minor = ${preview.totals.totalMinor}, updated_at = now()
     where store_id = ${storeId}::uuid and id = ${invoiceId}::uuid and status = 'draft'
       and (subtotal_minor, vat_minor, total_minor)
           is distinct from (${preview.totals.subtotalMinor}, ${preview.totals.vatMinor}, ${preview.totals.totalMinor})
  `);
  return { preview, seller, client };
}

type LockedInvoice = {
  id: string;
  status: InvoiceStatus;
  clientId: string;
  assignmentId: string | null;
  currency: string;
};

/** Locks an invoice for the rest of the transaction; null when it is not this store's. */
async function lockInvoice(run: Runner, storeId: string, invoiceId: string): Promise<LockedInvoice | null> {
  if (!isUuid(invoiceId)) return null;
  const [row] = await run.execute<Row>(sql`
    select id, status, client_id, assignment_id, currency::text as currency
    from commerce.work_invoices
    where store_id = ${storeId}::uuid and id = ${invoiceId}::uuid
    for update
  `);
  return row
    ? {
        id: String(row.id),
        status: String(row.status) as InvoiceStatus,
        clientId: String(row.client_id),
        assignmentId: text(row.assignment_id),
        currency: String(row.currency),
      }
    : null;
}

const NOT_FOUND = "This invoice no longer exists.";
const ISSUED = "This invoice has been issued and can no longer be changed. Credit it and issue a new one.";

/** A draft that is this store's, locked; or the failure to hand back. */
async function lockDraft(run: Runner, storeId: string, invoiceId: string): Promise<LockedInvoice> {
  const invoice = await lockInvoice(run, storeId, invoiceId);
  if (!invoice) throw new Abort([NOT_FOUND]);
  if (invoice.status !== "draft") throw new Abort([ISSUED], "not_draft");
  return invoice;
}

// --- The checklist before issuing -------------------------------------------------------------

/** What a code of `commerce.work_invoice_problems()` means, and where to fix it. */
const SQL_PROBLEMS: Record<string, { code: string; where: ReadinessProblem["where"] }> = {
  seller_name: { code: "seller_legal_name", where: "company" },
  seller_address: { code: "seller_address", where: "company" },
  seller_country: { code: "seller_country", where: "company" },
  seller_organisation_number: { code: "seller_organisation_number", where: "company" },
  seller_vat_number: { code: "seller_vat_number", where: "settings" },
  seller_bank_account: { code: "seller_bank_account", where: "settings" },
  buyer_address: { code: "buyer_address", where: "client" },
  buyer_country: { code: "buyer_country", where: "client" },
  buyer_vat_number: { code: "buyer_vat_number", where: "client" },
  no_lines: { code: "no_lines", where: "invoice" },
  zero_total: { code: "zero_total", where: "invoice" },
  vat_category_mismatch: { code: "vat_category_mismatch", where: "invoice" },
};

const FX_RATE = /^(\d{1,9})(?:\.(\d{1,8}))?$/;

/** An exchange rate as typed ("11,5" or "11.50"), as the decimal text the database takes; null if it is not a usable rate. */
export function parseFxRate(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").trim().replace(",", ".");
  const match = FX_RATE.exec(cleaned);
  if (!match || Number(cleaned) <= 0) return null;
  return cleaned;
}

/**
 * Everything to check before a draft may be issued: the seller's identity and payment details, the
 * client's, the VAT treatment's requirements and the lines, as the owner reads them (the pure
 * `workInvoiceReadiness()`), plus what the database's own checklist (`work_invoice_problems()`)
 * finds that that does not, so `ready` is never true where issuing would be refused.
 */
async function readinessOf(
  run: Runner,
  storeId: string,
  invoice: Pick<LockedInvoice, "id" | "clientId" | "currency">,
  fxRate: string | null,
): Promise<InvoiceReadiness> {
  const seller = await loadSeller(run, storeId);
  const client = await loadClient(run, storeId, invoice.clientId);
  const lines = await draftLines(run, storeId, invoice.id);
  const sqlRows = await run.execute<Row>(
    sql`select commerce.work_invoice_problems(${storeId}::uuid, ${invoice.id}::uuid) as problems`,
  );

  if (!client) return { ready: false, problems: [], needsFxRate: false, homeCurrency: null };
  const preview = priceDraft(vatContext(seller, client), lines);
  const descriptions = await run.execute<Row>(sql`
    select id, description from commerce.work_invoice_lines
    where store_id = ${storeId}::uuid and invoice_id = ${invoice.id}::uuid
  `);
  const described = new Map(descriptions.map((r) => [String(r.id), String(r.description)]));
  const js = workInvoiceReadiness({
    seller: {
      legalName: seller.legalName,
      organisationNumber: seller.organisationNumber,
      postalAddress: seller.postalAddress,
      country: seller.country,
      vatRegistered: seller.vatRegistered,
      vatNumber: seller.vatNumber,
      bankAccount: seller.bankAccount,
    },
    buyer: {
      name: client.legalName || client.name,
      address: addressText(client.billingAddress),
      country: client.country,
      business: client.business,
      vatNumber: client.vatNumber,
      vatTreatment: client.vatTreatment,
    },
    currency: invoice.currency,
    sellerHomeCurrency: seller.homeCurrency,
    fxRate,
    lines: preview.lines.map((l) => ({
      description: described.get(l.id) ?? "",
      exclMinor: l.exclMinor,
      vatCategory: l.vatCategory,
      vatBp: l.vatBp,
    })),
  });

  const problems: InvoiceProblem[] = [...js.problems];
  const have = new Set(problems.map((p) => p.code));
  const sqlCodes = ((sqlRows[0]?.problems ?? []) as string[]) ?? [];
  for (const code of sqlCodes) {
    const known = SQL_PROBLEMS[code];
    if (!known || have.has(known.code)) continue;
    // The alignment below makes categories fit; only a draft nobody has aligned yet shows this.
    if (code === "vat_category_mismatch") continue;
    problems.push({
      code: known.code,
      severity: "error",
      where: known.where,
      message:
        code === "buyer_address"
          ? "Add the client's billing address: street, postal code and city."
          : readinessMessage(code),
    });
    have.add(known.code);
  }
  const needsFxRate = Boolean(seller.homeCurrency && invoice.currency !== seller.homeCurrency);
  if (needsFxRate && !parseFxRate(fxRate) && !have.has("vat_home_amount")) {
    problems.push({
      code: "fx_rate_required",
      severity: "error",
      where: "invoice",
      message: `The invoice is in ${invoice.currency}, and your country's currency is ${seller.homeCurrency}: enter the exchange rate for the issue date.`,
    });
  }
  return {
    ready: problems.every((p) => p.severity !== "error"),
    problems,
    needsFxRate,
    homeCurrency: seller.homeCurrency,
  };
}

/**
 * The checklist for a draft: what is missing before it can be issued, so the owner can fix it all at
 * once. `fxRate` is the exchange rate typed so far. Null for an invoice that is not this store's.
 */
export async function invoiceReadiness(
  storeId: string,
  invoiceId: string,
  options: { fxRate?: string | null } = {},
): Promise<InvoiceReadiness | null> {
  if (!isUuid(invoiceId)) return null;
  const [row] = await readDb().execute<Row>(sql`
    select id, status, client_id, assignment_id, currency::text as currency
    from commerce.work_invoices where store_id = ${storeId}::uuid and id = ${invoiceId}::uuid
  `);
  if (!row) return null;
  if (String(row.status) !== "draft") return { ready: false, problems: [], needsFxRate: false, homeCurrency: null };
  return readinessOf(
    readDb(),
    storeId,
    { id: String(row.id), clientId: String(row.client_id), currency: String(row.currency) },
    parseFxRate(options.fxRate),
  );
}

/**
 * A suggestion for the exchange rate at issue, from the store's own rates (units of the seller's
 * currency per 1 of the invoice's, as text with 8 decimals). Only a suggestion: the person checks
 * it against the ECB reference rate for the issue date, and issuing takes the rate they confirm.
 */
export function suggestFxRate(
  rates: ReadonlyMap<string, { rate: number | null }>,
  homeCurrency: string,
  invoiceCurrency: string,
): string | null {
  if (homeCurrency === invoiceCurrency) return "1.00000000";
  const rateOf = (c: string) => (c === "EUR" ? 1 : (rates.get(c)?.rate ?? null));
  const home = rateOf(homeCurrency);
  const foreign = rateOf(invoiceCurrency);
  if (!home || !foreign || home <= 0 || foreign <= 0) return null;
  return (home / foreign).toFixed(8);
}

// --- Numbering preview ---------------------------------------------------------------------------

/** The number the next invoice will get, as it will be printed (`W-12`). Not reserved: the number is taken at issue. */
export async function nextInvoiceNumberPreview(storeId: string): Promise<string | null> {
  const [row] = await readDb().execute<Row>(sql`
    select prefix, next_number from commerce.document_series
    where store_id = ${storeId}::uuid and series = 'work_invoice'
  `);
  return row ? `${String(row.prefix)}${String(row.next_number)}` : null;
}

// --- Creating a draft -------------------------------------------------------------------------------

const createInput = z.object({
  clientId: z.string().nullish(),
  assignmentId: z.string().nullish(),
  currency: z.string().nullish(),
});

/**
 * Starts a draft invoice for a client, for one of its assignments (at most one draft each) or on
 * its own. The currency starts as the client's; payment terms, language and VAT treatment follow
 * the client and the settings until issued, so nothing is copied that a later change would not
 * reach. Lines come next: from time (`generateLinesFromTime`) or typed (`saveLines`).
 */
export async function createDraftInvoice(
  actor: WorkActor,
  raw: unknown,
): Promise<InvoiceResult<{ invoiceId: string }>> {
  const storeId = actor.store.id;
  const start = createInput.safeParse(raw);
  if (!start.success) return problem(...zodProblems(start.error));
  return guarded(() =>
    db().transaction(async (tx): Promise<InvoiceResult<{ invoiceId: string }>> => {
      let clientId = start.data.clientId || null;
      let assignmentId = start.data.assignmentId || null;
      if (assignmentId) {
        if (!isUuid(assignmentId)) return problem("This assignment no longer exists.");
        const [assignment] = await tx.execute<Row>(sql`
          select client_id from commerce.work_assignments where store_id = ${storeId}::uuid and id = ${assignmentId}::uuid
        `);
        if (!assignment) return problem("This assignment no longer exists.");
        if (clientId && clientId !== String(assignment.client_id))
          return problem("The assignment belongs to another client.");
        clientId = String(assignment.client_id);
        const [existing] = await tx.execute<Row>(sql`
          select id from commerce.work_invoices
          where store_id = ${storeId}::uuid and assignment_id = ${assignmentId}::uuid and status = 'draft'
        `);
        if (existing) {
          return fail(
            "draft_exists",
            "This assignment already has a draft invoice. Finish or delete it before starting another.",
          ) as InvoiceResult<{ invoiceId: string }>;
        }
      } else {
        assignmentId = null;
      }
      if (!clientId) return problem("Choose the client to invoice.");
      const client = await loadClient(tx, storeId, clientId);
      if (!client) return problem("This client no longer exists.");
      if (client.archived) return problem("This client is archived. Restore it before invoicing it.");

      const parsed = invoiceDraftInput.safeParse({
        ...(raw && typeof raw === "object" ? raw : {}),
        clientId,
        assignmentId,
        currency: start.data.currency || client.currency,
      });
      if (!parsed.success) return problem(...zodProblems(parsed.error));
      const input = parsed.data;
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.work_invoices (store_id, client_id, assignment_id, currency, payment_days, service_from,
                                            service_to, notes, reference, created_by)
        values (${storeId}::uuid, ${input.clientId}::uuid, ${input.assignmentId}::uuid, ${input.currency},
                ${input.paymentDays}, ${input.serviceFrom}::date, ${input.serviceTo}::date, ${input.notes},
                ${input.reference}, ${actor.account?.id ?? null}::uuid)
        returning id
      `);
      const invoiceId = String(row.id);
      await workEvent(
        tx,
        storeId,
        "invoice",
        invoiceId,
        "invoice.created",
        { client_id: input.clientId, assignment_id: input.assignmentId, currency: input.currency },
        actor.account?.id ?? null,
      );
      return { ok: true, invoiceId };
    }),
  );
}

// --- Saving a draft -------------------------------------------------------------------------------------

/** What a browser must never send: the amounts are worked out here, and only here. */
const FORBIDDEN_AMOUNTS = new Set([
  "totalminor",
  "subtotalminor",
  "vatminor",
  "exclminor",
  "inclminor",
  "grossminor",
  "discountminor",
  "vatbp",
  "vatrate",
  "totals",
  "amounts",
]);

/** The first amount a browser sent that only the server may decide, or null. */
function sentAmounts(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 3) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = sentAmounts(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [key, inner] of Object.entries(value)) {
    if (FORBIDDEN_AMOUNTS.has(key.toLowerCase())) return key;
    const found = sentAmounts(inner, depth + 1);
    if (found) return found;
  }
  return null;
}

const AMOUNTS_REFUSED =
  "Amounts and totals are worked out by the server from quantity, price, discount and VAT category; they cannot be sent.";

export type SavedLine = { id: string; position: number; taskId: string | null };

export type DraftSaved = {
  /** The lines in the order saved, with the ids new ones got and the task each is paired with. */
  lines: SavedLine[];
  /** The live preview: what the database will issue the draft as, worked out exactly. */
  preview: { lines: PricedLine[]; totals: InvoiceTotals };
};

/**
 * Applies a whole draft: the header and every line, in the browser's order. Lines are upserted by id
 * (a save keeps the ids, so pairings with tasks and attached time survive, and new rows get theirs
 * back), missing ones are deleted (their time is released), and each line's position is its place in
 * the list. On an invoice with an assignment, lines and tasks are kept as one piece of work
 * (`planLineTaskSync`): an unpaired line gets a task, a renamed line renames its task, and the task
 * of a removed line goes too unless time was logged on it.
 */
async function applyDraft(
  tx: Db,
  storeId: string,
  accountId: string | null,
  invoice: LockedInvoice,
  header: z.infer<typeof invoiceInput> | null,
  lines: readonly InvoiceLineInput[],
): Promise<DraftSaved> {
  if (header) {
    await tx.execute(sql`
      update commerce.work_invoices
         set currency = ${header.currency}, payment_days = ${header.paymentDays}, service_from = ${header.serviceFrom}::date,
             service_to = ${header.serviceTo}::date, notes = ${header.notes}, reference = ${header.reference}, updated_at = now()
       where store_id = ${storeId}::uuid and id = ${invoice.id}::uuid
    `);
  }

  const existing = new Map(
    (
      await tx.execute<Row>(sql`
        select id, task_id from commerce.work_invoice_lines
        where store_id = ${storeId}::uuid and invoice_id = ${invoice.id}::uuid
      `)
    ).map((r) => [String(r.id), { taskId: text(r.task_id) }]),
  );

  // What the lines point at must be this client's assignment, and a task of the line's own assignment.
  const assignmentIds = [...new Set(lines.map((l) => l.assignmentId).filter((id): id is string => Boolean(id)))];
  if (assignmentIds.length > 0) {
    const found = await tx.execute<Row>(sql`
      select id from commerce.work_assignments
      where store_id = ${storeId}::uuid and client_id = ${invoice.clientId}::uuid
        and id in (select jsonb_array_elements_text(${jsonb(assignmentIds)})::uuid)
    `);
    if (found.length !== assignmentIds.length)
      throw new Abort(["A line points at an assignment that is not this client's."]);
  }
  const wantedTaskIds = [
    ...new Set(lines.filter((l) => !(l.id && existing.has(l.id)) && l.taskId).map((l) => l.taskId as string)),
  ];
  const taskAssignment = new Map<string, string>();
  if (wantedTaskIds.length > 0) {
    const found = await tx.execute<Row>(sql`
      select id, assignment_id from commerce.work_tasks
      where store_id = ${storeId}::uuid and id in (select jsonb_array_elements_text(${jsonb(wantedTaskIds)})::uuid)
    `);
    for (const r of found) taskAssignment.set(String(r.id), String(r.assignment_id));
  }
  const keptTasks = new Set(
    lines.map((l) => (l.id ? existing.get(l.id)?.taskId : null)).filter((id): id is string => Boolean(id)),
  );

  const rows = lines.map((l, index) => {
    const prior = l.id ? existing.get(l.id) : undefined;
    const id = prior && l.id ? l.id : randomUUID();
    const assignmentId = l.assignmentId ?? invoice.assignmentId;
    let taskId: string | null = prior ? prior.taskId : null;
    if (!prior && l.taskId) {
      const owner = taskAssignment.get(l.taskId);
      if (!owner || owner !== assignmentId || keptTasks.has(l.taskId)) {
        throw new Abort([
          "A line is paired with a task that is not on its assignment, or that another line already has.",
        ]);
      }
      keptTasks.add(l.taskId);
      taskId = l.taskId;
    }
    return {
      id,
      position: index,
      assignment_id: assignmentId,
      task_id: taskId,
      description: lineDescription(l.description),
      unit: l.unit,
      quantity_hundredths: l.quantityHundredths,
      unit_price_minor: l.unitPriceMinor,
      discount_bp: l.discountBp,
      vat_category: l.vatCategory,
      quantity_manual: l.quantityManual,
    };
  });

  const keptIds = new Set(rows.map((r) => r.id));
  const removed = [...existing.entries()].filter(([id]) => !keptIds.has(id));
  if (removed.length > 0) {
    await tx.execute(sql`
      delete from commerce.work_invoice_lines
      where store_id = ${storeId}::uuid and invoice_id = ${invoice.id}::uuid
        and id in (select jsonb_array_elements_text(${jsonb(removed.map(([id]) => id))})::uuid)
    `);
  }
  if (rows.length > 0) {
    await tx.execute(sql`
      insert into commerce.work_invoice_lines (id, store_id, invoice_id, position, assignment_id, task_id, description, unit,
                                               quantity_hundredths, unit_price_minor, discount_bp, vat_category, quantity_manual)
      select v.id, ${storeId}::uuid, ${invoice.id}::uuid, v.position, v.assignment_id, v.task_id, v.description, v.unit,
             v.quantity_hundredths, v.unit_price_minor, v.discount_bp, v.vat_category, v.quantity_manual
      from jsonb_to_recordset(${jsonb(rows)}) as v(
        id uuid, position int, assignment_id uuid, task_id uuid, description text, unit text, quantity_hundredths int,
        unit_price_minor bigint, discount_bp int, vat_category text, quantity_manual boolean)
      on conflict (id) do update set
        position = excluded.position, assignment_id = excluded.assignment_id, description = excluded.description,
        unit = excluded.unit, quantity_hundredths = excluded.quantity_hundredths, unit_price_minor = excluded.unit_price_minor,
        discount_bp = excluded.discount_bp, vat_category = excluded.vat_category, quantity_manual = excluded.quantity_manual,
        updated_at = now()
      where commerce.work_invoice_lines.store_id = excluded.store_id and commerce.work_invoice_lines.invoice_id = excluded.invoice_id
    `);
  }

  const taskByLine = new Map<string, string | null>(rows.map((r) => [r.id, r.task_id]));
  if (invoice.assignmentId) {
    const removedTaskIds = removed.map(([, r]) => r.taskId).filter((id): id is string => Boolean(id));
    // A task with time logged on it (or a running timer) stays: the work happened, only the line is gone.
    const deletable = new Set<string>();
    if (removedTaskIds.length > 0) {
      const free = await tx.execute<Row>(sql`
        select t.id from commerce.work_tasks t
        where t.store_id = ${storeId}::uuid and t.assignment_id = ${invoice.assignmentId}::uuid
          and t.id in (select jsonb_array_elements_text(${jsonb(removedTaskIds)})::uuid)
          and not exists (select 1 from commerce.work_time_entries e where e.store_id = t.store_id and e.task_id = t.id)
          and not exists (select 1 from commerce.work_timers w where w.store_id = t.store_id and w.task_id = t.id)
      `);
      for (const r of free) deletable.add(String(r.id));
    }
    const pairedIds = [...new Set(rows.map((r) => r.task_id).filter((id): id is string => Boolean(id)))];
    const tasks = pairedIds.length
      ? await tx.execute<Row>(sql`
          select id, title from commerce.work_tasks
          where store_id = ${storeId}::uuid and assignment_id = ${invoice.assignmentId}::uuid
            and id in (select jsonb_array_elements_text(${jsonb(pairedIds)})::uuid)
        `)
      : [];
    const plan = planLineTaskSync({
      lines: rows.map((r) => ({
        id: r.id,
        taskId: r.task_id,
        description: r.description,
        quantityHundredths: r.quantity_hundredths,
      })),
      tasks: tasks.map((t) => ({ id: String(t.id), title: String(t.title) })),
      removedTaskIds: removedTaskIds.filter((id) => deletable.has(id)),
    });
    for (const rename of plan.renameTasks) {
      await tx.execute(sql`
        update commerce.work_tasks set title = ${rename.title.slice(0, 200)}, updated_at = now()
        where store_id = ${storeId}::uuid and id = ${rename.taskId}::uuid
      `);
    }
    if (plan.createTasks.length > 0) {
      const [order] = await tx.execute<Row>(sql`
        select coalesce(max(sort_order) + 1, 0)::int as next from commerce.work_tasks
        where store_id = ${storeId}::uuid and assignment_id = ${invoice.assignmentId}::uuid
      `);
      let sortOrder = int(order.next);
      for (const create of plan.createTasks) {
        const [task] = await tx.execute<Row>(sql`
          insert into commerce.work_tasks (store_id, assignment_id, title, estimated_minutes, sort_order)
          values (${storeId}::uuid, ${invoice.assignmentId}::uuid, ${create.title.slice(0, 200)}, ${create.estimatedMinutes}, ${sortOrder++})
          returning id
        `);
        const taskId = String(task.id);
        await tx.execute(sql`
          update commerce.work_invoice_lines set task_id = ${taskId}::uuid
          where store_id = ${storeId}::uuid and id = ${create.lineId}::uuid
        `);
        taskByLine.set(create.lineId, taskId);
        await workEvent(
          tx,
          storeId,
          "task",
          taskId,
          "task.created",
          { title: create.title, assignment_id: invoice.assignmentId, source: "invoice_line" },
          accountId,
        );
      }
    }
    if (plan.deleteTaskIds.length > 0) {
      await tx.execute(sql`
        delete from commerce.work_tasks
        where store_id = ${storeId}::uuid and assignment_id = ${invoice.assignmentId}::uuid
          and id in (select jsonb_array_elements_text(${jsonb(plan.deleteTaskIds)})::uuid)
      `);
    }
  }

  const { preview } = await refreshDraft(tx, storeId, invoice.id, invoice.clientId);
  return {
    lines: rows.map((r) => ({ id: r.id, position: r.position, taskId: taskByLine.get(r.id) ?? null })),
    preview: { lines: preview.lines, totals: preview.totals },
  };
}

/**
 * Saves a draft whole (the editor's autosave): its header and every line, in order. The client and
 * the assignment of a draft do not change. Anything that looks like an amount or a total is refused:
 * only quantity, price, discount and VAT category are input.
 */
export async function saveDraft(actor: WorkActor, invoiceId: string, raw: unknown): Promise<InvoiceResult<DraftSaved>> {
  const storeId = actor.store.id;
  const sent = sentAmounts(raw);
  if (sent) return problem(AMOUNTS_REFUSED);
  const parsed = invoiceInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const header = parsed.data;
  return guarded(() =>
    db().transaction(async (tx): Promise<InvoiceResult<DraftSaved>> => {
      const invoice = await lockDraft(tx, storeId, invoiceId);
      if (header.clientId !== invoice.clientId || (header.assignmentId ?? null) !== invoice.assignmentId) {
        return problem(
          "The client and the assignment of a draft cannot be changed. Delete the draft and start another.",
        );
      }
      const saved = await applyDraft(tx, storeId, actor.account?.id ?? null, invoice, header, header.lines);
      return { ok: true, ...saved };
    }),
  );
}

/** Saves only a draft's lines (keeping its header): the list, in order, upserted by id. */
export async function saveLines(
  actor: WorkActor,
  invoiceId: string,
  rawLines: unknown,
): Promise<InvoiceResult<DraftSaved>> {
  const storeId = actor.store.id;
  if (!Array.isArray(rawLines)) return problem("Send the invoice's lines as a list.");
  if (sentAmounts(rawLines)) return problem(AMOUNTS_REFUSED);
  if (rawLines.length > MAX_INVOICE_LINES) return problem(`An invoice has at most ${MAX_INVOICE_LINES} lines.`);
  return guarded(() =>
    db().transaction(async (tx): Promise<InvoiceResult<DraftSaved>> => {
      const invoice = await lockDraft(tx, storeId, invoiceId);
      const [row] = await tx.execute<Row>(sql`
        select payment_days, service_from::text as service_from, service_to::text as service_to, notes, reference
        from commerce.work_invoices where store_id = ${storeId}::uuid and id = ${invoiceId}::uuid
      `);
      const parsed = invoiceInput.safeParse({
        clientId: invoice.clientId,
        assignmentId: invoice.assignmentId,
        currency: invoice.currency,
        paymentDays: intOrNull(row.payment_days),
        serviceFrom: text(row.service_from),
        serviceTo: text(row.service_to),
        notes: text(row.notes),
        reference: text(row.reference),
        lines: rawLines,
      });
      if (!parsed.success) return problem(...zodProblems(parsed.error));
      const saved = await applyDraft(tx, storeId, actor.account?.id ?? null, invoice, null, parsed.data.lines);
      return { ok: true, ...saved };
    }),
  );
}

/** Changes a draft's header only (currency, terms, period, notes, reference); its lines are left as they are. */
export async function saveDraftHeader(
  actor: WorkActor,
  invoiceId: string,
  raw: unknown,
): Promise<InvoiceResult<DraftSaved>> {
  const storeId = actor.store.id;
  if (sentAmounts(raw)) return problem(AMOUNTS_REFUSED);
  return guarded(() =>
    db().transaction(async (tx): Promise<InvoiceResult<DraftSaved>> => {
      const invoice = await lockDraft(tx, storeId, invoiceId);
      const [stored] = await tx.execute<Row>(sql`
        select payment_days, service_from::text as service_from, service_to::text as service_to, notes, reference
        from commerce.work_invoices where store_id = ${storeId}::uuid and id = ${invoiceId}::uuid
      `);
      const parsed = invoiceInput.safeParse({
        currency: invoice.currency,
        paymentDays: intOrNull(stored.payment_days),
        serviceFrom: text(stored.service_from),
        serviceTo: text(stored.service_to),
        notes: text(stored.notes),
        reference: text(stored.reference),
        ...(raw && typeof raw === "object" ? raw : {}),
        clientId: invoice.clientId,
        assignmentId: invoice.assignmentId,
        lines: [],
      });
      if (!parsed.success) return problem(...zodProblems(parsed.error));
      const header = parsed.data;
      await tx.execute(sql`
        update commerce.work_invoices
           set currency = ${header.currency}, payment_days = ${header.paymentDays}, service_from = ${header.serviceFrom}::date,
               service_to = ${header.serviceTo}::date, notes = ${header.notes}, reference = ${header.reference}, updated_at = now()
         where store_id = ${storeId}::uuid and id = ${invoiceId}::uuid
      `);
      const { preview } = await refreshDraft(tx, storeId, invoiceId, invoice.clientId);
      const lines = await draftLines(tx, storeId, invoiceId);
      return {
        ok: true,
        lines: lines.map((l, i) => ({ id: l.id, position: i, taskId: null })),
        preview: { lines: preview.lines, totals: preview.totals },
      };
    }),
  );
}

// --- Time: the mirror between tasks and lines, and lines made from time --------------------------------

/**
 * Sets the quantity of draft lines from the time attached to them: the sum of their entries'
 * billable minutes not covered by prepaid hours, as hundredths of an hour (20 min is 0.33 h). A line
 * the owner typed or rounded (`quantity_manual`) keeps its quantity, and so does every line on a
 * fixed-fee assignment, decided from the invoice's assignment or the line's, so a fee is never
 * rewritten as hours times the fee (`mayMirrorHours`). Returns the draft invoices that changed.
 */
async function mirrorHours(run: Runner, storeId: string, lineIds: readonly string[]): Promise<Set<string>> {
  const changed = new Set<string>();
  if (lineIds.length === 0) return changed;
  const rows = await run.execute<Row>(sql`
    select l.id, l.invoice_id, l.quantity_manual, l.quantity_hundredths, la.billing_type as line_billing,
           ia.billing_type as invoice_billing,
           coalesce((select sum(e.minutes - e.prepaid_minutes) from commerce.work_time_entries e
                      where e.store_id = l.store_id and e.invoice_line_id = l.id), 0) as minutes
    from commerce.work_invoice_lines l
    join commerce.work_invoices i on i.store_id = l.store_id and i.id = l.invoice_id and i.status = 'draft'
    left join commerce.work_assignments la on la.store_id = l.store_id and la.id = l.assignment_id
    left join commerce.work_assignments ia on ia.store_id = i.store_id and ia.id = i.assignment_id
    where l.store_id = ${storeId}::uuid and l.id in (select jsonb_array_elements_text(${jsonb(lineIds)})::uuid)
  `);
  const updates: { id: string; quantity: number }[] = [];
  for (const r of rows) {
    const may = mayMirrorHours({
      quantityManual: Boolean(r.quantity_manual),
      assignmentBilling: (text(r.invoice_billing) as BillingType | null) ?? null,
      lineAssignmentBilling: (text(r.line_billing) as BillingType | null) ?? null,
    });
    if (!may) continue;
    const quantity = Math.min(LINE_QTY_CAP, minutesToHundredths(int(r.minutes)));
    if (quantity === int(r.quantity_hundredths)) continue;
    updates.push({ id: String(r.id), quantity });
    changed.add(String(r.invoice_id));
  }
  if (updates.length > 0) {
    await run.execute(sql`
      update commerce.work_invoice_lines l set quantity_hundredths = v.quantity, updated_at = now()
      from jsonb_to_recordset(${jsonb(updates)}) as v(id uuid, quantity int)
      where l.store_id = ${storeId}::uuid and l.id = v.id
    `);
  }
  return changed;
}

/** Re-prices the drafts (after lines changed outside a save) and returns nothing: the amounts are kept current. */
async function refreshDrafts(run: Runner, storeId: string, invoiceIds: Iterable<string>): Promise<void> {
  for (const invoiceId of invoiceIds) {
    const [row] = await run.execute<Row>(sql`
      select client_id from commerce.work_invoices where store_id = ${storeId}::uuid and id = ${invoiceId}::uuid and status = 'draft'
    `);
    if (row) await refreshDraft(run, storeId, invoiceId, String(row.client_id));
  }
}

/**
 * After a task was added (`createTask`): mirrors it as a line on its assignment's draft invoice,
 * described as the task, priced at the assignment's effective rate with the task's estimate as the
 * quantity (nothing if it has none), and the client's VAT treatment. A task that already has a
 * line only renames it. Returns the draft that changed, or null when the assignment has no draft.
 */
export async function syncTaskToDraftLine(
  run: Db,
  args: { storeId: string; assignmentId: string; task: { id: string; title: string; estimatedMinutes: number | null } },
): Promise<string | null> {
  const { storeId, assignmentId, task } = args;
  const [invoice] = await run.execute<Row>(sql`
    select i.id, i.client_id from commerce.work_invoices i
    where i.store_id = ${storeId}::uuid and i.assignment_id = ${assignmentId}::uuid and i.status = 'draft'
    for update
  `);
  if (!invoice) return null;
  const invoiceId = String(invoice.id);
  const description = lineDescription(task.title);
  const [line] = await run.execute<Row>(sql`
    select id, description from commerce.work_invoice_lines
    where store_id = ${storeId}::uuid and invoice_id = ${invoiceId}::uuid and task_id = ${task.id}::uuid
  `);
  if (line) {
    if (String(line.description) !== description) {
      await run.execute(sql`
        update commerce.work_invoice_lines set description = ${description}, updated_at = now()
        where store_id = ${storeId}::uuid and id = ${String(line.id)}::uuid
      `);
    }
    return invoiceId;
  }
  const [assignment] = await run.execute<Row>(sql`
    select a.billing_type, a.hourly_rate_minor, c.default_hourly_rate_minor
    from commerce.work_assignments a join commerce.work_clients c on c.store_id = a.store_id and c.id = a.client_id
    where a.store_id = ${storeId}::uuid and a.id = ${assignmentId}::uuid
  `);
  if (!assignment) return null;
  const { rateMinor } = effectiveRate(
    {
      billingType: String(assignment.billing_type) as BillingType,
      hourlyRateMinor: intOrNull(assignment.hourly_rate_minor),
    },
    { defaultHourlyRateMinor: intOrNull(assignment.default_hourly_rate_minor) },
  );
  const seed = lineFromTask(task, { rateMinor, vatBp: 0, vatCategory: "standard" });
  await run.execute(sql`
    insert into commerce.work_invoice_lines (store_id, invoice_id, position, assignment_id, task_id, description, unit,
                                             quantity_hundredths, unit_price_minor)
    select ${storeId}::uuid, ${invoiceId}::uuid, coalesce(max(position) + 1, 0), ${assignmentId}::uuid, ${task.id}::uuid,
           ${seed.description}, 'hour', ${Math.min(LINE_QTY_CAP, seed.quantityHundredths)}, ${seed.unitPriceMinor}
    from commerce.work_invoice_lines where store_id = ${storeId}::uuid and invoice_id = ${invoiceId}::uuid
  `);
  await refreshDraft(run, storeId, invoiceId, String(invoice.client_id));
  return invoiceId;
}

/**
 * Before a task is deleted (`deleteTask`): takes its line off the drafts it is on (the time attached
 * to the line is released with it). Lines on issued invoices are documents and stay. Returns the
 * drafts that lost a line.
 */
export async function removeLinesForTask(run: Db, args: { storeId: string; taskId: string }): Promise<string[]> {
  const { storeId, taskId } = args;
  const lines = await run.execute<Row>(sql`
    select l.id, l.invoice_id, i.client_id
    from commerce.work_invoice_lines l
    join commerce.work_invoices i on i.store_id = l.store_id and i.id = l.invoice_id and i.status = 'draft'
    where l.store_id = ${storeId}::uuid and l.task_id = ${taskId}::uuid
    order by l.invoice_id for update of i
  `);
  if (lines.length === 0) return [];
  await run.execute(sql`
    delete from commerce.work_invoice_lines
    where store_id = ${storeId}::uuid and id in (select jsonb_array_elements_text(${jsonb(lines.map((l) => String(l.id)))})::uuid)
  `);
  const invoices = [...new Set(lines.map((l) => String(l.invoice_id)))];
  await refreshDrafts(run, storeId, invoices);
  return invoices;
}

/**
 * After time was logged on a task, or a line was made for it: takes the task's unbilled billable
 * time onto its line on a draft invoice (so nothing is billed twice) and sets the line's hours to
 * all the time attached to it. The line's rate, discount and VAT are kept; a fixed fee and a
 * quantity the owner typed are left alone. Non-billable time and time already invoiced are never
 * taken. Returns the draft that changed, or null when the task has no line on a draft.
 */
export async function syncTaskHoursToDraftLine(
  run: Db,
  args: { storeId: string; taskId: string },
): Promise<string | null> {
  const { storeId, taskId } = args;
  const [line] = await run.execute<Row>(sql`
    select l.id, l.invoice_id, i.client_id
    from commerce.work_invoice_lines l
    join commerce.work_invoices i on i.store_id = l.store_id and i.id = l.invoice_id and i.status = 'draft'
    where l.store_id = ${storeId}::uuid and l.task_id = ${taskId}::uuid
    order by l.position limit 1
    for update of i
  `);
  if (!line) return null;
  const lineId = String(line.id);
  await run.execute(sql`
    update commerce.work_time_entries e set invoice_line_id = ${lineId}::uuid, updated_at = now()
    from commerce.work_invoice_lines l
    where l.store_id = ${storeId}::uuid and l.id = ${lineId}::uuid
      and e.store_id = l.store_id and e.task_id = ${taskId}::uuid and e.billable and e.invoice_line_id is null
      and e.minutes > e.prepaid_minutes and e.assignment_id = coalesce(l.assignment_id, e.assignment_id)
  `);
  await mirrorHours(run, storeId, [lineId]);
  await refreshDraft(run, storeId, String(line.invoice_id), String(line.client_id));
  return String(line.invoice_id);
}

/**
 * Takes logged time off the draft invoice lines it is on, so it can be changed or deleted, or
 * billed on another invoice. Only time on a draft is released: time on an issued invoice is
 * immutable (credit the invoice). The hours of the lines it was on follow. Returns how many entries
 * were released.
 */
export async function releaseTimeFromDrafts(
  actor: WorkActor,
  entryIds: readonly string[],
): Promise<InvoiceResult<{ released: number }>> {
  const storeId = actor.store.id;
  const ids = [...new Set(entryIds)].filter(isUuid);
  if (ids.length === 0) return problem("Choose the time to take off the invoice.");
  return guarded(() =>
    db().transaction(async (tx): Promise<InvoiceResult<{ released: number }>> => {
      const rows = await tx.execute<Row>(sql`
        select e.id, e.invoice_line_id, l.invoice_id, i.status, i.client_id
        from commerce.work_time_entries e
        join commerce.work_invoice_lines l on l.store_id = e.store_id and l.id = e.invoice_line_id
        join commerce.work_invoices i on i.store_id = l.store_id and i.id = l.invoice_id
        where e.store_id = ${storeId}::uuid and e.id in (select jsonb_array_elements_text(${jsonb(ids)})::uuid)
        order by l.invoice_id
        for update of i
      `);
      if (rows.some((r) => String(r.status) !== "draft")) {
        return problem("Time on an issued invoice cannot be taken off it. Credit the invoice to release the time.");
      }
      if (rows.length === 0) return { ok: true, released: 0 };
      await tx.execute(sql`
        update commerce.work_time_entries set invoice_line_id = null, updated_at = now()
        where store_id = ${storeId}::uuid and id in (select jsonb_array_elements_text(${jsonb(rows.map((r) => String(r.id)))})::uuid)
      `);
      const lineIds = [...new Set(rows.map((r) => String(r.invoice_line_id)))];
      await mirrorHours(tx, storeId, lineIds);
      await refreshDrafts(tx, storeId, new Set(rows.map((r) => String(r.invoice_id))));
      return { ok: true, released: rows.length };
    }),
  );
}

/**
 * Re-prices draft invoices after something they are priced with changed: a client's VAT treatment, or the
 * store's VAT registration (`clientId` left out: every draft of the store). The amounts a draft shows are
 * kept current by every write to it; this is for the writes made elsewhere. Returns how many drafts.
 */
export async function refreshDraftInvoices(run: Db, args: { storeId: string; clientId?: string }): Promise<number> {
  const drafts = await run.execute<Row>(sql`
    select id, client_id from commerce.work_invoices
    where store_id = ${args.storeId}::uuid and status = 'draft'
      and (${args.clientId ?? null}::uuid is null or client_id = ${args.clientId ?? null}::uuid)
    order by id
    for update
  `);
  for (const draft of drafts) await refreshDraft(run, args.storeId, String(draft.id), String(draft.client_id));
  return drafts.length;
}

const generateInput = z.object({
  assignmentIds: z.array(z.uuid()).max(200).nullish(),
  from: isoDay.nullish(),
  to: isoDay.nullish(),
});

export type GeneratedLines = {
  added: number;
  updated: number;
  attachedEntries: number;
  /** Billable minutes now on the lines made or updated (what prepaid hours did not cover). */
  minutes: number;
  /** Things the owner should know: a missing rate, a fixed fee already invoiced. */
  notes: string[];
};

/**
 * Makes lines from unbilled time on a draft: its assignment's (or, for an invoice on its own, the
 * client's assignments, optionally chosen and within a period). Billable time on no invoice line,
 * less what prepaid hours covered, is grouped by task (time without a task by assignment) into a
 * line each, priced at the assignment's effective rate (else the client's default) and attached to
 * it (`invoice_line_id`), so nothing is billed twice and the entries become immutable at issue. A line
 * that already exists for a task takes the new time and its hours follow, unless typed by hand. A
 * fixed-fee assignment is one line at its fee, once (never again while an issued invoice bills it),
 * with its time attached. Run it again after logging more time.
 */
export async function generateLinesFromTime(
  actor: WorkActor,
  invoiceId: string,
  raw: unknown = {},
): Promise<InvoiceResult<GeneratedLines>> {
  const storeId = actor.store.id;
  const parsed = generateInput.safeParse(raw ?? {});
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const options = parsed.data;
  return guarded(() =>
    db().transaction(async (tx): Promise<InvoiceResult<GeneratedLines>> => {
      const invoice = await lockDraft(tx, storeId, invoiceId);
      const client = await loadClient(tx, storeId, invoice.clientId);
      if (!client) return problem("The client of this invoice no longer exists.");
      const notes: string[] = [];

      const assignments = await tx.execute<Row>(sql`
        select a.id, a.name, a.billing_type, a.hourly_rate_minor, a.fixed_amount_minor
        from commerce.work_assignments a
        where a.store_id = ${storeId}::uuid and a.client_id = ${invoice.clientId}::uuid
          and (${invoice.assignmentId}::uuid is null or a.id = ${invoice.assignmentId}::uuid)
          and (${options.assignmentIds ? 1 : 0} = 0
               or a.id in (select jsonb_array_elements_text(${jsonb(options.assignmentIds ?? [])})::uuid))
        order by a.sort_order, a.name, a.id
      `);
      if (assignments.length === 0) return problem("There is no assignment to take time from.");
      const assignmentIds = assignments.map((a) => String(a.id));

      const entries = await tx.execute<Row>(sql`
        select e.id, e.assignment_id, e.task_id, t.title as task_title
        from commerce.work_time_entries e
        left join commerce.work_tasks t on t.store_id = e.store_id and t.id = e.task_id
        where e.store_id = ${storeId}::uuid and e.billable and e.invoice_line_id is null and e.minutes > e.prepaid_minutes
          and e.assignment_id in (select jsonb_array_elements_text(${jsonb(assignmentIds)})::uuid)
          and (${options.from ?? null}::date is null or e.work_date >= ${options.from ?? null}::date)
          and (${options.to ?? null}::date is null or e.work_date <= ${options.to ?? null}::date)
        order by e.work_date, e.created_at, e.id
      `);

      const lines = await tx.execute<Row>(sql`
        select l.id, l.task_id, l.assignment_id, l.position,
               exists (select 1 from commerce.work_time_entries e
                        where e.store_id = l.store_id and e.invoice_line_id = l.id and e.task_id is null) as has_taskless_time
        from commerce.work_invoice_lines l
        where l.store_id = ${storeId}::uuid and l.invoice_id = ${invoiceId}::uuid
        order by l.position, l.created_at
      `);
      const byTask = new Map<string, string>();
      const byAssignment = new Map<string, string>();
      const withAssignment = new Map<string, string>();
      let nextPosition = lines.length === 0 ? 0 : Math.max(...lines.map((l) => int(l.position))) + 1;
      for (const l of lines) {
        if (l.task_id) byTask.set(String(l.task_id), String(l.id));
        if (l.assignment_id && l.has_taskless_time) byAssignment.set(String(l.assignment_id), String(l.id));
        if (l.assignment_id && !withAssignment.has(String(l.assignment_id)))
          withAssignment.set(String(l.assignment_id), String(l.id));
      }

      const touched = new Set<string>();
      const created = new Set<string>();
      let attachedEntries = 0;
      const attach = async (lineId: string, entryIds: string[]) => {
        if (entryIds.length === 0) return;
        attachedEntries += entryIds.length;
        await tx.execute(sql`
          update commerce.work_time_entries set invoice_line_id = ${lineId}::uuid, updated_at = now()
          where store_id = ${storeId}::uuid and id in (select jsonb_array_elements_text(${jsonb(entryIds)})::uuid)
        `);
      };
      const addLine = async (fields: {
        assignmentId: string;
        taskId: string | null;
        description: string;
        unit: "hour" | "unit";
        quantityHundredths: number;
        unitPriceMinor: number;
        manual: boolean;
      }): Promise<string> => {
        const [row] = await tx.execute<Row>(sql`
          insert into commerce.work_invoice_lines (store_id, invoice_id, position, assignment_id, task_id, description, unit,
                                                   quantity_hundredths, unit_price_minor, quantity_manual)
          values (${storeId}::uuid, ${invoiceId}::uuid, ${nextPosition++}, ${fields.assignmentId}::uuid, ${fields.taskId}::uuid,
                  ${lineDescription(fields.description).slice(0, 500)}, ${fields.unit}, ${fields.quantityHundredths},
                  ${fields.unitPriceMinor}, ${fields.manual})
          returning id
        `);
        created.add(String(row.id));
        return String(row.id);
      };

      for (const a of assignments) {
        const assignmentId = String(a.id);
        const mine = entries.filter((e) => String(e.assignment_id) === assignmentId);
        const billing = String(a.billing_type) as BillingType;
        if (billing === "fixed_fee") {
          if (mine.length === 0 && withAssignment.has(assignmentId)) continue;
          let lineId = withAssignment.get(assignmentId) ?? null;
          if (!lineId) {
            const [billed] = await tx.execute<Row>(sql`
              select 1 from commerce.work_invoice_lines l
              join commerce.work_invoices i on i.store_id = l.store_id and i.id = l.invoice_id
              where l.store_id = ${storeId}::uuid and l.assignment_id = ${assignmentId}::uuid and i.status in ('sent', 'paid')
              limit 1
            `);
            if (billed) {
              notes.push(`“${String(a.name)}” is a fixed fee that an issued invoice already bills.`);
              continue;
            }
            const fee = intOrNull(a.fixed_amount_minor) ?? 0;
            lineId = await addLine({
              assignmentId,
              taskId: null,
              description: String(a.name),
              unit: "unit",
              quantityHundredths: 100,
              unitPriceMinor: fee,
              manual: true,
            });
            withAssignment.set(assignmentId, lineId);
          }
          await attach(
            lineId,
            mine.map((e) => String(e.id)),
          );
          touched.add(lineId);
          continue;
        }
        if (mine.length === 0) continue;
        const { rateMinor, source } = effectiveRate(
          { billingType: billing, hourlyRateMinor: intOrNull(a.hourly_rate_minor) },
          { defaultHourlyRateMinor: client.defaultHourlyRateMinor },
        );
        if (source === "none")
          notes.push(`“${String(a.name)}” has no hourly rate: its lines are priced at 0 until you set one.`);
        const groups = new Map<string | null, { title: string | null; ids: string[] }>();
        for (const e of mine) {
          const key = text(e.task_id);
          const group = groups.get(key) ?? { title: text(e.task_title), ids: [] };
          group.ids.push(String(e.id));
          groups.set(key, group);
        }
        for (const [taskId, group] of groups) {
          let lineId = (taskId ? byTask.get(taskId) : byAssignment.get(assignmentId)) ?? null;
          if (!lineId) {
            lineId = await addLine({
              assignmentId,
              taskId,
              description: taskId ? (group.title ?? String(a.name)) : String(a.name),
              unit: "hour",
              quantityHundredths: 0,
              unitPriceMinor: rateMinor,
              manual: false,
            });
            if (taskId) byTask.set(taskId, lineId);
            else byAssignment.set(assignmentId, lineId);
          }
          await attach(lineId, group.ids);
          touched.add(lineId);
        }
      }

      const lineIds = [...touched];
      const before = new Map(
        (
          await tx.execute<Row>(sql`
            select id, quantity_hundredths from commerce.work_invoice_lines
            where store_id = ${storeId}::uuid and id in (select jsonb_array_elements_text(${jsonb(lineIds)})::uuid)
          `)
        ).map((r) => [String(r.id), int(r.quantity_hundredths)]),
      );
      await mirrorHours(tx, storeId, lineIds);
      const after = await tx.execute<Row>(sql`
        select l.id, l.quantity_hundredths,
               coalesce((select sum(e.minutes - e.prepaid_minutes) from commerce.work_time_entries e
                          where e.store_id = l.store_id and e.invoice_line_id = l.id), 0) as minutes
        from commerce.work_invoice_lines l
        where l.store_id = ${storeId}::uuid and l.id in (select jsonb_array_elements_text(${jsonb(lineIds)})::uuid)
      `);
      const updated = after.filter(
        (r) =>
          !created.has(String(r.id)) &&
          before.has(String(r.id)) &&
          before.get(String(r.id)) !== int(r.quantity_hundredths),
      ).length;
      const added = created.size;
      await refreshDraft(tx, storeId, invoiceId, invoice.clientId);
      if (entries.length === 0 && added === 0) notes.push("There is no unbilled time to add.");
      return {
        ok: true,
        added,
        updated,
        attachedEntries,
        minutes: after.reduce((sum, r) => sum + int(r.minutes), 0),
        notes,
      };
    }),
  );
}

// --- Unbilled time -----------------------------------------------------------------------------------------

export type UnbilledGroup = {
  clientId: string;
  assignmentId: string;
  assignmentName: string;
  billingType: BillingType;
  taskId: string | null;
  taskTitle: string | null;
  entries: number;
  /** Billable minutes on no invoice line, less what prepaid hours covered. */
  minutes: number;
  rateMinor: number;
  /** Net, at the rate (0 for a fixed fee, which is one line at its fee). */
  amountMinor: number;
  oldest: string;
  newest: string;
};

/**
 * Billable time no invoice line has taken, by assignment and task, with what it comes to at the
 * assignment's rate: what "New invoice from unbilled time" offers.
 */
export async function unbilledTime(
  storeId: string,
  filter: { clientId?: string; assignmentId?: string; from?: string; to?: string } = {},
): Promise<UnbilledGroup[]> {
  for (const id of [filter.clientId, filter.assignmentId]) if (id !== undefined && !isUuid(id)) return [];
  for (const d of [filter.from, filter.to]) if (d !== undefined && !isoDay.safeParse(d).success) return [];
  const rows = await readDb().execute<Row>(sql`
    select a.client_id, a.id as assignment_id, a.name as assignment_name, a.billing_type, a.hourly_rate_minor,
           c.default_hourly_rate_minor, e.task_id, t.title as task_title, count(*)::int as entries,
           sum(e.minutes - e.prepaid_minutes)::int as minutes, min(e.work_date)::text as oldest, max(e.work_date)::text as newest
    from commerce.work_time_entries e
    join commerce.work_assignments a on a.store_id = e.store_id and a.id = e.assignment_id
    join commerce.work_clients c on c.store_id = a.store_id and c.id = a.client_id
    left join commerce.work_tasks t on t.store_id = e.store_id and t.id = e.task_id
    where e.store_id = ${storeId}::uuid and e.billable and e.invoice_line_id is null and e.minutes > e.prepaid_minutes
      and (${filter.clientId ?? null}::uuid is null or a.client_id = ${filter.clientId ?? null}::uuid)
      and (${filter.assignmentId ?? null}::uuid is null or a.id = ${filter.assignmentId ?? null}::uuid)
      and (${filter.from ?? null}::date is null or e.work_date >= ${filter.from ?? null}::date)
      and (${filter.to ?? null}::date is null or e.work_date <= ${filter.to ?? null}::date)
    group by a.client_id, a.id, a.name, a.billing_type, a.hourly_rate_minor, c.default_hourly_rate_minor, e.task_id, t.title,
             a.sort_order
    order by a.client_id, a.sort_order, a.name, t.title nulls last
  `);
  return rows.map((r) => {
    const billingType = String(r.billing_type) as BillingType;
    const { rateMinor } = effectiveRate(
      { billingType, hourlyRateMinor: intOrNull(r.hourly_rate_minor) },
      { defaultHourlyRateMinor: intOrNull(r.default_hourly_rate_minor) },
    );
    const minutes = int(r.minutes);
    return {
      clientId: String(r.client_id),
      assignmentId: String(r.assignment_id),
      assignmentName: String(r.assignment_name),
      billingType,
      taskId: text(r.task_id),
      taskTitle: text(r.task_title),
      entries: int(r.entries),
      minutes,
      rateMinor,
      amountMinor: billingType === "fixed_fee" ? 0 : timeAmountMinor(minutes, rateMinor),
      oldest: String(r.oldest),
      newest: String(r.newest),
    };
  });
}

// --- Issuing ------------------------------------------------------------------------------------------------------

const issueExtras = z.object({
  fxRate: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null),
  /** The total the person saw: issuing is refused if it moved. Never stored, never trusted as an amount. */
  expectedTotalMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullish(),
});

/** What the browser sends to issue: the invoice, and optionally the day, the exchange rate and the total it saw. */
export type IssueInvoiceRequest = z.input<typeof issueInvoiceInput> & z.input<typeof issueExtras>;

export type IssuedInvoice = {
  invoiceId: string;
  documentNumber: string;
  number: number;
  issuedOn: string;
  dueOn: string;
  currency: string;
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
  vatHomeMinor: number | null;
  publicToken: string;
};

/**
 * Issues a draft: the checklist first (a failure lists everything that is missing, with where to fix
 * it), then, in one transaction, `commerce.issue_work_invoice()`, which takes the next gap-free number
 * of the series, recomputes every line, freezes the totals and snapshots seller and buyer. The result
 * is read back from what the database froze. `fxRate` is the exchange rate for the VAT in the seller's
 * currency when the invoice is in another (units of the seller's currency per 1 of the invoice's).
 * A date earlier than the previous invoice's is refused with `code: "date_before_previous"` until
 * `confirmEarlierDate`. Issuing also gives the invoice its hosted link's token.
 */
export async function issueInvoice(actor: WorkActor, raw: unknown): Promise<InvoiceResult<{ invoice: IssuedInvoice }>> {
  const storeId = actor.store.id;
  if (sentAmounts(raw)) return problem(AMOUNTS_REFUSED);
  const parsed = issueInvoiceInput.safeParse(raw);
  const extras = issueExtras.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  if (!extras.success) return problem(...zodProblems(extras.error));
  const input = parsed.data;
  const fxText = extras.data.fxRate ? parseFxRate(extras.data.fxRate) : null;
  if (extras.data.fxRate && !fxText)
    return problem("The exchange rate must be a number above 0 with up to 8 decimals.");
  const supplied = extras.data.expectedTotalMinor ?? null;
  let currency = "";
  return guarded(
    () =>
      db().transaction(async (tx): Promise<InvoiceResult<{ invoice: IssuedInvoice }>> => {
        const invoice = await lockDraft(tx, storeId, input.invoiceId);
        currency = invoice.currency;
        const { preview } = await refreshDraft(tx, storeId, invoice.id, invoice.clientId);
        const readiness = await readinessOf(tx, storeId, invoice, fxText);
        if (!readiness.ready) {
          return {
            ok: false,
            code: "not_ready",
            problems: readiness.problems.filter((p) => p.severity === "error").map((p) => p.message),
          };
        }
        const [row] = await tx.execute<Row>(sql`
          select i.id, i.number, i.document_number, i.issued_on::text as issued_on, i.due_on::text as due_on,
                 i.currency::text as currency, i.subtotal_minor, i.vat_minor, i.total_minor, i.vat_home_minor
          from commerce.issue_work_invoice(
            ${storeId}::uuid, ${invoice.id}::uuid, ${actor.account?.id ?? null}::uuid, ${input.issuedOn}::date,
            ${supplied ?? preview.totals.totalMinor}::bigint, ${fxText}::numeric, ${input.confirmEarlierDate}::boolean
          ) i
        `);
        const token = randomBytes(24).toString("base64url");
        await tx.execute(sql`
          update commerce.work_invoices set public_token = ${token}
          where store_id = ${storeId}::uuid and id = ${invoice.id}::uuid and public_token is null
        `);
        return {
          ok: true,
          invoice: {
            invoiceId: String(row.id),
            documentNumber: String(row.document_number),
            number: int(row.number),
            issuedOn: String(row.issued_on),
            dueOn: String(row.due_on),
            currency: String(row.currency),
            subtotalMinor: int(row.subtotal_minor),
            vatMinor: int(row.vat_minor),
            totalMinor: int(row.total_minor),
            vatHomeMinor: intOrNull(row.vat_home_minor),
            publicToken: token,
          },
        };
      }),
    (error) => {
      const code = workErrorCode(error);
      if (code === "work_invoice.not_ready") {
        return { ok: false, code: "not_ready", problems: notReadyCodes(error).map(readinessMessage) };
      }
      if (code === "work_invoice.date_before_previous") {
        return fail(
          "date_before_previous",
          `${workErrorMessage(error) ?? "The date is earlier than the previous invoice's."} Confirm it to issue the invoice with this date.`,
        );
      }
      if (code === "work_invoice.total_changed") {
        const amount = /now (\d+)/.exec(workErrorParts(error)?.detail ?? "")?.[1];
        return fail(
          "total_changed",
          amount && currency
            ? `The total is now ${formatMoney(Number(amount), currency, "en")}, not what you saw. Check the invoice and issue it again.`
            : "The total changed while you were issuing the invoice. Check the amounts and try again.",
        );
      }
      return null;
    },
  );
}

// --- Credit notes -----------------------------------------------------------------------------------------------------

const creditExtras = z.object({
  issuedOn: isoDay.nullish(),
  confirmEarlierDate: z.boolean().default(false),
  /** Money already received that is paid back with the credit note: recorded as a negative payment. */
  refund: z
    .object({
      /** Left out: all that has been paid beyond what is still owed after the credit. */
      amountMinor: z.number().int().min(1).nullish(),
      method: z.enum(MANUAL_PAYMENT_METHODS).default("bank"),
      receivedOn: isoDay.nullish(),
      reference: z.string().trim().max(200).nullish(),
    })
    .nullish(),
});

/** What the browser sends to credit: the invoice, the reason, the lines (or the whole), and optionally a refund. */
export type CreditInvoiceRequest = z.input<typeof creditNoteInput> & z.input<typeof creditExtras>;

export type IssuedCreditNote = {
  creditNoteId: string;
  documentNumber: string;
  totalMinor: number;
  /** The credit notes now cover the whole invoice: it is void and its time is released. */
  voided: boolean;
  refundedMinor: number;
};

/**
 * Issues a credit note against an issued invoice: the whole of what is left (which voids it and
 * releases its time) or chosen lines with quantities, by `commerce.credit_work_invoice()`. When money
 * was already received, `refund` records the paying back as a negative payment in the same
 * transaction (the amount left out means all that was paid beyond what is still owed). Owner-only
 * (4.9) is the action's rule; the function only does it.
 */
export async function creditInvoice(
  actor: WorkActor,
  raw: unknown,
): Promise<InvoiceResult<{ creditNote: IssuedCreditNote }>> {
  const storeId = actor.store.id;
  if (sentAmounts(raw)) return problem(AMOUNTS_REFUSED);
  const parsed = creditNoteInput.safeParse(raw);
  const extras = creditExtras.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  if (!extras.success) return problem(...zodProblems(extras.error));
  const input = parsed.data;
  const { issuedOn, confirmEarlierDate, refund } = extras.data;
  return guarded(
    () =>
      db().transaction(async (tx): Promise<InvoiceResult<{ creditNote: IssuedCreditNote }>> => {
        const invoice = await lockInvoice(tx, storeId, input.invoiceId);
        if (!invoice) return problem(NOT_FOUND);
        if (invoice.status === "draft") return problem("A draft cannot be credited. Delete it instead.");
        if (invoice.status === "void") return problem("This invoice is already fully credited.");
        const lines =
          input.kind === "full"
            ? null
            : input.lines.map((l) => ({ line_id: l.lineId, quantity_hundredths: l.quantityHundredths }));
        const [note] = await tx.execute<Row>(sql`
          select c.id, c.document_number, c.total_minor
          from commerce.credit_work_invoice(
            ${storeId}::uuid, ${invoice.id}::uuid, ${actor.account?.id ?? null}::uuid, ${input.reason},
            ${lines === null ? null : JSON.stringify(lines)}::jsonb, ${issuedOn ?? null}::date, ${confirmEarlierDate}::boolean
          ) c
        `);
        const [amounts] = await tx.execute<Row>(sql`
          select total_minor, paid_minor, credited_minor from commerce.work_invoice_amounts(${storeId}::uuid, ${invoice.id}::uuid)
        `);
        const owed = Math.max(0, int(amounts.total_minor) - int(amounts.credited_minor));
        const overpaid = Math.max(0, int(amounts.paid_minor) - owed);
        let refunded = 0;
        if (refund) {
          const amount = refund.amountMinor ?? overpaid;
          if (amount > overpaid) {
            throw new Abort([
              `Only ${formatMoney(overpaid, invoice.currency, "en")} has been paid beyond what is still owed after this credit note, so that is the most that can be refunded.`,
            ]);
          }
          if (amount > 0) {
            const received = refund.receivedOn ?? (await today(tx, storeId));
            await tx.execute(sql`
              insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method, reference, recorded_by)
              values (${storeId}::uuid, ${invoice.id}::uuid, ${-amount}, ${invoice.currency}, ${received}::date, ${refund.method},
                      ${refund.reference || `Refund with credit note ${String(note.document_number)}`}, ${actor.account?.id ?? null}::uuid)
            `);
            refunded = amount;
          }
        }
        const [after] = await tx.execute<Row>(sql`
          select status from commerce.work_invoices where store_id = ${storeId}::uuid and id = ${invoice.id}::uuid
        `);
        return {
          ok: true,
          creditNote: {
            creditNoteId: String(note.id),
            documentNumber: String(note.document_number),
            totalMinor: int(note.total_minor),
            voided: String(after.status) === "void",
            refundedMinor: refunded,
          },
        };
      }),
    (error) => {
      if (workErrorCode(error) === "work_credit_note.date_before_previous") {
        return fail(
          "date_before_previous",
          `${workErrorMessage(error) ?? "The date is earlier than the previous credit note's."} Confirm it to issue the credit note with this date.`,
        );
      }
      return null;
    },
  );
}

// --- Payments -----------------------------------------------------------------------------------------------------------------

async function amountsOf(run: Runner, storeId: string, invoiceId: string): Promise<InvoiceAmounts> {
  const [a] = await run.execute<Row>(sql`
    select total_minor, paid_minor, credited_minor, outstanding_minor
    from commerce.work_invoice_amounts(${storeId}::uuid, ${invoiceId}::uuid)
  `);
  return a
    ? {
        totalMinor: int(a.total_minor),
        paidMinor: int(a.paid_minor),
        creditedMinor: int(a.credited_minor),
        outstandingMinor: int(a.outstanding_minor),
      }
    : { totalMinor: 0, paidMinor: 0, creditedMinor: 0, outstandingMinor: 0 };
}

/**
 * Records a payment received by hand (bank, card, cash, other): a row in the invoice's payments,
 * possibly a part of the total. The database sets the status (paid when payments and credit notes
 * cover it) and writes `payment.recorded`, `invoice.paid`. More than what is outstanding is refused.
 */
export async function recordPayment(
  actor: WorkActor,
  raw: unknown,
): Promise<InvoiceResult<{ paymentId: string; status: InvoiceStatus; amounts: InvoiceAmounts }>> {
  const storeId = actor.store.id;
  const parsed = recordPaymentInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const input = parsed.data;
  return guarded(() =>
    db().transaction(
      async (tx): Promise<InvoiceResult<{ paymentId: string; status: InvoiceStatus; amounts: InvoiceAmounts }>> => {
        const invoice = await lockInvoice(tx, storeId, input.invoiceId);
        if (!invoice) return problem(NOT_FOUND);
        if (invoice.status === "draft") return problem("A draft invoice cannot be paid. Issue it first.");
        if (invoice.status === "void") return problem("This invoice is fully credited and takes no payments.");
        if (input.receivedOn > (await today(tx, storeId))) return problem("The payment cannot be dated in the future.");
        const before = await amountsOf(tx, storeId, invoice.id);
        if (input.amountMinor > before.outstandingMinor) {
          return problem(
            before.outstandingMinor === 0
              ? "This invoice is already paid in full."
              : `The payment is more than what is outstanding (${formatMoney(before.outstandingMinor, invoice.currency, "en")}).`,
          );
        }
        const [row] = await tx.execute<Row>(sql`
        insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method, reference, recorded_by)
        values (${storeId}::uuid, ${invoice.id}::uuid, ${input.amountMinor}, ${invoice.currency}, ${input.receivedOn}::date,
                ${input.method}, ${input.reference}, ${actor.account?.id ?? null}::uuid)
        returning id
      `);
        const [after] = await tx.execute<Row>(sql`
        select status from commerce.work_invoices where store_id = ${storeId}::uuid and id = ${invoice.id}::uuid
      `);
        return {
          ok: true,
          paymentId: String(row.id),
          status: String(after.status) as InvoiceStatus,
          amounts: await amountsOf(tx, storeId, invoice.id),
        };
      },
    ),
  );
}

/**
 * Takes back a payment by adding a reversing row (the original stays: payments are append-only).
 * The invoice goes back to sent when it no longer covers the total. Only a received payment can be
 * reversed, once.
 */
export async function reversePayment(
  actor: WorkActor,
  raw: unknown,
): Promise<InvoiceResult<{ reversalId: string; status: InvoiceStatus; amounts: InvoiceAmounts }>> {
  const storeId = actor.store.id;
  const parsed = reversePaymentInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const { paymentId, reason } = parsed.data;
  return guarded(() =>
    db().transaction(
      async (tx): Promise<InvoiceResult<{ reversalId: string; status: InvoiceStatus; amounts: InvoiceAmounts }>> => {
        const [payment] = await tx.execute<Row>(sql`
        select p.id, p.invoice_id, p.amount_minor, p.currency::text as currency, p.method, p.reverses,
               exists (select 1 from commerce.work_invoice_payments r where r.store_id = p.store_id and r.reverses = p.id) as reversed
        from commerce.work_invoice_payments p
        where p.store_id = ${storeId}::uuid and p.id = ${paymentId}::uuid
      `);
        if (!payment) return problem("This payment no longer exists.");
        const invoice = await lockInvoice(tx, storeId, String(payment.invoice_id));
        if (!invoice) return problem(NOT_FOUND);
        if (int(payment.amount_minor) < 0) return problem("Only a payment that was received can be reversed.");
        if (Boolean(payment.reversed)) return problem("This payment has already been reversed.");
        const label = reason ? `Reversal: ${reason}` : "Reversal";
        const [row] = await tx.execute<Row>(sql`
        insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method, reference, reverses, recorded_by)
        values (${storeId}::uuid, ${invoice.id}::uuid, ${-int(payment.amount_minor)}, ${String(payment.currency)},
                ${await today(tx, storeId)}::date, ${String(payment.method)}, ${label.slice(0, 200)}, ${paymentId}::uuid,
                ${actor.account?.id ?? null}::uuid)
        returning id
      `);
        const [after] = await tx.execute<Row>(sql`
        select status from commerce.work_invoices where store_id = ${storeId}::uuid and id = ${invoice.id}::uuid
      `);
        return {
          ok: true,
          reversalId: String(row.id),
          status: String(after.status) as InvoiceStatus,
          amounts: await amountsOf(tx, storeId, invoice.id),
        };
      },
    ),
  );
}

// --- Deleting a draft -------------------------------------------------------------------------------------------------------------

/**
 * Deletes a draft invoice. It never used a number, so none is burned; its assignment, tasks and
 * time entries stay (the entries are only released from its lines). An issued invoice cannot be
 * deleted (the database refuses it): credit it. Voiding a draft is deleting it.
 */
export async function deleteDraft(actor: WorkActor, invoiceId: string): Promise<InvoiceResult> {
  const storeId = actor.store.id;
  return guarded(() =>
    db().transaction(async (tx): Promise<InvoiceResult> => {
      const invoice = await lockInvoice(tx, storeId, invoiceId);
      if (!invoice) return problem(NOT_FOUND);
      if (invoice.status !== "draft") {
        return problem("An issued invoice cannot be deleted. Credit it with a credit note instead.");
      }
      const [count] = await tx.execute<Row>(sql`
        select count(*)::int as lines from commerce.work_invoice_lines
        where store_id = ${storeId}::uuid and invoice_id = ${invoice.id}::uuid
      `);
      await tx.execute(
        sql`delete from commerce.work_invoices where store_id = ${storeId}::uuid and id = ${invoice.id}::uuid`,
      );
      await workEvent(
        tx,
        storeId,
        "invoice",
        invoice.id,
        "invoice.deleted",
        { client_id: invoice.clientId, assignment_id: invoice.assignmentId, lines: int(count.lines) },
        actor.account?.id ?? null,
      );
      return { ok: true };
    }),
  );
}

// --- Readers ---------------------------------------------------------------------------------------------------------------------------

const toSeller = (json: unknown): SellerSnapshot => {
  const s = (json ?? {}) as Record<string, unknown>;
  return {
    legalName: text(s.legal_name),
    organisationNumber: text(s.organisation_number),
    vatRegistered: s.vat_registered !== false,
    vatNumber: text(s.vat_number),
    address: text(s.address),
    country: text(s.country),
    email: text(s.email),
    bankAccount: text(s.bank_account),
    bic: text(s.bic),
    paymentNote: text(s.payment_note),
    invoiceFooter: text(s.invoice_footer),
    latePaymentNote: text(s.late_payment_note),
  };
};

const toBuyer = (json: unknown): BuyerSnapshot => {
  const b = (json ?? {}) as Record<string, unknown>;
  return {
    name: text(b.name),
    clientName: text(b.client_name),
    organisationNumber: text(b.organisation_number),
    vatNumber: text(b.vat_number),
    address: (b.address ?? {}) as Partial<BillingAddress>,
    country: text(b.country),
    email: text(b.email),
    contactName: text(b.contact_name),
    business: b.business !== false,
    vatTreatment: (text(b.vat_treatment) ?? "domestic") as VatTreatment,
  };
};

const sellerNow = (s: SellerRow): SellerSnapshot => ({
  legalName: s.legalName,
  organisationNumber: s.organisationNumber,
  vatRegistered: s.vatRegistered,
  vatNumber: s.vatRegistered ? s.vatNumber : null,
  address: s.postalAddress,
  country: s.country,
  email: s.contactEmail,
  bankAccount: s.bankAccount,
  bic: s.bic,
  paymentNote: s.paymentNote,
  invoiceFooter: s.invoiceFooter,
  latePaymentNote: s.latePaymentNote,
});

const buyerNow = (c: ClientRow): BuyerSnapshot => ({
  name: c.legalName?.trim() || c.name,
  clientName: c.name,
  organisationNumber: c.organisationNumber,
  vatNumber: c.vatNumber,
  address: c.billingAddress,
  country: c.country,
  email: c.billingEmail,
  contactName: c.contactName,
  business: c.business,
  vatTreatment: c.vatTreatment,
});

const toCreditLine = (json: unknown): CreditNoteLine => {
  const l = json as Record<string, unknown>;
  return {
    lineId: String(l.line_id),
    position: int(l.position),
    description: String(l.description),
    unit: String(l.unit) as "hour" | "unit",
    quantityHundredths: int(l.quantity_hundredths),
    unitPriceMinor: int(l.unit_price_minor),
    discountBp: int(l.discount_bp),
    vatCategory: String(l.vat_category) as VatLineCategory,
    vatBp: rateToBp(Number(l.vat_rate ?? 0)),
    exclMinor: int(l.excl_minor),
    vatMinor: int(l.vat_minor),
    inclMinor: int(l.incl_minor),
  };
};

const toCreditNote = (row: Row): CreditNoteSummary => ({
  id: String(row.id),
  documentNumber: String(row.document_number),
  issuedOn: String(row.issued_on),
  currency: String(row.currency),
  reason: text(row.reason),
  subtotalMinor: int(row.subtotal_minor),
  vatMinor: int(row.vat_minor),
  totalMinor: int(row.total_minor),
  lines: ((row.lines ?? []) as unknown[]).map(toCreditLine),
  createdAt: iso(row.created_at),
  createdByName: text(row.created_by_name),
});

const CREDIT_SELECT = sql`
  select c.id, c.document_number, c.issued_on::text as issued_on, c.currency::text as currency, c.reason, c.subtotal_minor,
         c.vat_minor, c.total_minor, c.lines, c.created_at, coalesce(a.name, a.email) as created_by_name
  from commerce.work_credit_notes c left join commerce.accounts a on a.id = c.created_by
`;

const LINE_SELECT = sql`
  select l.id, l.position, l.assignment_id, l.task_id, l.description, l.unit, l.quantity_hundredths, l.unit_price_minor,
         l.discount_bp, l.vat_category, l.vat_rate, l.excl_minor, l.vat_minor, l.incl_minor, l.quantity_manual,
         coalesce((select sum(e.minutes - e.prepaid_minutes) from commerce.work_time_entries e
                    where e.store_id = l.store_id and e.invoice_line_id = l.id), 0) as time_minutes
  from commerce.work_invoice_lines l
`;

/** The stored lines of an invoice as they are (an issued invoice's are the frozen ones). */
function toStoredLine(row: Row, credited: number): InvoiceLine {
  const category = String(row.vat_category) as VatLineCategory;
  const quantity = int(row.quantity_hundredths);
  const price = int(row.unit_price_minor);
  const discountBp = int(row.discount_bp);
  const excl = int(row.excl_minor);
  const gross = computeLine({
    quantityHundredths: quantity,
    unitPriceMinor: price,
    discountBp,
    vatBp: 0,
    vatCategory: category,
  }).grossMinor;
  return {
    id: String(row.id),
    position: int(row.position),
    assignmentId: text(row.assignment_id),
    taskId: text(row.task_id),
    description: String(row.description),
    unit: String(row.unit) as "hour" | "unit",
    quantityHundredths: quantity,
    unitPriceMinor: price,
    discountBp,
    vatCategory: category,
    vatBp: rateToBp(Number(row.vat_rate)),
    exclMinor: excl,
    vatMinor: int(row.vat_minor),
    inclMinor: int(row.incl_minor),
    discountMinor: Math.max(0, gross - excl),
    quantityManual: Boolean(row.quantity_manual),
    timeMinutes: int(row.time_minutes),
    creditedQuantityHundredths: credited,
  };
}

/** What an issued invoice's lines add up to, read from the frozen amounts (never recomputed). */
function totalsOfStored(lines: readonly InvoiceLine[]): InvoiceTotals {
  return totalsOf(
    lines.map((l) => ({
      grossMinor: l.exclMinor + l.discountMinor,
      discountMinor: l.discountMinor,
      exclMinor: l.exclMinor,
      vatMinor: l.vatMinor,
      inclMinor: l.inclMinor,
      vatBp: l.vatBp,
      vatCategory: l.vatCategory,
    })),
  );
}

const INVOICE_SELECT = sql`
  select i.id, i.status, i.number, i.document_number, i.client_id, i.assignment_id, i.recurring_invoice_id, i.currency::text as currency,
         i.locale, i.payment_days, i.issued_on::text as issued_on, i.due_on::text as due_on, i.sent_at, i.paid_at,
         i.service_from::text as service_from, i.service_to::text as service_to, i.notes, i.reference, i.subtotal_minor, i.vat_minor,
         i.total_minor, i.vat_home_minor, i.fx_rate::text as fx_rate, i.seller, i.buyer, i.vat_notes, i.public_token, i.sent_to,
         i.created_at, i.updated_at
  from commerce.work_invoices i
`;

function toHeader(
  row: Row,
  args: { seller: SellerRow; client: ClientRow; today: string; totals: InvoiceTotals | null; noteKeys: VatNoteKey[] },
): InvoiceHeader {
  const status = String(row.status) as InvoiceStatus;
  const own = intOrNull(row.payment_days);
  const effective = resolvePaymentDays({
    invoice: own,
    client: args.client.paymentDays,
    store: args.seller.defaultPaymentDays,
  });
  const draft = status === "draft";
  return {
    id: String(row.id),
    status,
    documentNumber: text(row.document_number),
    number: intOrNull(row.number),
    clientId: String(row.client_id),
    assignmentId: text(row.assignment_id),
    recurringInvoiceId: text(row.recurring_invoice_id),
    currency: String(row.currency),
    locale: text(row.locale) ?? args.client.locale ?? args.seller.mainLocale ?? "en",
    paymentDays: own,
    effectivePaymentDays: effective,
    issuedOn: text(row.issued_on),
    dueOn: text(row.due_on),
    tentativeDueOn: draft ? tentativeDueOn(args.today, effective) : null,
    sentAt: isoOrNull(row.sent_at),
    paidAt: isoOrNull(row.paid_at),
    serviceFrom: text(row.service_from),
    serviceTo: text(row.service_to),
    notes: text(row.notes),
    reference: text(row.reference),
    subtotalMinor: draft && args.totals ? args.totals.subtotalMinor : int(row.subtotal_minor),
    vatMinor: draft && args.totals ? args.totals.vatMinor : int(row.vat_minor),
    totalMinor: draft && args.totals ? args.totals.totalMinor : int(row.total_minor),
    vatHomeMinor: intOrNull(row.vat_home_minor),
    fxRate: text(row.fx_rate),
    vatNotes: draft ? args.noteKeys : ((row.vat_notes ?? []) as string[] as VatNoteKey[]),
    publicToken: text(row.public_token),
    sentTo: text(row.sent_to),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/**
 * One invoice with everything the invoice screen shows, or null (also for another store's id).
 * A draft is read with its live preview and its readiness checklist; an issued invoice from what
 * was frozen (its lines and the seller and buyer snapshots) with the amounts from
 * `work_invoice_amounts()`, its payments, credit notes and history.
 */
export async function getWorkInvoiceDetail(storeId: string, invoiceId: string): Promise<InvoiceDetail | null> {
  if (!isUuid(invoiceId)) return null;
  const run = readDb();
  const [row] = await run.execute<Row>(
    sql`${INVOICE_SELECT} where i.store_id = ${storeId}::uuid and i.id = ${invoiceId}::uuid`,
  );
  if (!row) return null;
  const status = String(row.status) as InvoiceStatus;
  const draft = status === "draft";
  const [seller, client, lineRows, paymentRows, creditRows, eventRows, assignmentRow, now, amounts] = await Promise.all(
    [
      loadSeller(run, storeId),
      loadClient(run, storeId, String(row.client_id)),
      run.execute<Row>(
        sql`${LINE_SELECT} where l.store_id = ${storeId}::uuid and l.invoice_id = ${invoiceId}::uuid order by l.position, l.created_at, l.id`,
      ),
      run.execute<Row>(sql`
      select p.id, p.amount_minor, p.currency::text as currency, p.received_on::text as received_on, p.method, p.reference, p.reverses,
             p.created_at, coalesce(a.name, a.email) as recorded_by_name,
             exists (select 1 from commerce.work_invoice_payments r where r.store_id = p.store_id and r.reverses = p.id) as reversed
      from commerce.work_invoice_payments p left join commerce.accounts a on a.id = p.recorded_by
      where p.store_id = ${storeId}::uuid and p.invoice_id = ${invoiceId}::uuid
      order by p.created_at, p.id
    `),
      run.execute<Row>(
        sql`${CREDIT_SELECT} where c.store_id = ${storeId}::uuid and c.invoice_id = ${invoiceId}::uuid order by c.number`,
      ),
      run.execute<Row>(sql`
      select e.id, e.type, e.data, e.created_at, coalesce(a.name, a.email) as account_name
      from commerce.work_events e left join commerce.accounts a on a.id = e.account_id
      where e.store_id = ${storeId}::uuid and e.entity_type = 'invoice' and e.entity_id = ${invoiceId}::uuid
      order by e.id desc limit 200
    `),
      row.assignment_id
        ? run.execute<Row>(sql`
          select id, name, billing_type from commerce.work_assignments
          where store_id = ${storeId}::uuid and id = ${String(row.assignment_id)}::uuid
        `)
        : Promise.resolve([] as Row[]),
      today(run, storeId),
      draft ? Promise.resolve(null) : amountsOf(run, storeId, invoiceId),
    ],
  );
  if (!client) return null;

  const creditNotes = creditRows.map(toCreditNote);
  const creditedQty = new Map<string, number>();
  for (const note of creditNotes) {
    for (const l of note.lines) creditedQty.set(l.lineId, (creditedQty.get(l.lineId) ?? 0) + l.quantityHundredths);
  }

  let lines: InvoiceLine[];
  let totals: InvoiceTotals;
  let noteKeys: VatNoteKey[] = [];
  if (draft) {
    const stored = lineRows.map((r) => toStoredLine(r, 0));
    const preview = priceDraft(
      vatContext(seller, client),
      stored.map((l) => ({
        id: l.id,
        quantityHundredths: l.quantityHundredths,
        unitPriceMinor: l.unitPriceMinor,
        discountBp: l.discountBp,
        vatCategory: l.vatCategory,
      })),
    );
    lines = stored.map((l, i) => ({ ...l, ...preview.lines[i] }));
    totals = preview.totals;
    noteKeys = preview.noteKeys;
  } else {
    lines = lineRows.map((r) => toStoredLine(r, creditedQty.get(String(r.id)) ?? 0));
    totals = totalsOfStored(lines);
  }

  const readiness = draft
    ? await readinessOf(
        run,
        storeId,
        { id: invoiceId, clientId: String(row.client_id), currency: String(row.currency) },
        null,
      )
    : null;
  const header = toHeader(row, { seller, client, today: now, totals: draft ? totals : null, noteKeys });
  const overdue = isOverdue({ status: header.status, dueOn: header.dueOn }, now);
  const assignment = assignmentRow[0]
    ? {
        id: String(assignmentRow[0].id),
        name: String(assignmentRow[0].name),
        billingType: String(assignmentRow[0].billing_type) as BillingType,
      }
    : null;
  return {
    invoice: header,
    client,
    assignment,
    seller: draft ? null : toSeller(row.seller),
    buyer: draft ? null : toBuyer(row.buyer),
    lines,
    totals,
    amounts: amounts ?? {
      totalMinor: totals.totalMinor,
      paidMinor: 0,
      creditedMinor: 0,
      outstandingMinor: 0,
    },
    payments: paymentRows.map((p) => ({
      id: String(p.id),
      amountMinor: int(p.amount_minor),
      currency: String(p.currency),
      receivedOn: String(p.received_on),
      method: String(p.method),
      reference: text(p.reference),
      reverses: text(p.reverses),
      reversed: Boolean(p.reversed),
      refund: int(p.amount_minor) < 0 && !p.reverses,
      recordedByName: text(p.recorded_by_name),
      createdAt: iso(p.created_at),
    })),
    creditNotes,
    events: eventRows.map((e) => ({
      id: int(e.id),
      type: String(e.type),
      data: (e.data ?? {}) as Record<string, unknown>,
      at: iso(e.created_at),
      accountName: text(e.account_name),
    })),
    readiness,
    today: now,
    overdue,
    daysOverdue: daysOverdue({ status: header.status, dueOn: header.dueOn }, now),
    credited: creditNotes.length > 0,
  };
}

// --- The list ------------------------------------------------------------------------------------------------------------------------------

export const INVOICE_SORTS = ["newest", "oldest", "due", "total", "client"] as const;

export type InvoiceListFilter = {
  status?: InvoiceStatus | "open";
  clientId?: string;
  assignmentId?: string;
  /** Sent and not paid, due before today in the store's time zone. */
  overdue?: boolean;
  /** Issue dates, inclusive (drafts have none and drop out when a date is given). */
  issuedFrom?: string;
  issuedTo?: string;
  /** A number, a client's name, or the client's own reference. */
  search?: string;
  sort?: (typeof INVOICE_SORTS)[number];
  page?: number;
  pageSize?: number;
};

export type InvoiceListRow = {
  id: string;
  status: InvoiceStatus;
  documentNumber: string | null;
  clientId: string;
  clientName: string;
  assignmentId: string | null;
  assignmentName: string | null;
  currency: string;
  issuedOn: string | null;
  dueOn: string | null;
  createdAt: string;
  totalMinor: number;
  paidMinor: number;
  creditedMinor: number;
  /** Still to be paid: 0 for a draft and a void invoice. */
  outstandingMinor: number;
  overdue: boolean;
  daysOverdue: number;
};

export type InvoiceList = {
  rows: InvoiceListRow[];
  total: number;
  page: number;
  pageSize: number;
  today: string;
  /** Store-wide counts for the status tabs (whatever the filter). */
  counts: { draft: number; sent: number; paid: number; void: number; overdue: number };
};

const PAGE_SIZE_MAX = 100;

const ORDER = {
  newest: sql`(i.status = 'draft') desc, coalesce(i.issued_on, i.created_at::date) desc, i.number desc nulls first, i.created_at desc`,
  oldest: sql`coalesce(i.issued_on, i.created_at::date), i.number nulls last, i.created_at`,
  due: sql`i.due_on nulls last, i.number nulls last, i.created_at`,
  total: sql`i.total_minor desc, i.created_at desc`,
  client: sql`lower(c.name), coalesce(i.issued_on, i.created_at::date) desc, i.number desc nulls first`,
} as const;

/**
 * The store's invoices: filtered by status, client, assignment, overdue and issue dates, searched by
 * number, client name or reference, sorted and paged. Amounts are the database's own
 * (`work_invoice_amounts` semantics); overdue is derived in the store's time zone.
 */
export async function listWorkInvoices(storeId: string, filter: InvoiceListFilter = {}): Promise<InvoiceList> {
  const run = readDb();
  const now = await today(run, storeId);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.trunc(filter.pageSize ?? 25)));
  const page = Math.max(1, Math.trunc(filter.page ?? 1));
  const where = [sql`i.store_id = ${storeId}::uuid`];
  if (filter.status === "open") where.push(sql`i.status = 'sent'`);
  else if (filter.status) where.push(sql`i.status = ${filter.status}`);
  if (filter.clientId) where.push(isUuid(filter.clientId) ? sql`i.client_id = ${filter.clientId}::uuid` : sql`false`);
  if (filter.assignmentId) {
    where.push(isUuid(filter.assignmentId) ? sql`i.assignment_id = ${filter.assignmentId}::uuid` : sql`false`);
  }
  if (filter.overdue) where.push(sql`i.status = 'sent' and i.due_on < ${now}::date`);
  if (filter.issuedFrom && isoDay.safeParse(filter.issuedFrom).success)
    where.push(sql`i.issued_on >= ${filter.issuedFrom}::date`);
  if (filter.issuedTo && isoDay.safeParse(filter.issuedTo).success)
    where.push(sql`i.issued_on <= ${filter.issuedTo}::date`);
  const search = filter.search?.trim().toLowerCase();
  if (search) {
    where.push(sql`(strpos(lower(coalesce(i.document_number, '')), ${search}) > 0
                    or strpos(lower(c.name), ${search}) > 0
                    or strpos(lower(coalesce(c.legal_name, '')), ${search}) > 0
                    or strpos(lower(coalesce(i.reference, '')), ${search}) > 0)`);
  }
  const clause = sql.join(where, sql` and `);
  const order = ORDER[filter.sort ?? "newest"] ?? ORDER.newest;
  const [rows, totalRow, countRows] = await Promise.all([
    run.execute<Row>(sql`
      select i.id, i.status, i.document_number, i.client_id, c.name as client_name, i.assignment_id, a.name as assignment_name,
             i.currency::text as currency, i.issued_on::text as issued_on, i.due_on::text as due_on, i.created_at, i.total_minor,
             coalesce((select sum(p.amount_minor) from commerce.work_invoice_payments p
                        where p.store_id = i.store_id and p.invoice_id = i.id), 0) as paid_minor,
             coalesce((select sum(n.total_minor) from commerce.work_credit_notes n
                        where n.store_id = i.store_id and n.invoice_id = i.id), 0) as credited_minor
      from commerce.work_invoices i
      join commerce.work_clients c on c.store_id = i.store_id and c.id = i.client_id
      left join commerce.work_assignments a on a.store_id = i.store_id and a.id = i.assignment_id
      where ${clause}
      order by ${order}, i.id
      limit ${pageSize} offset ${(page - 1) * pageSize}
    `),
    run.execute<Row>(sql`
      select count(*)::int as n
      from commerce.work_invoices i join commerce.work_clients c on c.store_id = i.store_id and c.id = i.client_id
      where ${clause}
    `),
    run.execute<Row>(sql`
      select count(*) filter (where status = 'draft')::int as draft, count(*) filter (where status = 'sent')::int as sent,
             count(*) filter (where status = 'paid')::int as paid, count(*) filter (where status = 'void')::int as void,
             count(*) filter (where status = 'sent' and due_on < ${now}::date)::int as overdue
      from commerce.work_invoices where store_id = ${storeId}::uuid
    `),
  ]);
  const counts = countRows[0] ?? {};
  return {
    rows: rows.map((r) => {
      const status = String(r.status) as InvoiceStatus;
      const total = int(r.total_minor);
      const paid = int(r.paid_minor);
      const credited = int(r.credited_minor);
      const dueOn = text(r.due_on);
      return {
        id: String(r.id),
        status,
        documentNumber: text(r.document_number),
        clientId: String(r.client_id),
        clientName: String(r.client_name),
        assignmentId: text(r.assignment_id),
        assignmentName: text(r.assignment_name),
        currency: String(r.currency),
        issuedOn: text(r.issued_on),
        dueOn,
        createdAt: iso(r.created_at),
        totalMinor: total,
        paidMinor: paid,
        creditedMinor: credited,
        outstandingMinor: status === "sent" || status === "paid" ? Math.max(0, total - paid - credited) : 0,
        overdue: isOverdue({ status, dueOn }, now),
        daysOverdue: daysOverdue({ status, dueOn }, now),
      };
    }),
    total: int(totalRow[0]?.n),
    page,
    pageSize,
    today: now,
    counts: {
      draft: int(counts.draft),
      sent: int(counts.sent),
      paid: int(counts.paid),
      void: int(counts.void),
      overdue: int(counts.overdue),
    },
  };
}

// --- Documents: what the print page, the hosted page and the email need -------------------------------------------------------------------------------

export type DocumentLine = {
  description: string;
  unit: "hour" | "unit";
  quantityHundredths: number;
  unitPriceMinor: number;
  discountBp: number;
  vatCategory: VatLineCategory;
  vatBp: number;
  exclMinor: number;
  vatMinor: number;
  inclMinor: number;
};

type DocumentBase = {
  language: DocumentLanguage;
  locale: string;
  labels: DocumentLabels;
  currency: string;
  seller: SellerSnapshot;
  buyer: BuyerSnapshot;
  lines: DocumentLine[];
  totals: InvoiceTotals;
  /** The VAT in the seller's own currency (4.5 6), when the invoice is in another. */
  vatHome: { amountMinor: number; currency: string; rate: string } | null;
  /** The statutory notes (reverse charge, not registered, …) in the document's language. */
  vatNotes: { key: VatNoteKey; text: string }[];
  /** The lines add up to the header's totals (always true unless the data was tampered with). */
  consistent: boolean;
};

export type InvoiceDocument = DocumentBase & {
  kind: "invoice";
  invoiceId: string;
  /** A draft is a preview: no number, live seller and buyer. */
  draft: boolean;
  status: InvoiceStatus;
  documentNumber: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  paymentDays: number | null;
  servicePeriod: { from: string | null; to: string | null } | null;
  reference: string | null;
  notes: string | null;
  payment: {
    bankAccount: string | null;
    bic: string | null;
    /** What to put on the payment: the invoice's number. */
    paymentReference: string | null;
    note: string | null;
    dueOn: string | null;
    amountDueMinor: number;
  };
  latePaymentNote: string;
  footer: string | null;
  amounts: InvoiceAmounts;
  creditNotes: CreditNoteSummary[];
  publicToken: string | null;
};

export type CreditNoteDocument = DocumentBase & {
  kind: "credit_note";
  creditNoteId: string;
  invoiceId: string;
  documentNumber: string;
  invoiceNumber: string;
  issuedOn: string;
  reason: string | null;
  full: boolean;
  wording: { title: string; statement: string; settlement: string };
};

function vatHomeOf(row: Row, homeCurrency: string | null) {
  const amount = intOrNull(row.vat_home_minor);
  const rate = text(row.fx_rate);
  return amount !== null && rate && homeCurrency ? { amountMinor: amount, currency: homeCurrency, rate } : null;
}

const toDocumentLine = (l: InvoiceLine): DocumentLine => ({
  description: l.description,
  unit: l.unit,
  quantityHundredths: l.quantityHundredths,
  unitPriceMinor: l.unitPriceMinor,
  discountBp: l.discountBp,
  vatCategory: l.vatCategory,
  vatBp: l.vatBp,
  exclMinor: l.exclMinor,
  vatMinor: l.vatMinor,
  inclMinor: l.inclMinor,
});

/**
 * Everything the invoice document needs, from the immutable snapshot for an issued invoice: the
 * seller and buyer as they were, the frozen lines, the VAT groups (the sums of what each line was
 * frozen at), the statutory notes in the document's language, the payment instructions, what has been
 * paid and credited. Nothing an issued document shows is worked out again. A draft reads as a preview
 * of what it would be issued as. Null for an invoice that is not the store's.
 */
export async function invoiceDocumentData(storeId: string, invoiceId: string): Promise<InvoiceDocument | null> {
  const detail = await getWorkInvoiceDetail(storeId, invoiceId);
  if (!detail) return null;
  const { invoice } = detail;
  const draft = invoice.status === "draft";
  const seller = await loadSeller(readDb(), storeId);
  const sellerDoc = draft ? sellerNow(seller) : (detail.seller ?? sellerNow(seller));
  const buyerDoc = draft
    ? buyerNow(detail.client as ClientRow)
    : (detail.buyer ?? buyerNow(detail.client as ClientRow));
  const language = documentLanguage(invoice.locale);
  const [homeRow] = await readDb().execute<Row>(sql`
    select co.currency::text as currency from commerce.countries co where co.code = ${sellerDoc.country}
  `);
  const homeCurrency = homeRow ? String(homeRow.currency) : seller.homeCurrency;
  const totals = detail.totals;
  const consistent =
    totals.subtotalMinor === invoice.subtotalMinor &&
    totals.vatMinor === invoice.vatMinor &&
    totals.totalMinor === invoice.totalMinor;
  const owed = draft ? invoice.totalMinor : detail.amounts.outstandingMinor;
  return {
    kind: "invoice",
    invoiceId,
    draft,
    status: invoice.status,
    documentNumber: invoice.documentNumber,
    language,
    locale: invoice.locale,
    labels: documentLabels(language),
    currency: invoice.currency,
    issuedOn: invoice.issuedOn,
    dueOn: invoice.dueOn ?? invoice.tentativeDueOn,
    paymentDays: invoice.paymentDays ?? invoice.effectivePaymentDays,
    servicePeriod:
      invoice.serviceFrom || invoice.serviceTo ? { from: invoice.serviceFrom, to: invoice.serviceTo } : null,
    reference: invoice.reference,
    notes: invoice.notes,
    seller: sellerDoc,
    buyer: buyerDoc,
    lines: detail.lines.map(toDocumentLine),
    totals,
    vatHome: vatHomeOf({ vat_home_minor: invoice.vatHomeMinor, fx_rate: invoice.fxRate }, homeCurrency),
    vatNotes: vatNotesFor(invoice.vatNotes, invoice.locale, sellerDoc.country),
    consistent,
    payment: {
      bankAccount: sellerDoc.bankAccount,
      bic: sellerDoc.bic,
      paymentReference: invoice.documentNumber,
      note: sellerDoc.paymentNote,
      dueOn: invoice.dueOn ?? invoice.tentativeDueOn,
      amountDueMinor: owed,
    },
    latePaymentNote: sellerDoc.latePaymentNote?.trim() || defaultLatePaymentNote(language),
    footer: sellerDoc.invoiceFooter,
    amounts: detail.amounts,
    creditNotes: detail.creditNotes,
    publicToken: invoice.publicToken,
  };
}

/** A credit note as a document, from what was frozen on it and on its invoice. Null when it is not the store's. */
export async function creditNoteDocumentData(
  storeId: string,
  creditNoteId: string,
): Promise<CreditNoteDocument | null> {
  if (!isUuid(creditNoteId)) return null;
  const [note] = await readDb().execute<Row>(sql`
    select c.id, c.invoice_id, c.document_number, c.issued_on::text as issued_on, c.currency::text as currency, c.reason,
           c.subtotal_minor, c.vat_minor, c.total_minor, c.vat_home_minor, c.fx_rate::text as fx_rate, c.lines, c.seller, c.buyer,
           c.vat_notes, i.document_number as invoice_number, i.total_minor as invoice_total, i.locale,
           co.currency::text as home_currency
    from commerce.work_credit_notes c
    join commerce.work_invoices i on i.store_id = c.store_id and i.id = c.invoice_id
    left join commerce.countries co on co.code = c.seller ->> 'country'
    where c.store_id = ${storeId}::uuid and c.id = ${creditNoteId}::uuid
  `);
  if (!note) return null;
  const lines = ((note.lines ?? []) as unknown[]).map(toCreditLine);
  const language = documentLanguage(text(note.locale));
  const seller = toSeller(note.seller);
  const totals = totalsOf(
    lines.map((l) => {
      const gross = computeLine({
        quantityHundredths: l.quantityHundredths,
        unitPriceMinor: l.unitPriceMinor,
        discountBp: l.discountBp,
        vatBp: 0,
        vatCategory: l.vatCategory,
      }).grossMinor;
      return {
        grossMinor: gross,
        discountMinor: Math.max(0, gross - l.exclMinor),
        exclMinor: l.exclMinor,
        vatMinor: l.vatMinor,
        inclMinor: l.inclMinor,
        vatBp: l.vatBp,
        vatCategory: l.vatCategory,
      };
    }),
  );
  const invoiceNumber = String(note.invoice_number);
  const full = int(note.total_minor) === int(note.invoice_total);
  return {
    kind: "credit_note",
    creditNoteId,
    invoiceId: String(note.invoice_id),
    documentNumber: String(note.document_number),
    invoiceNumber,
    issuedOn: String(note.issued_on),
    language,
    locale: text(note.locale) ?? "en",
    labels: documentLabels(language),
    currency: String(note.currency),
    reason: text(note.reason),
    full,
    wording: creditNoteWording(language, { invoiceNumber, full }),
    seller,
    buyer: toBuyer(note.buyer),
    lines: lines.map((l) => ({
      description: l.description,
      unit: l.unit,
      quantityHundredths: l.quantityHundredths,
      unitPriceMinor: l.unitPriceMinor,
      discountBp: l.discountBp,
      vatCategory: l.vatCategory,
      vatBp: l.vatBp,
      exclMinor: l.exclMinor,
      vatMinor: l.vatMinor,
      inclMinor: l.inclMinor,
    })),
    totals,
    vatHome: vatHomeOf(note, text(note.home_currency)),
    vatNotes: vatNotesFor((note.vat_notes ?? []) as string[] as VatNoteKey[], text(note.locale), seller.country),
    consistent:
      totals.subtotalMinor === int(note.subtotal_minor) &&
      totals.vatMinor === int(note.vat_minor) &&
      totals.totalMinor === int(note.total_minor),
  };
}

/** The invoice a hosted link's token belongs to (a store and an invoice), or null. The token is the whole access. */
export async function findInvoiceByToken(token: string): Promise<{ storeId: string; invoiceId: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await readDb().execute<Row>(sql`
    select store_id, id from commerce.work_invoices where public_token = ${token} and status <> 'draft'
  `);
  return row ? { storeId: String(row.store_id), invoiceId: String(row.id) } : null;
}
