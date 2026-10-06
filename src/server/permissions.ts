import "server-only";

import { notFound } from "next/navigation";

import { can, pageTypeKey, type Access, type PermissionKey } from "@/lib/permissions";
import { allowedWhenNotOpen } from "@/lib/store-closure";

import { getMembership, holderOf, requireMember, type Membership } from "./auth";

/**
 * Who may do what in a store's admin (wave 1, 1f, docs/wave-1-trust.md 2.7): the one place the rule lives. Every store admin
 * page, server action, route handler and helper asks one of these, with the key of its area (a page's is its place in the store
 * navigation, `permissionOfPath()`); `src/lib/permissions.scan.test.ts` fails when one does not. Nothing else compares a role
 * with `"owner"`: it asks for the `owner` key.
 *
 * - `requirePermission()` for a page or a route handler: signs in, sends a member held at their second step to set it up, and
 *   gives a 404 to anyone who is not a member or lacks the key (so a hidden page cannot be told from a missing one).
 * - `checkPermission()` for an action: the membership, or null, and the action answers with `NO_ACCESS`.
 * - `requireOwnerRole()` for what only the owner may do.
 * - `requireMemberAny()` for the pages that need membership only (Home, Your account, the activity log).
 */

/** An action's refusal when the member lacks the permission. */
export const NO_ACCESS = "You do not have access to this.";

/**
 * What a member may do, without a request: for the navigation, a page that shows a control only to those who can use it, and the checks below.
 * In a store that is not open (suspended or closed, D171) a member may only read and handle what already happened (`allowedWhenNotOpen()`), whatever
 * their role holds: this is the one place that rule is kept, so no page or action of a closed store can sell, publish or change the shop.
 */
export const memberCan = (member: Pick<Membership, "role" | "kind" | "permissions"> & { store?: { status?: string } }, key: PermissionKey): boolean => {
  if (member.store?.status && member.store.status !== "active" && !allowedWhenNotOpen(key)) return false;
  return can(holderOf(member), key);
};

/** For a page or a route handler: the membership when the member holds the key, else a redirect to sign in or the second step, or a 404. */
export async function requirePermission(storeSlug: string, key: PermissionKey): Promise<Membership> {
  const member = await requireMember(storeSlug);
  if (!memberCan(member, key)) notFound();
  return member;
}

/** For an action: the membership when the member holds the key, else null (not a member, held at their second step, or lacking the key). */
export async function checkPermission(storeSlug: string, key: PermissionKey): Promise<Membership | null> {
  const member = await getMembership(storeSlug);
  return member && memberCan(member, key) ? member : null;
}

/** For a page or a route handler that any of several keys opens (the page builder's side actions): the first the member holds, else a 404. */
export async function requireAnyPermission(storeSlug: string, keys: readonly PermissionKey[]): Promise<Membership> {
  const member = await requireMember(storeSlug);
  if (!keys.some((key) => memberCan(member, key))) notFound();
  return member;
}

/** For an action that any of several keys opens: the membership, or null. */
export async function checkAnyPermission(storeSlug: string, keys: readonly PermissionKey[]): Promise<Membership | null> {
  const member = await getMembership(storeSlug);
  return member && keys.some((key) => memberCan(member, key)) ? member : null;
}

/** For the views of the page builder's lists and editors: the key of the kind of page (`pageTypeKey()`), a 404 for a kind that is none. */
export async function requirePageTypeAccess(storeSlug: string, type: unknown, access: Access): Promise<Membership> {
  const key = pageTypeKey(type, access);
  if (!key) notFound();
  return requirePermission(storeSlug, key);
}

/** For the actions that change a page, a term or a layout of a kind: the membership when the member holds that kind's key, else null. */
export async function checkPageTypeAccess(storeSlug: string, type: unknown, access: Access): Promise<Membership | null> {
  const key = pageTypeKey(type, access);
  return key ? checkPermission(storeSlug, key) : null;
}

/** For what only the owner may do: payments, plans, the team, the rules of returns. */
export const requireOwnerRole = (storeSlug: string): Promise<Membership> => requirePermission(storeSlug, "owner");

/** The same as an action's check, for the owner only. */
export const checkOwnerRole = (storeSlug: string): Promise<Membership | null> => checkPermission(storeSlug, "owner");

/** For a page that any member of the store may open (Home, Your account, the activity log): membership only. */
export const requireMemberAny = (storeSlug: string): Promise<Membership> => requireMember(storeSlug);

/** The same for an action. */
export const checkMemberAny = (storeSlug: string): Promise<Membership | null> => getMembership(storeSlug);

// The guards the scan test accepts, and the wrappers that call one: pure data in `src/lib/permission-guards.ts`.
export { DELEGATED_GUARDS, GUARDS } from "@/lib/permission-guards";
