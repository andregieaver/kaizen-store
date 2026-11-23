import type { ExtensionId } from "./extensions";

/**
 * Use beyond an extension's allowance (D880, D748 E11), pure: what each unit is, what is billed for a period, and how the owner's cap holds.
 * The owner's choices (23 November 2026): billed as used, as lines on the account's invoice; told at 80 % and when extras begin; an optional
 * monthly cap, at which the support desk's AI hands new conversations to people and no more is billed. Arithmetic is here, never in words.
 */

export const EXTRA_UNITS = ["ai_conversation", "person"] as const;
export type ExtraUnit = (typeof EXTRA_UNITS)[number];

/** Which extensions have use beyond an allowance, and in what unit: the support desk's AI-handled conversations, Work's and Deals' people. */
export const EXTRA_UNIT_OF: Partial<Record<ExtensionId, ExtraUnit>> = { support_desk: "ai_conversation", work: "person", deals: "person" };

/** An extension's use in a period against what its size includes (null: no limit), with what one unit beyond costs. */
export type ExtraLine = { extensionId: ExtensionId; unit: ExtraUnit; used: number; included: number | null; unitMinor: number };

/** A line as billed: the units beyond, after the cap, and what they cost. */
export type BilledLine = ExtraLine & { beyond: number; quantity: number; amountMinor: number };

/** Units beyond the allowance: none while there is no limit. */
export const beyondOf = (line: Pick<ExtraLine, "used" | "included">): number => (line.included === null ? 0 : Math.max(0, line.used - line.included));

/**
 * What a period's use costs, line by line, in the order given: each line's units beyond at its price, and once the cap is reached, no more
 * (a line is cut to the whole units the cap still has room for). Null is no cap.
 */
export function billExtras(lines: readonly ExtraLine[], capMinor: number | null): BilledLine[] {
  let room = capMinor ?? Infinity;
  return lines.map((line) => {
    const beyond = beyondOf(line);
    const fits = line.unitMinor > 0 ? Math.min(beyond, Math.floor(room / line.unitMinor)) : beyond;
    const quantity = Math.max(0, fits);
    const amountMinor = quantity * line.unitMinor;
    room -= amountMinor;
    return { ...line, beyond, quantity, amountMinor };
  });
}

/** The period's extras in all: what the lines cost after the cap. */
export const extrasTotal = (billed: readonly BilledLine[]): number => billed.reduce((sum, line) => sum + line.amountMinor, 0);

/**
 * Whether the support desk's AI may take one more conversation this period: always while it is inside its allowance or there is no cap;
 * beyond it, only while one more conversation's price still fits under the cap with everything else of the period.
 */
export function aiMayTakeOne(lines: readonly ExtraLine[], capMinor: number | null): boolean {
  if (capMinor === null) return true;
  const ai = lines.find((line) => line.unit === "ai_conversation");
  if (!ai || ai.included === null || ai.used < ai.included) return true;
  const withOne = lines.map((line) => (line === ai ? { ...line, used: line.used + 1 } : line));
  const unbilled = billExtras(withOne, null);
  return extrasTotal(unbilled) <= capMinor;
}

/** Whether the owner is told: at 80 % of an allowance, or once use goes beyond it. */
export function extrasNotice(line: Pick<ExtraLine, "used" | "included">): "fine" | "near" | "beyond" {
  if (line.included === null) return "fine";
  if (line.used > line.included) return "beyond";
  return line.used * 100 >= line.included * 80 ? "near" : "fine";
}
