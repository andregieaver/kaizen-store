/**
 * Invoices brought in from Tripletex into Work (D494): what Tripletex's invoice list says (`GET /invoice`, each with its customer, its
 * order lines and its postings), read into plain shapes (`readTripletexInvoice()`), and the plan of what the store gets from it
 * (`planTripletexInvoices()`). Pure: no database, no network; the server reads Tripletex and the store's Work, and writes the plan in
 * one transaction (`src/server/tripletex-invoices.ts`).
 *
 * What comes in is history, as Life's invoices did (WP15, `work-import.ts`): an *imported* invoice, issued, with Tripletex's own number,
 * lines and amounts, never numbered from the store's series, never emailed, never sent back to Tripletex (the sync and the ledger leave
 * imported invoices out) and never posted. A payment Tripletex has is one payment row, so the invoice's status follows the money.
 *
 * Nothing comes twice: an invoice already here with Tripletex's number is the same invoice, and so is one of Life's that has no number of
 * its own, for the same client and amount within a week of Tripletex's date (it gets Tripletex's number, and the payment Tripletex has).
 * A Tripletex customer is the Work client with its organisation number, else the one with its name (without `AS`, `ENK` and the like);
 * a client found so is filled in where it is empty, never overwritten. A credit note for a whole invoice makes that invoice void; one for
 * part of it, or for an invoice not read, is left out and named, for the owner to add by hand.
 */
import { uuidV5 } from "./work-import";

// ---------------------------------------------------------------------------------------------------------------------
// Tripletex's answer
// ---------------------------------------------------------------------------------------------------------------------

/** The fields asked of `GET /invoice` [spec 2.75.22]: the invoice, its customer, its lines and its postings. */
export const TRIPLETEX_INVOICE_FIELDS = [
  "id,invoiceNumber,invoiceDate,invoiceDueDate,isCreditNote,creditedInvoice",
  "amountCurrency,amountExcludingVatCurrency,amountCurrencyOutstanding,invoiceComment,currency(code)",
  "customer(id,name,organizationNumber,email,invoiceEmail,phoneNumber,phoneNumberMobile,isPrivateIndividual,language,invoicesDueIn,invoicesDueInType,currency(code),postalAddress(addressLine1,addressLine2,postalCode,city,country(isoAlpha2Code)))",
  "orderLines(description,count,unitPriceExcludingVatCurrency,discount,amountExcludingVatCurrency,amountIncludingVatCurrency,sortIndex,vatType(number,percentage),product(name,productUnit(nameShort,commonCode)))",
  "postings(date,amountCurrency)",
].join(",");

export type TxCustomer = {
  id: number;
  name: string;
  organisationNumber: string | null;
  email: string | null;
  phone: string | null;
  business: boolean;
  english: boolean;
  paymentDays: number | null;
  currency: string | null;
  address: { line1: string | null; line2: string | null; postalCode: string | null; city: string | null };
  country: string | null;
};

export type TxLine = {
  description: string | null;
  productName: string | null;
  hours: boolean;
  count: number;
  unitPriceExcl: number;
  discount: number;
  vatPercent: number;
  vatCode: string | null;
  exclMinor: number;
  inclMinor: number;
  sortIndex: number;
};

export type TxInvoice = {
  id: number;
  number: number | null;
  issuedOn: string;
  dueOn: string | null;
  creditNote: boolean;
  /** The id of the invoice a credit note credits. */
  credits: number | null;
  currency: string;
  /** In the invoice's currency, minor units; negative on a credit note. */
  totalMinor: number;
  exclMinor: number;
  outstandingMinor: number;
  comment: string | null;
  customer: TxCustomer | null;
  lines: TxLine[];
  /** The days money came (the invoice's postings with a negative amount), latest last. */
  paidDays: string[];
};

type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);
const str = (v: unknown, max = 500): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t === "" ? null : t.slice(0, max);
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const minor = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n * 100);
};
const dayOf = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);
const currencyCode = (v: unknown): string | null => {
  const code = str(v, 10)?.toUpperCase();
  return code && /^[A-Z]{3}$/.test(code) ? code : null;
};
const id = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isSafeInteger(n) && n > 0 ? n : null;
};

