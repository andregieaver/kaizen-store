/**
 * What a member of a store may do (wave 1, 1f, `docs/wave-1-trust.md` 2.7 and 4.6). Pure: the keys are in
 * `permission-keys.ts`, the rules are `can()`, and `permissionOfPath()` says which key a page or an action needs, from
 * its place in the store navigation, so a page can never be forgotten here: a test fails when a store page has no area.
 *
 * - `owner` holds everything. `admin` with no custom role holds `ADMIN_DEFAULT`, which is what an admin could do before
 *   there were roles. An `admin` with a custom role (`store_roles`) holds that role's keys.
 * - `write` includes `read`.
 * - `owner`, `staff:write` and `billing:write` are held by the owner role only: a custom role cannot contain them, so a
 *   role can never grant the power to invite people, change roles or change the plan.
 * - A collaborator (an agency's account with an expiry) never holds `staff:*`, `billing:*` or `owner`, whatever the role.
 */
import { ADMIN_PAGES, matchPath } from "./admin-map";
import type { PageType } from "./page-content";
import {
  ADMIN_DEFAULT,
  AREAS,
  GRANTABLE_PERMISSIONS,
  OWNER_HELD,
  isGrantable,
  type Access,
  type Area,
  type AreaPermission,
  type PermissionKey,
} from "./permission-keys";
import { sectionOf } from "./store-nav";

export * from "./permission-keys";

/** What the guards and the navigation need to know about a member. */
export type PermissionHolder = {
  role: "owner" | "admin";
  /** `collaborator`: an agency's account with an expiry; the default is `staff`. */
  kind?: "staff" | "collaborator";
  /** The keys of the custom role the member holds; null or undefined: no custom role, so the default admin set. */
  permissions?: readonly string[] | null;
};

/** The keys in canonical order, each `write` with its `read`, only the grantable ones: what a custom role may hold. */
export function normalisePermissions(keys: readonly string[]): AreaPermission[] {
  const wanted = new Set<string>();
  for (const key of keys) {
    if (!isGrantable(key)) continue;
    wanted.add(key);
    if (key.endsWith(":write")) wanted.add(key.replace(/:write$/, ":read"));
  }
  return GRANTABLE_PERMISSIONS.filter((key) => wanted.has(key));
}

/** The keys a holder has: for an owner everything, for an admin the default or the custom role's, without what only owners hold. */
export function permissionsOf(holder: PermissionHolder): PermissionKey[] {
  if (holder.role === "owner") return [...GRANTABLE_PERMISSIONS, ...OWNER_HELD];
  const base: readonly string[] = holder.permissions == null ? ADMIN_DEFAULT : holder.permissions;
  // Write implies read, and what only an owner holds is never granted, whatever a stored role says.
  const held = new Set<string>();
  for (const key of base) {
    if (OWNER_HELD.includes(key as PermissionKey)) continue;
    if (!/^(orders|products|customers|marketing|analytics|website|bookings|settings|billing|staff):(read|write)$/.test(key)) continue;
    held.add(key);
    if (key.endsWith(":write")) held.add(key.replace(/:write$/, ":read"));
  }
  if (holder.kind === "collaborator") {
    for (const key of [...held]) if (key.startsWith("staff:") || key.startsWith("billing:")) held.delete(key);
  }
  return [...GRANTABLE_PERMISSIONS, ...OWNER_HELD].filter((key) => held.has(key));
}

/** Whether the holder has the key. `write` includes `read`; `owner` is the owner role's alone. */
export function can(holder: PermissionHolder, key: PermissionKey): boolean {
  if (holder.role === "owner") return true;
  if (key === "owner") return false;
  return permissionsOf(holder).includes(key);
}

// ---------------------------------------------------------------------------
// Which key a page or action needs
// ---------------------------------------------------------------------------

