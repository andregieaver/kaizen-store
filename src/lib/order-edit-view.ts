/**
 * The order editor's summary as the screen draws it (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.2): the SERVER's preview of a change (`previewOrderEdit()`,
 * the same pricing the apply uses) turned into plain, serialisable rows: what is taken off and what is added, the order's totals before and after, the VAT each rate
 * moves by, the difference and what happens to the money, the documents, and the problems in words. Nothing is priced here: every amount is the preview's; the only
 * sums are of the preview's own rows, grouped by VAT rate for the reader. Pure, no zod, no server import (the editor is a client component).
 */
import type { DraftTaxOutcome } from "./draft-order";
import type { OrderEditLineKind } from "./order-edit-status";
import type { OrderTotals, PricedEdit } from "./order-edit";

/** What the preview carries that the screen reads (`EditPreview` of `src/server/order-edits.ts`, structurally). */
export type EditPreviewLike = {
  ok: boolean;
  currency: string;
  problems: { code: string; key?: string; text: string }[];
  priced: PricedEdit<DraftTaxOutcome> | null;
  added: { key: string; listPriceMinor: number | null; custom: boolean; backorder: { units: number; days: number | null } | null }[];
  base: unknown;
  money: "charge" | "refund" | "none";
  differenceMinor: number;
  outside: boolean;
  mustNotify: boolean;
  sentences: { money: string; documents: string };
  invoiceNumber: string | null;
};

export type EditSummaryLine = {
  n: number;
  kind: OrderEditLineKind;
  title: string;
  sku: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  taxMinor: number;
  taxRate: number;
  /** Added lines: the list price as shown, whether staff typed the price, and units sold on backorder (D172). */
  listPriceMinor: number | null;
  custom: boolean;
  backorder: { units: number; days: number | null } | null;
};

export type EditSummaryView = {
  ok: boolean;
  currency: string;
  problems: { code: string; key: string | null; text: string }[];
  /** Taken off (`remove`, `reduce`) and added (`add`), in the change's own numbering. */
  takenOff: EditSummaryLine[];
  added: EditSummaryLine[];
  before: OrderTotals | null;
  after: OrderTotals | null;
  /** The VAT each rate moves by (the preview's lines), and what the shipping's VAT moves by. */
  vatChanges: { rate: number; deltaMinor: number }[];
  shippingVatDeltaMinor: number;
  differenceMinor: number;
  money: "charge" | "refund" | "none";
  mustNotify: boolean;
  outside: boolean;
  sentences: { money: string; documents: string };
  /** Sent back with the apply: the order as previewed. */
  base: unknown;
};

/** The screen's summary of a preview. A preview that could not be priced (`priced` null) has no lines or totals, only its problems. */
export function editSummaryView(preview: EditPreviewLike): EditSummaryView {
  const priced = preview.priced;
  const extra = new Map(preview.added.map((a) => [a.key, a]));
  const lines: EditSummaryLine[] = (priced?.lines ?? []).map((l) => {
    const add = l.kind === "add" && l.key ? extra.get(l.key) : undefined;
    return {
      n: l.n,
      kind: l.kind,
      title: l.title,
      sku: l.sku,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      totalMinor: l.totalMinor,
      taxMinor: l.taxMinor,
      taxRate: l.taxRate,
      listPriceMinor: add ? add.listPriceMinor : l.listPriceMinor,
      custom: add ? add.custom : false,
      backorder: add ? add.backorder : null,
    };
  });
  const byRate = new Map<number, number>();
  let linesDelta = 0;
  for (const l of lines) {
    const signed = l.kind === "add" ? l.taxMinor : -l.taxMinor;
    linesDelta += signed;
    byRate.set(l.taxRate, (byRate.get(l.taxRate) ?? 0) + signed);
  }
  return {
    ok: preview.ok,
    currency: preview.currency,
    problems: preview.problems.map((p) => ({ code: p.code, key: p.key ?? null, text: p.text })),
    takenOff: lines.filter((l) => l.kind !== "add"),
    added: lines.filter((l) => l.kind === "add"),
    before: priced?.before ?? null,
    after: priced?.after ?? null,
    vatChanges: [...byRate.entries()].filter(([, delta]) => delta !== 0).map(([rate, deltaMinor]) => ({ rate, deltaMinor })).sort((a, b) => b.rate - a.rate),
    shippingVatDeltaMinor: priced ? priced.taxDelta - linesDelta : 0,
    differenceMinor: preview.differenceMinor,
    money: preview.money,
    mustNotify: preview.mustNotify,
    outside: preview.outside,
    sentences: preview.sentences,
    base: preview.base,
  };
}

/** A rate as staff read it: `0.25` → "25 %". */
export const ratePercent = (rate: number): string => `${(Math.round(rate * 10000) / 100).toLocaleString("en", { maximumFractionDigits: 2 })} %`;

/** The words of the main button for a change, by what happens to the money. */
export function applyLabel(money: EditSummaryView["money"]): string {
  return money === "charge" ? "Send the customer a pay link" : money === "refund" ? "Save the change and refund" : "Save the change";
}