const HOUR_UNITS = new Set(["t", "time", "timer", "h", "hr", "hrs", "hour", "hours", "tim"]);

function readCustomer(raw: unknown): TxCustomer | null {
  const c = obj(raw);
  const customerId = id(c?.id);
  const name = str(c?.name, 120);
  if (!c || customerId === null || !name) return null;
  const address = obj(c.postalAddress);
  const country = str(obj(address?.country)?.isoAlpha2Code, 10)?.toUpperCase() ?? null;
  const days = num(c.invoicesDueIn);
  const email = str(c.invoiceEmail, 200) ?? str(c.email, 200);
  return {
    id: customerId,
    name,
    organisationNumber: str(c.organizationNumber, 30),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    phone: str(c.phoneNumber, 40) ?? str(c.phoneNumberMobile, 40),
    business: c.isPrivateIndividual !== true,
    english: c.language === "EN",
    paymentDays: days !== null && Number.isInteger(days) && days >= 1 && days <= 90 && (c.invoicesDueInType ?? "DAYS") === "DAYS" ? days : null,
    currency: currencyCode(obj(c.currency)?.code),
    address: { line1: str(address?.addressLine1, 200), line2: str(address?.addressLine2, 200), postalCode: str(address?.postalCode, 20), city: str(address?.city, 100) },
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
  };
}

function readLine(raw: unknown): TxLine | null {
  const l = obj(raw);
  if (!l) return null;
  const count = num(l.count);
  const unitPriceExcl = num(l.unitPriceExcludingVatCurrency);
  const excl = minor(l.amountExcludingVatCurrency);
  const incl = minor(l.amountIncludingVatCurrency);
  if (count === null || unitPriceExcl === null || excl === null || incl === null) return null;
  const vat = obj(l.vatType);
  const product = obj(l.product);
  const unit = obj(product?.productUnit);
  const short = str(unit?.nameShort, 20)?.toLowerCase().replace(/\.$/, "") ?? "";
  return {
    description: str(l.description),
    productName: str(product?.name),
    hours: unit?.commonCode === "HUR" || HOUR_UNITS.has(short),
    count,
    unitPriceExcl,
    discount: num(l.discount) ?? 0,
    vatPercent: num(vat?.percentage) ?? 0,
    vatCode: vat?.number === undefined || vat?.number === null ? null : String(vat.number).trim().slice(0, 10),
    exclMinor: excl,
    inclMinor: incl,
    sortIndex: num(l.sortIndex) ?? 0,
  };
}

