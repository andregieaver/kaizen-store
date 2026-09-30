/**
 * Import of one person's Work data from Kaizen Life into a store (docs/work.md WP15, D122).
 *
 * Pure: a JSON export of one Life space in, a plan out (rows converted to Store's units, with a
 * reconciliation of every invoice), then a single SQL transaction and a dry-run report as text.
 * `scripts/import-life-work.mjs` is the thin command line around it; nothing here touches a
 * database, so the same plan is what the tests, the dry run and the production run agree on.
 *
 * Deliberately self-contained (one import, `node:crypto`): Node runs this file as it is, so the
 * command line does not need a build step. Its arithmetic is the exact half-up integer arithmetic of
 * `work-calc.ts` (4.3), repeated here and checked against it in `work-import.test.ts`.
 *
 * What the SQL guarantees, and the plan mirrors:
 *  - ids are uuid v5 of the Life id in the store's namespace, so a second run finds its own rows
 *    (`on conflict do nothing`) and adds nothing;
 *  - it aborts if the store already has Work rows that are not from this import;
 *  - sent and paid Life invoices become *imported* invoices (`work_imported_invoices`): issued, with
 *    Life's own number (or the label `Imported`) and Life's own amounts, never numbered from the store's
 *    series, never emailed, no D41 event; a paid one gets one payment row so its status follows the money;
 *  - Life's draft invoices stay ordinary drafts, priced by Store's formula;
 *  - it writes nothing to Life and sends nothing.
 */
import { createHash } from "node:crypto";

// --- The export (what the command line reads) ----------------------------------------------------------

type Num = number | string | null;

export type LifeClient = {
  id: string;
  name: string;
  notes: string | null;
  currency: string;
  contact_email: string | null;
  payment_due_days: number | null;
  default_hourly_rate: Num;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type LifeAssignment = {
  id: string;
  client_id: string;
  name: string;
  status: string;
  billing_type: string;
  hourly_rate: Num;
  fixed_amount: Num;
  estimated_hours: Num;
  start_date: string | null;
  end_date: string | null;
  sort_order: number;
  created_at: string;
};

export type LifeTask = {
  id: string;
  assignment_id: string;
  title: string;
  status: string;
  estimated_hours: Num;
  sort_order: number;
  created_at: string;
};

export type LifeTimeEntry = {
  id: string;
  assignment_id: string;
  task_id: string | null;
  user_id: string;
  work_date: string;
  minutes: number;
  billable: boolean;
  note: string | null;
  created_at: string;
};

export type LifeRecurring = {
  id: string;
  client_id: string;
  name: string;
  amount: Num;
  currency: string;
  is_active: boolean;
  payment_due_days: number | null;
  recurrence_period: string;
  recurrence_interval: number;
  recurrence_start_date: string;
  sort_order: number;
  created_at: string;
};

export type LifeInvoice = {
  id: string;
  client_id: string;
  assignment_id: string | null;
  recurring_invoice_id: string | null;
  recurring_period: string | null;
  status: string;
  invoice_number: string | null;
  issued_on: string | null;
  due_on: string | null;
  sent_at: string | null;
  paid_at: string | null;
  currency: string;
  notes: string | null;
  payment_due_days: number | null;
  subtotal_excl_vat: Num;
  total_vat: Num;
  total_incl_vat: Num;
  finance_transaction_id: string | null;
  estimate_alert_minutes: number | null;
  estimate_alert_popup: boolean;
  estimate_alert_sound: boolean;
  created_at: string;
};

export type LifeLine = {
  id: string;
  invoice_id: string;
  assignment_id: string | null;
  task_id: string | null;
  description: string;
  quantity_hours: Num;
  unit_rate: Num;
  discount_percent: Num;
  vat_percent: Num;
  amount_excl_vat: Num;
  vat_amount: Num;
  amount_incl_vat: Num;
  sort_order: number;
  created_at: string;
};

export type LifeExport = {
  source?: { space_id?: string };
  space?: { work_default_vat_percent?: Num };
  store_snapshot?: {
    store_id?: string;
    slug?: string;
    time_zone?: string;
    country?: string;
    legal_name?: string | null;
    organisation_number?: string | null;
    postal_address?: string | null;
    contact_email?: string | null;
    work_settings?: { vat_registered?: boolean; vat_number?: string | null; bank_account?: string | null } | null;
    members?: { email: string; role: string; account?: string }[];
  };
  clients: LifeClient[];
  assignments: LifeAssignment[];
  tasks: LifeTask[];
  time_entries: LifeTimeEntry[];
  recurring: LifeRecurring[];
  invoices: LifeInvoice[];
  invoice_lines: LifeLine[];
  finance_transactions?: { id: string; type?: string; amount?: Num; occurred_on: string }[];
};

// --- Exact arithmetic ---------------------------------------------------------------------------------

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

/** n / d rounded to the nearest whole number, halves away from zero. */
export function divideRounded(n: bigint, d: bigint): bigint {
  if (d <= ZERO) throw new RangeError("Divisor must be positive");
  const negative = n < ZERO;
  const a = negative ? -n : n;
  const q = (TWO * a + d) / (TWO * d);
  return negative ? -q : q;
}

function decimalText(value: Num | undefined): string {
  if (value === null || value === undefined) throw new RangeError("A number is missing");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError(`Not a number: ${value}`);
    const plain = String(value);
    return /e/i.test(plain) ? value.toFixed(10) : plain;
  }
  return value.trim();
}

/** A decimal (a number as the export holds it, or a string) times 10^shift, half up past the last place, no floats. */
export function scaleDecimal(value: Num | undefined, shift: number): bigint {
  const text = decimalText(value);
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (match[2] === "" && !match[3])) throw new RangeError(`Not a decimal number: ${text}`);
  const fraction = match[3] ?? "";
  let digits = BigInt((match[2] || "0") + fraction.slice(0, shift).padEnd(shift, "0"));
  if (fraction.length > shift && fraction.charCodeAt(shift) >= 53) digits += ONE;
  return match[1] ? -digits : digits;
}

