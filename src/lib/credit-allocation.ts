/**
 * What a credit note credits (D159, `docs/wave-1b-invoices.md` 4.6): pure, and mirrored statement by statement in SQL
 * (`commerce.make_credit_note()`), which `src/db/invoice-parity.test.ts` holds to these functions.
 *
 * A credit note is issued when a refund succeeds (or a return is refunded outside Kaizen). It is allocated over the VAT-rate
 * buckets of the invoice it refers to and is never above what the invoice left uncredited, per bucket, in net, VAT and gross
 * (the database refuses it otherwise). Directive Art. 219 (read 2026-10-04): a document that amends an invoice and refers to
 * it unambiguously is treated as an invoice; the Swedish and Danish guidance read says the same and asks for the original's
 * number. Needs review by an accountant.
 *
 * Two ways to allocate:
 * - **A refund that is not a return**: the amount is shared over the buckets in proportion to what each still has uncredited,
 *   by the largest-remainder method (`distribute()`), so no share exceeds its bucket and the shares add up to the amount.
 * - **A return** (D153): the working of the refund (`returns.refund_working`) gives each returned line at its own rate, the
 *   deductions, the delivery given back and the return shipping the shopper pays; a bucket cannot go below 0 or above what is
 *   left, and what that moves (a staff adjustment, a return shipping larger than the delivery given back) is shared again by
 *   the same method and shown as an *adjustment* row, so the rows always add up to the buckets.
 */
import {
  SNAPSHOT_VERSION,
  bucketsOf,
  convertWith,
  distribute,
  totalsOf,
  vatIncludedExact,
  type BucketBasis,
  type DocLanguage,
  type OrderInvoiceSnapshot,
  type SnapshotBucket,
  type SnapshotBuyer,
  type SnapshotOrder,
  type SnapshotSeller,
  type SnapshotTotals,
  type SnapshotTreatment,
  type SnapshotVatHome,
  type SnapshotVatMain,
} from "./invoice-snapshot";

export type BucketLeft = { rate: number; basis: BucketBasis; netLeft: number; vatLeft: number; grossLeft: number };
export type Credited = { rate: number; basis: BucketBasis; netMinor: number; vatMinor: number; grossMinor: number };

/**
 * The buckets of an order's invoices taken together (wave 3, D174): the order's own invoice and every change's additional invoice, summed per rate and basis,
 * highest rate first. Credit notes credit this pool (`commerce.order_buckets_left()`); for an order with one invoice it is that invoice's buckets.
 */
export function pooledBuckets(invoices: readonly (readonly SnapshotBucket[])[]): SnapshotBucket[] {
  return bucketsOf(invoices.flat());
}

/** What each bucket of an invoice (or the pool of an order's invoices) has left after its credit notes so far (never below 0). */
export function bucketsLeft(invoice: readonly SnapshotBucket[], earlier: readonly (readonly SnapshotBucket[])[]): BucketLeft[] {
  return invoice.map((b) => {
    let net = 0;
    let vat = 0;
    let gross = 0;
    for (const note of earlier) {
      for (const c of note) {
        if (c.rate === b.rate && c.basis === b.basis) {
          net += c.netMinor;
          vat += c.vatMinor;
          gross += c.grossMinor;
        }
      }
    }
    return { rate: b.rate, basis: b.basis, netLeft: Math.max(0, b.netMinor - net), vatLeft: Math.max(0, b.vatMinor - vat), grossLeft: Math.max(0, b.grossMinor - gross) };
  });
}

/**
 * Net, VAT and gross of a share of one bucket. The whole of what is left carries the whole VAT left; a part carries the VAT
 * in it (never above the VAT left, and never so little that the net exceeds the net left), so two credits of 10 and 15 on a
 * bucket of 25 leave exactly 0 with the VAT adding up to the invoice's.
 */
export function creditFromGross(left: BucketLeft, grossMinor: number): Credited {
  const base = { rate: left.rate, basis: left.basis };
  const gross = Math.max(0, Math.min(grossMinor, left.grossLeft));
  if (gross === 0) return { ...base, netMinor: 0, vatMinor: 0, grossMinor: 0 };
  let vat: number;
  if (gross === left.grossLeft) vat = left.vatLeft;
  else {
    vat = Math.min(vatIncludedExact(gross, left.rate), left.vatLeft);
    vat = Math.max(vat, gross - left.netLeft);
  }
  return { ...base, netMinor: gross - vat, vatMinor: vat, grossMinor: gross };
}