/** One value of Tripletex's invoice list read into the plain shape, or null when it lacks what an invoice must have. */
export function readTripletexInvoice(raw: unknown): TxInvoice | null {
  const i = obj(raw);
  const invoiceId = id(i?.id);
  const issuedOn = dayOf(i?.invoiceDate);
  const total = minor(i?.amountCurrency);
  const excl = minor(i?.amountExcludingVatCurrency);
  const currency = currencyCode(obj(i?.currency)?.code);
  if (!i || invoiceId === null || !issuedOn || total === null || excl === null || !currency) return null;
  const number = num(i.invoiceNumber);
  const lines = (Array.isArray(i.orderLines) ? i.orderLines : []).map(readLine);
  const paidDays = (Array.isArray(i.postings) ? i.postings : [])
    .map(obj)
    .filter((p): p is Raw => p !== null && (num(p.amountCurrency) ?? 0) < 0)
    .map((p) => dayOf(p.date))
    .filter((d): d is string => d !== null)
    .sort();
  return {
    id: invoiceId,
    number: number !== null && Number.isSafeInteger(number) && number > 0 ? number : null,
    issuedOn,
    dueOn: dayOf(i.invoiceDueDate),
    creditNote: i.isCreditNote === true,
    credits: id(i.creditedInvoice),
    currency,
    totalMinor: total,
    exclMinor: excl,
    outstandingMinor: minor(i.amountCurrencyOutstanding) ?? 0,
    comment: str(i.invoiceComment, 1000),
    customer: readCustomer(i.customer),
    // A line that cannot be read makes the lines unreadable as a whole: the invoice is then shown as one line per VAT rate.
    lines: lines.some((l) => l === null) ? [] : (lines as TxLine[]).sort((a, b) => a.sortIndex - b.sortIndex),
    paidDays,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// What the store has
// ---------------------------------------------------------------------------------------------------------------------

export type HereClient = {
  id: string;
  name: string;
  legalName: string | null;
  organisationNumber: string | null;
  billingEmail: string | null;
  phone: string | null;
  hasAddress: boolean;
  locale: string | null;
  vatTreatment: string;
};

export type HereInvoice = {
  id: string;
  clientId: string;
  imported: boolean;
  legacyNumber: string | null;
  documentNumber: string | null;
  status: "draft" | "sent" | "paid" | "void";
  issuedOn: string | null;
  currency: string;
  totalMinor: number;
  paidMinor: number;
};

export type PlanInput = {
  storeId: string;
  /** The Tripletex company the invoices are from: part of every id made, so two companies never share one. */
  companyId: number;
  invoices: readonly TxInvoice[];
  clients: readonly HereClient[];
  here: readonly HereInvoice[];
  /** The store's country, for a client Tripletex gives none (a client with no currency of its own takes its invoice's). */
  storeCountry: string;
  /** The countries the store knows (`commerce.countries`): a client's country is one of them, or the store's. */
  countries: ReadonlySet<string>;
  today: string;
};

// ---------------------------------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------------------------------

export type NewClient = {
  id: string;
  theirId: number;
  name: string;
  organisationNumber: string | null;
  billingEmail: string | null;
  phone: string | null;
  address: { line1: string | null; line2: string | null; postalCode: string | null; city: string | null };
  country: string;
  locale: string;
  currency: string;
  paymentDays: number | null;
  business: boolean;
  vatTreatment: "domestic" | "reverse_charge";
};

/** What a found client lacks and Tripletex has: only the empty fields. */
export type ClientFill = {
  clientId: string;
  theirId: number;
  organisationNumber?: string;
  billingEmail?: string;
  phone?: string;
  address?: NewClient["address"];
};

export type NewLine = {
  id: string;
  position: number;
  description: string;
  unit: "hour" | "unit";
  quantityHundredths: number;
  unitPriceMinor: number;
  discountBp: number;
  vatCategory: "standard" | "exempt" | "reverse_charge" | "outside_scope";
  /** A fraction with four places, e.g. `0.2500`. */
  vatRate: string;
  exclMinor: number;
  vatMinor: number;
  inclMinor: number;
};

export type NewPayment = { id: string; amountMinor: number; currency: string; receivedOn: string };

export type NewInvoice = {
  id: string;
  theirId: number;
  clientId: string;
  number: string;
  status: "sent" | "void";
  issuedOn: string;
  dueOn: string;
  paymentDays: number;
  currency: string;
  notes: string | null;
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
  vatNotes: string[];
  lines: NewLine[];
  /** True when Tripletex's lines could not be kept one by one: one line per VAT rate instead. */
  linesJoined: boolean;
  payment: NewPayment | null;
};

/** One already here (Tripletex's number, or one of Life's without a number), and what it gets from Tripletex. */
export type Matched = {
  invoiceId: string;
  theirId: number;
  number: string | null;
  /** Tripletex's number, given to an invoice that had none. */
  giveNumber: string | null;
  payment: NewPayment | null;
};

export type SkipReason = "credited_part" | "credit_alone" | "credited_here" | "number_taken" | "no_customer" | "amounts" | "lines" | "unreadable";

export type Skipped = { number: string | null; issuedOn: string | null; reason: SkipReason };

export type TripletexInvoicePlan = {
  clients: NewClient[];
  fills: ClientFill[];
  /** Every Tripletex customer and the client it is, for the sync to use the same customer card. */
  links: { clientId: string; theirId: number }[];
  invoices: NewInvoice[];
  matched: Matched[];
  skipped: Skipped[];
};

const ORG_FORMS = /\b(as|asa|enk|da|ans|sa|nuf|ks|ba|ab|aps|gmbh|ltd|limited|inc|llc|oy|oyj|bv)\b/g;

/** A company's name without its legal form, case, accents and punctuation: "Acme Norge AS" and "ACME NORGE" are one name. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9æøå ]+/g, " ")
    .replace(ORG_FORMS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const digitsOf = (v: string | null) => (v ? v.replace(/\D/g, "") : "");

/** Days between two ISO dates. */
const daysApart = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const rateOf = (percent: number) => (Math.round(percent * 100) / 10_000).toFixed(4);

/** The day a paid invoice's money came: its latest payment posting, else its due day, never after today nor before it was issued. */
function paidOn(t: TxInvoice, dueOn: string, today: string): string {
  const day = t.paidDays.at(-1) ?? dueOn;
  return day > today ? (t.issuedOn > today ? today : t.issuedOn) : day;
}

/** The lines as Work keeps them: one by one when each fits, else one per VAT rate (a discount line, a line Tripletex gave no amount). */
function linesOf(
  t: TxInvoice,
  idOf: (n: number) => string,
  categoryOf: (percent: number, code: string | null) => NewLine["vatCategory"],
): { lines: NewLine[]; joined: boolean } | null {
  const fallback = t.number ? `Tripletex ${t.number}` : "Tripletex";
  // Lines that add up to the invoice (within Tripletex's rounding to whole kroner); else the invoice's own totals are its one line.
  const sum = (lines: readonly { exclMinor: number; inclMinor: number }[]) => lines.reduce((a, l) => ({ excl: a.excl + l.exclMinor, incl: a.incl + l.inclMinor }), { excl: 0, incl: 0 });
  const fits = (lines: readonly { exclMinor: number; inclMinor: number }[]) => {
    const { excl, incl } = sum(lines);
    return Math.abs(excl - t.exclMinor) <= 100 && Math.abs(incl - t.totalMinor) <= 100;
  };
  const given = fits(t.lines) ? t.lines : [];
  const oneByOne = given.map((l, n): NewLine | null => {
    const quantity = Math.round(l.count * 100);
    const price = Math.round(l.unitPriceExcl * 100);
    const discount = Math.round(l.discount * 100);
    const vat = l.inclMinor - l.exclMinor;
    if (quantity < 0 || quantity > 10_000_000 || price < 0 || price > 1_000_000_000 || discount < 0 || discount > 10_000) return null;
    if (l.exclMinor < 0 || vat < 0 || l.vatPercent < 0 || l.vatPercent >= 100) return null;
    const category = categoryOf(l.vatPercent, l.vatCode);
    return {
      id: idOf(n),
      position: n,
      description: (l.description ?? l.productName ?? fallback).slice(0, 500),
      unit: l.hours ? "hour" : "unit",
      quantityHundredths: quantity,
      unitPriceMinor: price,
      discountBp: discount,
      vatCategory: category,
      vatRate: category === "standard" ? rateOf(l.vatPercent) : "0.0000",
      exclMinor: l.exclMinor,
      vatMinor: vat,
      inclMinor: l.inclMinor,
    };
  });
  if (given.length > 0 && oneByOne.every((l) => l !== null)) return { lines: oneByOne as NewLine[], joined: false };

  // One line per VAT rate, from the lines Tripletex gave (a discount line takes from its rate's sum), or from the invoice's own totals.
  const groups = new Map<number, { code: string | null; excl: number; incl: number; words: string[] }>();
  if (given.length > 0) {
    for (const l of given) {
      const g = groups.get(l.vatPercent) ?? { code: l.vatCode, excl: 0, incl: 0, words: [] };
      g.excl += l.exclMinor;
      g.incl += l.inclMinor;
      const words = l.description ?? l.productName;
      if (words && !g.words.includes(words)) g.words.push(words);
      groups.set(l.vatPercent, g);
    }
  } else {
    const vat = t.totalMinor - t.exclMinor;
    const percent = t.exclMinor > 0 ? Math.round((vat / t.exclMinor) * 10_000) / 100 : 0;
    groups.set(percent, { code: null, excl: t.exclMinor, incl: t.totalMinor, words: [] });
  }
  const joined: NewLine[] = [];
  for (const [percent, g] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
    const vat = g.incl - g.excl;
    if (g.excl < 0 || vat < 0 || percent < 0 || percent >= 100 || g.excl > 1_000_000_000) return null;
    if (g.excl === 0 && vat === 0) continue;
    const category = categoryOf(percent, g.code);
    joined.push({
      id: idOf(joined.length),
      position: joined.length,
      description: (g.words.join("; ") || fallback).slice(0, 500),
      unit: "unit",
      quantityHundredths: 100,
      unitPriceMinor: g.excl,
      discountBp: 0,
      vatCategory: category,
      vatRate: category === "standard" ? rateOf(percent) : "0.0000",
      exclMinor: g.excl,
      vatMinor: vat,
      inclMinor: g.incl,
    });
  }
  return joined.length > 0 ? { lines: joined, joined: true } : null;
}

/**
 * The plan: which clients are made and which filled in, which invoices come in with their lines and payments, which of the store's own
 * are the same invoice (and get Tripletex's number and payment), and which are left out and why. Deterministic: ids are uuid v5 of
 * Tripletex's own ids in the store's namespace, so a second run plans the same rows and adds nothing.
 */
export function planTripletexInvoices(input: PlanInput): TripletexInvoicePlan {
  const { storeId, companyId, today } = input;
  const idOf = (kind: string, ...parts: (string | number)[]) => uuidV5(`tripletex:${kind}:${companyId}:${parts.join(":")}`, storeId);
  const skipped: Skipped[] = [];
  const skip = (t: TxInvoice, reason: SkipReason) => skipped.push({ number: t.number === null ? null : String(t.number), issuedOn: t.issuedOn, reason });

  // Credit notes: one for the whole of an invoice read makes it void; any other is left out (with its invoice, when that is part-credited).
  const byId = new Map(input.invoices.map((t) => [t.id, t]));
  const voids = new Map<number, TxInvoice>();
  const leftOut = new Set<number>();
  for (const c of input.invoices.filter((t) => t.creditNote)) {
    const original = c.credits === null ? undefined : byId.get(c.credits);
    if (!original || original.creditNote) {
      skip(c, "credit_alone");
      continue;
    }
    if (-c.totalMinor === original.totalMinor && !voids.has(original.id)) voids.set(original.id, c);
    else {
      skip(c, "credited_part");
      leftOut.add(original.id);
    }
  }

  // Clients: by organisation number, else by name; each Tripletex customer once.
  const clients: NewClient[] = [];
  const fills = new Map<string, ClientFill>();
  const clientOf = new Map<number, string>();
  const vatOf = new Map<string, string>(input.clients.map((c) => [c.id, c.vatTreatment]));
  const byOrg = new Map<string, HereClient>();
  const byName = new Map<string, HereClient[]>();
  for (const c of input.clients) {
    const org = digitsOf(c.organisationNumber);
    if (org.length >= 6 && !byOrg.has(org)) byOrg.set(org, c);
    for (const key of new Set([nameKey(c.name), c.legalName ? nameKey(c.legalName) : ""])) {
      if (key) byName.set(key, [...(byName.get(key) ?? []), c]);
    }
  }
  /** A found client: filled in where it is empty from the customer card, and linked to it. */
  const fillFrom = (found: HereClient, customer: TxCustomer) => {
    const fill: ClientFill = fills.get(found.id) ?? { clientId: found.id, theirId: customer.id };
    if (!found.organisationNumber && customer.organisationNumber) fill.organisationNumber = customer.organisationNumber;
    if (!found.billingEmail && customer.email) fill.billingEmail = customer.email;
    if (!found.phone && customer.phone) fill.phone = customer.phone;
    if (!found.hasAddress && (customer.address.line1 || customer.address.city)) fill.address = customer.address;
    fills.set(found.id, fill);
    if (!clientOf.has(customer.id)) clientOf.set(customer.id, found.id);
  };
  const resolve = (customer: TxCustomer, currency: string): string => {
    const known = clientOf.get(customer.id);
    if (known) return known;
    const org = digitsOf(customer.organisationNumber);
    let found = org.length >= 6 ? byOrg.get(org) : undefined;
    if (!found) {
      // By name only among clients with no other organisation number: two companies of one name are two clients.
      const named = (byName.get(nameKey(customer.name)) ?? []).filter((c) => {
        const theirs = digitsOf(c.organisationNumber);
        return theirs === "" || theirs === org;
      });
      if (named.length === 1) found = named[0];
    }
    if (found) {
      fillFrom(found, customer);
      return found.id;
    }
    const country = customer.country && input.countries.has(customer.country) ? customer.country : input.storeCountry;
    const vatTreatment = customer.business && country !== input.storeCountry ? "reverse_charge" : "domestic";
    const made: NewClient = {
      id: idOf("client", customer.id),
      theirId: customer.id,
      name: customer.name,
      organisationNumber: customer.organisationNumber,
      billingEmail: customer.email,
      phone: customer.phone,
      address: customer.address,
      country,
      locale: customer.english ? "en-GB" : "nb-NO",
      currency: customer.currency ?? currency,
      paymentDays: customer.paymentDays,
      business: customer.business,
      vatTreatment,
    };
    clients.push(made);
    vatOf.set(made.id, vatTreatment);
    if (org.length >= 6) byOrg.set(org, { ...made, legalName: null, hasAddress: true, locale: made.locale });
    byName.set(nameKey(made.name), [...(byName.get(nameKey(made.name)) ?? []), { ...made, legalName: null, hasAddress: true, locale: made.locale }]);
    clientOf.set(customer.id, made.id);
    return made.id;
  };

  // The store's invoices: by number (Tripletex's, kept as an imported invoice's own), and Life's unnumbered ones to match by amount.
  const byLegacy = new Map(input.here.filter((h) => h.legacyNumber).map((h) => [h.legacyNumber as string, h]));
  const numbersTaken = new Set(input.here.map((h) => h.documentNumber).filter((n): n is string => n !== null && n !== "Imported"));
  const unnumbered = input.here.filter((h) => h.imported && h.legacyNumber === null && h.status !== "draft" && h.issuedOn);
  const used = new Set<string>();

  const invoices: NewInvoice[] = [];
  const matched: Matched[] = [];

  const ordered = input.invoices.filter((t) => !t.creditNote).sort((a, b) => a.issuedOn.localeCompare(b.issuedOn) || a.id - b.id);
  // Two passes: an invoice that has its number here first, so a Life invoice matched by amount is never one another has by number.
  for (const t of ordered) {
    const number = t.number === null ? null : String(t.number);
    const same = number ? byLegacy.get(number) : undefined;
    if (same) used.add(same.id);
  }
  for (const t of ordered) {
    if (leftOut.has(t.id)) {
      skip(t, "credited_part");
      continue;
    }
    if (!t.customer) {
      skip(t, "no_customer");
      continue;
    }
    const number = t.number === null ? null : String(t.number);
    const credit = voids.get(t.id);
    const dueOn = t.dueOn && t.dueOn >= t.issuedOn ? t.dueOn : addDays(t.issuedOn, t.customer.paymentDays ?? 14);
    const paidMinor = credit ? 0 : Math.max(0, Math.min(t.totalMinor, t.totalMinor - t.outstandingMinor));
    const paymentFor = (alreadyMinor: number): NewPayment | null => {
      const more = paidMinor - alreadyMinor;
      return more > 0 ? { id: idOf("payment", t.id, paidMinor), amountMinor: more, currency: t.currency, receivedOn: paidOn(t, dueOn, today) } : null;
    };

    // Already here with its number.
    const same = number ? byLegacy.get(number) : undefined;
    if (same) {
      const client = input.clients.find((c) => c.id === same.clientId);
      if (client) fillFrom(client, t.customer);
      if (credit && same.status !== "void") skip(t, "credited_here");
      matched.push({ invoiceId: same.id, theirId: t.id, number, giveNumber: null, payment: same.status === "sent" && same.currency === t.currency ? paymentFor(same.paidMinor) : null });
      continue;
    }
    if (number && numbersTaken.has(number)) {
      skip(t, "number_taken");
      continue;
    }
    const clientId = resolve(t.customer, t.currency);

    // One of Life's without a number: the same client, currency and amount, within a week (the nearest).
    const life = unnumbered
      .filter((h) => !used.has(h.id) && h.clientId === clientId && h.currency === t.currency && h.totalMinor === t.totalMinor && daysApart(h.issuedOn as string, t.issuedOn) <= 7)
      .sort((a, b) => daysApart(a.issuedOn as string, t.issuedOn) - daysApart(b.issuedOn as string, t.issuedOn))[0];
    if (life) {
      used.add(life.id);
      if (credit && life.status !== "void") skip(t, "credited_here");
      matched.push({ invoiceId: life.id, theirId: t.id, number, giveNumber: number, payment: life.status === "sent" ? paymentFor(life.paidMinor) : null });
      if (number) numbersTaken.add(number);
      continue;
    }

    // A new imported invoice.
    const vatTreatment = vatOf.get(clientId) ?? "domestic";
    const categoryOf = (percent: number, code: string | null): NewLine["vatCategory"] => {
      if (percent > 0) return "standard";
      if (vatTreatment === "reverse_charge") return "reverse_charge";
      return code === "6" || code === "7" ? "outside_scope" : "exempt";
    };
    const vat = t.totalMinor - t.exclMinor;
    if (t.totalMinor <= 0 || t.exclMinor < 0 || vat < 0 || t.totalMinor > 1_000_000_000_00) {
      skip(t, "amounts");
      continue;
    }
    const made = linesOf(t, (n) => idOf("line", t.id, n), categoryOf);
    if (!made) {
      skip(t, "lines");
      continue;
    }
    const span = daysApart(t.issuedOn, dueOn);
    invoices.push({
      id: idOf("invoice", t.id),
      theirId: t.id,
      clientId,
      number: number ?? "Imported",
      status: credit ? "void" : "sent",
      issuedOn: t.issuedOn,
      dueOn,
      paymentDays: span >= 1 && span <= 90 ? span : (t.customer.paymentDays ?? 14),
      currency: t.currency,
      notes: t.comment,
      subtotalMinor: t.exclMinor,
      vatMinor: vat,
      totalMinor: t.totalMinor,
      vatNotes: [...new Set(made.lines.filter((l) => l.vatCategory !== "standard").map((l) => l.vatCategory))].sort(),
      lines: made.lines,
      linesJoined: made.joined,
      payment: paymentFor(0),
    });
    if (number) numbersTaken.add(number);
  }

  const links = [...clientOf.entries()].map(([theirId, clientId]) => ({ clientId, theirId }));
  // A fill with nothing to fill is only a link.
  const realFills = [...fills.values()].filter((f) => f.organisationNumber || f.billingEmail || f.phone || f.address);
  return { clients, fills: realFills, links, invoices, matched, skipped };
}

/** A first day the owner may choose for the invoices brought in: a real day from 2000 to today, else null. */
export function invoicesFrom(value: unknown, today: string): string | null {
  const day = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) && day >= "2000-01-01" && day <= today ? day : null;
}

/** What the plan does, counted for the owner (the preview and the answer after). */
export type PlanSummary = {
  invoices: number;
  lines: number;
  joined: number;
  paid: number;
  voided: number;
  clients: number;
  filled: number;
  numbered: number;
  paymentsHere: number;
  alreadyHere: number;
  skipped: Skipped[];
  firstDay: string | null;
  lastDay: string | null;
  /** Per currency, the sum of the invoices brought in. */
  totals: { currency: string; minor: number }[];
};

export function summarisePlan(plan: TripletexInvoicePlan): PlanSummary {
  const days = plan.invoices.map((i) => i.issuedOn).sort();
  const totals = new Map<string, number>();
  for (const i of plan.invoices) if (i.status !== "void") totals.set(i.currency, (totals.get(i.currency) ?? 0) + i.totalMinor);
  return {
    invoices: plan.invoices.length,
    lines: plan.invoices.reduce((n, i) => n + i.lines.length, 0),
    joined: plan.invoices.filter((i) => i.linesJoined).length,
    paid: plan.invoices.filter((i) => i.payment && i.payment.amountMinor === i.totalMinor).length,
    voided: plan.invoices.filter((i) => i.status === "void").length,
    clients: plan.clients.length,
    filled: plan.fills.length,
    numbered: plan.matched.filter((m) => m.giveNumber).length,
    paymentsHere: plan.matched.filter((m) => m.payment).length,
    alreadyHere: plan.matched.length,
    skipped: plan.skipped,
    firstDay: days[0] ?? null,
    lastDay: days.at(-1) ?? null,
    totals: [...totals.entries()].map(([currency, minor]) => ({ currency, minor })).sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}
