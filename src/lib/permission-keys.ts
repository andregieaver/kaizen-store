/**
 * The permission keys of a store's staff (wave 1, 1f, `docs/wave-1-trust.md` 4.6), as constants only: the keys, the
 * ones a custom role may hold and the ones only an owner holds. `src/lib/permissions.ts` builds the rules on them.
 *
 * No imports: `src/db/schema.ts` reads this file for the check on `store_roles.permissions`, and drizzle-kit loads it
 * without the app's path aliases.
 */

/** The areas of a store's admin, the store navigation's sections (D147) plus `billing` and `staff`, which live in the Settings sidebar. */
export const AREAS = ["orders", "products", "customers", "marketing", "analytics", "website", "bookings", "settings", "billing", "staff"] as const;
export type Area = (typeof AREAS)[number];

/** The areas that are working areas: what an admin can do in without being the owner. */
export const WORKING_AREAS = ["orders", "products", "customers", "marketing", "analytics", "website", "bookings", "settings"] as const satisfies readonly Area[];

export type Access = "read" | "write";
export type AreaPermission = `${Area}:${Access}`;
/** `owner` is the one key only the owner role holds (pages marked `needs: "owner"` and every action that checks the role). */
export type PermissionKey = AreaPermission | "owner";

export const AREA_PERMISSIONS: readonly AreaPermission[] = AREAS.flatMap((area) => [`${area}:read`, `${area}:write`] as const);
/** All 21 keys. */
export const PERMISSION_KEYS: readonly PermissionKey[] = [...AREA_PERMISSIONS, "owner"];

/** Held by owners only in this wave: a role must not be able to grant the power to change roles, the plan or what only the owner may. */
export const OWNER_HELD: readonly PermissionKey[] = ["owner", "staff:write", "billing:write"];

/** The 18 keys a custom role may contain. */
export const GRANTABLE_PERMISSIONS: readonly AreaPermission[] = AREA_PERMISSIONS.filter((key) => !(OWNER_HELD as readonly string[]).includes(key));

/** What an `admin` with no custom role can do: every `read` and `write` of the working areas, and to see the team and the plan. */
export const ADMIN_DEFAULT: readonly AreaPermission[] = [
  ...WORKING_AREAS.flatMap((area) => [`${area}:read`, `${area}:write`] as const),
  "staff:read",
  "billing:read",
];

export const isPermissionKey = (value: unknown): value is PermissionKey => (PERMISSION_KEYS as readonly unknown[]).includes(value);
export const isGrantable = (value: unknown): value is AreaPermission => (GRANTABLE_PERMISSIONS as readonly unknown[]).includes(value);
