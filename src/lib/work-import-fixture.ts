import type { LifeExport, LifeInvoice, LifeLine } from "./work-import";

/**
 * A small Life export for the import's tests (never used by the app): every case the importer
 * has a rule for, in a shape Life really holds (numeric amounts in major units, Life's ids).
 *
 *  - `paidNumbered`: paid, its own number `2154`, a paid date, 10 % discount lines;
 *  - `paidUnnumbered`: paid, no number and no paid date, but a Finances transaction (its date is used);
 *  - `paidBare`: paid, nothing to date the payment by (the due date is used);
 *  - `sentUnnumbered`: sent, a 0 % line and a line whose Life amount differs from Store's formula;
 *  - `sentNumbered`: sent, number `2026-041`, a sent date, one repeating-invoice instance;
 *  - `draft`: an open draft with task lines, one of them with time;
 *  - `voided`: a voided invoice, which cannot be imported faithfully.
 */
export const LIFE = {
  space: "404cae32-b11d-4b2d-a4d2-dc141cf3edd5",
  alpha: "aaaaaaaa-0000-4000-8000-000000000001",
  beta: "aaaaaaaa-0000-4000-8000-000000000002",
  gamma: "aaaaaaaa-0000-4000-8000-000000000003",
  asgInvoiced: "bbbbbbbb-0000-4000-8000-000000000001",
  asgActive: "bbbbbbbb-0000-4000-8000-000000000002",
  asgFixed: "bbbbbbbb-0000-4000-8000-000000000003",
  taskDesign: "cccccccc-0000-4000-8000-000000000001",
  taskBlank: "cccccccc-0000-4000-8000-000000000002",
  recurring: "dddddddd-0000-4000-8000-000000000001",
  paidNumbered: "eeeeeeee-0000-4000-8000-000000000001",
  paidUnnumbered: "eeeeeeee-0000-4000-8000-000000000002",
  paidBare: "eeeeeeee-0000-4000-8000-000000000003",
  sentUnnumbered: "eeeeeeee-0000-4000-8000-000000000004",
  sentNumbered: "eeeeeeee-0000-4000-8000-000000000005",
  draft: "eeeeeeee-0000-4000-8000-000000000006",
  voided: "eeeeeeee-0000-4000-8000-000000000007",
  transaction: "ffffffff-0000-4000-8000-000000000001",
  user: "99999999-0000-4000-8000-000000000001",
} as const;

const line = (
  n: number,
  invoiceId: string,
  over: Partial<LifeLine> & Pick<LifeLine, "description" | "quantity_hours" | "amount_excl_vat" | "vat_amount" | "amount_incl_vat">,
): LifeLine => ({
  id: `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`,
  invoice_id: invoiceId,
  assignment_id: null,
  task_id: null,
  unit_rate: 1490,
  discount_percent: 0,
  vat_percent: 25,
  sort_order: n,
  created_at: "2026-06-08T14:35:27.453144+00:00",
  ...over,
});

const invoice = (id: string, over: Partial<LifeInvoice>): LifeInvoice => ({
  id,
  client_id: LIFE.alpha,
  assignment_id: null,
  recurring_invoice_id: null,
  recurring_period: null,
  status: "sent",
  invoice_number: null,
  issued_on: "2026-06-08",
  due_on: "2026-06-22",
  sent_at: null,
  paid_at: null,
  currency: "NOK",
  notes: null,
  payment_due_days: null,
  subtotal_excl_vat: null,
  total_vat: null,
  total_incl_vat: null,
  finance_transaction_id: null,
  estimate_alert_minutes: 10,
  estimate_alert_popup: true,
  estimate_alert_sound: false,
  created_at: "2026-06-01T08:00:00+00:00",
  ...over,
});

