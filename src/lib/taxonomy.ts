import type { RichTextDoc } from "./page-content";
import type { TermSeo } from "./term-seo";
import type { TermRules } from "./term-rules";
import type { TermTexts } from "./term-texts";

/**
 * Categories and tags (D50), shared by the admin (in the browser) and the
 * server. Each kind of content has its own: Kaizen's pages, and each
 * store's products (later its pages and articles too). Categories nest;
 * tags are a flat list. An item can be in several of each.
 */

export const CONTENT_TYPES = ["page", "article", "product"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const TERM_KINDS = ["category", "tag"] as const;
export type TermKind = (typeof TERM_KINDS)[number];

/** Whose and for what: Kaizen's (`storeId` null) or a store's, for one kind of content. */
export type TermScope = { storeId: string | null; contentType: ContentType };

export type Term = {
  id: string;
  kind: TermKind;
  /** A category's parent category; null at the top, and always for tags. */
  parentId: string | null;
  name: string;
  slug: string;
  /**
   * A store's product category whose products (and its subcategories') need a content for the unit price (D160). Only
   * ever true on a product category; absent where it is not read (Kaizen's own terms).
   */
  requiresUnitPrice?: boolean;
  /** A store's product category's or tag's choice for its products' price of nothing (D913): Free, the amount, or null as the level above. */
  zeroFree?: boolean | null;
  /**
   * The category's or tag's own title and description for search results and shares, per language (wave 2, D168: `terms.seo`). Absent where it is not read
   * (Kaizen's own terms); `{}` when the term has none.
   */
  seo?: TermSeo;
  /**
   * A store's product category's or tag's own page (wave 6 unit A, D319): its description in the main language, its picture with its small
   * copy, and its name and description in the other languages (`termTextFor()`). Absent where they are not read (Kaizen's own terms).
   */
  description?: RichTextDoc | null;
  image?: { url: string; thumbnailUrl: string | null } | null;
  texts?: TermTexts;
  /**
   * A store's product category or tag filled by rules (wave 6 unit A2, D319): its conditions, null for one the owner fills by hand. Absent where it is
   * not read.
   */
  rules?: TermRules | null;
};

/** What an item is in: category and tag ids. */
export type TermIds = { categories: string[]; tags: string[] };

export const TERM_NAME_MAX = 80;
export const TERM_SLUG_MAX = 80;
/** Categories and tags per owner and kind of content, together. */
export const TERMS_MAX = 500;
/** Categories, or tags, on one item. */
export const ITEM_TERMS_MAX = 50;

export const TERM_LABELS: Record<TermKind, { one: string; many: string }> = {
  category: { one: "Category", many: "Categories" },
  tag: { one: "Tag", many: "Tags" },
};

/** Why an address cannot be used, or null. */
export function termSlugProblem(slug: string): string | null {
  if (slug.length === 0) return "Give it an address.";
  if (slug.length > TERM_SLUG_MAX) return `Keep the address under ${TERM_SLUG_MAX} characters.`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return "An address is lowercase letters and digits, with single hyphens between words.";
  }
  return null;
}

export const byName = (a: Term, b: Term) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/**
 * Categories in reading order, each after its parent, with its depth
 * (0 at the top); siblings by name. A category whose parent is missing
 * counts as at the top.
 */
export function categoryTree(terms: Term[]): (Term & { depth: number })[] {
  const categories = terms.filter((t) => t.kind === "category");
  const ids = new Set(categories.map((c) => c.id));
  const children = new Map<string | null, Term[]>();
  for (const category of categories) {
    const parent = category.parentId && ids.has(category.parentId) ? category.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), category]);
  }
  const out: (Term & { depth: number })[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const category of (children.get(parent) ?? []).sort(byName)) {
      if (seen.has(category.id)) continue;
      seen.add(category.id);
      out.push({ ...category, depth });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The categories and every category inside them, however deep: filtering by a category includes its subcategories. */
export function withDescendants(terms: Term[], ids: readonly string[]): string[] {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const term of terms) {
      if (term.kind === "category" && term.parentId && out.has(term.parentId) && !out.has(term.id)) {
        out.add(term.id);
        grew = true;
      }
    }
  }
  return [...out];
}

/** A category and every category inside it: where it cannot be moved. */
export function selfAndDescendants(terms: Term[], id: string): Set<string> {
  return new Set(withDescendants(terms, [id]));
}

/** Only the ids of terms of `kind` that exist, each once: a term deleted since is left out. */
export function knownIds(terms: Term[], kind: TermKind, ids: readonly string[]): string[] {
  const known = new Set(terms.filter((t) => t.kind === kind).map((t) => t.id));
  return [...new Set(ids)].filter((id) => known.has(id));
}

/** Categories (as a tree, indented) and tags as menu link targets, by address. */
export function termTargets(terms: Term[]): { category: { value: string; title: string }[]; tag: { value: string; title: string }[] } {
  return {
    category: categoryTree(terms).map((c) => ({ value: c.slug, title: `${"\u2003".repeat(c.depth)}${c.name}` })),
    tag: terms
      .filter((t) => t.kind === "tag")
      .sort(byName)
      .map((t) => ({ value: t.slug, title: t.name })),
  };
}
