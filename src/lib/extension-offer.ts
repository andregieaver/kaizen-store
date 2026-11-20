import type { ExtensionId } from "./extensions";
import { yearlySaving } from "./plan-offer";
import type { PlanInterval } from "./plans";

/**
 * Kaizena Flow's extensions as visitors see them (D748 E8, `docs/extensions.md` 11), pure: what the Extensions block draws from the public
 * catalogue (`getPublicExtensions()`): a card per extension on offer and per bundle, in one currency, with the founding price while founding
 * prices are offered and which plans include an extension. Nothing here is about an account.
 */

export type PublicPrice = { currency: string; interval: PlanInterval; amountMinor: number; foundingMinor: number | null };

export type PublicExtensions = {
  extensions: {
    id: ExtensionId;
    name: string;
    description: string;
    standalone: boolean;
    /** Its smallest offered size: what the card says it includes, and the prices it shows. */
    size: { label: string; prices: PublicPrice[] } | null;
  }[];
  bundles: { id: string; name: string; description: string; members: ExtensionId[]; prices: PublicPrice[] }[];
  /** Kaizena Flow's active plans in their order, with the extensions each includes. */
  plans: { id: string; name: string; position: number; includes: ExtensionId[] }[];
  /** While founding prices are offered (ISO), and how many months an account keeps one; null when they are not. */
  founding: { until: string | null; months: number };
};

export type ExtensionCardPrice = { amountMinor: number; foundingMinor: number | null; currency: string; interval: PlanInterval };

/** What the card leads with and what it says under it, as the Plans block's cards (D481). */
type CardPrices = {
  /** The price the card leads with: the interval the block asked for, or the other when it has only that; monthly when it asked for both. */
  price: ExtensionCardPrice;
  /** The yearly price under the monthly one, when the block shows both. */
  other: ExtensionCardPrice | null;
  /** Whole percent the yearly price saves against twelve monthly ones, where the yearly price shows; null when it saves nothing. */
  yearlySavingPercent: number | null;
  /** The one the block recommends. */
  highlighted: boolean;
};

export type ExtensionCard = CardPrices & {
  id: ExtensionId;
  name: string;
  description: string;
  includes: string;
  standalone: boolean;
  /** The plans that include it, cheapest first; `andUp` when every plan from the first one on does. */
  includedIn: { plans: string[]; andUp: boolean };
};

export type BundleCard = CardPrices & {
  id: string;
  name: string;
  description: string;
  members: string[];
  /** What it saves against its extensions one by one, a month or a year as its price is (founding against founding); null when one has no such price. */
  savingMinor: number | null;
};

/**
 * Founding prices are offered: the public read leaves out an offer that has ended (read again within the hour it ends), so a page needs no
 * clock; a test or a caller that has one may ask about `now`.
 */
export const foundingShown = (data: Pick<PublicExtensions, "founding">, now?: Date): boolean =>
  data.founding.until !== null && (now === undefined || now < new Date(data.founding.until));

