import { computeInvoice } from "@/lib/work-calc";
import type {
  InvoiceAmounts,
  InvoiceClient,
  InvoiceDetail,
  InvoiceHeader,
  InvoiceLine,
  InvoiceListRow,
  InvoiceReadiness,
} from "@/server/work-invoices";

/** Fixtures for the invoice screens' tests: a draft and an issued invoice with their lines, totals and history. */

export const STORE = "kaffe";
export const INVOICE = "6f1c0f37-5f39-4d0e-9d55-7f0d0f6a3001";
export const CLIENT = "6f1c0f37-5f39-4d0e-9d55-7f0d0f6a1001";
export const ASSIGNMENT = "6f1c0f37-5f39-4d0e-9d55-7f0d0f6a1002";
export const LINE_A = "6f1c0f37-5f39-4d0e-9d55-7f0d0f6a2001";
export const LINE_B = "6f1c0f37-5f39-4d0e-9d55-7f0d0f6a2002";
export const TODAY = "2026-09-29";

export const line = (over: Partial<InvoiceLine> = {}): InvoiceLine => ({
  id: LINE_A,
  position: 0,
  assignmentId: ASSIGNMENT,
  taskId: null,
  description: "Design workshop",
  unit: "hour",
  quantityHundredths: 175,
  unitPriceMinor: 120_000,
  discountBp: 0,
  vatCategory: "standard",
  vatBp: 2500,
  exclMinor: 210_000,
  vatMinor: 52_500,
  inclMinor: 262_500,
  discountMinor: 0,
  quantityManual: false,
  timeMinutes: 0,
  creditedQuantityHundredths: 0,
  ...over,
});

export const secondLine = (over: Partial<InvoiceLine> = {}): InvoiceLine =>
  line({
    id: LINE_B,
    position: 1,
    description: "Travel",
    unit: "unit",
    quantityHundredths: 200,
    unitPriceMinor: 25_000,
    exclMinor: 50_000,
    vatMinor: 12_500,
    inclMinor: 62_500,
    ...over,
  });

export const client = (over: Partial<InvoiceClient> = {}): InvoiceClient => ({
  id: CLIENT,
  name: "Acme AB",
  legalName: "Acme Aktiebolag",
  organisationNumber: "556677-8899",
  vatNumber: "SE556677889901",
  country: "SE",
  billingAddress: { line1: "Storgatan 1", postalCode: "111 22", city: "Stockholm" },
  billingEmail: "ap@acme.example",
  contactName: "Anna Berg",
  locale: "nb",
  currency: "NOK",
  business: true,
  vatTreatment: "domestic",
  archived: false,
  ...over,
});

const header = (over: Partial<InvoiceHeader> = {}): InvoiceHeader => ({
  id: INVOICE,
  status: "draft",
  documentNumber: null,
  number: null,
  clientId: CLIENT,
  assignmentId: ASSIGNMENT,
  recurringInvoiceId: null,
  currency: "NOK",
  locale: "nb",
  paymentDays: null,
  effectivePaymentDays: 14,
  issuedOn: null,
  dueOn: null,
  tentativeDueOn: "2026-10-13",
  sentAt: null,
  paidAt: null,
  serviceFrom: null,
  serviceTo: null,
  notes: null,
  reference: null,
  subtotalMinor: 260_000,
  vatMinor: 65_000,
  totalMinor: 325_000,
  vatHomeMinor: null,
  fxRate: null,
  vatNotes: [],
  publicToken: null,
  sentTo: null,
  createdAt: "2026-09-20T08:00:00.000Z",
  updatedAt: "2026-09-20T08:00:00.000Z",
  ...over,
});

const totalsOf = (lines: InvoiceLine[]) =>
  computeInvoice(
    lines.map((l) => ({
      quantityHundredths: l.quantityHundredths,
      unitPriceMinor: l.unitPriceMinor,
      discountBp: l.discountBp,
      vatBp: l.vatBp,
      vatCategory: l.vatCategory,
    })),
  ).totals;

export const readyReadiness: InvoiceReadiness = { ready: true, problems: [], needsFxRate: false, homeCurrency: "NOK" };

