/**
 * One word per thing in the admin's menus (ecosystem plan E3.7, D718): the rules `nav-labels.scan.test.ts` holds the store's, the
 * owner's and the platform's navigation to, in every language the admin is written in. Pure; the scan gathers the menus and the words.
 *
 * - In a store's menu no two places share a name, a tab and a page of its sidebar included, unless they open the same page (a section's
 *   tab and its main page: Orders and Orders).
 * - A name of the owner's or the platform's menu that a store's menu also has must mean the same thing at both levels (the platform's
 *   Website is Kaizena Flow's own site, as a store's Website is the store's): such names are listed as the same thing, each with why.
 *   Two different English names that one language says alike (Plans and Subscriptions are both «Abonnementer») are listed together.
 */

/** A place in a menu: its English name as the navigation writes it, the level, and the address it opens (after the level's base). */
export type NavEntry = { label: string; level: "store" | "owner" | "platform"; page: string };

/** English names that are the same thing at another level, each with the reason. */
export type SameThing = { labels: readonly string[]; why: string };

const key = (word: string) => word.trim().toLowerCase();

/** The places of `entries` by the name a person reads (`word`, the navigation in a language), lowercased. */
function byWord(entries: readonly NavEntry[], word: (label: string) => string): Map<string, NavEntry[]> {
  const found = new Map<string, NavEntry[]>();
  for (const entry of entries) {
    const k = key(word(entry.label));
    found.set(k, [...(found.get(k) ?? []), entry]);
  }
  return found;
}

/** Places of a store's menu that share a name and open different pages, as `«name»: /a, /b`. */
export function storeClashes(entries: readonly NavEntry[], word: (label: string) => string = (label) => label): string[] {
  const clashes: string[] = [];
  for (const [name, places] of byWord(entries, word)) {
    const pages = [...new Set(places.map((p) => p.page))];
    if (pages.length > 1) clashes.push(`«${name}»: ${pages.map((p) => p || "/").join(", ")}`);
  }
  return clashes;
}

/**
 * Names of the owner's or the platform's menu (`others`) that a store's menu also uses, read in one language, and not listed as the same
 * thing: `«name»: platform /x (Label) and store /y (Label)`. `used` holds the index of every `same` entry a shared name was let through by.
 */
export function levelClashes(
  store: readonly NavEntry[],
  others: readonly NavEntry[],
  same: readonly SameThing[],
  word: (label: string) => string = (label) => label,
): { clashes: string[]; used: Set<number> } {
  const storeBy = byWord(store, word);
  const clashes: string[] = [];
  const used = new Set<number>();
  for (const other of others) {
    const name = key(word(other.label));
    for (const mine of storeBy.get(name) ?? []) {
      const allowed = same.findIndex((s) => s.labels.includes(other.label) && s.labels.includes(mine.label));
      if (allowed >= 0) used.add(allowed);
      else clashes.push(`«${name}»: ${other.level} ${other.page || "/"} (${other.label}) and store ${mine.page || "/"} (${mine.label})`);
    }
  }
  return { clashes: [...new Set(clashes)], used };
}
