import { z } from "zod";

/**
 * A store's header and footer (D30): its logo and two menus the owner
 * edits. Kept on the store as one JSON value, loaded with the store, so
 * pages need no extra query. Shared by the admin editor and the storefront.
 */

export const MENU_LIMITS = { header: 8, footer: 12 } as const;
export type MenuName = keyof typeof MENU_LIMITS;
export const LABEL_MAX = 60;

export const LINK_KINDS = ["home", "page", "product", "category", "tag", "account", "cart", "url"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export type MenuLink =
  | { kind: "home" }
  | { kind: "account" }
  | { kind: "cart" }
  | { kind: "product"; handle: string }
  /** One of the store's pages (D54), by its address, which a store copied from the template keeps. */
  | StorePageLink
  /** A category's or tag's products (D50), by its address, which a store copied from the template keeps. */
  | TermLink
  | { kind: "url"; url: string };

/** A link to one of a store's pages (D54). */
export type StorePageLink = { kind: "page"; slug: string };

/** A link to a category or tag (D50), in a store's menus or Kaizen's. */
export type TermLink = { kind: "category" | "tag"; slug: string };

/** A menu item: its text in each of the store's languages, and where it goes. */
export type MenuItem = { label: Record<string, string>; link: MenuLink };

export type Logo = { url: string; width: number; height: number };

export type StoreNavigation = { logo: Logo | null; header: MenuItem[]; footer: MenuItem[] };

export const EMPTY_NAVIGATION: StoreNavigation = { logo: null, header: [], footer: [] };

/**
 * A menu's web address: http(s), or a path in the store (`/p/notatbok`,
 * relative to the shopper's country). Nothing else, so no `javascript:`.
 */
export function isMenuAddress(value: string): boolean {
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
  z.object({
    kind: z.literal("url"),
    url: z.string().trim().max(1000).refine(isMenuAddress, "A menu link has an invalid web address."),
  }),
]);

const item = z.object({ label, link });

export const navigationSchema = z.object({
  logo: z
    .object({
      url: z.string().trim().max(1000).refine(isMenuAddress, "The logo has an invalid address."),
      width: z.number().int().min(1).max(10_000),
      height: z.number().int().min(1).max(10_000),
    })
    .nullable(),
  header: z.array(item).max(MENU_LIMITS.header, `The header menu takes at most ${MENU_LIMITS.header} links.`),
  footer: z.array(item).max(MENU_LIMITS.footer, `The footer menu takes at most ${MENU_LIMITS.footer} links.`),
});

/** The stored value, or an empty header and footer if it is missing or damaged. */
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
    case "account":
      return { href: `${base}/account`, external: false };
    case "cart":
      return { href: `${base}/cart`, external: false };
    case "product":
      return { href: `${base}/p/${encodeURIComponent(link.handle)}`, external: false };
    case "category":
    case "tag":
      return { href: `${base}/${link.kind}/${link.slug}`, external: false };
    case "url":
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
  builtIn: { home: string; account: string; cart: string },
  /** Page titles, category and tag names by address, for links without a text of their own. */
  termNames?: MenuNames,
): string {
  const own = item.label[locale];
  if (own) return own;
  if (item.link.kind === "home" || item.link.kind === "account" || item.link.kind === "cart") {
    return builtIn[item.link.kind];
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

/** Names for menu links without a text of their own; a store's also has its pages. */
export type MenuNames = TermNames & { page?: PageNames };

/**
 * Whether a link still leads somewhere: a category or tag that is gone, or a
 * store page that is not published, is left out of the menu.
 */
export function linkExists(link: MenuLink | PlatformMenuLink, names: MenuNames): boolean {
  if (link.kind === "category" || link.kind === "tag") return names[link.kind].has(link.slug);
  if (link.kind === "page" && "slug" in link) return names.page?.has(link.slug) ?? false;
  return true;
}

// ---------------------------------------------------------------------------
// Kaizen's own header and footer (D42)
// ---------------------------------------------------------------------------

/** Where a link in Kaizen's own menus can go. */
export const PLATFORM_LINK_KINDS = ["home", "page", "category", "tag", "signUp", "signIn", "url"] as const;
export type PlatformLinkKind = (typeof PLATFORM_LINK_KINDS)[number];

export type PlatformMenuLink =
  | { kind: "home" }
  | { kind: "signUp" }
  | { kind: "signIn" }
  /** One of Kaizen's pages, by id, so it follows the page to a new address. */
  | { kind: "page"; pageId: string }
  /** Kaizen's pages in a category or with a tag (D50), by its address. */
  | TermLink
  | { kind: "url"; url: string };

export type PlatformMenuItem = { label: Record<string, string>; link: PlatformMenuLink };

export type PlatformNavigation = { logo: Logo | null; header: PlatformMenuItem[]; footer: PlatformMenuItem[] };

export const EMPTY_PLATFORM_NAVIGATION: PlatformNavigation = { logo: null, header: [], footer: [] };

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
  z.object({
    kind: z.literal("url"),
    url: z.string().trim().max(1000).refine(isMenuAddress, "A menu link has an invalid web address."),
  }),
]);

const platformItem = z.object({ label, link: platformLink });

export const platformNavigationSchema = navigationSchema.extend({
  header: z.array(platformItem).max(MENU_LIMITS.header, `The header menu takes at most ${MENU_LIMITS.header} links.`),
  footer: z.array(platformItem).max(MENU_LIMITS.footer, `The footer menu takes at most ${MENU_LIMITS.footer} links.`),
});

export function parsePlatformNavigation(value: unknown): PlatformNavigation {
  const parsed = platformNavigationSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_PLATFORM_NAVIGATION;
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
  builtIn: { home: string; signUp: string; signIn: string },
  terms: TermNames = { category: new Map(), tag: new Map() },
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
    case "url":
      return own ? { href: item.link.url, text: own, external: !item.link.url.startsWith("/") } : null;
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