export function sampleLifeExport(): LifeExport {
  return {
    source: { space_id: LIFE.space },
    space: { work_default_vat_percent: 25 },
    clients: [
      { id: LIFE.alpha, name: "Alfa AS", notes: "Betaler sent", currency: "NOK", contact_email: "regnskap@alfa.example", payment_due_days: 21, default_hourly_rate: 1490, sort_order: 0, created_at: "2026-05-21T12:35:03+00:00", updated_at: "2026-05-21T12:35:05+00:00" },
      { id: LIFE.beta, name: "Beta & Sønn", notes: null, currency: "NOK", contact_email: "not an address", payment_due_days: null, default_hourly_rate: null, sort_order: 1, created_at: "2026-05-22T12:35:03+00:00", updated_at: "2026-05-22T12:35:05+00:00" },
      { id: LIFE.gamma, name: "Gamma O'Neil", notes: null, currency: "NOK", contact_email: null, payment_due_days: null, default_hourly_rate: 990.5, sort_order: 2, created_at: "2026-05-23T12:35:03+00:00", updated_at: "2026-05-23T12:35:05+00:00" },
    ],
    assignments: [
      { id: LIFE.asgInvoiced, client_id: LIFE.alpha, name: "Faktura - Mai", status: "invoiced", billing_type: "hourly", hourly_rate: 1490, fixed_amount: null, estimated_hours: 10, start_date: "2026-05-01", end_date: "2026-05-31", sort_order: 0, created_at: "2026-05-21T13:48:20+00:00" },
      { id: LIFE.asgActive, client_id: LIFE.alpha, name: "Faktura - September", status: "active", billing_type: "hourly", hourly_rate: null, fixed_amount: null, estimated_hours: null, start_date: null, end_date: null, sort_order: 1, created_at: "2026-09-07T09:28:27+00:00" },
      { id: LIFE.asgFixed, client_id: LIFE.gamma, name: "Fastpris nettside", status: "paused", billing_type: "fixed_fee", hourly_rate: null, fixed_amount: 12500, estimated_hours: 8.25, start_date: "2026-08-01", end_date: null, sort_order: 2, created_at: "2026-08-01T09:28:27+00:00" },
    ],
    tasks: [
      { id: LIFE.taskDesign, assignment_id: LIFE.asgActive, title: "Design av forside", status: "open", estimated_hours: 1.5, sort_order: 0, created_at: "2026-09-16T11:15:01+00:00" },
      { id: LIFE.taskBlank, assignment_id: LIFE.asgActive, title: "Line item", status: "open", estimated_hours: null, sort_order: 1, created_at: "2026-09-16T11:16:01+00:00" },
    ],
    time_entries: [
      { id: "22222222-0000-4000-8000-000000000001", assignment_id: LIFE.asgActive, task_id: LIFE.taskDesign, user_id: LIFE.user, work_date: "2026-09-18", minutes: 90, billable: true, note: "Skisser", created_at: "2026-09-18T10:10:06+00:00" },
      { id: "22222222-0000-4000-8000-000000000002", assignment_id: LIFE.asgActive, task_id: null, user_id: LIFE.user, work_date: "2026-09-15", minutes: 45, billable: true, note: null, created_at: "2026-09-15T11:51:52+00:00" },
      { id: "22222222-0000-4000-8000-000000000003", assignment_id: LIFE.asgActive, task_id: LIFE.taskDesign, user_id: LIFE.user, work_date: "2026-09-19", minutes: 30, billable: false, note: null, created_at: "2026-09-19T10:10:06+00:00" },
    ],
    recurring: [
      { id: LIFE.recurring, client_id: LIFE.beta, name: "Hosting - månedlig", amount: 1237.5, currency: "NOK", is_active: true, payment_due_days: null, recurrence_period: "month", recurrence_interval: 1, recurrence_start_date: "2026-04-02", sort_order: 0, created_at: "2026-05-27T18:54:13+00:00" },
    ],
    invoices: [
      invoice(LIFE.paidNumbered, {
        status: "paid", invoice_number: "2154", assignment_id: LIFE.asgInvoiced, issued_on: "2026-06-08", due_on: "2026-06-20", payment_due_days: 12,
        paid_at: "2026-06-25T10:00:00+00:00", subtotal_excl_vat: 4023, total_vat: 1005.75, total_incl_vat: 5028.75, created_at: "2026-05-21T13:48:21+00:00",
      }),
      invoice(LIFE.paidUnnumbered, {
        status: "paid", client_id: LIFE.beta, recurring_invoice_id: LIFE.recurring, recurring_period: "2026-04-02", issued_on: "2026-04-02", due_on: "2026-04-16",
        finance_transaction_id: LIFE.transaction, subtotal_excl_vat: 990, total_vat: 247.5, total_incl_vat: 1237.5, created_at: "2026-05-29T14:19:46+00:00",
      }),
      invoice(LIFE.paidBare, {
        status: "paid", client_id: LIFE.gamma, issued_on: "2026-07-01", due_on: "2026-07-15",
        subtotal_excl_vat: 990.5, total_vat: 247.63, total_incl_vat: 1238.13, created_at: "2026-07-01T09:00:00+00:00",
      }),
      invoice(LIFE.sentUnnumbered, {
        status: "sent", issued_on: "2026-08-03", due_on: "2026-08-17", subtotal_excl_vat: 1341.33, total_vat: 335.33, total_incl_vat: 1676.66, created_at: "2026-08-03T09:00:00+00:00",
      }),
      invoice(LIFE.sentNumbered, {
        status: "sent", invoice_number: "2026-041", client_id: LIFE.beta, recurring_invoice_id: LIFE.recurring, recurring_period: "2026-05-02", issued_on: "2026-05-02", due_on: "2026-05-16",
        sent_at: "2026-05-02T06:00:55.412+00:00", subtotal_excl_vat: 990, total_vat: 247.5, total_incl_vat: 1237.5, created_at: "2026-05-02T06:00:11+00:00",
      }),
      invoice(LIFE.draft, {
        status: "draft", assignment_id: LIFE.asgActive, issued_on: "2026-09-07", due_on: null, estimate_alert_sound: true, created_at: "2026-09-07T09:28:28+00:00",
      }),
      invoice(LIFE.voided, {
        status: "void", issued_on: "2026-05-05", due_on: "2026-05-19", subtotal_excl_vat: 100, total_vat: 25, total_incl_vat: 125, created_at: "2026-05-05T09:00:00+00:00",
      }),
    ],
    invoice_lines: [
      line(1, LIFE.paidNumbered, { description: "Landingsside", quantity_hours: 3, discount_percent: 10, amount_excl_vat: 4023, vat_amount: 1005.75, amount_incl_vat: 5028.75 }),
      line(2, LIFE.paidUnnumbered, { description: "Hosting - månedlig", quantity_hours: 1, unit_rate: 990, amount_excl_vat: 990, vat_amount: 247.5, amount_incl_vat: 1237.5 }),
      line(3, LIFE.paidBare, { description: "Fastpris, del 1", quantity_hours: 1, unit_rate: 990.5, amount_excl_vat: 990.5, vat_amount: 247.63, amount_incl_vat: 1238.13 }),
      // Life stored 1341.33 here (an older float rounding); Store's formula gives 1341.00. Life's figure is kept and reported.
      line(4, LIFE.sentUnnumbered, { description: "Oppsett", quantity_hours: 1, discount_percent: 10, amount_excl_vat: 1341.33, vat_amount: 335.33, amount_incl_vat: 1676.66 }),
      line(5, LIFE.sentUnnumbered, { description: "Eksport, 0 % mva", quantity_hours: 0, vat_percent: 0, amount_excl_vat: 0, vat_amount: 0, amount_incl_vat: 0 }),
      line(6, LIFE.sentNumbered, { description: "Hosting - månedlig", quantity_hours: 1, unit_rate: 990, amount_excl_vat: 990, vat_amount: 247.5, amount_incl_vat: 1237.5 }),
      line(7, LIFE.draft, { description: "Design av forside", task_id: LIFE.taskDesign, quantity_hours: 1.5, discount_percent: 10, amount_excl_vat: 2011.5, vat_amount: 502.88, amount_incl_vat: 2514.38 }),
      line(8, LIFE.draft, { description: "Line item", task_id: LIFE.taskBlank, quantity_hours: 0, discount_percent: 10, amount_excl_vat: 0, vat_amount: 0, amount_incl_vat: 0, sort_order: 9 }),
      line(9, LIFE.voided, { description: "Kansellert", quantity_hours: 1, unit_rate: 100, amount_excl_vat: 100, vat_amount: 25, amount_incl_vat: 125 }),
    ],
    finance_transactions: [{ id: LIFE.transaction, type: "income", amount: 990, occurred_on: "2026-04-17" }],
  };
}
