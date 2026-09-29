import { z } from "zod";

/**
 * A site's logo and icon (D30), kept on the store as one JSON value, and its
 * menus (D85): lists of links the owner edits under Menus, shown wherever
 * one is chosen. Shared by the admin editors and the storefront.
 */

export const LABEL_MAX = 60;
/** A menu's items at most, and how deep one can sit under another (three levels). */
export const MENU_MAX_ITEMS = 100;
export const MENU_MAX_DEPTH = 2;
export const MENU_NAME_MAX = 80;

export const LINK_KINDS = ["home", "products", "page", "product", "category", "tag", "blog", "article", "blogCategory", "account", "cart", "url"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export type MenuLink =
  | { kind: "home" }
  /** All the store's products, to sort and filter (D78). */
  | { kind: "products" }
  | { kind: "account" }
  | { kind: "cart" }
  | { kind: "product"; handle: string }
  /** One of the store's pages (D54), by its address, which a store copied from the template keeps. */
  | StorePageLink
  /** A category's or tag's products (D50), by its address, which a store copied from the template keeps. */
  | TermLink
  /** The blog, one of its articles by address, or its articles in a category (D57). */
  | BlogLink
  | { kind: "article"; slug: string }
  | { kind: "url"; url: string };

/** A link to one of a store's pages (D54). */
export type StorePageLink = { kind: "page"; slug: string };

/** A link to the blog, or to its articles in a category (D57), in a store's menus or Kaizen's. */
export type BlogLink = { kind: "blog" } | { kind: "blogCategory"; slug: string };

/** A link to a category or tag (D50), in a store's menus or Kaizen's. */
export type TermLink = { kind: "category" | "tag"; slug: string };

/** A menu item: its text in each of the store's languages, and where it goes. */
export type MenuItem = { label: Record<string, string>; link: MenuLink };

export type Logo = { url: string; width: number; height: number };

/**
 * The site's icon in browser tabs, bookmarks and on home screens (D62):
 * square PNGs the browser made from the owner's picture, 512 and 64 pixels.
 */
export type Favicon = { url: string; smallUrl: string };

/** `logoDark` is shown where the background is dark (a dark theme or header), if given (D60). */
export type StoreNavigation = {
  logo: Logo | null;
  logoDark: Logo | null;
  favicon: Favicon | null;
};

export const EMPTY_NAVIGATION: StoreNavigation = { logo: null, logoDark: null, favicon: null };

/**
 * A menu's web address: http(s), a path in the store (`/p/notatbok`, relative
 * to the shopper's country), or an anchor on the page (`#kontakt`, or `#` alone
 * for a button that only opens a modal or a script-free placeholder). Nothing
 * else, so no `javascript:`.
 */
export function isMenuAddress(value: string): boolean {
  if (/^#\S*$/.test(value)) return true;
  if (/^\/(?![/\\])/.test(value)) return !/\s/.test(value);
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function termSlug(kind: "category" | "tag") {
  return z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, `Choose a ${kind} for each ${kind} link.`)
    .max(80);
}

const label = z.record(z.string(), z.string().trim().max(LABEL_MAX, `Keep menu texts under ${LABEL_MAX} characters.`));

const link = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("home") }),
  z.object({ kind: z.literal("products") }),
  z.object({ kind: z.literal("account") }),
  z.object({ kind: z.literal("cart") }),
  z.object({ kind: z.literal("product"), handle: z.string().trim().min(1, "Choose a product for each product link.").max(200) }),
  z.object({
    kind: z.literal("page"),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Choose a page for each page link.")
      .max(80),
  }),
  z.object({ kind: z.literal("category"), slug: termSlug("category") }),
  z.object({ kind: z.literal("tag"), slug: termSlug("tag") }),
  z.object({ kind: z.literal("blog") }),
  z.object({
    kind: z.literal("article"),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Choose an article for each article link.")
      .max(80),
  }),
  z.object({ kind: z.literal("blogCategory"), slug: termSlug("category") }),
  z.object({
    kind: z.literal("url"),
    url: z.string().trim().max(1000).refine(isMenuAddress, "A menu link has an invalid web address."),
  }),
]);

