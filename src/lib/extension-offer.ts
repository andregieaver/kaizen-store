import type { ExtensionId } from "./extensions";
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

export type ExtensionCardPrice = { amountMinor: number; foundingMinor: number | null; currency: string };

export type ExtensionCard = {
  id: ExtensionId;
  name: string;
  description: string;
  includes: string;
  standalone: boolean;
  price: ExtensionCardPrice;
  /** The plans that include it, cheapest first; `andUp` when every plan from the first one on does. */
  includedIn: { plans: string[]; andUp: boolean };
};

export type BundleCard = {
  id: string;
  name: string;
  description: string;
  members: string[];
  price: ExtensionCardPrice;
  /** What it saves a month against its extensions one by one (at the same kind of price: founding or not); null when one has no price. */
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

/**
 * The cards the block draws in `currency`: each extension with a monthly price there, then each bundle with one. A founding price shows
 * only while founding prices are offered (`foundingShown()`).
 */
export function extensionOffer(
  data: PublicExtensions,
  currency: string,
  now?: Date,
  /** The extensions and bundles switched off on the block (`ExtensionsBlock.hide`): left out after a bundle's saving is worked out. */
  hide: readonly string[] = [],
): { extensions: ExtensionCard[]; bundles: BundleCard[] } {
  const founding = foundingShown(data, now);
  const monthOf = (prices: readonly PublicPrice[]): ExtensionCardPrice | null => {
    const p = prices.find((x) => x.currency === currency && x.interval === "month");
    return p ? { amountMinor: p.amountMinor, foundingMinor: founding ? p.foundingMinor : null, currency } : null;
  };
  const plans = [...data.plans].sort((a, b) => a.position - b.position);
  const extensions = data.extensions.flatMap((e) => {
    const price = e.size ? monthOf(e.size.prices) : null;
    if (!e.size || !price) return [];
    const including = plans.filter((p) => p.includes.includes(e.id));
    const first = including[0] ? plans.indexOf(including[0]) : -1;
    const andUp = first >= 0 && plans.slice(first).every((p) => p.includes.includes(e.id)) && plans.length - first > 1;
    return [{ id: e.id, name: e.name, description: e.description, includes: e.size.label, standalone: e.standalone, price, includedIn: { plans: including.map((p) => p.name), andUp } }];
  });
  const bundles = data.bundles.flatMap((b) => {
    const price = monthOf(b.prices);
    if (!price) return [];
    const parts = b.members.map((id) => extensions.find((e) => e.id === id));
    const sum = parts.every(Boolean)
      ? parts.reduce((total, part) => total + (price.foundingMinor !== null ? (part!.price.foundingMinor ?? part!.price.amountMinor) : part!.price.amountMinor), 0)
      : null;
    const paid = price.foundingMinor ?? price.amountMinor;
    const names = b.members.map((id) => data.extensions.find((e) => e.id === id)?.name ?? id);
    return [{ id: b.id, name: b.name, description: b.description, members: names, price, savingMinor: sum === null ? null : Math.max(0, sum - paid) }];
  });
  const hidden = new Set(hide);
  return { extensions: extensions.filter((e) => !hidden.has(e.id)), bundles: bundles.filter((b) => !hidden.has(b.id)) };
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
