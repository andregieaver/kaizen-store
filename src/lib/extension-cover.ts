import type { ExtensionId } from "./extensions";

/**
 * The cheapest way to have some extensions (D748 step E6, `docs/extensions.md` 8.3), pure: which bundles and single extensions to buy so that
 * the account has every extension it wants beyond what its plan includes, for the least money. The checkout buys this answer and says what
 * it saves; the AI manager quotes the same function. It never buys an extension twice (bundles that share one are never bought together) and
 * never charges for what the plan includes (a bundle holding one is not offered).
 */

/** Something the account can buy, priced in one currency and interval: one extension at a size, or a bundle of extensions (each at its smallest). */
export type CoverOption = { kind: "extension" | "bundle"; id: string; priceId: string; covers: readonly ExtensionId[]; amountMinor: number };

export type Cover = {
  picks: CoverOption[];
  totalMinor: number;
  /** What the same extensions cost bought one by one, when each has a price of its own; null when one has none. */
  singlesMinor: number | null;
};

/** Bundles weighed at once: two to the power of this many sets are tried. */
const MAX_BUNDLES = 12;

/**
 * The cheapest cover of `wanted` after `included`, from `options` (one single per extension at the size wanted; a bundle only covers its
 * members at their smallest size, so leave it out where a bigger size is wanted). `refused` are extensions the owner said no to: no bundle
 * holding one is bought. Ties go to fewer things to buy, then to the options' order. Null when something wanted cannot be bought.
 */
export function cheapestCover(
  wanted: readonly ExtensionId[],
  included: readonly ExtensionId[],
  options: readonly CoverOption[],
  refused: readonly ExtensionId[] = [],
): Cover | null {
  const needed = [...new Set(wanted)].filter((id) => !included.includes(id));
  const singles = new Map<ExtensionId, CoverOption>();
  for (const option of options) {
    if (option.kind !== "extension" || option.covers.length !== 1) continue;
    const id = option.covers[0];
    const held = singles.get(id);
    if (!held || option.amountMinor < held.amountMinor) singles.set(id, option);
  }
  const bundles = options
    .filter((o) => o.kind === "bundle" && o.covers.length > 0)
    .filter((o) => !o.covers.some((id) => included.includes(id) || refused.includes(id)))
    .slice(0, MAX_BUNDLES);

  let best: Cover | null = null;
  for (let mask = 0; mask < 1 << bundles.length; mask++) {
    const chosen = bundles.filter((_, i) => mask & (1 << i));
    const members = chosen.flatMap((b) => b.covers);
    if (new Set(members).size !== members.length) continue; // two bundles holding one extension would charge for it twice
    const rest = needed.filter((id) => !members.includes(id));
    if (rest.some((id) => !singles.has(id))) continue;
    // A bundle must earn its place: it covers something wanted.
    if (chosen.some((b) => !b.covers.some((id) => needed.includes(id)))) continue;
    const picks = [...chosen, ...rest.map((id) => singles.get(id)!)];
    const totalMinor = picks.reduce((sum, p) => sum + p.amountMinor, 0);
    if (!best || totalMinor < best.totalMinor || (totalMinor === best.totalMinor && picks.length < best.picks.length)) {
      best = { picks, totalMinor, singlesMinor: null };
    }
  }
  if (!best) return null;
  const allSingle = needed.every((id) => singles.has(id));
  return { ...best, singlesMinor: allSingle ? needed.reduce((sum, id) => sum + singles.get(id)!.amountMinor, 0) : null };
}

/** What a cover saves against buying its extensions one by one, in minor units; zero when it buys them one by one. */
export const coverSaving = (cover: Cover): number => (cover.singlesMinor === null ? 0 : Math.max(0, cover.singlesMinor - cover.totalMinor));
