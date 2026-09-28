import type { AnyLinkKind, AnyMenuLink } from "@/lib/navigation";

/**
 * What a menu's links can point at, for the menu editor (D85): a store's
 * pages, products, categories and tags by address, or Kaizen's pages by id.
 */

/** A language's texts for links named by the site itself (the front page, the cart, …). */
export type MenuLanguage = { locale: string; name: string; defaults: Partial<Record<AnyLinkKind, string>> };

/** Something a link can point at: a product (by handle), a page (by id or address), a category or tag (by address). */
export type Target = { value: string; title: string; note?: string };
export type TargetKind = "product" | "page" | "category" | "tag" | "article" | "blogCategory";
export type Targets = Partial<Record<TargetKind, Target[]>>;

export const TARGET_NOUNS: Record<TargetKind, string> = {
  product: "Product",
  page: "Page",
  category: "Category",
  tag: "Tag",
  article: "Article",
  blogCategory: "Blog category",
};

/** A link kind the menus offer, and how pages are named: a store's by address (D54), Kaizen's by id. */
export type KindOption = { kind: AnyLinkKind; label: string; pageBy?: "id" | "slug" };

/** The link kinds a store's menus offer. */
export const STORE_KINDS: KindOption[] = [
  { kind: "home", label: "Front page" },
  { kind: "products", label: "All products" },
  { kind: "page", label: "Page", pageBy: "slug" },
  { kind: "product", label: "Product" },
  { kind: "category", label: "Category" },
  { kind: "tag", label: "Tag" },
  { kind: "blog", label: "Blog" },
  { kind: "article", label: "Article", pageBy: "slug" },
  { kind: "blogCategory", label: "Blog category" },
  { kind: "account", label: "My account" },
  { kind: "cart", label: "Cart" },
  { kind: "url", label: "Custom link" },
];

/** The link kinds Kaizen's menus offer. */
export const PLATFORM_KINDS: KindOption[] = [
  { kind: "home", label: "Front page" },
  { kind: "page", label: "Page", pageBy: "id" },
  { kind: "category", label: "Category" },
  { kind: "tag", label: "Tag" },
  { kind: "blog", label: "Blog" },
  { kind: "article", label: "Article", pageBy: "id" },
  { kind: "blogCategory", label: "Blog category" },
  { kind: "signUp", label: "Start your store" },
  { kind: "signIn", label: "Sign in" },
  { kind: "url", label: "Custom link" },
];

/** The page, product, category or tag a link points at, if the link has one. */
export function targetOf(link: AnyMenuLink): { kind: TargetKind; value: string } | null {
  if (link.kind === "product") return { kind: "product", value: link.handle };
  if (link.kind === "page" || link.kind === "article") return { kind: link.kind, value: "pageId" in link ? link.pageId : link.slug };
  if (link.kind === "category" || link.kind === "tag" || link.kind === "blogCategory") return { kind: link.kind, value: link.slug };
  return null;
}

/** A link to `value` of a target kind. */
export function targetLink(kind: TargetKind, value: string, kinds: KindOption[]): AnyMenuLink {
  if (kind === "page" || kind === "article") {
    const bySlug = kinds.find((k) => k.kind === kind)?.pageBy === "slug";
    if (kind === "page") return bySlug ? { kind, slug: value } : { kind, pageId: value };
    return bySlug ? { kind, slug: value } : { kind, pageId: value };
  }
  if (kind === "product") return { kind, handle: value };
  return { kind, slug: value };
}
