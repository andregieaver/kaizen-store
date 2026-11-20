/**
 * A draft order as the editor sends it and the server saves it (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.4): one schema, shared by the browser (which
 * builds it and shows the problems) and the server (`saveDraft()`, the AI manager's `create_draft_order`). Money is typed text in major units ("249,00", "10,5"),
 * read with `parsePrice()` for the draft's currency and `parsePercentBps()`, never a float; the server prices a draft only through `priceDraft()` and never trusts a
 * number from the browser for a total. This is an admin schema (zod is fine here; the cart page's gift fields are `src/lib/gift.ts`, which has none).
 */

import { DISCOUNT_BPS_MAX, DISCOUNT_BPS_MIN } from "./order-limits";
import { tagsOf } from "./order-tags";

export type { DraftAddress, DraftInput } from "./draft-input-schema";

/** The note lines a buyer reads: a few short paragraphs. */
export const NOTE_TO_BUYER_LINES = 12;

// ---------------------------------------------------------------------------------------------------------------------
// Typed numbers
// ---------------------------------------------------------------------------------------------------------------------

/** A typed percent ("10", "10,5", "0.25", "12.50 %") as basis points: 0.01 % to 100.00 %, at most two decimals; null when it is not one. */
export function parsePercentBps(value: string): number | null {
  const compact = value.replace(/[\s\u00a0%]/g, "");
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(compact);
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return bps >= DISCOUNT_BPS_MIN && bps <= DISCOUNT_BPS_MAX ? bps : null;
}

/** Basis points as the text of the field: 1050 is "10,5", 10000 is "100". */
export function formatPercentBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole},${fraction}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------------------------------------------------

/** Checks the typed tags once; the first problem is the one shown. */
export function draftTagProblems(tags: readonly string[]): string | null {
  const parsed = tagsOf(tags);
  return parsed.problems.length > 0 ? `The tag “${parsed.problems[0].input}” is not valid.` : null;
}

/** How money taken outside Kaizen was received. */
export const MANUAL_PAYMENT_METHODS = ["bank_transfer", "cash", "other"] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];
export const MANUAL_METHOD_LABELS: Record<ManualPaymentMethod, string> = { bank_transfer: "Bank transfer", cash: "Cash", other: "Other" };