export type Allocation = { buckets: Credited[]; creditedMinor: number; shortMinor: number };

/** A refund shared over the buckets in proportion to what each has left; what no bucket has room for is `shortMinor`. */
export function creditAllocation(left: readonly BucketLeft[], refundMinor: number): Allocation {
  if (!Number.isSafeInteger(refundMinor) || refundMinor < 0) throw new RangeError(`refundMinor must be a whole number of minor units, 0 or more: ${refundMinor}`);
  const room = left.reduce((s, b) => s + b.grossLeft, 0);
  const amount = Math.min(refundMinor, room);
  const shares = amount > 0 ? distribute(amount, left.map((b) => b.grossLeft), left.map((b) => b.rate)) : left.map(() => 0);
  const buckets = left.map((b, i) => creditFromGross(b, shares[i]));
  return { buckets, creditedMinor: buckets.reduce((s, b) => s + b.grossMinor, 0), shortMinor: refundMinor - amount };
}

// ---------------------------------------------------------------------------------------------------------------------
// A return's working
// ---------------------------------------------------------------------------------------------------------------------

/** What `record()` in `refundReturn()` keeps on `returns.refund_working`. `adjustmentMinor` is derived (the amount less the working). */
export type ReturnWorking = {
  lines: { lineId: string; quantity: number; valueMinor: number; deductionMinor: number }[];
  deliveryMinor: number;
  returnShippingMinor: number;
  adjustmentMinor: number;
  amountMinor: number;
  outside: boolean;
};

/** The adjustment a working holds: what the amount refunded is beyond (or short of) goods less deductions plus delivery less return shipping. */
export const adjustmentOf = (w: Pick<ReturnWorking, "lines" | "deliveryMinor" | "returnShippingMinor" | "amountMinor">): number =>
  w.amountMinor - (w.lines.reduce((s, l) => s + l.valueMinor - l.deductionMinor, 0) + w.deliveryMinor - w.returnShippingMinor);

/** `returns.refund_working` read defensively (null when it is not shaped as a working). */
export function parseWorking(value: unknown): ReturnWorking | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const int = (x: unknown): number | null => (typeof x === "number" && Number.isSafeInteger(x) ? x : null);
  const amount = int(v.amountMinor);
  const delivery = int(v.deliveryMinor);
  const ship = int(v.returnShippingMinor);
  if (amount === null || delivery === null || ship === null || !Array.isArray(v.lines)) return null;
  const lines: ReturnWorking["lines"] = [];
  for (const raw of v.lines) {
    const l = (raw ?? {}) as Record<string, unknown>;
    const quantity = int(l.quantity);
    const value = int(l.valueMinor);
    const deduction = int(l.deductionMinor);
    if (typeof l.lineId !== "string" || quantity === null || value === null || deduction === null) return null;
    lines.push({ lineId: l.lineId, quantity, valueMinor: value, deductionMinor: deduction });
  }
  const working = { lines, deliveryMinor: delivery, returnShippingMinor: ship, amountMinor: amount, outside: v.outside === true };
  return { ...working, adjustmentMinor: adjustmentOf(working) };
}

export type CreditRowKind = "refund" | "goods" | "deduction" | "delivery" | "return_shipping" | "adjustment";

/** A row of a credit note. A return's rows show their gross only: the VAT is the buckets'. */
export type CreditRow = {
  kind: CreditRowKind;
  lineId: string | null;
  sku: string | null;
  title: string | null;
  quantity: number | null;
  vatRate: number;
  basis: BucketBasis;
  grossMinor: number;
  netMinor: number | null;
  vatMinor: number | null;
};

export type ReturnCredit = Allocation & { rows: CreditRow[]; usedWorking: boolean };

type InvoiceView = Pick<OrderInvoiceSnapshot, "lines" | "shipping" | "buckets">;

const bucketIndex = (left: readonly BucketLeft[], rate: number, basis: BucketBasis) => left.findIndex((b) => b.rate === rate && b.basis === basis);