const item = z.object({ label, link });

/** Where an item sits: how deep under the items before it (0 at the top), and whether it opens in a new tab. */
/** A mega menu's columns at most (D87). */
export const MEGA_MAX_COLUMNS = 6;

/** A top link's mega menu (D87): the links under it across the content's width, in columns, centred if asked. */
export type MegaMenu = { columns: number; center?: boolean };
/** A link's picture (D87), shown in a mega menu. */
export type MenuPicture = { url: string; width: number; height: number };

const megaSchema = z.object({
  columns: z.number().int().min(1).max(MEGA_MAX_COLUMNS, `A mega menu has at most ${MEGA_MAX_COLUMNS} columns.`),
  center: z.boolean().optional(),
});
const pictureSchema = z.object({
  url: z.string().trim().max(1000).refine(isMenuAddress, "A menu link's picture has an invalid address."),
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
});

/** Where an item sits, and how it shows: a new tab, a mega menu for a top link, a picture. */
const placing = {
  depth: z.number().int().min(0).max(MENU_MAX_DEPTH),
  newTab: z.boolean().optional(),
  mega: megaSchema.optional(),
  image: pictureSchema.optional(),
};

/** A menu's items: at most `MENU_MAX_ITEMS`, the first at the top and each at most one deeper than the one before. */
function itemsSchema<T extends z.ZodType<{ depth: number }>>(entry: T) {
  return z
    .array(entry)
    .max(MENU_MAX_ITEMS, `A menu takes at most ${MENU_MAX_ITEMS} links.`)
    .refine(
      (items) => items.every((it, i) => it.depth <= (i === 0 ? 0 : items[i - 1].depth + 1)),
      "A link can only sit under the link before it.",
    )
    .refine((items) => items.every((it) => it.depth === 0 || !("mega" in it) || !it.mega), "Only a top link can be a mega menu.");
}

const menuName = z
  .string()
  .trim()
  .min(1, "Give the menu a name.")
  .max(MENU_NAME_MAX, `Keep the menu's name under ${MENU_NAME_MAX} characters.`);

/** A store's menu as the editor saves it. */
export const menuInput = z.object({ name: menuName, items: itemsSchema(item.extend(placing)) });

const logoSchema = z.object({
  url: z.string().trim().max(1000).refine(isMenuAddress, "The logo has an invalid address."),
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
});

export const navigationSchema = z.object({
  logo: logoSchema.nullable(),
  /** Saved before there was one: none. */
  logoDark: logoSchema.nullable().default(null),
  favicon: z
    .object({
      url: z.string().trim().max(1000).refine(isMenuAddress, "The icon has an invalid address."),
      smallUrl: z.string().trim().max(1000).refine(isMenuAddress, "The icon has an invalid address."),
    })
    .nullable()
    .default(null),
});

/** The stored value, or no logo or icon if it is missing or damaged. */
export function parseNavigation(value: unknown): StoreNavigation {
  const parsed = navigationSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_NAVIGATION;
}

/** Only the store's own languages, with empty texts dropped. */
export function cleanLabels(labels: Record<string, string>, locales: string[]): Record<string, string> {
  return Object.fromEntries(
    locales.flatMap((locale) => {
      const text = labels[locale]?.trim();
      return text ? [[locale, text]] : [];
    }),
  );
}

/** Where a menu item goes, from the shopper's country's front page (`/s/demo/no`). */
export function menuHref(link: MenuLink, base: string, names?: MenuNames): { href: string; external: boolean } {
  switch (link.kind) {
    case "home":
      return { href: base, external: false };
    case "page":
      // A page that moved is linked at its address now.
      return { href: `${base}/${names?.page?.get(link.slug)?.slug ?? link.slug}`, external: false };
    case "products":
      return { href: `${base}/products`, external: false };
    case "account":
      return { href: `${base}/account`, external: false };
    case "cart":
      return { href: `${base}/cart`, external: false };
    case "product":
      return { href: `${base}/p/${encodeURIComponent(link.handle)}`, external: false };
    case "category":
    case "tag":
      return { href: `${base}/${link.kind}/${link.slug}`, external: false };
    case "blog":
      return { href: `${base}/blog`, external: false };
    case "article":
      return { href: `${base}/blog/${names?.article?.get(link.slug)?.slug ?? link.slug}`, external: false };
    case "blogCategory":
      return { href: `${base}/blog/category/${link.slug}`, external: false };
    case "url":
      // An anchor stays where it is: it is on the page the shopper is on.
      if (link.url.startsWith("#")) return { href: link.url, external: false };
      return link.url.startsWith("/")
        ? { href: `${base}${link.url}`, external: false }
        : { href: link.url, external: true };
  }
}

