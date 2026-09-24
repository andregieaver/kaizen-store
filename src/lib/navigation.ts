import { z } from "zod";

/**
 * A store's header and footer (D30): its logo and two menus the owner
 * edits. Kept on the store as one JSON value, loaded with the store, so
 * pages need no extra query. Shared by the admin editor and the storefront.
 */

export const MENU_LIMITS = { header: 8, footer: 12 } as const;
export type MenuName = keyof typeof MENU_LIMITS;
export const LABEL_MAX = 60;

export const LINK_KINDS = ["home", "product", "account", "cart", "url"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export type MenuLink =
  | { kind: "home" }
  | { kind: "account" }
  | { kind: "cart" }
  | { kind: "product"; handle: string }
  | { kind: "url"; url: string };

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

const label = z.record(z.string(), z.string().trim().max(LABEL_MAX, `Keep menu texts under ${LABEL_MAX} characters.`));

const link = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("home") }),
  z.object({ kind: z.literal("account") }),
  z.object({ kind: z.literal("cart") }),
  z.object({ kind: z.literal("product"), handle: z.string().trim().min(1, "Choose a product for each product link.").max(200) }),
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
export function menuHref(link: MenuLink, base: string): { href: string; external: boolean } {
  switch (link.kind) {
    case "home":
      return { href: base, external: false };
    case "account":
      return { href: `${base}/account`, external: false };
    case "cart":
      return { href: `${base}/cart`, external: false };
    case "product":
      return { href: `${base}/p/${encodeURIComponent(link.handle)}`, external: false };
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
): string {
  const own = item.label[locale];
  if (own) return own;
  if (item.link.kind === "home" || item.link.kind === "account" || item.link.kind === "cart") {
    return builtIn[item.link.kind];
  }
  return Object.values(item.label).find(Boolean) ?? "";
}
