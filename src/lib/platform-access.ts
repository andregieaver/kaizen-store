import type { RoleTemplateKey } from "./permissions";
import { PLATFORM_BASE, PLATFORM_NAV_AREAS } from "./platform-nav";

/**
 * Roles on the platform's team (C1 of `docs/platform-parity-plan.md`, D510): who may do what in the platform admin. Pure.
 *
 * - `owner` is a platform admin as before D510 (`accounts.platform_admin`): everything, the team, the AI manager, an owner of Kaizena
 *   Flow's own store.
 * - The others (`accounts.platform_role`) read every page of the platform admin and change only their own area: `support` the support
 *   desk, the chat assistant and the stores and their requests; `content` Kaizena Flow's website and themes; `finance` the plans, their
 *   prices, discounts, referrals and reminders; `read_only` nothing. Settings, the team and the AI manager are the owners'.
 * - In Kaizena Flow's own store each is an admin in the store role of the same work (`HOUSE_ROLE_TEMPLATE`).
 *
 * A guard names its area in code (`requirePlatform(area)`), never from the address a request came to: a server action can be posted to any
 * page's address.
 */

export const PLATFORM_ROLES = ["owner", "support", "content", "finance", "read_only"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export const isPlatformRole = (value: unknown): value is PlatformRole => (PLATFORM_ROLES as readonly unknown[]).includes(value);

/** The roles a platform admin gives that are not owner (kept in `accounts.platform_role`). */
export const MEMBER_ROLES = ["support", "content", "finance", "read_only"] as const satisfies readonly PlatformRole[];
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const isMemberRole = (value: unknown): value is MemberRole => (MEMBER_ROLES as readonly unknown[]).includes(value);

export const PLATFORM_AREAS = ["home", "website", "stores", "plans", "support", "settings"] as const;
export type PlatformArea = (typeof PLATFORM_AREAS)[number];
export type PlatformAccess = "read" | "write";

/** What each role changes; every role reads everything. */
export const ROLE_WRITES: Record<PlatformRole, readonly PlatformArea[]> = {
  owner: PLATFORM_AREAS,
  support: ["support", "stores"],
  content: ["website"],
  finance: ["plans"],
  read_only: [],
};

/** The store role a member holds in Kaizena Flow's own store, from the store's starting roles (`ROLE_TEMPLATES`). */
export const HOUSE_ROLE_TEMPLATE: Record<MemberRole, RoleTemplateKey> = {
  support: "support",
  content: "content",
  finance: "analytics",
  read_only: "read_only",
};

/** A person's role on the platform's team, or none: an owner by `platform_admin`, else the role kept for them. */
export function platformRoleOf(account: { platformAdmin?: boolean; platformRole?: string | null } | null | undefined): PlatformRole | null {
  if (!account) return null;
  if (account.platformAdmin) return "owner";
  return isMemberRole(account.platformRole) ? account.platformRole : null;
}

/** Whether a role may read or change an area. None for someone not on the team. */
export function canPlatform(role: PlatformRole | null, area: PlatformArea, access: PlatformAccess = "write"): boolean {
  if (role === null) return false;
  if (access === "read") return true;
  return ROLE_WRITES[role].includes(area);
}

/**
 * An address of the platform's navigation with the area of the page there (D851), as `platformNavAreas()` lists them from the one structure
 * of the navigation (`PLATFORM_SECTIONS`, D877).
 */
export type PlatformNavArea = { path: string; area: PlatformArea };

/**
 * The area of a platform address (after `/admin/platform`, or the whole address) among these navigation addresses: Home's for Home, else the
 * area of the longest address it is or is inside, else the owners' (`settings`).
 */
export function platformAreaIn(areas: readonly PlatformNavArea[], path: string): PlatformArea {
  const p = path.startsWith(PLATFORM_BASE) ? path.slice(PLATFORM_BASE.length) : path;
  const clean = p === "" || p === "/" ? "" : `/${p.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  if (clean === "") return "home";
  let best: PlatformNavArea | undefined;
  for (const entry of areas) {
    if ((clean === entry.path || clean.startsWith(`${entry.path}/`)) && (!best || entry.path.length > best.path.length)) best = entry;
  }
  return best?.area ?? "settings";
}

/**
 * The area of a platform page by its address (after `/admin/platform`, or the whole address): the one its navigation entry names (D851),
 * never the tab or section it sits under. What the page's notice says and what the scan test holds each guard to. An address in no entry
 * is the owners' (`settings`); a page folder in none fails `platform-nav.test.ts` (D877).
 */
export const platformAreaOfPath = (path: string): PlatformArea => platformAreaIn(PLATFORM_NAV_AREAS, path);
