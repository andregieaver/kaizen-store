/**
 * The shop's variant picker at scale (wave 6 unit B, D320, `docs/wave-6-catalogue.md` B.5): each option a list of its own, with the values that make
 * no buyable variant with the others chosen marked. Pure and free of zod, for the product page's client part (D211).
 */

/** A variant as the picker knows it: its option values, and whether it can be bought now (in stock, on backorder or a download). */
export type PickVariant = { id: string; options: Record<string, string>; buyable: boolean };

/** From this many variants the buy part offers each option as a list of its own (`ProductBlock.optionsFrom` changes it). */
export const OPTIONS_FROM = 12;

/** The product's options in the order its variants name them, each with its values in the order they first appear. */
export function optionsOf(variants: readonly PickVariant[]): { name: string; values: string[] }[] {
  const options: { name: string; values: string[] }[] = [];
  for (const variant of variants) {
    for (const [name, value] of Object.entries(variant.options)) {
      let option = options.find((o) => o.name === name);
      if (!option) {
        option = { name, values: [] };
        options.push(option);
      }
      if (!option.values.includes(value)) option.values.push(value);
    }
  }
  return options;
}

/**
 * Per option, the values that make a buyable variant with the values chosen for the other options (an option not chosen holds anything). So a
 * colour is marked once no size of it can be bought in the fit chosen, and the size list says which sizes there are in the colour chosen.
 */
export function buyableValues(variants: readonly PickVariant[], chosen: Readonly<Record<string, string>>): Record<string, Set<string>> {
  const names = optionsOf(variants).map((o) => o.name);
  const out: Record<string, Set<string>> = Object.fromEntries(names.map((name) => [name, new Set<string>()]));
  for (const variant of variants) {
    if (!variant.buyable) continue;
    for (const name of names) {
      const others = names.every((other) => other === name || chosen[other] === undefined || variant.options[other] === chosen[other]);
      if (others && variant.options[name] !== undefined) out[name].add(variant.options[name]);
    }
  }
  return out;
}

/**
 * The variant to show after a value was chosen: the one with every value chosen when there is one and it can be bought, else the buyable variant
 * with that value keeping the most of the other values chosen (the first in the product's order on a tie), else the one with every value chosen,
 * else the first with that value. Null only when no variant has the value.
 */
export function nearestVariant<V extends PickVariant>(variants: readonly V[], chosen: Readonly<Record<string, string>>, changed: string): V | null {
  const value = chosen[changed];
  const candidates = variants.filter((v) => v.options[changed] === value);
  if (candidates.length === 0) return null;
  const others = Object.keys(chosen).filter((name) => name !== changed);
  const kept = (v: V) => others.filter((name) => v.options[name] === chosen[name]).length;
  const exact = candidates.find((v) => kept(v) === others.length);
  if (exact?.buyable) return exact;
  let best: V | null = null;
  for (const v of candidates) {
    if (v.buyable && (best === null || kept(v) > kept(best))) best = v;
  }
  return best ?? exact ?? candidates[0];
}