function safe(value: bigint, what: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${what} is too large`);
  }
  return Number(value);
}

/** Life's major units (numeric(14,2)) as minor units: x100, half up (every currency used has two decimals). */
export const majorToMinor = (value: Num | undefined): number => safe(scaleDecimal(value, 2), "Amount");

/** Hours as the hundredths a line's quantity is kept in. */
export const hoursToHundredths = (value: Num | undefined): number => safe(scaleDecimal(value, 2), "Quantity");

/** Estimated hours as minutes: round(hours x 60), half up. */
export const hoursToMinutes = (value: Num | undefined): number =>
  safe(divideRounded(scaleDecimal(value, 4) * BigInt(60), BigInt(10_000)), "Minutes");

/** A percentage (0-100, two decimals) as basis points. */
export const percentToBp = (value: Num | undefined): number => safe(scaleDecimal(value, 2), "Percentage");

/** Basis points as the fraction a line keeps (2500 becomes "0.2500"). */
export const bpToRate = (bp: number): string => `${Math.floor(bp / 10_000)}.${String(bp % 10_000).padStart(4, "0")}`;

/** Minutes as the hundredths of an hour Life's `minutesToHours` gave: round(minutes x 100 / 60), half up. */
export const minutesToHundredths = (minutes: number): number =>
  safe(divideRounded(BigInt(minutes) * BigInt(100), BigInt(60)), "Quantity");

/** The net part of a VAT-inclusive amount: round(incl x 10000 / (10000 + vatBp)) (docs/work.md 4.3). */
export const netOfGross = (inclMinor: number, vatBp: number): number =>
  safe(divideRounded(BigInt(inclMinor) * BigInt(10_000), BigInt(10_000 + vatBp)), "Amount");

export type LineAmounts = { exclMinor: number; vatMinor: number; inclMinor: number };

/** One line by docs/work.md 4.3: excl = round(qty x price x (10000 - discount) / 1 000 000), vat = round(excl x rate / 10000). */
export function lineAmounts(quantityHundredths: number, unitPriceMinor: number, discountBp: number, vatBp: number): LineAmounts {
  const product = BigInt(quantityHundredths) * BigInt(unitPriceMinor);
  const excl = divideRounded(product * BigInt(10_000 - discountBp), BigInt(1_000_000));
  const vat = divideRounded(excl * BigInt(vatBp), BigInt(10_000));
  return { exclMinor: safe(excl, "Amount"), vatMinor: safe(vat, "VAT"), inclMinor: safe(excl + vat, "Amount") };
}

// --- Ids ----------------------------------------------------------------------------------------------

/** A version 5 (name-based, SHA-1) UUID: the same name in the same namespace is always the same id. */
export function uuidV5(name: string, namespace: string): string {
  const hash = createHash("sha1")
    .update(Buffer.from(namespace.replace(/-/g, ""), "hex"))
    .update(name, "utf8")
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type IdKind =
  | "client"
  | "assignment"
  | "task"
  | "entry"
  | "recurring"
  | "invoice"
  | "line"
  | "payment";

/** The store's id for a Life row: uuid v5 of `kaizen-life:{kind}:{life id}` in the store's own namespace. */
export const importId = (storeId: string, kind: IdKind, lifeId: string): string =>
  uuidV5(`kaizen-life:${kind}:${lifeId}`, storeId);

// --- The plan -----------------------------------------------------------------------------------------

export type ImportOptions = {
  storeId: string;
  storeSlug: string;
  /** IANA time zone the store must have (sent-at defaults and paid-at noon follow it). */
  timeZone: string;
  /** The store member who did the work and created the rows. */
  accountEmail: string;
  /** Where Life's clients are assumed to be (Life keeps no country). */
  clientCountry: string;
  clientLocale: string;
  /** The store's standard VAT rate in basis points, for re-pricing drafts (Norway: 2500). */
  standardVatBp: number;
};

export const DEFAULT_OPTIONS = {
  timeZone: "Europe/Oslo",
  clientCountry: "NO",
  clientLocale: "nb-NO",
  standardVatBp: 2500,
} as const;

/** The label shown for an imported invoice Life gave no number. */
export const IMPORTED_LABEL = "Imported";
/** Life's own bookkeeping that has no place here. */
const IMPORT_SOURCE = "kaizen-life";

export type Note = {
  level: "assumption" | "altered" | "warning" | "skipped";
  scope: string;
  message: string;
};

export type PlannedClient = {
  id: string;
  lifeId: string;
  name: string;
  billingEmail: string | null;
  currency: string;
  defaultHourlyRateMinor: number | null;
  paymentDays: number | null;
  country: string;
  locale: string;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PlannedAssignment = {
  id: string;
  lifeId: string;
  clientId: string;
  name: string;
  status: "active" | "paused" | "done";
  billingType: "hourly" | "fixed_fee";
  hourlyRateMinor: number | null;
  fixedAmountMinor: number | null;
  estimatedMinutes: number | null;
  startDate: string | null;
  endDate: string | null;
  alertMinutes: number | null;
  alertPopup: boolean;
  alertSound: boolean;
  sortOrder: number;
  createdAt: string;
};

export type PlannedTask = {
  id: string;
  lifeId: string;
  assignmentId: string;
  title: string;
  status: "open" | "done";
  estimatedMinutes: number | null;
  sortOrder: number;
  createdAt: string;
};

export type PlannedEntry = {
  id: string;
  lifeId: string;
  assignmentId: string;
  taskId: string | null;
  workDate: string;
  minutes: number;
  billable: boolean;
  note: string | null;
  invoiceLineId: string | null;
  createdAt: string;
};

export type PlannedRecurring = {
  id: string;
  lifeId: string;
  clientId: string;
  name: string;
  description: string;
  unitPriceMinor: number;
  currency: string;
  interval: number;
  period: "week" | "month" | "year";
  startDate: string;
  paymentDays: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  /** Life's VAT-inclusive amount, for the report. */
  lifeAmountMinor: number;
};

export type PlannedLine = {
  id: string;
  lifeId: string;
  position: number;
  assignmentId: string | null;
  taskId: string | null;
  description: string;
  /** Life keeps every quantity as hours; a line of a repeating invoice is one unit of a fixed amount here. */
  unit: "hour" | "unit";
  quantityHundredths: number;
  unitPriceMinor: number;
  discountBp: number;
  vatCategory: "standard" | "exempt";
  vatBp: number;
  exclMinor: number;
  vatMinor: number;
  inclMinor: number;
  quantityManual: boolean;
  createdAt: string;
};

export type PlannedPayment = {
  id: string;
  amountMinor: number;
  currency: string;
  receivedOn: string;
  method: "other";
  reference: string;
  /** Where the date came from, for the report. */
  dateSource: "paid_at" | "finance_transaction" | "due_on";
};

export type PlannedInvoice = {
  id: string;
  lifeId: string;
  clientId: string;
  assignmentId: string | null;
  recurringId: string | null;
  recurringPeriod: string | null;
  /** `draft` stays an ordinary draft; `sent` and `paid` are imported (issued) invoices. */
  status: "draft" | "sent" | "paid";
  imported: boolean;
  legacyNumber: string | null;
  /** What `document_number` holds: Life's number, or `Imported`; null for a draft. */
  label: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  sentAt: string | null;
  currency: string;
  paymentDays: number | null;
  notes: string | null;
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
  vatNotes: string[];
  lines: PlannedLine[];
  payment: PlannedPayment | null;
  createdAt: string;
};

export type LineReconciliation = {
  position: number;
  description: string;
  life: LineAmounts;
  store: LineAmounts;
  /** What Store's formula would give from the same quantity, price, discount and rate. */
  recomputed: LineAmounts;
  /** The store's amounts are not Life's (only a draft, which Store re-prices with its own VAT rate). */
  differs: boolean;
  /** Life's own amounts are not what Store's formula gives from the same figures (older float rounding in Life). */
  formulaDiffers: boolean;
};

export type InvoiceReconciliation = {
  lifeId: string;
  id: string;
  label: string;
  status: string;
  clientName: string;
  /** Life's frozen header (null on a draft, which has none). */
  lifeHeader: { subtotalMinor: number; vatMinor: number; totalMinor: number } | null;
  /** The sums of Life's own line amounts. */
  lifeLineSums: LineAmounts;
  /** What the store holds. */
  store: { subtotalMinor: number; vatMinor: number; totalMinor: number };
  /** The sums of the lines re-priced by Store's formula. */
  recomputed: LineAmounts;
  lines: LineReconciliation[];
  headerMatchesLines: boolean;
  /** Store total minus Life's header total (0 when they are the same). */
  totalDifferenceMinor: number;
  skipped: string | null;
};

export type ImportPlan = {
  options: ImportOptions;
  spaceId: string | null;
  clients: PlannedClient[];
  assignments: PlannedAssignment[];
  tasks: PlannedTask[];
  entries: PlannedEntry[];
  recurring: PlannedRecurring[];
  invoices: PlannedInvoice[];
  reconciliation: InvoiceReconciliation[];
  notes: Note[];
  /** Everything in the export that was left out, with the reason. */
  skipped: Note[];
  /** The Life id of every row, per kind, for the report. */
  counts: Record<string, { life: number; imported: number }>;
};

const CURRENCY = /^[A-Z]{3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (text: string | null | undefined): string => (text ?? "").replace(/\u0000/g, "").trim();
const orNull = (text: string | null | undefined): string | null => (clean(text) === "" ? null : clean(text));
const day = (value: string | null | undefined): string | null => {
  const text = (value ?? "").slice(0, 10);
  return DAY.test(text) ? text : null;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const sumLines = (lines: readonly LineAmounts[]): LineAmounts =>
  lines.reduce(
    (t, l) => ({ exclMinor: t.exclMinor + l.exclMinor, vatMinor: t.vatMinor + l.vatMinor, inclMinor: t.inclMinor + l.inclMinor }),
    { exclMinor: 0, vatMinor: 0, inclMinor: 0 },
  );

const bySort = <T extends { sort_order: number; created_at: string; id: string }>(a: T, b: T) =>
  a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/**
 * Converts the export to what the store will hold, and reconciles every invoice. Never throws for
 * one bad row: a row that cannot be imported faithfully is left out and listed in `skipped` with the
 * reason (and everything that depends on it with it); the caller decides whether that is acceptable.
 */
export function planImport(life: LifeExport, options: ImportOptions): ImportPlan {
  const notes: Note[] = [];
  const skipped: Note[] = [];
  const note = (level: Note["level"], scope: string, message: string) => {
    (level === "skipped" ? skipped : notes).push({ level, scope, message });
  };
  const idOf = (kind: IdKind, lifeId: string) => importId(options.storeId, kind, lifeId);
  const spaceVatBp = life.space?.work_default_vat_percent === undefined ? 2500 : percentToBp(life.space.work_default_vat_percent);

  // Clients ------------------------------------------------------------------------------------------
  const clients: PlannedClient[] = [];
  const clientName = new Map<string, string>();
  for (const c of [...life.clients].sort(bySort)) {
    const scope = `client ${c.name}`;
    const name = clean(c.name);
    if (name.length < 1 || name.length > 120) {
      note("skipped", scope, "the name is empty or longer than 120 characters");
      continue;
    }
    if (!CURRENCY.test(c.currency)) {
      note("skipped", scope, `currency ${c.currency} is not a three-letter code`);
      continue;
    }
    let email = orNull(c.contact_email);
    if (email && !EMAIL.test(email)) {
      note("altered", scope, `contact email "${email}" is not an address; billing email left empty`);
      email = null;
    }
    let rate: number | null = null;
    if (c.default_hourly_rate !== null && c.default_hourly_rate !== undefined) {
      rate = majorToMinor(c.default_hourly_rate);
      if (rate > 1_000_000_000) {
        note("altered", scope, "the default hourly rate is over the limit; left empty");
        rate = null;
      }
    }
    let paymentDays = c.payment_due_days ?? null;
    if (paymentDays !== null && (paymentDays < 1 || paymentDays > 90)) {
      note("altered", scope, `payment terms of ${paymentDays} days are outside 1 to 90; left empty`);
      paymentDays = null;
    }
    clientName.set(c.id, name);
    clients.push({
      id: idOf("client", c.id),
      lifeId: c.id,
      name,
      billingEmail: email,
      currency: c.currency,
      defaultHourlyRateMinor: rate,
      paymentDays,
      country: options.clientCountry,
      locale: options.clientLocale,
      notes: orNull(c.notes),
      sortOrder: c.sort_order,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    });
  }
  if (clients.length > 0) {
    note(
      "assumption",
      "clients",
      `Life keeps no country, address, VAT treatment or language for a client: every client is imported as a Norwegian business (country ${options.clientCountry}, VAT treatment domestic, documents in ${options.clientLocale}), with an empty billing address and no organisation or VAT number. Fill these in before issuing a new invoice; imported invoices keep the empty address they were sent with.`,
    );
  }
  const clientIds = new Set(clients.map((c) => c.lifeId));

  // Assignments --------------------------------------------------------------------------------------
  const invoicesByAssignment = new Map<string, LifeInvoice>();
  for (const i of life.invoices) if (i.assignment_id && !invoicesByAssignment.has(i.assignment_id)) invoicesByAssignment.set(i.assignment_id, i);
  const assignments: PlannedAssignment[] = [];
  for (const a of [...life.assignments].sort(bySort)) {
    const scope = `assignment ${a.name}`;
    if (!clientIds.has(a.client_id)) {
      note("skipped", scope, "its client was not imported");
      continue;
    }
    const name = clean(a.name);
    if (name.length < 1 || name.length > 160) {
      note("skipped", scope, "the name is empty or longer than 160 characters");
      continue;
    }
    let status: PlannedAssignment["status"];
    if (a.status === "active" || a.status === "paused" || a.status === "done") status = a.status;
    else if (a.status === "invoiced") {
      status = "done";
      note("altered", scope, "Life status invoiced becomes done (Store derives invoiced from the invoice lines)");
    } else {
      note("skipped", scope, `unknown status ${a.status}`);
      continue;
    }
    const billingType: PlannedAssignment["billingType"] = a.billing_type === "fixed_fee" ? "fixed_fee" : "hourly";
    const hourly = a.hourly_rate === null || a.hourly_rate === undefined ? null : majorToMinor(a.hourly_rate);
    const fixed = a.fixed_amount === null || a.fixed_amount === undefined ? null : majorToMinor(a.fixed_amount);
    const invoice = invoicesByAssignment.get(a.id);
    const startDate = day(a.start_date);
    const endDate = day(a.end_date);
    assignments.push({
      id: idOf("assignment", a.id),
      lifeId: a.id,
      clientId: idOf("client", a.client_id),
      name,
      status,
      billingType,
      hourlyRateMinor: hourly,
      fixedAmountMinor: fixed,
      estimatedMinutes: a.estimated_hours === null || a.estimated_hours === undefined ? null : hoursToMinutes(a.estimated_hours),
      startDate,
      endDate: startDate && endDate && endDate < startDate ? null : endDate,
      // Life kept the estimate warnings on the invoice, Store keeps them on the assignment.
      alertMinutes: invoice ? invoice.estimate_alert_minutes : 10,
      alertPopup: invoice ? invoice.estimate_alert_popup : true,
      alertSound: invoice ? invoice.estimate_alert_sound : false,
      sortOrder: a.sort_order,
      createdAt: a.created_at,
    });
    if (startDate && endDate && endDate < startDate) note("altered", scope, "the end date was before the start date; end date left empty");
  }
  const assignmentIds = new Set(assignments.map((a) => a.lifeId));

  // Tasks --------------------------------------------------------------------------------------------
  const tasks: PlannedTask[] = [];
  for (const t of [...life.tasks].sort(bySort)) {
    const scope = `task ${t.title}`;
    if (!assignmentIds.has(t.assignment_id)) {
      note("skipped", scope, "its assignment was not imported");
      continue;
    }
    const title = clean(t.title);
    if (title.length < 1 || title.length > 200) {
      note("skipped", scope, "the title is empty or longer than 200 characters");
      continue;
    }
    tasks.push({
      id: idOf("task", t.id),
      lifeId: t.id,
      assignmentId: idOf("assignment", t.assignment_id),
      title,
      status: t.status === "done" ? "done" : "open",
      estimatedMinutes: t.estimated_hours === null || t.estimated_hours === undefined ? null : hoursToMinutes(t.estimated_hours),
      sortOrder: t.sort_order,
      createdAt: t.created_at,
    });
  }
  const placeholderTasks = tasks.filter((t) => t.title === "Line item").length;
  if (placeholderTasks > 0) {
    note(
      "warning",
      "tasks",
      `${placeholderTasks} tasks are titled "Line item" (Life's name for an unnamed line, with no estimate): imported as they are, the owner may want to name or delete them`,
    );
  }
  const taskIds = new Set(tasks.map((t) => t.lifeId));
  const taskAssignment = new Map(life.tasks.map((t) => [t.id, t.assignment_id]));

  // Recurring templates ------------------------------------------------------------------------------
  const recurring: PlannedRecurring[] = [];
  for (const r of [...life.recurring].sort(bySort)) {
    const scope = `recurring ${r.name}`;
    if (!clientIds.has(r.client_id)) {
      note("skipped", scope, "its client was not imported");
      continue;
    }
    const name = clean(r.name);
    const period = r.recurrence_period;
    const start = day(r.recurrence_start_date);
    if (name.length < 1 || name.length > 120 || (period !== "week" && period !== "month" && period !== "year") || !start) {
      note("skipped", scope, "the name, period or start date cannot be kept");
      continue;
    }
    if (r.recurrence_interval < 1 || r.recurrence_interval > 4) {
      note("skipped", scope, `an interval of ${r.recurrence_interval} is outside 1 to 4`);
      continue;
    }
    const lifeAmount = majorToMinor(r.amount);
    const net = netOfGross(lifeAmount, spaceVatBp);
    const exact = lineAmounts(100, net, 0, spaceVatBp).inclMinor === lifeAmount;
    recurring.push({
      id: idOf("recurring", r.id),
      lifeId: r.id,
      clientId: idOf("client", r.client_id),
      name,
      description: name,
      unitPriceMinor: net,
      currency: r.currency,
      interval: r.recurrence_interval,
      period,
      startDate: start,
      paymentDays: r.payment_due_days,
      isActive: r.is_active,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
      lifeAmountMinor: lifeAmount,
    });
    note(
      exact ? "altered" : "warning",
      scope,
      `Life's fixed VAT-inclusive amount ${fmt(lifeAmount)} becomes the net price ${fmt(net)} at ${bpText(spaceVatBp)} % (the space's default VAT); ${exact ? "one invoice of it comes to the same amount including VAT" : `one invoice of it comes to ${fmt(lineAmounts(100, net, 0, spaceVatBp).inclMinor)} including VAT, not ${fmt(lifeAmount)}`}. Schedule kept (every ${r.recurrence_interval} ${period} from ${start}); ${r.is_active ? "active" : "paused"}, auto-issue off. Its earlier invoices are imported and are not generated again.`,
    );
  }
  const recurringIds = new Set(recurring.map((r) => r.lifeId));

  // Invoices ------------------------------------------------------------------------------------------
  const linesByInvoice = new Map<string, LifeLine[]>();
  for (const l of life.invoice_lines) {
    const list = linesByInvoice.get(l.invoice_id) ?? [];
    list.push(l);
    linesByInvoice.set(l.invoice_id, list);
  }
  const transactions = new Map((life.finance_transactions ?? []).map((t) => [t.id, t]));
  const invoices: PlannedInvoice[] = [];
  const reconciliation: InvoiceReconciliation[] = [];
  const entriesByTask = new Map<string, LifeTimeEntry[]>();
  for (const e of life.time_entries) {
    if (e.task_id) entriesByTask.set(e.task_id, [...(entriesByTask.get(e.task_id) ?? []), e]);
  }
  const linkedEntries = new Map<string, string>(); // life entry id -> planned line id
  let nUnnumbered = 0;

  for (const i of [...life.invoices].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
    const short = i.id.slice(0, 8);
    const scope = `invoice ${i.invoice_number ?? short}`;
    const cname = clientName.get(i.client_id) ?? "?";
    const emptyRec = (label: string, why: string): InvoiceReconciliation => ({
      lifeId: i.id,
      id: idOf("invoice", i.id),
      label,
      status: i.status,
      clientName: cname,
      lifeHeader: null,
      lifeLineSums: { exclMinor: 0, vatMinor: 0, inclMinor: 0 },
      store: { subtotalMinor: 0, vatMinor: 0, totalMinor: 0 },
      recomputed: { exclMinor: 0, vatMinor: 0, inclMinor: 0 },
      lines: [],
      headerMatchesLines: false,
      totalDifferenceMinor: 0,
      skipped: why,
    });
    const skip = (why: string) => {
      note("skipped", scope, why);
      reconciliation.push(emptyRec(i.invoice_number ?? short, why));
    };
    if (!clientIds.has(i.client_id)) {
      skip("its client was not imported");
      continue;
    }
    if (i.status !== "draft" && i.status !== "sent" && i.status !== "paid") {
      skip(`Life status ${i.status} cannot be imported faithfully (a voided invoice needs a credit note); left out`);
      continue;
    }
    if (!CURRENCY.test(i.currency)) {
      skip(`currency ${i.currency} is not a three-letter code`);
      continue;
    }
    if (i.assignment_id && !assignmentIds.has(i.assignment_id)) {
      skip("its assignment was not imported");
      continue;
    }
    if (i.recurring_invoice_id && !recurringIds.has(i.recurring_invoice_id)) {
      skip("its recurring template was not imported");
      continue;
    }
    const isDraft = i.status === "draft";
    const lifeLines = [...(linesByInvoice.get(i.id) ?? [])].sort(bySort);
    if (lifeLines.length === 0 && !isDraft) {
      skip("an issued invoice with no lines");
      continue;
    }

    // Lines: Life's own amounts, and what Store's formula gives from the same figures.
    const planned: PlannedLine[] = [];
    const lineRec: LineReconciliation[] = [];
    let bad: string | null = null;
    const invoiceId = idOf("invoice", i.id);
    for (const [n, l] of lifeLines.entries()) {
      try {
        const qty = hoursToHundredths(l.quantity_hours ?? 0);
        const price = majorToMinor(l.unit_rate ?? 0);
        const discount = percentToBp(l.discount_percent ?? 0);
        const vatBp = l.vat_percent === null || l.vat_percent === undefined ? spaceVatBp : percentToBp(l.vat_percent);
        if (qty > 10_000_000 || price > 1_000_000_000 || discount > 10_000 || vatBp >= 10_000) {
          bad = `line ${n + 1} is outside the limits Store allows`;
          break;
        }
        const category: PlannedLine["vatCategory"] = vatBp === 0 ? "exempt" : "standard";
        const lifeAmounts: LineAmounts = {
          exclMinor: majorToMinor(l.amount_excl_vat),
          vatMinor: majorToMinor(l.vat_amount),
          inclMinor: majorToMinor(l.amount_incl_vat),
        };
        if (lifeAmounts.inclMinor !== lifeAmounts.exclMinor + lifeAmounts.vatMinor) {
          bad = `line ${n + 1}'s amounts do not add up (${fmt(lifeAmounts.exclMinor)} + ${fmt(lifeAmounts.vatMinor)} is not ${fmt(lifeAmounts.inclMinor)})`;
          break;
        }
        // A draft is re-priced by Store on every edit, with the store's own VAT rate: import it as Store would hold it.
        const priceBp = isDraft ? (vatBp === 0 ? 0 : options.standardVatBp) : vatBp;
        const recomputed = lineAmounts(qty, price, discount, vatBp);
        const stored = isDraft ? lineAmounts(qty, price, discount, priceBp) : lifeAmounts;
        let description = clean(l.description);
        if (description === "") description = "Line item";
        if (description.length > 500) {
          note("altered", scope, `line ${n + 1}'s description was cut to 500 characters`);
          description = description.slice(0, 500);
        }
        if (isDraft && vatBp !== 0 && vatBp !== options.standardVatBp) {
          note("warning", scope, `draft line ${n + 1} has ${bpText(vatBp)} % VAT; Store prices a draft at ${bpText(options.standardVatBp)} %`);
        }
        const taskId = l.task_id && taskIds.has(l.task_id) ? l.task_id : null;
        if (l.task_id && !taskId) note("altered", scope, `line ${n + 1}'s task was not imported; the line keeps no task`);
        planned.push({
          id: idOf("line", l.id),
          lifeId: l.id,
          position: n,
          assignmentId: taskId && i.assignment_id ? idOf("assignment", i.assignment_id) : null,
          taskId: taskId ? idOf("task", taskId) : null,
          description,
          unit: i.recurring_invoice_id ? "unit" : "hour",
          quantityHundredths: qty,
          unitPriceMinor: price,
          discountBp: discount,
          vatCategory: category,
          vatBp: priceBp,
          exclMinor: stored.exclMinor,
          vatMinor: stored.vatMinor,
          inclMinor: stored.inclMinor,
          quantityManual: false,
          createdAt: l.created_at,
        });
        lineRec.push({
          position: n + 1,
          description,
          life: lifeAmounts,
          store: stored,
          recomputed,
          differs:
            lifeAmounts.exclMinor !== stored.exclMinor ||
            lifeAmounts.vatMinor !== stored.vatMinor ||
            lifeAmounts.inclMinor !== stored.inclMinor,
          formulaDiffers:
            lifeAmounts.exclMinor !== recomputed.exclMinor ||
            lifeAmounts.vatMinor !== recomputed.vatMinor ||
            lifeAmounts.inclMinor !== recomputed.inclMinor,
        });
      } catch (error) {
        bad = `line ${n + 1} cannot be read: ${error instanceof Error ? error.message : String(error)}`;
        break;
      }
    }
    if (bad) {
      skip(bad);
      continue;
    }

    const lifeLineSums = sumLines(lineRec.map((l) => l.life));
    const recomputedSums = sumLines(lineRec.map((l) => l.recomputed));
    const storeLineSums = sumLines(lineRec.map((l) => l.store));

    // The header.
    let header: { subtotalMinor: number; vatMinor: number; totalMinor: number };
    let lifeHeader: InvoiceReconciliation["lifeHeader"] = null;
    if (isDraft) {
      header = { subtotalMinor: storeLineSums.exclMinor, vatMinor: storeLineSums.vatMinor, totalMinor: storeLineSums.inclMinor };
      if (i.subtotal_excl_vat !== null && i.subtotal_excl_vat !== undefined) {
        note("warning", scope, "a draft with a frozen total in Life; the total is worked out from its lines");
      }
    } else if (
      i.subtotal_excl_vat === null ||
      i.subtotal_excl_vat === undefined ||
      i.total_vat === null ||
      i.total_vat === undefined ||
      i.total_incl_vat === null ||
      i.total_incl_vat === undefined
    ) {
      header = { subtotalMinor: lifeLineSums.exclMinor, vatMinor: lifeLineSums.vatMinor, totalMinor: lifeLineSums.inclMinor };
      note("warning", scope, "Life holds no frozen total for this issued invoice; the sum of its lines is used");
    } else {
      lifeHeader = {
        subtotalMinor: majorToMinor(i.subtotal_excl_vat),
        vatMinor: majorToMinor(i.total_vat),
        totalMinor: majorToMinor(i.total_incl_vat),
      };
      if (lifeHeader.totalMinor !== lifeHeader.subtotalMinor + lifeHeader.vatMinor) {
        skip(`Life's total ${fmt(lifeHeader.totalMinor)} is not its subtotal plus VAT`);
        continue;
      }
      header = lifeHeader;
    }
    if (header.totalMinor <= 0 && !isDraft) {
      skip("an issued invoice with a zero total");
      continue;
    }
    const headerMatchesLines =
      header.subtotalMinor === storeLineSums.exclMinor &&
      header.vatMinor === storeLineSums.vatMinor &&
      header.totalMinor === storeLineSums.inclMinor;
    if (!headerMatchesLines) {
      note(
        "warning",
        scope,
        `Life's frozen total ${fmt(header.totalMinor)} is not the sum of its lines ${fmt(storeLineSums.inclMinor)}; the frozen total is kept`,
      );
    }

    // Time on the lines: only a task's own billable time of the invoice's assignment goes on that task's line.
    if (i.assignment_id) {
      for (const line of planned) {
        const source = lifeLines[line.position];
        if (!source.task_id || !line.taskId) continue;
        const entries = (entriesByTask.get(source.task_id) ?? []).filter(
          (e) => e.billable && e.assignment_id === i.assignment_id && !linkedEntries.has(e.id),
        );
        if (entries.length === 0) continue;
        for (const e of entries) linkedEntries.set(e.id, line.id);
        const minutes = entries.reduce((s, e) => s + e.minutes, 0);
        if (minutes100(minutes) !== line.quantityHundredths) {
          line.quantityManual = true;
          note(
            "warning",
            scope,
            `line ${line.position + 1} is ${fmt100(line.quantityHundredths)} h but its ${entries.length} time entries come to ${fmt100(minutes100(minutes))} h; the entries are attached and the quantity is marked as typed by hand`,
          );
        }
      }
    }

    // Status, number, dates, payment.
    const legacy = orNull(i.invoice_number);
    const issuedOn = isDraft ? null : day(i.issued_on);
    const dueOn = isDraft ? null : day(i.due_on);
    let paymentDays = i.payment_due_days ?? null;
    if (isDraft) {
      if (i.issued_on) note("altered", scope, `the draft's issue date ${i.issued_on} is dropped (Store dates an invoice when it is issued)`);
    } else {
      if (!issuedOn || !dueOn) {
        skip("an issued invoice needs an issue date and a due date");
        continue;
      }
      if (paymentDays === null) {
        const span = daysBetween(issuedOn, dueOn);
        if (span >= 1 && span <= 90) {
          paymentDays = span;
          note("assumption", scope, `payment terms taken from the dates (${issuedOn} to ${dueOn}): ${span} days`);
        } else {
          paymentDays = 14;
          note("assumption", scope, `payment terms are not derivable from the dates (${issuedOn} to ${dueOn}); 14 days recorded`);
        }
      }
      if (dueOn < issuedOn) note("warning", scope, `the due date ${dueOn} is before the issue date ${issuedOn}; kept as Life had it`);
    }
    if (!isDraft) {
      if (legacy) note("assumption", scope, `keeps Life's number ${legacy} as its number`);
      else nUnnumbered += 1;
      if (i.recurring_period && issuedOn && i.recurring_period.slice(0, 7) !== issuedOn.slice(0, 7)) {
        note(
          "warning",
          scope,
          `issued ${issuedOn} for the period ${i.recurring_period} (Life's dates disagree); both kept as they are`,
        );
      }
    }
    let payment: PlannedPayment | null = null;
    if (i.status === "paid") {
      const transaction = i.finance_transaction_id ? transactions.get(i.finance_transaction_id) : undefined;
      let receivedOn: string;
      let source: PlannedPayment["dateSource"];
      if (day(i.paid_at)) {
        receivedOn = day(i.paid_at) as string;
        source = "paid_at";
      } else if (transaction && day(transaction.occurred_on)) {
        receivedOn = day(transaction.occurred_on) as string;
        source = "finance_transaction";
      } else {
        receivedOn = dueOn as string;
        source = "due_on";
      }
      note(
        "assumption",
        scope,
        `paid in full: one payment of ${fmt(header.totalMinor)} received ${receivedOn} (${
          source === "paid_at"
            ? "Life's paid date"
            : source === "finance_transaction"
              ? "Life had no paid date; the date of the Finances transaction linked to the invoice"
              : "Life had no paid date and no linked transaction; the due date"
        }), method other, reference imported`,
      );
      payment = {
        id: idOf("payment", i.id),
        amountMinor: header.totalMinor,
        currency: i.currency,
        receivedOn,
        method: "other",
        reference: "imported",
        dateSource: source,
      };
    }
    const vatNotes = [...new Set(planned.filter((l) => l.vatCategory !== "standard").map((l) => l.vatCategory))].sort();

    invoices.push({
      id: invoiceId,
      lifeId: i.id,
      clientId: idOf("client", i.client_id),
      assignmentId: i.assignment_id ? idOf("assignment", i.assignment_id) : null,
      recurringId: i.recurring_invoice_id ? idOf("recurring", i.recurring_invoice_id) : null,
      recurringPeriod: day(i.recurring_period),
      status: isDraft ? "draft" : i.status === "paid" ? "paid" : "sent",
      imported: !isDraft,
      legacyNumber: isDraft ? null : legacy,
      label: isDraft ? null : (legacy ?? IMPORTED_LABEL),
      issuedOn,
      dueOn,
      sentAt: isDraft ? null : (i.sent_at ?? null),
      currency: i.currency,
      paymentDays,
      notes: orNull(i.notes),
      subtotalMinor: header.subtotalMinor,
      vatMinor: header.vatMinor,
      totalMinor: header.totalMinor,
      vatNotes,
      lines: planned,
      payment,
      createdAt: i.created_at,
    });
    reconciliation.push({
      lifeId: i.id,
      id: invoiceId,
      label: isDraft ? "Draft" : (legacy ?? IMPORTED_LABEL),
      status: i.status,
      clientName: cname,
      lifeHeader,
      lifeLineSums,
      store: header,
      recomputed: recomputedSums,
      lines: lineRec,
      headerMatchesLines,
      totalDifferenceMinor: lifeHeader ? header.totalMinor - lifeHeader.totalMinor : 0,
      skipped: null,
    });
  }
  const unitLines = invoices.reduce((n, i) => n + i.lines.filter((l) => l.unit === "unit").length, 0);
  if (unitLines > 0) {
    note(
      "altered",
      "invoices",
      `${unitLines} lines of repeating-invoice instances are kept as one unit (Life stores every quantity as hours, so a fixed monthly fee reads "1 hour" there); the amounts are unchanged`,
    );
  }
  if (nUnnumbered > 0) {
    note(
      "assumption",
      "invoices",
      `${nUnnumbered} issued invoices have no number in Life: they are shown as "${IMPORTED_LABEL}" and take nothing from the store's invoice series`,
    );
  }
  const sentWithoutDate = life.invoices.filter((i) => i.status !== "draft" && !i.sent_at).length;
  if (sentWithoutDate > 0) {
    note(
      "assumption",
      "invoices",
      `${sentWithoutDate} issued invoices have no sent date in Life: the time it was sent is set to noon on the issue date in the store's time zone`,
    );
  }
  if (invoices.some((i) => i.imported)) {
    note(
      "assumption",
      "invoices",
      "sent and paid invoices are frozen as imported issued invoices with Life's own line and total amounts (not re-priced); Life's `sent` invoices without a payment stay open (sent) exactly as Life had them, including those past their due date: record their payments in Work. They are not emailed and get no hosted-page link.",
    );
  }

  // Time entries ------------------------------------------------------------------------------------
  const entries: PlannedEntry[] = [];
  const plannedLineIds = new Set(invoices.flatMap((i) => i.lines.map((l) => l.id)));
  for (const e of [...life.time_entries].sort((a, b) => a.work_date.localeCompare(b.work_date) || a.created_at.localeCompare(b.created_at))) {
    const scope = `time entry ${e.work_date} ${e.minutes} min`;
    if (!assignmentIds.has(e.assignment_id)) {
      note("skipped", scope, "its assignment was not imported");
      continue;
    }
    if (!Number.isInteger(e.minutes) || e.minutes < 1 || e.minutes > 1440) {
      note("skipped", scope, `${e.minutes} minutes is outside 1 to 1440`);
      continue;
    }
    const workDate = day(e.work_date);
    if (!workDate) {
      note("skipped", scope, "no valid date");
      continue;
    }
    let taskId: string | null = null;
    if (e.task_id) {
      if (taskIds.has(e.task_id) && taskAssignment.get(e.task_id) === e.assignment_id) taskId = idOf("task", e.task_id);
      else note("altered", scope, "its task was not imported (or belongs to another assignment); the entry keeps no task");
    }
    let note500 = orNull(e.note);
    if (note500 && note500.length > 500) {
      note("altered", scope, "the note was cut to 500 characters");
      note500 = note500.slice(0, 500);
    }
    const lineId = linkedEntries.get(e.id) ?? null;
    entries.push({
      id: idOf("entry", e.id),
      lifeId: e.id,
      assignmentId: idOf("assignment", e.assignment_id),
      taskId,
      workDate,
      minutes: e.minutes,
      billable: e.billable,
      note: note500,
      invoiceLineId: lineId && plannedLineIds.has(lineId) ? lineId : null,
      createdAt: e.created_at,
    });
  }
  if (entries.length > 0) {
    const attached = entries.filter((e) => e.invoiceLineId).length;
    note(
      "assumption",
      "time entries",
      `all ${entries.length} entries are attributed to the store member ${options.accountEmail} (Life's user is not a store account). ${attached} entr${attached === 1 ? "y is" : "ies are"} attached to the invoice line of their own task (billable time of a task goes on that task's line, as Store's own sync does); ${entries.length - attached} are left unbilled: no invoice line of Life's names them (time logged without a task)`,
    );
  }

  const count = (life: number, imported: number) => ({ life, imported });
  return {
    options,
    spaceId: life.source?.space_id ?? null,
    clients,
    assignments,
    tasks,
    entries,
    recurring,
    invoices,
    reconciliation,
    notes,
    skipped,
    counts: {
      clients: count(life.clients.length, clients.length),
      assignments: count(life.assignments.length, assignments.length),
      tasks: count(life.tasks.length, tasks.length),
      "time entries": count(life.time_entries.length, entries.length),
      "recurring templates": count(life.recurring.length, recurring.length),
      invoices: count(life.invoices.length, invoices.length),
      "invoice lines": count(life.invoice_lines.length, invoices.reduce((s, i) => s + i.lines.length, 0)),
      payments: count(life.invoices.filter((i) => i.status === "paid").length, invoices.filter((i) => i.payment).length),
    },
  };
}

