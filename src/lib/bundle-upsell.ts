import type { ExtensionId } from "./extensions";

/**
 * The sign-up for extensions proposes a bundle (D748 E7, D859), pure, so the page works it out as a person ticks and a test can hold it:
 *
 * - **Cheaper as a bundle.** When a bundle holds everything chosen and costs no more than the choice, the page chooses it for them and says
 *   why (`switchTo`). A bundle they took off is not chosen for them again; it is offered instead (`offer`).
 * - **A little more for more.** When a bundle holds everything chosen and more, and costs at most `nearPercent` % more than the choice, it is
 *   proposed with what it adds (`propose`), but only when it adds something they can use now: a part that needs a store (`needsStore`) is
 *   never what a bundle is sold on to an account without one, and is named as working once they add their store.
 *
 * Prices are what is paid a month in one currency (the founding price while it is offered); arithmetic is here, never in the words.
 */

export type UpsellBundle = { id: string; name: string; members: readonly ExtensionId[]; priceMinor: number };

export type UpsellInput = {
  /** Extensions ticked on their own. */
  ticked: readonly ExtensionId[];
  /** Bundles chosen. */
  chosen: readonly string[];
  /** Each extension's own monthly price; one without a price cannot be costed. */
  prices: Readonly<Partial<Record<ExtensionId, number>>>;
  bundles: readonly UpsellBundle[];
  /** Parts that do nothing without a store (`STORE_ONLY_EXTENSIONS`, and those not sold on their own). */
  needsStore: readonly ExtensionId[];
  /** A store is ticked too: every part can be used. */
  withStore: boolean;
  /** How much more a bundle may cost to be proposed, in percent of the choice; 0 proposes none. */
  nearPercent: number;
  /** Bundles the person took off after the page chose them: offered, never chosen for them again. */
  declined: readonly string[];
};

export type Upsell = {
  /** What the choice costs a month as it is ticked, or null when a part has no price. */
  totalMinor: number | null;
  /** Every extension the choice gives: those ticked and the chosen bundles' parts. */
  covered: ExtensionId[];
  /** A bundle to choose for them: it holds everything chosen for no more. */
  switchTo: { bundle: UpsellBundle; fromMinor: number } | null;
  /** The same, for a bundle they took off: shown with a button, not chosen. */
  offer: { bundle: UpsellBundle; fromMinor: number } | null;
  /** A bundle for a little more: what it costs on top, what it adds that they can use, and what it adds that needs a store. */
  propose: { bundle: UpsellBundle; extraMinor: number; adds: ExtensionId[]; addsLater: ExtensionId[] } | null;
};

/** What the choice costs and covers, and the bundle to choose for them, offer or propose. */
export function bundleUpsell(input: UpsellInput): Upsell {
  const chosen = input.bundles.filter((b) => input.chosen.includes(b.id));
  const inBundles = new Set(chosen.flatMap((b) => b.members));
  const loose = [...new Set(input.ticked)].filter((id) => !inBundles.has(id));
  const covered = [...new Set([...inBundles, ...loose])];
  const loosePrices = loose.map((id) => input.prices[id]);
  const totalMinor = loosePrices.every((p) => typeof p === "number") ? chosen.reduce((sum, b) => sum + b.priceMinor, 0) + loosePrices.reduce<number>((sum, p) => sum + p!, 0) : null;
  const none: Upsell = { totalMinor, covered, switchTo: null, offer: null, propose: null };
  if (totalMinor === null || covered.length === 0) return none;
  // Bundles that hold everything chosen and are not chosen already, cheapest first, then the one that holds more.
  const holding = input.bundles
    .filter((b) => !input.chosen.includes(b.id) && covered.every((id) => b.members.includes(id)))
    .sort((a, b) => a.priceMinor - b.priceMinor || b.members.length - a.members.length);
  const cheaper = holding.filter((b) => b.priceMinor <= totalMinor);
  const switchable = cheaper.find((b) => !input.declined.includes(b.id));
  if (switchable) return { ...none, switchTo: { bundle: switchable, fromMinor: totalMinor } };
  const declined = cheaper[0];
  if (declined) return { ...none, offer: { bundle: declined, fromMinor: totalMinor } };
  if (input.nearPercent <= 0) return none;
  const usable = (id: ExtensionId) => input.withStore || !input.needsStore.includes(id);
  // A bundle they took off is never proposed for more either.
  const near = holding.find((b) => {
    if (input.declined.includes(b.id)) return false;
    const adds = b.members.filter((id) => !covered.includes(id));
    return b.priceMinor * 100 <= totalMinor * (100 + input.nearPercent) && adds.some(usable);
  });
  if (!near) return none;
  const adds = near.members.filter((id) => !covered.includes(id));
  return { ...none, propose: { bundle: near, extraMinor: near.priceMinor - totalMinor, adds: adds.filter(usable), addsLater: adds.filter((id) => !usable(id)) } };
}

/** The currency the sign-up shows prices in: the country's when the price list has it, else euros, else the first there is. */
export function signUpCurrency(countryCurrency: string | null, priced: readonly string[]): string | null {
  if (countryCurrency && priced.includes(countryCurrency)) return countryCurrency;
  if (priced.includes("EUR")) return "EUR";
  return priced[0] ?? null;
}
