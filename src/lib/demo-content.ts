/**
 * A new store's demo content (`docs/theme-showcase-phase-1.md` step 4b): what the store template it was copied from brought (products,
 * pages and articles, categories and tags), marked when the store was made (`commerce.store_demo_items`), so *Remove demo content* on the
 * store's Home takes it out in one press, never touching what the owner made or changed. Pure: the words and the menu rule the server and
 * its tests share.
 */

export const DEMO_KINDS = ["product", "page", "term"] as const;
export type DemoKind = (typeof DEMO_KINDS)[number];

/** How many of each are still demo (marked and unchanged), as the Home card counts them. */
export type DemoCounts = { products: number; pages: number; articles: number; categories: number; tags: number };

export const NO_DEMO: DemoCounts = { products: 0, pages: 0, articles: 0, categories: 0, tags: 0 };

export const demoTotal = (counts: DemoCounts): number => counts.products + counts.pages + counts.articles + counts.categories + counts.tags;

const NOUNS: Record<keyof DemoCounts, [string, string]> = {
  products: ["product", "products"],
  pages: ["page", "pages"],
  articles: ["article", "articles"],
  categories: ["category", "categories"],
  tags: ["tag", "tags"],
};

/** "a, b and c". */
export function andWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** "6 products, 2 pages and 3 categories": only what there is, in a fixed order; empty when there is nothing. */
export function demoWords(counts: DemoCounts): string {
  return andWords(
    (Object.keys(NOUNS) as (keyof DemoCounts)[]).filter((key) => counts[key] > 0).map((key) => `${counts[key]} ${NOUNS[key][counts[key] === 1 ? 0 : 1]}`),
  );
}

/** Why a marked item stays when the demo content is removed. */
export type KeptReason = "changed" | "in_use" | "in_test";

export type KeptItem = { kind: DemoKind; title: string; reason: KeptReason };

const KEPT_WORDS: Record<KeptReason, (n: number) => string> = {
  changed: (n) => (n === 1 ? "1 you changed" : `${n} you changed`),
  in_use: (n) => (n === 1 ? "1 that your own products or pages use" : `${n} that your own products or pages use`),
  in_test: (n) => (n === 1 ? "1 in an A/B test" : `${n} in an A/B test`),
};

/** What stays, named, one sentence per reason: "Kept 2 you changed: Linen shirt and About us." */
export function keptWords(kept: readonly KeptItem[]): string[] {
  return (Object.keys(KEPT_WORDS) as KeptReason[]).flatMap((reason) => {
    const titles = kept.filter((k) => k.reason === reason).map((k) => k.title);
    return titles.length > 0 ? [`Kept ${KEPT_WORDS[reason](titles.length)}: ${andWords(titles)}.`] : [];
  });
}

/** What the removal says when it is done: what went, then what stayed and why. */
export function removalWords(removed: DemoCounts, kept: readonly KeptItem[]): string[] {
  const went = demoWords(removed);
  return [went ? `Removed ${went}. Products are archived, so past orders keep them.` : "Nothing was removed.", ...keptWords(kept)];
}

/** The addresses of what went, by the kind of menu link that names it. */
export type RemovedAddresses = {
  products: readonly string[];
  pages: readonly string[];
  articles: readonly string[];
  categories: readonly string[];
  tags: readonly string[];
  blogCategories: readonly string[];
};

/** Whether a menu link goes to something that was removed (a product by its handle, the rest by their addresses). */
export function linksToRemoved(link: unknown, gone: RemovedAddresses): boolean {
  if (!link || typeof link !== "object") return false;
  const { kind, slug, handle } = link as { kind?: unknown; slug?: unknown; handle?: unknown };
  const has = (list: readonly string[], value: unknown) => typeof value === "string" && list.includes(value);
  switch (kind) {
    case "product":
      return has(gone.products, handle);
    case "page":
      return has(gone.pages, slug);
    case "article":
      return has(gone.articles, slug);
    case "category":
      return has(gone.categories, slug);
    case "tag":
      return has(gone.tags, slug);
    case "blogCategory":
      return has(gone.blogCategories, slug);
    default:
      return false;
  }
}