const minutes100 = minutesToHundredths;

// --- Text helpers ----------------------------------------------------------------------------------

/** Minor units as a plain decimal with two places. */
export function fmt(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  return `${negative ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
const fmt100 = (hundredths: number) => fmt(hundredths);
const bpText = (bp: number) => (bp % 100 === 0 ? String(bp / 100) : fmt(bp));

// --- The SQL -----------------------------------------------------------------------------------------

const lit = (value: string | null): string => (value === null ? "null" : `'${value.replace(/'/g, "''")}'`);
const uuid = (value: string | null): string => (value === null ? "null::uuid" : `'${value}'::uuid`);
const int = (value: number | null): string => (value === null ? "null" : String(value));
const bool = (value: boolean): string => (value ? "true" : "false");
const date = (value: string | null): string => (value === null ? "null::date" : `'${value}'::date`);
const ts = (value: string): string => `'${value}'::timestamptz`;
const jsonb = (value: unknown): string => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
const idList = (ids: readonly string[]): string => (ids.length === 0 ? "array[]::uuid[]" : `array[${ids.map((i) => `'${i}'`).join(", ")}]::uuid[]`);

/**
 * The whole import as one SQL transaction. Run it against the store's database (psql -1 -f, or one
 * `execute_sql`); it either does everything and checks itself, or does nothing.
 */
