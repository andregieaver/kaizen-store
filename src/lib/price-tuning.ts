/**
 * The AI tunes Kaizena Flow's prices, as far as a platform owner allows (D748 E9 part two, D854, `docs/extensions.md` 9). Pure: the setting,
 * the price a person last set (the anchor the range is measured from) and the one rule that says whether a change is refused, waits for a
 * yes or runs on its own. A store's own product prices are tuned under the autopilot's catalogue level and its largest price change (D309).
 */

export const PRICE_TUNING_LEVELS = ["off", "propose", "auto"] as const;
export type PriceTuningLevel = (typeof PRICE_TUNING_LEVELS)[number];
export const isPriceTuningLevel = (value: unknown): value is PriceTuningLevel => (PRICE_TUNING_LEVELS as readonly unknown[]).includes(value);

export const PRICE_TUNING_RANGE_MIN = 1;
export const PRICE_TUNING_RANGE_MAX = 50;
export const PRICE_TUNING_RANGE_DEFAULT = 20;

/** The setting: off, each change waits for a yes, or changes within `rangePercent` of the anchor run on their own. */
export type PriceTuning = { level: PriceTuningLevel; rangePercent: number };

/** A price's change in percent of the price it is measured from, to one decimal. */
export function changePercent(fromMinor: number, toMinor: number): number {
  if (fromMinor <= 0) return toMinor > 0 ? 100 : 0;
  return Math.round(((toMinor - fromMinor) / fromMinor) * 1000) / 10;
}

/** The AI's latest change of a price, as `commerce.platform_price_changes` keeps it. */
export type LastChange = { toMinor: number; anchorMinor: number };

/**
 * The price a person last set: the anchor of the AI's last change while its price is still the one on offer, else the price now (a person
 * changed it since, or the AI never did). So changes on its own can never walk a price out of the range a step at a time.
 */
export function anchorFor(last: LastChange | null, currentMinor: number): number {
  return last && last.toMinor === currentMinor ? last.anchorMinor : currentMinor;
}

export type PriceChangeFacts = {
  currentMinor: number;
  toMinor: number;
  anchorMinor: number;
  /** The founding price below the list price (D748 E6), which a list price must stay above. */
  foundingMinor: number | null;
  /** Every AI acting on its own is paused (PSI AST-07): a change it would make itself waits for a yes. */
  autonomyPaused: boolean;
};

export type PriceDecision = { kind: "refuse"; reason: string } | { kind: "ask"; why: string } | { kind: "run" };

/** Whether the AI's change of one price is refused, waits for a platform owner's yes, or runs on its own within the range. */
export function priceTuningDecision(tuning: PriceTuning, facts: PriceChangeFacts): PriceDecision {
  if (tuning.level === "off") return { kind: "refuse", reason: "The AI does not change Kaizena Flow's prices: it is off on Platform → Plans, under AI and prices." };
  if (!Number.isSafeInteger(facts.toMinor) || facts.toMinor <= 0) return { kind: "refuse", reason: "A price must be more than nothing." };
  if (facts.toMinor === facts.currentMinor) return { kind: "refuse", reason: "That is the price now." };
  if (facts.foundingMinor !== null && facts.toMinor <= facts.foundingMinor) {
    return { kind: "refuse", reason: "The list price must stay above its founding price: change the founding price first on Platform → Plans → Extensions." };
  }
  if (tuning.level === "propose") return { kind: "ask", why: "Each price change waits for a yes." };
  if (facts.autonomyPaused) return { kind: "ask", why: "Every AI acting on its own is paused." };
  const moved = Math.abs(changePercent(facts.anchorMinor, facts.toMinor));
  if (moved > tuning.rangePercent) return { kind: "ask", why: `It is ${moved} % from the price a person last set, beyond the ${tuning.rangePercent} % the AI may go on its own.` };
  return { kind: "run" };
}