/** The refund rows of the plain way: one per bucket that was credited. */
export function refundRows(allocation: Allocation): CreditRow[] {
  return allocation.buckets
    .filter((b) => b.grossMinor > 0)
    .map((b) => ({ kind: "refund" as const, lineId: null, sku: null, title: null, quantity: null, vatRate: b.rate, basis: b.basis, grossMinor: b.grossMinor, netMinor: b.netMinor, vatMinor: b.vatMinor }));
}

/**
 * What a return's refund credits. The working is used when it matches the invoice (every line is on it, and the delivery
 * has a shipping line) and the amount refunded; otherwise the amount is shared as a plain refund (`usedWorking` false).
 */
export function creditForReturn(invoice: InvoiceView, left: readonly BucketLeft[], working: ReturnWorking | null, amountMinor: number): ReturnCredit {
  const plain = (): ReturnCredit => {
    const a = creditAllocation(left, amountMinor);
    return { ...a, rows: refundRows(a), usedWorking: false };
  };
  if (!working || working.amountMinor !== amountMinor) return plain();

  const rows: CreditRow[] = [];
  const sums = left.map(() => 0);
  const put = (row: Omit<CreditRow, "vatRate" | "basis" | "netMinor" | "vatMinor">, rate: number, basis: BucketBasis): boolean => {
    const i = bucketIndex(left, rate, basis);
    if (i < 0) return false;
    sums[i] += row.grossMinor;
    rows.push({ ...row, vatRate: rate, basis, netMinor: null, vatMinor: null });
    return true;
  };

  for (const w of working.lines) {
    const line = invoice.lines.find((l) => l.lineId === w.lineId);
    if (!line) return plain();
    if (w.valueMinor > 0 && !put({ kind: "goods", lineId: line.lineId, sku: line.sku, title: line.title, quantity: w.quantity, grossMinor: w.valueMinor }, line.vatRate, line.basis)) return plain();
    if (w.deductionMinor > 0 && !put({ kind: "deduction", lineId: line.lineId, sku: line.sku, title: line.title, quantity: null, grossMinor: -w.deductionMinor }, line.vatRate, line.basis)) return plain();
  }
  if (working.deliveryMinor > 0 || working.returnShippingMinor > 0) {
    const s = invoice.shipping;
    if (!s) return plain();
    if (working.deliveryMinor > 0 && !put({ kind: "delivery", lineId: null, sku: null, title: s.label, quantity: null, grossMinor: working.deliveryMinor }, s.vatRate, s.basis)) return plain();
    if (working.returnShippingMinor > 0 && !put({ kind: "return_shipping", lineId: null, sku: null, title: null, quantity: null, grossMinor: -working.returnShippingMinor }, s.vatRate, s.basis)) return plain();
  }

  const room = left.reduce((s, b) => s + b.grossLeft, 0);
  const target = Math.min(amountMinor, room);
  const clamped = sums.map((v, i) => Math.max(0, Math.min(v, left[i].grossLeft)));
  const d = target - clamped.reduce((s, v) => s + v, 0);
  const final = [...clamped];
  if (d > 0) {
    const head = left.map((b, i) => b.grossLeft - clamped[i]);
    const inWorking = head.map((h, i) => (clamped[i] > 0 ? h : 0));
    const weights = inWorking.reduce((s, h) => s + h, 0) >= d ? inWorking : head;
    distribute(d, weights, left.map((b) => b.rate)).forEach((v, i) => (final[i] += v));
  } else if (d < 0) {
    distribute(-d, clamped, left.map((b) => b.rate)).forEach((v, i) => (final[i] -= v));
  }
  const buckets = left.map((b, i) => creditFromGross(b, final[i]));
  buckets.forEach((b, i) => {
    const diff = b.grossMinor - sums[i];
    if (diff !== 0) rows.push({ kind: "adjustment", lineId: null, sku: null, title: null, quantity: null, vatRate: b.rate, basis: b.basis, grossMinor: diff, netMinor: null, vatMinor: null });
  });
  return { buckets, creditedMinor: buckets.reduce((s, b) => s + b.grossMinor, 0), shortMinor: amountMinor - target, rows, usedWorking: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// The credit note's snapshot
// ---------------------------------------------------------------------------------------------------------------------

export type CreditNoteNote = "credit_capped" | "working_not_used";

export type CreditNoteSnapshot = {
  version: typeof SNAPSHOT_VERSION;
  documentType: "credit_note";
  number: string;
  issuedOn: string;
  locale: string;
  language: DocLanguage;
  currency: string;
  seller: SnapshotSeller;
  buyer: SnapshotBuyer;
  order: SnapshotOrder;
  refersTo: { invoiceId: string; invoiceNumber: string; invoiceIssuedOn: string };
  /** A fixed phrase in the document's language is drawn from this (never the staff member's free text). `order_edit`: what a change took off (D174), with its number. */
  reason: { kind: "refund" | "return" | "order_edit"; returnNumber: string | null; editSeq?: number };
  source: "refund" | "return_outside" | "order_edit";
  lines: CreditRow[];
  buckets: SnapshotBucket[];
  totals: SnapshotTotals;
  vatHome: SnapshotVatHome | null;
  vatMain: SnapshotVatMain | null;
  treatment: SnapshotTreatment;
  position: { invoiceTotalMinor: number; creditedBeforeMinor: number; creditedNowMinor: number; leftOnInvoiceMinor: number };
  notes: CreditNoteNote[];
};

/**
 * The VAT of a credit note converted at the invoice's rate as the difference of cumulative conversions, bucket by bucket:
 * convert(VAT credited so far including this note) - convert(VAT credited before it). The invoice converts each bucket whole, so
 * converting each note's parts on their own would round differently and the notes would not add up to the invoice's converted
 * VAT (and so unit 1c's totals would drift). Mirrored by `commerce.credit_vat_converted()`.
 */
export function creditVatConverted(
  buckets: readonly Pick<SnapshotBucket, "rate" | "basis" | "vatMinor">[],
  earlier: readonly (readonly Pick<SnapshotBucket, "rate" | "basis" | "vatMinor">[])[],
  fx: number,
): number {
  return buckets.reduce((sum, b) => {
    let before = 0;
    for (const note of earlier) for (const c of note) if (c.rate === b.rate && c.basis === b.basis) before += c.vatMinor;
    return sum + convertWith(before + b.vatMinor, fx) - convertWith(before, fx);
  }, 0);
}

export type CreditNoteInput = {
  invoice: { id: string; snapshot: OrderInvoiceSnapshot };
  /** The order's other invoices (each change's additional invoice, D174), in the order they were issued: credited as one pool with the order's own. */
  others?: readonly { snapshot: Pick<OrderInvoiceSnapshot, "buckets" | "lines" | "totals"> }[];
  /** The buckets of the earlier credit notes of the order's invoices. */
  earlier: readonly (readonly SnapshotBucket[])[];
  source: "refund" | "return_outside";
  returnNumber: string | null;
  refundMinor: number;
  working: ReturnWorking | null;
  number: string;
  issuedOn: string;
};

export type CreditNoteResult = { snapshot: CreditNoteSnapshot | null; creditedMinor: number; shortMinor: number };

export function creditNoteSnapshot(input: CreditNoteInput): CreditNoteResult {
  const inv = input.invoice.snapshot;
  const others = input.others ?? [];
  const pool = others.length === 0 ? inv.buckets : pooledBuckets([inv.buckets, ...others.map((o) => o.snapshot.buckets)]);
  const poolTotal = inv.totals.grossMinor + others.reduce((s, o) => s + o.snapshot.totals.grossMinor, 0);
  const view: InvoiceView = { lines: [...inv.lines, ...others.flatMap((o) => o.snapshot.lines)], shipping: inv.shipping, buckets: pool };
  const left = bucketsLeft(pool, input.earlier);
  const isReturn = input.working !== null || input.returnNumber !== null;
  const credit = isReturn ? creditForReturn(view, left, input.working, input.refundMinor) : (() => {
    const a = creditAllocation(left, input.refundMinor);
    return { ...a, rows: refundRows(a), usedWorking: false };
  })();
  if (credit.creditedMinor <= 0) return { snapshot: null, creditedMinor: 0, shortMinor: input.refundMinor };

  const buckets: SnapshotBucket[] = credit.buckets.filter((b) => b.grossMinor > 0).map((b) => ({ rate: b.rate, basis: b.basis, netMinor: b.netMinor, vatMinor: b.vatMinor, grossMinor: b.grossMinor }));
  const totals = totalsOf(buckets);
  const before = input.earlier.reduce((s, note) => s + note.reduce((a, b) => a + b.grossMinor, 0), 0);
  const notes: CreditNoteNote[] = [];
  if (credit.shortMinor > 0) notes.push("credit_capped");
  if (isReturn && input.working !== null && !credit.usedWorking) notes.push("working_not_used");
  const home = inv.vatHome;
  const main = inv.vatMain;
  const snapshot: CreditNoteSnapshot = {
    version: SNAPSHOT_VERSION,
    documentType: "credit_note",
    number: input.number,
    issuedOn: input.issuedOn,
    locale: inv.locale,
    language: inv.language,
    currency: inv.currency,
    seller: inv.seller,
    buyer: inv.buyer,
    order: inv.order,
    refersTo: { invoiceId: input.invoice.id, invoiceNumber: inv.number, invoiceIssuedOn: inv.issuedOn },
    reason: { kind: isReturn ? "return" : "refund", returnNumber: input.returnNumber },
    source: input.source,
    lines: credit.rows,
    buckets,
    totals,
    vatHome: home ? { ...home, vatMinor: creditVatConverted(buckets, input.earlier, home.fxRate) } : null,
    vatMain: main ? { ...main, vatMinor: main.fxRate === null ? totals.vatMinor : creditVatConverted(buckets, input.earlier, main.fxRate) } : null,
    treatment: inv.treatment,
    position: {
      invoiceTotalMinor: poolTotal,
      creditedBeforeMinor: before,
      creditedNowMinor: totals.grossMinor,
      leftOnInvoiceMinor: poolTotal - before - totals.grossMinor,
    },
    notes,
  };
  return { snapshot, creditedMinor: totals.grossMinor, shortMinor: credit.shortMinor };
}

// ---------------------------------------------------------------------------------------------------------------------
// The credit note of a change (wave 3, D174, docs/wave-3-fulfilment.md 4.6; `commerce.make_edit_documents()` is the same, held by invoice-parity.test.ts)
// ---------------------------------------------------------------------------------------------------------------------

export type EditCreditInput = {
  /** The order's own invoice (the credit note refers to it). */
  invoice: { id: string; snapshot: OrderInvoiceSnapshot };
  /** The order's other invoices (earlier changes' additional invoices), in the order they were issued. */
  others?: readonly { snapshot: Pick<OrderInvoiceSnapshot, "buckets" | "lines" | "totals"> }[];
  /** The buckets of every earlier credit note of the order's invoices. */
  earlier: readonly (readonly SnapshotBucket[])[];
  /** The change's lines that took something off (`remove` and `reduce`, in their order), with what they took off. */
  removed: readonly { lineId: string; sku: string; title: string; quantity: number; totalMinor: number; taxMinor: number; taxRate: number }[];
  /** A lower shipping charge: what it went down by and the VAT in that; null when the shipping did not go down. */
  shipping: { grossMinor: number; vatMinor: number; rate: number; label: string | null } | null;
  seq: number;
  number: string;
  issuedOn: string;
};

/**
 * What a change took off, as a credit note: each removed unit's money at the rate and basis its invoice line had (the order's own invoice or an earlier
 * change's), and a lower shipping charge; per bucket never above what the order's invoices left (what does not fit is an adjustment row and `credit_capped`);
 * the VAT the units carried when it fits whole, else the VAT in what fits (`creditFromGross()`). Null when there is nothing to credit.
 */
export function editCreditNote(input: EditCreditInput): CreditNoteResult {
  const inv = input.invoice.snapshot;
  const others = input.others ?? [];
  const pool = others.length === 0 ? inv.buckets : pooledBuckets([inv.buckets, ...others.map((o) => o.snapshot.buckets)]);
  const poolTotal = inv.totals.grossMinor + others.reduce((s, o) => s + o.snapshot.totals.grossMinor, 0);
  const allLines = [...inv.lines, ...others.flatMap((o) => o.snapshot.lines)];
  const left = bucketsLeft(pool, input.earlier);
  const wantGross = left.map(() => 0);
  const wantVat = left.map(() => 0);
  const rows: CreditRow[] = [];
  let short = 0;
  const put = (gross: number, vat: number, rate: number, basis: BucketBasis) => {
    const i = bucketIndex(left, rate, basis);
    if (i < 0) short += gross;
    else {
      wantGross[i] += gross;
      wantVat[i] += vat;
    }
  };
  for (const r of input.removed) {
    if (r.totalMinor <= 0) continue;
    const line = allLines.find((l) => l.lineId === r.lineId);
    const rate = line?.vatRate ?? r.taxRate;
    const basis: BucketBasis = line?.basis ?? "standard";
    rows.push({ kind: "goods", lineId: r.lineId, sku: r.sku, title: r.title, quantity: r.quantity, vatRate: rate, basis, grossMinor: r.totalMinor, netMinor: null, vatMinor: null });
    put(r.totalMinor, r.taxMinor, rate, basis);
  }
  if (input.shipping && input.shipping.grossMinor > 0) {
    const rate = inv.shipping?.vatRate ?? input.shipping.rate;
    const basis: BucketBasis = inv.shipping?.basis ?? "standard";
    rows.push({ kind: "delivery", lineId: null, sku: null, title: input.shipping.label, quantity: null, vatRate: rate, basis, grossMinor: input.shipping.grossMinor, netMinor: null, vatMinor: null });
    put(input.shipping.grossMinor, input.shipping.vatMinor, rate, basis);
  }
  const final = left.map((b, i) => Math.max(0, Math.min(wantGross[i], b.grossLeft)));
  short += final.reduce((s, f, i) => s + wantGross[i] - f, 0);
  const credited: Credited[] = left.map((b, i) => {
    const g = final[i];
    if (g === 0) return { rate: b.rate, basis: b.basis, netMinor: 0, vatMinor: 0, grossMinor: 0 };
    if (g === wantGross[i]) {
      const vat = Math.max(Math.min(wantVat[i], b.vatLeft, g), g - b.netLeft);
      return { rate: b.rate, basis: b.basis, netMinor: g - vat, vatMinor: vat, grossMinor: g };
    }
    return creditFromGross(b, g);
  });
  credited.forEach((b, i) => {
    const diff = b.grossMinor - wantGross[i];
    if (diff !== 0) rows.push({ kind: "adjustment", lineId: null, sku: null, title: null, quantity: null, vatRate: b.rate, basis: b.basis, grossMinor: diff, netMinor: null, vatMinor: null });
  });
  const buckets: SnapshotBucket[] = credited.filter((b) => b.grossMinor > 0).map((b) => ({ rate: b.rate, basis: b.basis, netMinor: b.netMinor, vatMinor: b.vatMinor, grossMinor: b.grossMinor }));
  const totals = totalsOf(buckets);
  if (totals.grossMinor <= 0) return { snapshot: null, creditedMinor: 0, shortMinor: short };
  const before = input.earlier.reduce((s, note) => s + note.reduce((a, b) => a + b.grossMinor, 0), 0);
  const home = inv.vatHome;
  const main = inv.vatMain;
  const snapshot: CreditNoteSnapshot = {
    version: SNAPSHOT_VERSION,
    documentType: "credit_note",
    number: input.number,
    issuedOn: input.issuedOn,
    locale: inv.locale,
    language: inv.language,
    currency: inv.currency,
    seller: inv.seller,
    buyer: inv.buyer,
    order: inv.order,
    refersTo: { invoiceId: input.invoice.id, invoiceNumber: inv.number, invoiceIssuedOn: inv.issuedOn },
    reason: { kind: "order_edit", returnNumber: null, editSeq: input.seq },
    source: "order_edit",
    lines: rows,
    buckets,
    totals,
    vatHome: home ? { ...home, vatMinor: creditVatConverted(buckets, input.earlier, home.fxRate) } : null,
    vatMain: main ? { ...main, vatMinor: main.fxRate === null ? totals.vatMinor : creditVatConverted(buckets, input.earlier, main.fxRate) } : null,
    treatment: inv.treatment,
    position: { invoiceTotalMinor: poolTotal, creditedBeforeMinor: before, creditedNowMinor: totals.grossMinor, leftOnInvoiceMinor: poolTotal - before - totals.grossMinor },
    notes: short > 0 ? ["credit_capped"] : [],
  };
  return { snapshot, creditedMinor: totals.grossMinor, shortMinor: short };
}

