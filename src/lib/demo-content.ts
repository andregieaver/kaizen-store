/**
 * A new store's demo content (`docs/theme-showcase-phase-1.md` step 4b): what the store template it was copied from brought (products,
 * pages and articles, categories and tags), marked when the store was made (`commerce.store_demo_items`), so *Remove demo content* on the
 * store's Home takes it out in one press, never touching what the owner made or changed. Pure: the words and the menu rule the server and
 * its tests share.
 */

import { countWords, fillWords } from "./admin-fill";
import { homeEn, type HomeMessages } from "./admin-messages/home.en";

export const DEMO_KINDS = ["product", "page", "term"] as const;
export type DemoKind = (typeof DEMO_KINDS)[number];

/** How many of each are still demo (marked and unchanged), as the Home card counts them. */
export type DemoCounts = { products: number; pages: number; articles: number; categories: number; tags: number };

export const NO_DEMO: DemoCounts = { products: 0, pages: 0, articles: 0, categories: 0, tags: 0 };

export const demoTotal = (counts: DemoCounts): number => counts.products + counts.pages + counts.articles + counts.categories + counts.tags;

/** The words the demo content is told in (D312 A3): the `home` catalogue's `demo`, English unless given. */
export type DemoWords = HomeMessages["demo"];

const COUNT_KEYS: (keyof DemoCounts)[] = ["products", "pages", "articles", "categories", "tags"];

/** "a, b and c". */
export function andWords(words: readonly string[], and = homeEn.demo.and): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} ${and} ${words[words.length - 1]}`;
}

/** "6 products, 2 pages and 3 categories": only what there is, in a fixed order; empty when there is nothing. */
export function demoWords(counts: DemoCounts, w: DemoWords = homeEn.demo): string {
  return andWords(
    COUNT_KEYS.filter((key) => counts[key] > 0).map((key) => countWords(counts[key], w.counts[key])),
    w.and,
  );
}

/** Why a marked item stays when the demo content is removed. */
export type KeptReason = "changed" | "in_use" | "in_test";

export type KeptItem = { kind: DemoKind; title: string; reason: KeptReason };

const KEPT_REASONS: KeptReason[] = ["changed", "in_use", "in_test"];

/** What stays, named, one sentence per reason: "Kept 2 you changed: Linen shirt and About us." */
export function keptWords(kept: readonly KeptItem[], w: DemoWords = homeEn.demo): string[] {
  return KEPT_REASONS.flatMap((reason) => {
    const titles = kept.filter((k) => k.reason === reason).map((k) => k.title);
    return titles.length > 0 ? [countWords(titles.length, w.kept[reason], { titles: andWords(titles, w.and) })] : [];
  });
}

/** What the removal says when it is done: what went, then what stayed and why. */
export function removalWords(removed: DemoCounts, kept: readonly KeptItem[], w: DemoWords = homeEn.demo): string[] {
  const went = demoWords(removed, w);
  return [went ? fillWords(w.removed, { words: went }) : w.nothingRemoved, ...keptWords(kept, w)];
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