/**
 * A menu item's text in the shopper's language: the owner's, else the
 * built-in name for a page Kaizen knows, else the owner's text in another
 * language.
 */
export function menuLabel(
  item: MenuItem,
  locale: string,
  builtIn: { home: string; account: string; cart: string; blog?: string; products?: string },
  /** Page titles, category and tag names by address, for links without a text of their own. */
  termNames?: MenuNames,
): string {
  const own = item.label[locale];
  if (own) return own;
  if (item.link.kind === "home" || item.link.kind === "account" || item.link.kind === "cart") {
    return builtIn[item.link.kind];
  }
  if (item.link.kind === "blog" && builtIn.blog) return builtIn.blog;
  if (item.link.kind === "products" && builtIn.products) return builtIn.products;
  if (item.link.kind === "article") {
    const title = termNames?.article?.get(item.link.slug)?.title;
    if (title) return title;
  }
  if (item.link.kind === "blogCategory") {
    const name = termNames?.blogCategory?.get(item.link.slug);
    if (name) return name;
  }
  if ((item.link.kind === "category" || item.link.kind === "tag") && termNames) {
    const name = termNames[item.link.kind].get(item.link.slug);
    if (name) return name;
  }
  if (item.link.kind === "page") {
    const title = termNames?.page?.get(item.link.slug)?.title;
    if (title) return title;
  }
  return Object.values(item.label).find(Boolean) ?? "";
}

/** A store's or Kaizen's category and tag names by address, for menus (D50). */
export type TermNames = { category: ReadonlyMap<string, string>; tag: ReadonlyMap<string, string> };

/** Names by address, from categories and tags. */
export function termNames(terms: readonly { kind: "category" | "tag"; slug: string; name: string }[]): TermNames {
  const of = (kind: "category" | "tag") => new Map(terms.filter((t) => t.kind === kind).map((t) => [t.slug, t.name]));
  return { category: of("category"), tag: of("tag") };
}

/**
 * A store's published pages by address (D54), with where each is now and its
 * title; a page that moved is also known by its old addresses.
 */
export type PageNames = ReadonlyMap<string, { slug: string; title: string }>;

/** Names for menu links without a text of their own; a store's also has its pages, articles and blog categories (D57). */
export type MenuNames = TermNames & { page?: PageNames; article?: PageNames; blogCategory?: ReadonlyMap<string, string> };

/**
 * Whether a link still leads somewhere: a category or tag that is gone, or a
 * store page that is not published, is left out of the menu.
 */
export function linkExists(link: MenuLink | PlatformMenuLink, names: MenuNames): boolean {
  if (link.kind === "category" || link.kind === "tag") return names[link.kind].has(link.slug);
  if (link.kind === "page" && "slug" in link) return names.page?.has(link.slug) ?? false;
  if (link.kind === "article" && "slug" in link) return names.article?.has(link.slug) ?? false;
  if (link.kind === "blogCategory") return names.blogCategory?.has(link.slug) ?? false;
  return true;
}

// ---------------------------------------------------------------------------
// Kaizen's own header and footer (D42)
// ---------------------------------------------------------------------------

/** Where a link in Kaizen's own menus can go. */
export const PLATFORM_LINK_KINDS = ["home", "page", "category", "tag", "blog", "article", "blogCategory", "signUp", "signIn", "url"] as const;
export type PlatformLinkKind = (typeof PLATFORM_LINK_KINDS)[number];