/** The currency the block shows: the one asked for when something is priced in it, else the one most monthly prices are in. */
export function offerCurrency(data: PublicExtensions, asked?: string): string | null {
  const monthly = [...data.extensions.flatMap((e) => e.size?.prices ?? []), ...data.bundles.flatMap((b) => b.prices)].filter((p) => p.interval === "month");
  if (asked && monthly.some((p) => p.currency === asked)) return asked;
  const counts = new Map<string, number>();
  for (const p of monthly) counts.set(p.currency, (counts.get(p.currency) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/** What is paid a month in each currency the prices are in: the founding price while founding prices are offered, else the price. */
export function paidMonthly(prices: readonly PublicPrice[], founding: boolean): Record<string, number> {
  return Object.fromEntries(prices.filter((p) => p.interval === "month").map((p) => [p.currency, founding && p.foundingMinor !== null ? p.foundingMinor : p.amountMinor]));
}

/** How the block shows prices (`ExtensionsBlock`): one interval or both (none), and the one it recommends. */
export type OfferOptions = { interval?: PlanInterval; highlightId?: string };

/** What is paid: the founding price while it is offered, else the list price. */
export const paidMinor = (price: ExtensionCardPrice): number => price.foundingMinor ?? price.amountMinor;

/**
 * The cards the block draws in `currency`: each extension with a price there, then each bundle with one, as the Plans block chooses a
 * card's price (`planCards()`): the interval asked for, or the other when it has only that; with none asked, monthly with the yearly price
 * under it. A founding price shows only while founding prices are offered (`foundingShown()`).
 */
export function extensionOffer(
  data: PublicExtensions,
  currency: string,
  now?: Date,
  /** The extensions and bundles switched off on the block (`ExtensionsBlock.hide`): left out after a bundle's saving is worked out. */
  hide: readonly string[] = [],
  options: OfferOptions = {},
): { extensions: ExtensionCard[]; bundles: BundleCard[] } {
  const founding = foundingShown(data, now);
  const priceIn = (prices: readonly PublicPrice[], interval: PlanInterval): ExtensionCardPrice | null => {
    const p = prices.find((x) => x.currency === currency && x.interval === interval);
    return p ? { amountMinor: p.amountMinor, foundingMinor: founding ? p.foundingMinor : null, currency, interval } : null;
  };
  const cardPrices = (id: string, prices: readonly PublicPrice[]): CardPrices | null => {
    const monthly = priceIn(prices, "month");
    const yearly = priceIn(prices, "year");
    const price = options.interval === "year" ? (yearly ?? monthly) : (monthly ?? yearly);
    if (!price) return null;
    return {
      price,
      other: options.interval ? null : price === monthly ? yearly : null,
      // Said where the yearly price shows: under the monthly one, or leading the card.
      yearlySavingPercent: monthly && yearly && (!options.interval || price === yearly) ? yearlySaving(paidMinor(monthly), paidMinor(yearly)) : null,
      highlighted: id === options.highlightId,
    };
  };
  const plans = [...data.plans].sort((a, b) => a.position - b.position);
  const extensions = data.extensions.flatMap((e) => {
    const prices = e.size ? cardPrices(e.id, e.size.prices) : null;
    if (!e.size || !prices) return [];
    const including = plans.filter((p) => p.includes.includes(e.id));
    const first = including[0] ? plans.indexOf(including[0]) : -1;
    const andUp = first >= 0 && plans.slice(first).every((p) => p.includes.includes(e.id)) && plans.length - first > 1;
    return [{ id: e.id, name: e.name, description: e.description, includes: e.size.label, standalone: e.standalone, ...prices, includedIn: { plans: including.map((p) => p.name), andUp } }];
  });
  const bundles = data.bundles.flatMap((b) => {
    const prices = cardPrices(b.id, b.prices);
    if (!prices) return [];
    // Against each of its extensions at the same interval, founding against founding.
    const parts = b.members.map((id) => {
      const extension = data.extensions.find((e) => e.id === id);
      return extension?.size ? priceIn(extension.size.prices, prices.price.interval) : null;
    });
    const sum = parts.every(Boolean) ? parts.reduce((total, part) => total + (prices.price.foundingMinor !== null ? paidMinor(part!) : part!.amountMinor), 0) : null;
    const names = b.members.map((id) => data.extensions.find((e) => e.id === id)?.name ?? id);
    return [{ id: b.id, name: b.name, description: b.description, members: names, ...prices, savingMinor: sum === null ? null : Math.max(0, sum - paidMinor(prices.price)) }];
  });
  const hidden = new Set(hide);
  return { extensions: extensions.filter((e) => !hidden.has(e.id)), bundles: bundles.filter((b) => !hidden.has(b.id)) };
}

/** The most a yearly price saves among the cards, for the switch between monthly and yearly; null when none saves. */
export function bestExtensionSaving(cards: readonly CardPrices[]): number | null {
  const savings = cards.map((card) => card.yearlySavingPercent).filter((p): p is number => p !== null);
  return savings.length > 0 ? Math.max(...savings) : null;
}

/**
 * The comparison table under the cards: each extension shown in a row, and for each bundle shown and each plan that includes one of them,
 * whether it includes that extension. Empty when there is nothing to compare against.
 */
export function extensionComparison(
  data: PublicExtensions,
  shown: { extensions: readonly ExtensionCard[]; bundles: readonly BundleCard[] },
): { columns: { id: string; name: string }[]; rows: { id: ExtensionId; name: string; included: boolean[] }[] } {
  const bundles = shown.bundles.map((card) => ({ id: card.id, name: card.name, holds: data.bundles.find((b) => b.id === card.id)?.members ?? [] }));
  const plans = [...data.plans]
    .sort((a, b) => a.position - b.position)
    .filter((p) => shown.extensions.some((e) => p.includes.includes(e.id)))
    .map((p) => ({ id: p.id, name: p.name, holds: p.includes }));
  const columns = [...bundles, ...plans];
  if (columns.length === 0 || shown.extensions.length === 0) return { columns: [], rows: [] };
  return {
    columns: columns.map(({ id, name }) => ({ id, name })),
    rows: shown.extensions.map((e) => ({ id: e.id, name: e.name, included: columns.map((c) => c.holds.includes(e.id)) })),
  };
}

/** An extension or a bundle the page builder's Extensions block can switch off (`ExtensionsBlock.hide`). */
export type ExtensionChoice = { id: string; name: string; kind: "extension" | "bundle" };

/** What the block can show, in the catalogue's order: each extension on offer, then each bundle. */
export function extensionChoices(data: PublicExtensions): ExtensionChoice[] {
  return [
    ...data.extensions.filter((e) => e.size).map((e) => ({ id: e.id, name: e.name, kind: "extension" as const })),
    ...data.bundles.map((b) => ({ id: b.id, name: b.name, kind: "bundle" as const })),
  ];
}