export const notReady: InvoiceReadiness = {
  ready: false,
  needsFxRate: false,
  homeCurrency: "NOK",
  problems: [
    {
      code: "seller_bank_account",
      severity: "error",
      where: "settings",
      message: "Add the bank account invoices are paid to.",
    },
    {
      code: "buyer_address",
      severity: "error",
      where: "client",
      message: "Add the client's billing address: street, postal code and city.",
    },
    { code: "line_without_amount", severity: "warning", where: "invoice", message: "A line has no amount." },
  ],
};

export function draftDetail(over: Partial<InvoiceDetail> = {}): InvoiceDetail {
  const lines = over.lines ?? [line(), secondLine()];
  return {
    invoice: header(),
    client: client(),
    assignment: { id: ASSIGNMENT, name: "Website rebuild", billingType: "hourly" },
    seller: null,
    buyer: null,
    lines,
    totals: totalsOf(lines),
    amounts: { totalMinor: 325_000, paidMinor: 0, creditedMinor: 0, outstandingMinor: 0 },
    payments: [],
    creditNotes: [],
    events: [],
    readiness: notReady,
    today: TODAY,
    overdue: false,
    daysOverdue: 0,
    credited: false,
    ...over,
  };
}

export function issuedDetail(over: Partial<InvoiceDetail> = {}, amounts: Partial<InvoiceAmounts> = {}): InvoiceDetail {
  const lines = over.lines ?? [line(), secondLine()];
  const totals = totalsOf(lines);
  return {
    invoice: header({
      status: "sent",
      documentNumber: "W-12",
      number: 12,
      issuedOn: "2026-09-15",
      dueOn: "2026-09-29",
      tentativeDueOn: null,
      paymentDays: 14,
      locale: "nb",
      reference: "PO-7",
      subtotalMinor: totals.subtotalMinor,
      vatMinor: totals.vatMinor,
      totalMinor: totals.totalMinor,
      publicToken: "tok",
      sentAt: "2026-09-15T08:00:00.000Z",
    }),
    client: client(),
    assignment: { id: ASSIGNMENT, name: "Website rebuild", billingType: "hourly" },
    seller: {
      legalName: "Kaffe AS",
      organisationNumber: "999 888 777",
      vatRegistered: true,
      vatNumber: "NO999888777MVA",
      address: "Kaffegata 1, 0150 Oslo",
      country: "NO",
      email: "post@kaffe.example",
      bankAccount: "NO9386011117947",
      bic: "DNBANOKK",
      paymentNote: null,
      invoiceFooter: null,
      latePaymentNote: null,
    },
    buyer: {
      name: "Acme Aktiebolag",
      clientName: "Acme AB",
      organisationNumber: "556677-8899",
      vatNumber: "SE556677889901",
      address: { line1: "Storgatan 1", postalCode: "111 22", city: "Stockholm" },
      country: "SE",
      email: "ap@acme.example",
      contactName: "Anna Berg",
      business: true,
      vatTreatment: "domestic",
    },
    lines,
    totals,
    amounts: {
      totalMinor: totals.totalMinor,
      paidMinor: 0,
      creditedMinor: 0,
      outstandingMinor: totals.totalMinor,
      ...amounts,
    },
    payments: [],
    creditNotes: [],
    events: [
      {
        id: 2,
        type: "invoice.issued",
        data: { document_number: "W-12" },
        at: "2026-09-15T08:00:00.000Z",
        accountName: "Kari",
      },
      { id: 1, type: "invoice.created", data: {}, at: "2026-09-14T08:00:00.000Z", accountName: "Kari" },
    ],
    readiness: null,
    today: TODAY,
    overdue: false,
    daysOverdue: 0,
    credited: false,
    ...over,
  };
}

export const listRow = (over: Partial<InvoiceListRow> = {}): InvoiceListRow => ({
  id: INVOICE,
  status: "sent",
  documentNumber: "W-12",
  clientId: CLIENT,
  clientName: "Acme AB",
  assignmentId: ASSIGNMENT,
  assignmentName: "Website rebuild",
  currency: "NOK",
  issuedOn: "2026-09-15",
  dueOn: "2026-10-29",
  createdAt: "2026-09-14T08:00:00.000Z",
  totalMinor: 325_000,
  paidMinor: 0,
  creditedMinor: 0,
  outstandingMinor: 325_000,
  overdue: false,
  daysOverdue: 0,
  ...over,
});

/** The html of a server render without React's comment markers between text pieces, and with plain spaces in amounts. */
export const clean = (html: string): string => html.replace(/<!-- -->/g, "").replace(/[\u00a0\u202f]/g, " ");