export function renderSql(plan: ImportPlan): string {
  const { options } = plan;
  const store = options.storeId;
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);

  const invoiceIds = plan.invoices.map((i) => i.id);
  const lineIds = plan.invoices.flatMap((i) => i.lines.map((l) => l.id));
  const paymentIds = plan.invoices.flatMap((i) => (i.payment ? [i.payment.id] : []));

  push(
    "-- Import of one person's Work data from Kaizen Life into the store " + options.storeSlug + ".",
    "-- Generated by scripts/import-life-work.mjs (src/lib/work-import.ts); do not edit by hand.",
    `-- Life space ${plan.spaceId ?? "?"}: ${plan.counts.clients.imported} clients, ${plan.counts.assignments.imported} assignments, ${plan.counts.tasks.imported} tasks,`,
    `-- ${plan.counts["time entries"].imported} time entries, ${plan.counts["recurring templates"].imported} recurring templates, ${plan.counts.invoices.imported} invoices with ${plan.counts["invoice lines"].imported} lines, ${plan.counts.payments.imported} payments.`,
    "--",
    "-- One transaction. Every id is a uuid v5 of the Life id in the store's namespace and every insert is",
    "-- `on conflict do nothing`, so running it twice adds nothing. It stops (and does nothing) when the store",
    "-- already holds Work rows that are not from this import, when the store or member is not as expected, or when",
    "-- its own totals do not check out at the end. It writes nothing to Life, sends no email, takes no number from",
    "-- the store's invoice series and queues no D41 event.",
    "--",
    "-- Needs the migration `work_imported_invoices` applied first.",
    "begin;",
    "",
    "-- Tells the Work rules this transaction is the import (imported invoices can only be made under it).",
    "select set_config('commerce.work_importing', 'on', true);",
    "",
    "-- What the import needs from the store, read once: the member the rows are made by, and the seller as the",
    "-- store's own details and Work settings say it now (fill in the Work settings before running to get a complete seller).",
    "create temporary table work_import_ctx on commit drop as",
    "select s.id as store_id,",
    "       s.time_zone,",
    "       (select a.id from commerce.store_members m join commerce.accounts a on a.id = m.account_id",
    `         where m.store_id = s.id and lower(a.email) = lower(${lit(options.accountEmail)}) limit 1) as account_id,`,
    "       (select ds.next_number from commerce.document_series ds where ds.store_id = s.id and ds.series = 'work_invoice') as invoice_next,",
    "       (select ds.next_number from commerce.document_series ds where ds.store_id = s.id and ds.series = 'work_credit_note') as credit_next,",
    "       (select count(*) from commerce.integration_deliveries d where d.store_id = s.id) as deliveries,",
    "       jsonb_build_object(",
    "         'legal_name', s.legal_name, 'organisation_number', s.organisation_number,",
    "         'vat_registered', coalesce(ws.vat_registered, true),",
    "         'vat_number', case when coalesce(ws.vat_registered, true) then ws.vat_number end,",
    "         'address', s.postal_address, 'country', s.country, 'email', s.contact_email,",
    "         'bank_account', ws.bank_account, 'bic', ws.bic, 'payment_note', ws.payment_note,",
    "         'invoice_footer', ws.invoice_footer, 'late_payment_note', ws.late_payment_note) as seller",
    "from commerce.stores s",
    "left join commerce.work_settings ws on ws.store_id = s.id",
    `where s.id = ${uuid(store)} and s.slug = ${lit(options.storeSlug)};`,
    "",
    "-- Guards: the right store, Work on, the member exists, and nothing there that is not from this import.",
    "do $guard$",
    "declare",
    "  ctx record;",
    "  n bigint;",
    "begin",
    "  select * into ctx from work_import_ctx;",
    `  if ctx.store_id is null then raise exception 'work_import.store: no store ${options.storeSlug} with id ${store}'; end if;`,
    `  if ctx.time_zone is distinct from ${lit(options.timeZone)} then raise exception 'work_import.time_zone: the store is in %, expected ${options.timeZone}', ctx.time_zone; end if;`,
    "  if not exists (select 1 from commerce.stores where id = ctx.store_id and 'work' = any (modules)) then raise exception 'work_import.module: the Work module is not switched on for the store'; end if;",
    `  if ctx.account_id is null then raise exception 'work_import.member: ${options.accountEmail} is not a member of the store'; end if;`,
    "  if not exists (select 1 from commerce.countries where code = " + lit(options.clientCountry) + ") then raise exception 'work_import.country: unknown country " + options.clientCountry + "'; end if;",
  );
  const guardTables: [string, string[]][] = [
    ["work_clients", plan.clients.map((c) => c.id)],
    ["work_assignments", plan.assignments.map((a) => a.id)],
    ["work_tasks", plan.tasks.map((t) => t.id)],
    ["work_time_entries", plan.entries.map((e) => e.id)],
    ["work_recurring_invoices", plan.recurring.map((r) => r.id)],
    ["work_invoices", invoiceIds],
    ["work_invoice_lines", lineIds],
    ["work_invoice_payments", paymentIds],
  ];
  for (const [table, ids] of guardTables) {
    push(
      `  select count(*) into n from commerce.${table} where store_id = ctx.store_id and id <> all (${idList(ids)});`,
      `  if n > 0 then raise exception 'work_import.store_not_empty: % rows in ${table} are not from this import', n; end if;`,
    );
  }
  push(
    "  select count(*) into n from commerce.work_credit_notes where store_id = ctx.store_id;",
    "  if n > 0 then raise exception 'work_import.store_not_empty: % work_credit_notes rows are not from this import', n; end if;",
    "  select count(*) into n from commerce.work_timers where store_id = ctx.store_id;",
    "  if n > 0 then raise exception 'work_import.store_not_empty: % work_timers rows are not from this import', n; end if;",
    `  select count(*) into n from commerce.work_events where store_id = ctx.store_id and coalesce(data ->> 'import', '') <> '${IMPORT_SOURCE}';`,
    "  if n > 0 then raise exception 'work_import.store_not_empty: % work_events rows are not from this import', n; end if;",
    "end",
    "$guard$;",
    "",
  );

  // Clients
  if (plan.clients.length > 0) {
    push(
      "-- Clients",
      "insert into commerce.work_clients (id, store_id, name, billing_email, country, billing_address, locale, currency,",
      "  default_hourly_rate_minor, payment_days, business, vat_treatment, notes, sort_order, created_at, updated_at) values",
      plan.clients
        .map(
          (c) =>
            `  (${uuid(c.id)}, ${uuid(store)}, ${lit(c.name)}, ${lit(c.billingEmail)}, ${lit(c.country)}, '{}'::jsonb, ${lit(c.locale)}, ${lit(c.currency)}, ${int(c.defaultHourlyRateMinor)}, ${int(c.paymentDays)}, true, 'domestic', ${lit(c.notes)}, ${c.sortOrder}, ${ts(c.createdAt)}, ${ts(c.updatedAt)})`,
        )
        .join(",\n"),
      "on conflict do nothing;",
      "",
    );
  }
  // Assignments
  if (plan.assignments.length > 0) {
    push(
      "-- Assignments",
      "insert into commerce.work_assignments (id, store_id, client_id, name, status, billing_type, hourly_rate_minor, fixed_amount_minor,",
      "  estimated_minutes, start_date, end_date, estimate_alert_minutes, estimate_alert_popup, estimate_alert_sound, created_by, sort_order, created_at, updated_at)",
      "select v.id, " + uuid(store) + ", v.client_id, v.name, v.status, v.billing_type, v.hourly, v.fixed, v.estimate, v.start_date, v.end_date, v.alert_minutes, v.alert_popup, v.alert_sound, x.account_id, v.sort_order, v.created_at, v.created_at",
      "from work_import_ctx x, (values",
      plan.assignments
        .map(
          (a) =>
            `  (${uuid(a.id)}, ${uuid(a.clientId)}, ${lit(a.name)}, ${lit(a.status)}, ${lit(a.billingType)}, ${int(a.hourlyRateMinor)}::bigint, ${int(a.fixedAmountMinor)}::bigint, ${int(a.estimatedMinutes)}::integer, ${date(a.startDate)}, ${date(a.endDate)}, ${int(a.alertMinutes)}::integer, ${bool(a.alertPopup)}, ${bool(a.alertSound)}, ${a.sortOrder}, ${ts(a.createdAt)})`,
        )
        .join(",\n"),
      ") as v(id, client_id, name, status, billing_type, hourly, fixed, estimate, start_date, end_date, alert_minutes, alert_popup, alert_sound, sort_order, created_at)",
      "on conflict do nothing;",
      "",
    );
  }
  // Tasks
  if (plan.tasks.length > 0) {
    push(
      "-- Tasks",
      "insert into commerce.work_tasks (id, store_id, assignment_id, title, status, estimated_minutes, sort_order, created_at, updated_at) values",
      plan.tasks
        .map(
          (t) =>
            `  (${uuid(t.id)}, ${uuid(store)}, ${uuid(t.assignmentId)}, ${lit(t.title)}, ${lit(t.status)}, ${int(t.estimatedMinutes)}, ${t.sortOrder}, ${ts(t.createdAt)}, ${ts(t.createdAt)})`,
        )
        .join(",\n"),
      "on conflict do nothing;",
      "",
    );
  }
  // Recurring templates
  if (plan.recurring.length > 0) {
    push(
      "-- Recurring invoices (net prices: Life kept them VAT-inclusive)",
      "insert into commerce.work_recurring_invoices (id, store_id, client_id, name, description, unit, quantity_hundredths, unit_price_minor,",
      "  discount_bp, vat_category, currency, recurrence_interval, recurrence_period, start_date, payment_days, auto_issue, is_active, sort_order, created_at, updated_at) values",
      plan.recurring
        .map(
          (r) =>
            `  (${uuid(r.id)}, ${uuid(store)}, ${uuid(r.clientId)}, ${lit(r.name)}, ${lit(r.description)}, 'unit', 100, ${r.unitPriceMinor}, 0, 'standard', ${lit(r.currency)}, ${r.interval}, ${lit(r.period)}, ${date(r.startDate)}, ${int(r.paymentDays)}, false, ${bool(r.isActive)}, ${r.sortOrder}, ${ts(r.createdAt)}, ${ts(r.createdAt)})`,
        )
        .join(",\n"),
      "on conflict do nothing;",
      "",
    );
  }
  // Invoices
  push("-- Invoices: Life's drafts stay drafts; sent and paid ones are imported (issued, own number and amounts)");
  for (const i of plan.invoices) {
    const label = i.imported ? `${i.legacyNumber ? `Life ${i.legacyNumber}` : "unnumbered"} ${i.status} ${fmt(i.totalMinor)}` : `draft ${fmt(i.totalMinor)}`;
    push(`-- ${label} (Life ${i.lifeId})`);
    if (i.imported) {
      push(
        "insert into commerce.work_invoices (id, store_id, client_id, assignment_id, recurring_invoice_id, recurring_period, status, series,",
        "  number, document_number, imported, legacy_number, issued_on, due_on, sent_at, currency, locale, payment_days, notes,",
        "  subtotal_minor, vat_minor, total_minor, vat_notes, seller, buyer, created_by, created_at, updated_at)",
        `select ${uuid(i.id)}, x.store_id, c.id, ${uuid(i.assignmentId)}, ${uuid(i.recurringId)}, ${date(i.recurringPeriod)}, 'sent', 'work_invoice',`,
        `  null, ${lit(i.label)}, true, ${lit(i.legacyNumber)}, ${date(i.issuedOn)}, ${date(i.dueOn)},`,
        `  ${i.sentAt ? ts(i.sentAt) : `((${date(i.issuedOn)}::timestamp + interval '12 hours') at time zone x.time_zone)`}, ${lit(i.currency)}, c.locale, ${int(i.paymentDays)}, ${lit(i.notes)},`,
        `  ${i.subtotalMinor}, ${i.vatMinor}, ${i.totalMinor}, ${jsonb(i.vatNotes)}, x.seller,`,
        "  jsonb_build_object('name', coalesce(nullif(trim(c.legal_name), ''), c.name), 'client_name', c.name,",
        "    'organisation_number', c.organisation_number, 'vat_number', c.vat_number, 'address', c.billing_address,",
        "    'country', c.country, 'email', c.billing_email, 'contact_name', c.contact_name, 'business', c.business,",
        "    'vat_treatment', c.vat_treatment),",
        `  x.account_id, ${ts(i.createdAt)}, ${ts(i.createdAt)}`,
        `from work_import_ctx x join commerce.work_clients c on c.store_id = x.store_id and c.id = ${uuid(i.clientId)}`,
        "on conflict do nothing;",
      );
    } else {
      push(
        "insert into commerce.work_invoices (id, store_id, client_id, assignment_id, recurring_invoice_id, recurring_period, status, series,",
        "  currency, payment_days, notes, subtotal_minor, vat_minor, total_minor, created_by, created_at, updated_at)",
        `select ${uuid(i.id)}, x.store_id, ${uuid(i.clientId)}, ${uuid(i.assignmentId)}, ${uuid(i.recurringId)}, ${date(i.recurringPeriod)}, 'draft', 'work_invoice',`,
        `  ${lit(i.currency)}, ${int(i.paymentDays)}, ${lit(i.notes)}, ${i.subtotalMinor}, ${i.vatMinor}, ${i.totalMinor}, x.account_id, ${ts(i.createdAt)}, ${ts(i.createdAt)}`,
        "from work_import_ctx x",
        "on conflict do nothing;",
      );
    }
    if (i.lines.length > 0) {
      push(
        "insert into commerce.work_invoice_lines (id, store_id, invoice_id, position, assignment_id, task_id, description, unit,",
        "  quantity_hundredths, unit_price_minor, discount_bp, vat_category, vat_rate, excl_minor, vat_minor, incl_minor, quantity_manual, created_at, updated_at) values",
        i.lines
          .map(
            (l) =>
              `  (${uuid(l.id)}, ${uuid(store)}, ${uuid(i.id)}, ${l.position}, ${uuid(l.assignmentId)}, ${uuid(l.taskId)}, ${lit(l.description)}, ${lit(l.unit)}, ${l.quantityHundredths}, ${l.unitPriceMinor}, ${l.discountBp}, ${lit(l.vatCategory)}, ${bpToRate(l.vatBp)}, ${l.exclMinor}, ${l.vatMinor}, ${l.inclMinor}, ${bool(l.quantityManual)}, ${ts(l.createdAt)}, ${ts(l.createdAt)})`,
          )
          .join(",\n"),
        "on conflict do nothing;",
      );
    }
    push("");
  }
  // Time entries (after the lines they may be attached to)
  if (plan.entries.length > 0) {
    push(
      "-- Time entries (made by the store member; attached to the invoice line of their own task where Life's line is that task's time)",
      "insert into commerce.work_time_entries (id, store_id, assignment_id, task_id, account_id, work_date, minutes, billable, note, invoice_line_id, created_at, updated_at)",
      "select v.id, " + uuid(store) + ", v.assignment_id, v.task_id, x.account_id, v.work_date, v.minutes, v.billable, v.note, v.invoice_line_id, v.created_at, v.created_at",
      "from work_import_ctx x, (values",
      plan.entries
        .map(
          (e) =>
            `  (${uuid(e.id)}, ${uuid(e.assignmentId)}, ${uuid(e.taskId)}, ${date(e.workDate)}, ${e.minutes}, ${bool(e.billable)}, ${lit(e.note)}, ${uuid(e.invoiceLineId)}, ${ts(e.createdAt)})`,
        )
        .join(",\n"),
      ") as v(id, assignment_id, task_id, work_date, minutes, billable, note, invoice_line_id, created_at)",
      "on conflict do nothing;",
      "",
    );
  }
  // Payments
  const payments = plan.invoices.filter((i) => i.payment);
  if (payments.length > 0) {
    push(
      "-- Payments of the paid invoices: the invoice becomes paid by its own trigger, paid_at at noon on the day received",
      "insert into commerce.work_invoice_payments (id, store_id, invoice_id, amount_minor, currency, received_on, method, reference, recorded_by)",
      "select v.id, x.store_id, v.invoice_id, v.amount_minor, v.currency, v.received_on, v.method, v.reference, x.account_id",
      "from work_import_ctx x, (values",
      payments
        .map((i) => {
          const p = i.payment as PlannedPayment;
          return `  (${uuid(p.id)}, ${uuid(i.id)}, ${p.amountMinor}::bigint, ${lit(p.currency)}::char(3), ${date(p.receivedOn)}, ${lit(p.method)}, ${lit(p.reference)})`;
        })
        .join(",\n"),
      ") as v(id, invoice_id, amount_minor, currency, received_on, method, reference)",
      "on conflict do nothing;",
      "",
    );
  }
  // History
  const imported = plan.invoices.filter((i) => i.imported);
  if (imported.length > 0) {
    push(
      "-- One history entry per imported invoice (the payment and paid entries are left out while importing)",
      "insert into commerce.work_events (store_id, entity_type, entity_id, type, data, account_id)",
      "select x.store_id, 'invoice', v.id, 'invoice.imported', v.data, x.account_id",
      "from work_import_ctx x, (values",
      imported
        .map(
          (i) =>
            `  (${uuid(i.id)}, ${jsonb({ import: IMPORT_SOURCE, life_invoice_id: i.lifeId, legacy_number: i.legacyNumber, status: i.status, total_minor: i.totalMinor, currency: i.currency })})`,
        )
        .join(",\n"),
      ") as v(id, data)",
      "where not exists (select 1 from commerce.work_events e where e.store_id = x.store_id and e.entity_id = v.id and e.type = 'invoice.imported');",
      "",
    );
  }
  // Checks
  push(
    "-- The import checks itself: every row is there, every invoice has the total and status the plan worked out, and",
    "-- nothing it must not touch has moved (the invoice series, the integration queue). Any failure rolls it all back.",
    "do $check$",
    "declare",
    "  ctx record;",
    "  n bigint;",
    "begin",
    "  select * into ctx from work_import_ctx;",
  );
  const rowChecks: [string, number, string[]][] = [
    ["work_clients", plan.clients.length, plan.clients.map((c) => c.id)],
    ["work_assignments", plan.assignments.length, plan.assignments.map((a) => a.id)],
    ["work_tasks", plan.tasks.length, plan.tasks.map((t) => t.id)],
    ["work_time_entries", plan.entries.length, plan.entries.map((e) => e.id)],
    ["work_recurring_invoices", plan.recurring.length, plan.recurring.map((r) => r.id)],
    ["work_invoices", plan.invoices.length, invoiceIds],
    ["work_invoice_lines", lineIds.length, lineIds],
    ["work_invoice_payments", paymentIds.length, paymentIds],
  ];
  for (const [table, expected, ids] of rowChecks) {
    push(
      `  select count(*) into n from commerce.${table} where store_id = ctx.store_id and id = any (${idList(ids)});`,
      `  if n <> ${expected} then raise exception 'work_import.check: % of ${expected} ${table} rows are there', n; end if;`,
    );
  }
  if (plan.invoices.length > 0) {
    push(
      "  select count(*) into n from (values",
      plan.invoices
        .map(
          (i) =>
            `    (${uuid(i.id)}, ${lit(i.status)}, ${i.subtotalMinor}::bigint, ${i.vatMinor}::bigint, ${i.totalMinor}::bigint, ${i.lines.reduce((s, l) => s + l.inclMinor, 0)}::bigint, ${bool(i.imported)}, ${lit(i.label)})`,
        )
        .join(",\n"),
      "  ) as v(id, status, subtotal, vat, total, lines_incl, imported, label)",
      "  join commerce.work_invoices i on i.store_id = ctx.store_id and i.id = v.id",
      "  where i.status = v.status and i.subtotal_minor = v.subtotal and i.vat_minor = v.vat and i.total_minor = v.total",
      "    and i.imported = v.imported and i.document_number is not distinct from v.label",
      "    and (i.number is null)",
      "    and (select coalesce(sum(l.incl_minor), 0) from commerce.work_invoice_lines l where l.store_id = i.store_id and l.invoice_id = i.id) = v.lines_incl;",
      `  if n <> ${plan.invoices.length} then raise exception 'work_import.check: only % of ${plan.invoices.length} invoices have the status, number and totals planned', n; end if;`,
    );
  }
  push(
    "  if (select next_number from commerce.document_series where store_id = ctx.store_id and series = 'work_invoice') is distinct from ctx.invoice_next then",
    "    raise exception 'work_import.check: the work_invoice series moved'; end if;",
    "  if (select next_number from commerce.document_series where store_id = ctx.store_id and series = 'work_credit_note') is distinct from ctx.credit_next then",
    "    raise exception 'work_import.check: the work_credit_note series moved'; end if;",
    "  if (select count(*) from commerce.integration_deliveries where store_id = ctx.store_id) <> ctx.deliveries then",
    "    raise exception 'work_import.check: an integration event was queued'; end if;",
    "end",
    "$check$;",
    "",
    "commit;",
    "",
  );
  return out.join("\n");
}

