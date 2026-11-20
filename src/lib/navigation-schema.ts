import { z } from "zod";

import {
  type BusinessDetails,
  EMPTY_BUSINESS,
  EMPTY_NAVIGATION,
  LABEL_MAX,
  MEGA_MAX_COLUMNS,
  MENU_MAX_DEPTH,
  MENU_MAX_ITEMS,
  MENU_NAME_MAX,
  type MenuEntry,
  type PlatformMenuEntry,
  type StoreNavigation,
  isMenuAddress,
  soundDepths,
} from "./navigation";

/**
 * Menus, the logo and the business details as they are checked and read (D29, bloat review step 2.46): the menus' and the
 * navigation's schemas and the readers built on them, apart from the link kinds, labels and helpers in navigation.ts, so a screen
 * that only draws or words a link loads no zod. Import this file only where a schema runs.
 */

function termSlug(kind: "category" | "tag") {
  return z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, `Choose a ${kind} for each ${kind} link.`)
    .max(80);
}

const label = z.record(z.string(), z.string().trim().max(LABEL_MAX, `Keep menu texts under ${LABEL_MAX} characters.`));

/** A store's menu link as the editor saves it; a custom grid item's link (D155) is the same shape. */
export const menuLinkSchema = z.discriminatedUnion("kind", [
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
      // A page's address may be nested (`projects/project-a`).
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/, "Choose a page for each page link.")
      .max(240),
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

const link = menuLinkSchema;
const item = z.object({ label, link });

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

/** A link in one of Kaizena Flow's own menus as the editor saves it: its pages and articles by id. */
export const platformMenuLinkSchema = z.discriminatedUnion("kind", [
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

const platformItem = z.object({ label, link: platformMenuLinkSchema });

/** Kaizen's menu as the editor saves it. */
export const platformMenuInput = z.object({ name: menuName, items: itemsSchema(platformItem.extend(placing)) });

export const platformNavigationSchema = navigationSchema;
export const parsePlatformNavigation = parseNavigation;

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

export const businessDetailsSchema = z.object({
  legalName: z.string().trim().max(200, "Keep the company name under 200 characters."),
  organisationNumber: z.string().trim().max(40, "Keep the organisation number under 40 characters."),
  postalAddress: z.string().trim().max(300, "Keep the address under 300 characters."),
  contactEmail: z.union([z.literal(""), z.email("The contact email is not a valid address.").max(200)]),
});

export function parseBusinessDetails(value: unknown): BusinessDetails {
  const parsed = businessDetailsSchema.safeParse({ ...EMPTY_BUSINESS, ...(typeof value === "object" && value) });
  return parsed.success ? parsed.data : EMPTY_BUSINESS;
}