export type PlatformMenuLink =
  | { kind: "home" }
  | { kind: "signUp" }
  | { kind: "signIn" }
  /** One of Kaizen's pages, by id, so it follows the page to a new address. */
  | { kind: "page"; pageId: string }
  /** Kaizen's pages in a category or with a tag (D50), by its address. */
  | TermLink
  /** The blog, one of its articles by id, or its articles in a category (D57). */
  | BlogLink
  | { kind: "article"; pageId: string }
  | { kind: "url"; url: string };

export type PlatformMenuItem = { label: Record<string, string>; link: PlatformMenuLink };

export type PlatformNavigation = StoreNavigation;

export const EMPTY_PLATFORM_NAVIGATION: PlatformNavigation = EMPTY_NAVIGATION;

/** Any menu link, store or platform: what the shared menu editor works with. */
export type AnyMenuLink = MenuLink | PlatformMenuLink;
export type AnyLinkKind = AnyMenuLink["kind"];
export type AnyMenuItem = { label: Record<string, string>; link: AnyMenuLink };

const platformLink = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("home") }),
  z.object({ kind: z.literal("signUp") }),
  z.object({ kind: z.literal("signIn") }),
  z.object({ kind: z.literal("page"), pageId: z.uuid("Choose a page for each page link.") }),
  z.object({ kind: z.literal("category"), slug: termSlug("category") }),
  z.object({ kind: z.literal("tag"), slug: termSlug("tag") }),
  z.object({ kind: z.literal("blog") }),
  z.object({ kind: z.literal("article"), pageId: z.uuid("Choose an article for each article link.") }),
  z.object({ kind: z.literal("blogCategory"), slug: termSlug("category") }),
  z.object({
    kind: z.literal("url"),
    url: z.string().trim().max(1000).refine(isMenuAddress, "A menu link has an invalid web address."),
  }),
]);

const platformItem = z.object({ label, link: platformLink });

/** Kaizen's menu as the editor saves it. */
export const platformMenuInput = z.object({ name: menuName, items: itemsSchema(platformItem.extend(placing)) });

export const platformNavigationSchema = navigationSchema;
export const parsePlatformNavigation = parseNavigation;

// ---------------------------------------------------------------------------
// Menus (D85)
// ---------------------------------------------------------------------------

/** An item in a menu: its link and texts, how deep it sits under the items before it, and whether it opens a new tab. */
type Placing = { depth: number; newTab?: boolean; mega?: MegaMenu; image?: MenuPicture };
export type MenuEntry = MenuItem & Placing;
export type PlatformMenuEntry = PlatformMenuItem & Placing;
export type AnyMenuEntry = AnyMenuItem & Placing;

/** A menu: a store's (`MenuEntry`) or Kaizen's (`PlatformMenuEntry`). */
export type Menu<E extends AnyMenuEntry = MenuEntry> = { id: string; name: string; items: E[] };
export type PlatformMenu = Menu<PlatformMenuEntry>;

/** Depths made sound: the first at the top, none more than one deeper than the one before, none too deep. */
export function soundDepths<E extends { depth: number }>(items: E[]): E[] {
  let before = -1;
  return items.map((it) => {
    const depth = Math.max(0, Math.min(it.depth, before + 1, MENU_MAX_DEPTH));
    before = depth;
    return depth === it.depth ? it : { ...it, depth };
  });
}

/** Stored items, each checked on its own: one that is damaged is left out, and depths made sound. */
function parseItems<E extends { depth: number }>(value: unknown, entry: z.ZodType<E>): E[] {
  if (!Array.isArray(value)) return [];
  return soundDepths(value.slice(0, MENU_MAX_ITEMS).flatMap((raw) => {
    const parsed = entry.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  }));
}

const stored = {
  depth: z.number().int().min(0).catch(0),
  newTab: z.boolean().optional().catch(undefined),
  mega: megaSchema.optional().catch(undefined),
  image: pictureSchema.optional().catch(undefined),
};
const storeEntry = item.extend(stored);
const platformEntry = platformItem.extend(stored);

/** A store's stored menu items. */
export const parseMenuItems = (value: unknown): MenuEntry[] => parseItems(value, storeEntry);
/** Kaizen's stored menu items. */
export const parsePlatformMenuItems = (value: unknown): PlatformMenuEntry[] => parseItems(value, platformEntry);

