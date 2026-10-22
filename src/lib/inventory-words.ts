/**
 * The Inventory pages' sentences in the admin's language (D312 A5), written from the `inventory` catalogue as the libraries write them in English
 * (`figureText()`, `policyCell()`, `savedWords()`, `heldWords()` in `inventory-admin.ts`; `reasonWord()`, `byWords()`, `deactivationWords()`,
 * `ADJUST_PROBLEM_WORDS` in `inventory.ts`), which keep their English for their other readers. Pure and free of the catalogues themselves, so a client part
 * passes the slice it was handed; with the English slice each one says exactly what the library says (`inventory-words.test.ts`).
 */

import { countWords, fillWords } from "./admin-fill";
import type { InventoryMessages } from "./admin-messages/inventory.en";
import { STOCK_MAX, isMovementReason, type AdjustProblem, type StockPolicy } from "./inventory";
import type { SavedCounts } from "./inventory-admin";

/** A whole number with the language's thousands separator. */
export const numberIn = (n: number, locale: string): string => n.toLocaleString(locale);

/** A figure for a table: a minus sign that is a minus sign, thousands apart. */
export const figureIn = (n: number, locale: string): string => (n < 0 ? `−${Math.abs(n).toLocaleString(locale)}` : n.toLocaleString(locale));

/** A change for a table: always signed. */
export const deltaIn = (n: number, locale: string): string => (n > 0 ? `+${n.toLocaleString(locale)}` : n < 0 ? `−${Math.abs(n).toLocaleString(locale)}` : "0");

/** "Keep selling: 7 days" / "Stop selling at zero". */
export function policyIn(policy: StockPolicy, days: number | null, w: Pick<InventoryMessages, "policy">): string {
  return policy === "continue" && days ? countWords(days, w.policy.keepDays) : w.policy[policy];
}

/** Why a typed figure cannot be saved, by problem, with the limit in the language's figures (`reviewRows()`'s `problemWords`). */
export function adjustProblemsIn(w: Pick<InventoryMessages, "problems">, locale: string): Record<AdjustProblem, string> {
  const max = STOCK_MAX.toLocaleString(locale);
  return {
    not_whole: w.problems.not_whole,
    too_high: fillWords(w.problems.too_high, { max }),
    too_low: w.problems.too_low,
    negative: w.problems.negative,
    adjust_range: fillWords(w.problems.adjust_range, { max }),
  };
}

/** One sentence about what a save did, naming only counts. */
export function savedIn(c: SavedCounts, w: Pick<InventoryMessages, "saved">, locale: string): string {
  const n = (value: number) => ({ n: value.toLocaleString(locale) });
  const parts = [countWords(c.written, w.saved.written, n(c.written))];
  if (c.unchanged > 0) parts.push(fillWords(w.saved.unchanged, n(c.unchanged)));
  if (c.conflicts > 0) parts.push(countWords(c.conflicts, w.saved.conflicts, n(c.conflicts)));
  if (c.refused > 0) parts.push(fillWords(w.saved.refused, n(c.refused)));
  if (c.failed > 0) parts.push(fillWords(w.saved.failed, n(c.failed)));
  return `${parts.join(", ")}.`;
}

/** "12 units across 3 variants" for a location's line. */
export function heldIn(units: number, variants: number, w: Pick<InventoryMessages, "locations">, locale: string): string {
  const unitWords = countWords(units, w.locations.units, { n: units.toLocaleString(locale) });
  return countWords(variants, w.locations.held, { n: variants.toLocaleString(locale), units: unitWords });
}

/** The sentence the deactivate dialog and the notice after it say (`deactivationWords()`). */
export function deactivationIn(
  impact: { units: number; variants: number; committedUnits: number },
  w: Pick<InventoryMessages, "locations">,
  locale: string,
): { refusal: string | null; notice: string } {
  return {
    refusal: impact.committedUnits > 0 ? countWords(impact.committedUnits, w.locations.refusal) : null,
    notice: countWords(impact.variants, w.locations.notice, { units: countWords(impact.units, w.locations.noticeUnits, { n: impact.units.toLocaleString(locale) }) }),
  };
}

/** A movement's reason, or the word for one the page does not know. */
export const reasonIn = (reason: string, w: Pick<InventoryMessages, "reasons" | "reasonOther">): string => (isMovementReason(reason) ? w.reasons[reason] : w.reasonOther);

/** Who or what made a change, as the history shows it (`byWords()`). */
export function byIn(
  movement: { source: string; actorName?: string | null; orderNumber?: string | null; returnNumber?: string | null },
  w: Pick<InventoryMessages, "by">,
): string {
  if (movement.returnNumber) return fillWords(w.by.return, { number: movement.returnNumber });
  if (movement.orderNumber) return fillWords(w.by.order, { number: movement.orderNumber });
  switch (movement.source) {
    case "checkout":
      return w.by.checkout;
    case "file":
      return movement.actorName ? fillWords(w.by.fileBy, { name: movement.actorName }) : w.by.file;
    case "ai_manager":
      return w.by.aiManager;
    case "copy":
      return w.by.copy;
    case "system":
      return w.by.system;
    default:
      return movement.actorName?.trim() ? movement.actorName.trim() : w.by.staff;
  }
}

/** A moment as `5 Oct 2026, 14:22` in a time zone (the store's), in the language's form (`momentText()`). */
export function momentIn(iso: string | null | undefined, timeZone: string, locale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const options = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } as const;
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
  }
}

/** The rows of a number list as one phrase: `3, 4 and 9`; more than five are summarised (`rowsPhrase()`). */
export function rowsIn(rows: readonly number[], w: Pick<InventoryMessages["import"]["findings"], "rowsAnd" | "rowsRange">): string {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length <= 5) return sorted.length === 1 ? String(sorted[0]) : fillWords(w.rowsAnd, { list: sorted.slice(0, -1).join(", "), last: sorted[sorted.length - 1] });
  return fillWords(w.rowsRange, { first: sorted[0], last: sorted[sorted.length - 1], n: sorted.length });
}

/** A file's size as a person reads it: `812 B`, `14.2 KB`, `3.5 MB`, with the language's decimal mark (`formatBytes()`). */
export function bytesIn(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const mark = (1.5).toLocaleString(locale).charAt(1);
  const one = (n: number) => n.toFixed(1).replace(".", mark);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${one(bytes / 1024)} KB`;
  return `${one(bytes / 1024 / 1024)} MB`;
}