// --- The report --------------------------------------------------------------------------------------

const pad = (text: string, width: number, right = false) => (right ? text.padStart(width) : text.padEnd(width));

/** The dry-run reconciliation report: what will be imported, every invoice's totals against Life's, and everything altered, assumed or left out. */
export function renderReport(plan: ImportPlan, extra: { sqlFile?: string; sqlBytes?: number } = {}): string {
  const { options } = plan;
  const out: string[] = [];
  out.push(
    `Kaizen Life -> ${options.storeSlug} (${options.storeId}), Life space ${plan.spaceId ?? "?"}`,
    `Store time zone ${options.timeZone}; rows made by ${options.accountEmail}.${extra.sqlFile ? ` SQL: ${extra.sqlFile}` : ""}`,
    "",
    "ROWS",
    ...Object.entries(plan.counts).map(
      ([kind, c]) => `  ${pad(kind, 22)} Life ${pad(String(c.life), 3, true)}  imported ${pad(String(c.imported), 3, true)}${c.life === c.imported ? "" : "   <-- differs"}`,
    ),
    "",
    "INVOICES (amounts in the invoice currency, major units)",
    `  ${pad("Life id", 9)}${pad("Number", 10)}${pad("Life", 6)}${pad("Client", 21)}${pad("Life total", 12, true)}${pad("Life lines", 12, true)}${pad("Store total", 12, true)}${pad("By 4.3", 12, true)}${pad("Diff", 7, true)}  Result`,
  );
  for (const r of plan.reconciliation) {
    if (r.skipped) {
      out.push(`  ${pad(r.lifeId.slice(0, 8), 9)}${pad(r.label, 10)}${pad(r.status, 6)}${pad(r.clientName.slice(0, 20), 21)}${pad("", 12)}${pad("", 12)}${pad("", 12)}${pad("", 12)}${pad("", 7)}  SKIPPED: ${r.skipped}`);
      continue;
    }
    const lifeTotal = r.lifeHeader ? fmt(r.lifeHeader.totalMinor) : "(draft)";
    const diffLines = r.lines.filter((l) => l.differs).length;
    const recomputedDiffers = r.recomputed.inclMinor !== r.store.totalMinor;
    const result = [
      r.totalDifferenceMinor === 0 ? "total equal" : "TOTAL DIFFERS",
      r.headerMatchesLines ? "lines add up" : "LINES DO NOT ADD UP",
      diffLines > 0
        ? `${diffLines} line(s) re-priced by the draft rule`
        : recomputedDiffers
          ? `Life's rounding kept; Store's formula gives ${fmt(r.recomputed.inclMinor)}`
          : "Store's formula agrees",
    ].join("; ");
    out.push(
      `  ${pad(r.lifeId.slice(0, 8), 9)}${pad(r.label, 10)}${pad(r.status, 6)}${pad(r.clientName.slice(0, 20), 21)}${pad(lifeTotal, 12, true)}${pad(fmt(r.lifeLineSums.inclMinor), 12, true)}${pad(fmt(r.store.totalMinor), 12, true)}${pad(fmt(r.recomputed.inclMinor), 12, true)}${pad(fmt(r.totalDifferenceMinor), 7, true)}  ${result}`,
    );
  }
  const issued = plan.reconciliation.filter((r) => !r.skipped && r.lifeHeader);
  const sum = (pick: (r: InvoiceReconciliation) => number) => issued.reduce((s, r) => s + pick(r), 0);
  out.push(
    `  ${pad("Total, issued", 46)}${pad(fmt(sum((r) => r.lifeHeader?.totalMinor ?? 0)), 12, true)}${pad(fmt(sum((r) => r.lifeLineSums.inclMinor)), 12, true)}${pad(fmt(sum((r) => r.store.totalMinor)), 12, true)}${pad(fmt(sum((r) => r.recomputed.inclMinor)), 12, true)}${pad(fmt(sum((r) => r.totalDifferenceMinor)), 7, true)}`,
    "  (Life total = the frozen header; Life lines = sum of Life's own line amounts; Store total = what the store will hold;",
    "   By 4.3 = the same lines re-priced by Store's exact half-up formula; Diff = Store total - Life total.)",
    "",
  );
  const lineDiffs = plan.reconciliation.flatMap((r) => r.lines.filter((l) => l.differs || l.formulaDiffers).map((l) => ({ r, l })));
  out.push("LINE ROUNDING (a line where Life's amounts, the store's amounts or Store's formula differ)");
  if (lineDiffs.length === 0) {
    out.push("  none: on every line Life's stored amounts equal what Store's formula gives from the same quantity, price, discount and VAT rate.");
  } else {
    for (const { r, l } of lineDiffs) {
      out.push(
        `  ${r.label} (${r.lifeId.slice(0, 8)}) line ${l.position} "${l.description.slice(0, 40)}": Life ${fmt(l.life.exclMinor)} + ${fmt(l.life.vatMinor)} = ${fmt(l.life.inclMinor)}; store ${fmt(l.store.exclMinor)} + ${fmt(l.store.vatMinor)} = ${fmt(l.store.inclMinor)}; formula ${fmt(l.recomputed.exclMinor)} + ${fmt(l.recomputed.vatMinor)} = ${fmt(l.recomputed.inclMinor)}`,
      );
    }
  }
  out.push("");
  const section = (title: string, level: Note["level"], list: Note[]) => {
    const items = list.filter((n) => n.level === level);
    if (items.length === 0) return;
    out.push(title);
    for (const n of items) out.push(`  [${n.scope}] ${n.message}`);
    out.push("");
  };
  section("LEFT OUT (could not be imported faithfully)", "skipped", plan.skipped);
  section("WARNINGS", "warning", plan.notes);
  section("ALTERED", "altered", plan.notes);
  section("ASSUMPTIONS", "assumption", plan.notes);
  if (plan.skipped.length === 0) out.push("Nothing was left out.", "");
  return out.join("\n");
}