/** An item with the items under it. */
export type MenuNode<E> = { item: E; children: MenuNode<E>[] };

/**
 * The items as a tree. `keep` leaves an item out (a page no longer
 * published); the items under it take its place.
 */
export function menuTree<E extends { depth: number }>(items: E[], keep: (item: E) => boolean = () => true): MenuNode<E>[] {
  const roots: MenuNode<E>[] = [];
  // The open nodes by depth: where the next item's parent is.
  const open: (MenuNode<E> | null)[] = [];
  for (const item of items) {
    open.length = item.depth;
    const node: MenuNode<E> = { item, children: [] };
    let parent: MenuNode<E> | null = null;
    for (let d = item.depth - 1; d >= 0 && !parent; d--) parent = open[d] ?? null;
    if (keep(item)) (parent ? parent.children : roots).push(node);
    open[item.depth] = keep(item) ? node : parent;
  }
  return roots;
}

/** A published page as the menus know it. */
export type MenuPage = { id: string; slug: string; title: string };

/**
 * Where a link in Kaizen's menus goes and what it says, or null for a page
 * that is not published (then the link is left out until it is).
 */
export function platformMenuLink(
  item: PlatformMenuItem,
  pages: ReadonlyMap<string, MenuPage>,
  builtIn: { home: string; signUp: string; signIn: string; blog?: string },
  terms: TermNames = { category: new Map(), tag: new Map() },
  /** Kaizen's published articles by id, and its blog categories' names by address (D57). */
  blog: { articles: ReadonlyMap<string, MenuPage>; categories: ReadonlyMap<string, string> } = {
    articles: new Map(),
    categories: new Map(),
  },
): { href: string; text: string; external: boolean } | null {
  const own = item.label.en || Object.values(item.label).find(Boolean) || "";
  switch (item.link.kind) {
    case "home":
      return { href: "/", text: own || builtIn.home, external: false };
    case "signUp":
      return { href: "/sign-up", text: own || builtIn.signUp, external: false };
    case "signIn":
      return { href: "/admin", text: own || builtIn.signIn, external: false };
    case "page": {
      const page = pages.get(item.link.pageId);
      return page ? { href: `/${page.slug}`, text: own || page.title, external: false } : null;
    }
    case "category":
    case "tag": {
      // A category or tag that is gone is left out.
      const name = terms[item.link.kind].get(item.link.slug);
      return name ? { href: `/${item.link.kind}/${item.link.slug}`, text: own || name, external: false } : null;
    }
    case "blog":
      return { href: "/blog", text: own || builtIn.blog || "Blog", external: false };
    case "article": {
      const article = blog.articles.get(item.link.pageId);
      return article ? { href: `/blog/${article.slug}`, text: own || article.title, external: false } : null;
    }
    case "blogCategory": {
      const name = blog.categories.get(item.link.slug);
      return name ? { href: `/blog/category/${item.link.slug}`, text: own || name, external: false } : null;
    }
    case "url":
      return own ? { href: item.link.url, text: own, external: !item.link.url.startsWith("/") && !item.link.url.startsWith("#") } : null;
  }
}

/** Who runs Kaizen, as the law asks every web service to say (ehandelsloven § 8). */
export type BusinessDetails = {
  legalName: string;
  organisationNumber: string;
  postalAddress: string;
  contactEmail: string;
};

export const businessDetailsSchema = z.object({
  legalName: z.string().trim().max(200, "Keep the company name under 200 characters."),
  organisationNumber: z.string().trim().max(40, "Keep the organisation number under 40 characters."),
  postalAddress: z.string().trim().max(300, "Keep the address under 300 characters."),
  contactEmail: z.union([z.literal(""), z.email("The contact email is not a valid address.").max(200)]),
});

export const EMPTY_BUSINESS: BusinessDetails = { legalName: "", organisationNumber: "", postalAddress: "", contactEmail: "" };

export function parseBusinessDetails(value: unknown): BusinessDetails {
  const parsed = businessDetailsSchema.safeParse({ ...EMPTY_BUSINESS, ...(typeof value === "object" && value) });
  return parsed.success ? parsed.data : EMPTY_BUSINESS;
}