/** Pages that belong to an area other than their navigation section's: the Team and Billing pages live in the Settings sidebar. */
const AREA_OVERRIDES: { path: string; area: Area }[] = [
  { path: "/staff", area: "staff" },
  { path: "/billing", area: "billing" },
];

/** The area of a page after the store's address (`/orders/[orderId]`, `/settings/shipping`), or null for Home's pages (membership only). */
export function areaOfPath(path: string): Area | null {
  const clean = path === "" ? "" : `/${path.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  for (const override of AREA_OVERRIDES) {
    if (clean === override.path || clean.startsWith(`${override.path}/`)) return override.area;
  }
  const section = sectionOf(clean);
  return section ? section.key : null;
}

/**
 * The key a store page or action needs, from its address after the store's: the page's area with `read` (or `write` for
 * an action or a mutating route), `owner` for a page marked `needs: "owner"` in `ADMIN_PAGES`, and null for Home's pages
 * (membership only). The address may hold `[param]`s or real values.
 */
export function permissionOfPath(path: string, access: Access = "read"): PermissionKey | null {
  const clean = path === "" ? "" : `/${path.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  const matched = matchPath(`/admin/_store${clean}`);
  if (matched && matched.page.area === "store" && matched.page.needs === "owner") return "owner";
  // The activity log is membership only: what a member sees in it is narrowed by their readable areas, not by a key for the page.
  if (matched && matched.page.area === "store" && (MEMBERSHIP_ONLY_PAGE_IDS as readonly string[]).includes(matched.page.id)) return null;
  const area = areaOfPath(clean);
  return area ? (`${area}:${access}` as AreaPermission) : null;
}

/** Every store page's required key, for the tests that hold the table to the baseline and for the navigation. */
export function storePageKeys(access: Access = "read"): { id: string; path: string; key: PermissionKey | null }[] {
  return ADMIN_PAGES.filter((page) => page.area === "store").map((page) => ({
    id: page.id,
    path: page.path,
    key: page.needs === "owner" ? ("owner" as const) : permissionOfPath(page.path, access),
  }));
}

/** The pages of the store admin that need no area (Home, the setup wizard and the activity log): membership is enough. */
export const MEMBERSHIP_ONLY_PAGE_IDS = ["overview", "setup", "setup.step", "activity"] as const;

/** Whether a holder may open a page at this address after the store's: the navigation offers only these (a page they cannot open would be a 404). */
export function canOpenPath(holder: PermissionHolder, path: string): boolean {
  const key = permissionOfPath(path, "read");
  return key === null || can(holder, key);
}

/**
 * The area each kind of page is edited in: the page builder serves them all, but each kind has its own place in the store navigation, so its
 * own key (a Products role edits product layouts, not the website's pages; an A/B test's versions are edited from the test, under Marketing).
 */
export const PAGE_TYPE_AREA: Record<PageType, Area> = {
  page: "website",
  article: "website",
  header: "website",
  footer: "website",
  product_layout: "products",
  variant: "marketing",
};

/** The key for working on a kind of page (`read`: see it, `write`: change it), or null when the kind is not one. */
export function pageTypeKey(type: unknown, access: Access): AreaPermission | null {
  const area = typeof type === "string" && Object.hasOwn(PAGE_TYPE_AREA, type) ? PAGE_TYPE_AREA[type as PageType] : null;
  return area ? (`${area}:${access}` as AreaPermission) : null;
}

/**
 * The areas whose members work in the page builder, and so may use what it calls on the side (saved rows and components, the library of
 * templates, pictures, a preview of a grid): website pages, product layouts and the versions of an A/B test. A support action asks for the
 * key of any of them (`checkAnyPermission()`), never a key of another area.
 */
export const BUILDER_AREAS: readonly Area[] = ["website", "products", "marketing"];
export const BUILDER_READ: readonly AreaPermission[] = BUILDER_AREAS.map((area) => `${area}:read` as const);
export const BUILDER_WRITE: readonly AreaPermission[] = BUILDER_AREAS.map((area) => `${area}:write` as const);

export const AREA_LABELS: Record<Area, string> = {
  orders: "Orders",
  products: "Products",
  customers: "Customers",
  marketing: "Marketing",
  analytics: "Analytics",
  website: "Website",
  bookings: "Bookings",
  settings: "Settings",
  billing: "Billing",
  staff: "Team",
};

/** What a role gives in an area, for the role editor: no access, can view, can change. */
export type AreaLevel = "none" | "read" | "write";

export function levelIn(keys: readonly string[], area: Area): AreaLevel {
  if (keys.includes(`${area}:write`)) return "write";
  if (keys.includes(`${area}:read`)) return "read";
  return "none";
}

/** The keys a role editor's choices make: one level per area, normalised (a `write` with its `read`, nothing ungrantable). */
export function permissionsFromLevels(levels: Partial<Record<Area, AreaLevel>>): AreaPermission[] {
  const keys: string[] = [];
  for (const area of AREAS) {
    const level = levels[area] ?? "none";
    if (level === "read") keys.push(`${area}:read`);
    if (level === "write") keys.push(`${area}:write`);
  }
  return normalisePermissions(keys);
}

// ---------------------------------------------------------------------------
// Role templates and collaborators
// ---------------------------------------------------------------------------

export const ROLE_TEMPLATE_KEYS = ["orders", "products", "marketing", "content", "analytics", "read_only"] as const;
export type RoleTemplateKey = (typeof ROLE_TEMPLATE_KEYS)[number];

/** The roles `ensureStoreRoles()` offers a store on first visit; the owner can edit or delete them. Already normalised. */
export const ROLE_TEMPLATES: Record<RoleTemplateKey, { name: string; description: string; permissions: AreaPermission[] }> = {
  orders: {
    name: "Orders",
    description: "Handles orders and returns, and can look up customers and products.",
    permissions: normalisePermissions(["orders:write", "customers:read", "products:read", "bookings:read"]),
  },
  products: {
    name: "Products",
    description: "Keeps the catalogue: products, prices, stock and layouts.",
    permissions: normalisePermissions(["products:write"]),
  },
  marketing: {
    name: "Marketing",
    description: "Runs campaigns, coupons, tests and emails, and reads the figures.",
    permissions: normalisePermissions(["marketing:write", "analytics:read", "products:read", "customers:read"]),
  },
  content: {
    name: "Content",
    description: "Writes and designs the site: pages, blog, menus, pictures and translations.",
    permissions: normalisePermissions(["website:write", "products:read"]),
  },
  analytics: {
    name: "Analytics",
    description: "Reads the figures and what lies behind them.",
    permissions: normalisePermissions(["analytics:write", "orders:read", "products:read", "customers:read", "marketing:read"]),
  },
  read_only: {
    name: "Read-only",
    description: "Can look at everything except billing and the team, and change nothing.",
    permissions: normalisePermissions(["orders:read", "products:read", "customers:read", "marketing:read", "analytics:read", "website:read", "bookings:read", "settings:read"]),
  },
};

/** A collaborator's access lasts 1 to 365 days; 30 unless the owner chooses. */
export const COLLABORATOR_DAYS = { min: 1, max: 365, default: 30 } as const;

/** The days a collaborator invitation asks for, held to the limits (a whole number); null when it is not one. */
export function collaboratorDays(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  return n >= COLLABORATOR_DAYS.min && n <= COLLABORATOR_DAYS.max ? n : null;
}

/** When a collaborator's access ends: `days` whole days after `now`. */
export const collaboratorExpiry = (now: Date, days: number): Date => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

/** Whether a member's access has ended by `now` (`expires_at <= now`); a member with no expiry never does. */
export const accessEnded = (expiresAt: Date | null | undefined, now: Date): boolean => expiresAt != null && expiresAt.getTime() <= now.getTime();
