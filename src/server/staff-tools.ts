import "server-only";

import { can, ROLE_TEMPLATES } from "@/lib/permissions";

import { passMembership, type Account, type Membership } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import { memberCan } from "./permissions";
import { disableStaff, inviteStaff, listStaff, type StaffMember } from "./settings";
import { assignRole, ensureStoreRoles, inviteCollaborator, listStoreRoles, type RoleChoice } from "./store-roles";
import type { Store } from "./stores";
import { normaliseEmail, sameEmail } from "@/lib/email-address";

/**
 * The AI manager's team tools (PSI AGT-01; wave 1 1f, `docs/wave-1-trust.md` 2.7): who works in the store, and inviting, changing a role
 * and removing someone, each through the Staff page's own function (`inviteStaff()`, `inviteCollaborator()`, `assignRole()`,
 * `disableStaff()`), so its rules hold here: only an owner changes the team, one active owner always, a collaborator never an owner, the
 * staff places of the plan. The changes are gated (`access`): kept for the owner's yes, then run with the membership read again
 * (`passMembership()`), never the one the turn started with.
 */

type Ctx = { account: Account; store: Store };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const staffLink = (store: Store) => `/admin/${store.slug}/staff`;

/** The person's membership now; refused unless they may change the team (an owner). */
async function ownerMember(ctx: Ctx): Promise<Membership> {
  const member = await passMembership(ctx.store.slug, ctx.account.id);
  if (!member || !memberCan(member, "staff:write")) return fail("Only an owner of the store changes its team.");
  return member;
}

/** Whether a member holds the owner role (the permission rules decide, never a comparison of the role's name). */
const isOwner = (m: Pick<StaffMember, "role" | "kind">) => can({ role: m.role, kind: m.kind }, "owner");
const roleWords = (m: Pick<StaffMember, "role" | "kind" | "roleName">) => (isOwner(m) ? "owner" : m.roleName ? m.roleName : "admin (everything but the team and the plan)");

/** A role as the owner names it: owner, admin (the default set) or one of the store's roles by name (any case). */
async function roleChoice(store: Store, named: string): Promise<{ choice: RoleChoice; words: string }> {
  const wanted = named.trim().toLowerCase();
  if (wanted === "owner") return { choice: { kind: "owner" }, words: "owner" };
  if (wanted === "admin") return { choice: { kind: "admin" }, words: "admin" };
  await ensureStoreRoles(store.id);
  const roles = await listStoreRoles(store.id);
  const found = roles.find((r) => r.name.trim().toLowerCase() === wanted);
  if (found) return { choice: { kind: "role", roleId: found.id }, words: found.name };
  return fail(`There is no role "${named}". The store's roles: owner, admin, ${roles.map((r) => r.name).join(", ")}.`);
}

/** An active member by email (any case), or a refusal. */
async function activeMember(store: Store, email: string): Promise<StaffMember> {
  const wanted = normaliseEmail(email);
  const found = (await listStaff(store.id)).find((m) => !m.disabled && normaliseEmail(m.email) === wanted);
  return found ?? fail(`${email} does not work in this store. Look with list_staff.`);
}

/** `list_staff`: the team and the store's roles. Read-only; the Staff page is the owner's, so is this. */
export async function listStaffTool(ctx: Ctx) {
  await ensureStoreRoles(ctx.store.id);
  const [members, roles] = await Promise.all([listStaff(ctx.store.id), listStoreRoles(ctx.store.id)]);
  return {
    team: members
      .filter((m) => !m.disabled)
      .map((m) => ({
        email: m.email,
        name: m.name,
        role: roleWords(m),
        ...(m.kind === "collaborator" ? { collaborator_until: m.expiresAt?.slice(0, 10) ?? null } : {}),
        signed_in_yet: m.signedInBefore,
        two_step: m.hasTwoStep ? "on" : "not seen",
      })),
    roles: [
      { name: "owner", members: members.filter((m) => !m.disabled && isOwner(m)).length, holds: "everything, the team and the plan included" },
      { name: "admin", members: members.filter((m) => !m.disabled && !isOwner(m) && !m.roleId).length, holds: "everything but the team and the plan" },
      ...roles.map((r) => ({ name: r.name, members: r.members, holds: r.template ? ROLE_TEMPLATES[r.template].description : `${r.permissions.length} permissions` })),
    ],
    link: staffLink(ctx.store),
  };
}

type InviteInput = { email: string; role: string; collaborator_days?: number };

/** Checked before the owner is asked: who asks may change the team, the role exists, a collaborator is never an owner. */
export async function preflightInviteStaff(ctx: Ctx, input: InviteInput): Promise<void> {
  await ownerMember(ctx);
  const { choice } = await roleChoice(ctx.store, input.role);
  if (input.collaborator_days !== undefined && choice.kind === "owner") fail("A collaborator cannot be an owner.");
  const already = (await listStaff(ctx.store.id)).find((m) => !m.disabled && sameEmail(m.email, input.email));
  if (already) fail(`${input.email} already works in the store (${roleWords(already)}): change their role instead.`);
}

/** `invite_staff`: staff, or a collaborator for a number of days. They sign in with their email; no password is made here. */
export async function inviteStaffTool(ctx: Ctx, input: InviteInput) {
  const member = await ownerMember(ctx);
  const { choice, words } = await roleChoice(ctx.store, input.role);
  if (input.collaborator_days !== undefined) {
    if (choice.kind === "owner") return fail("A collaborator cannot be an owner.");
    const result = await inviteCollaborator(member, input.email, choice.kind === "role" ? choice.roleId : null, input.collaborator_days);
    if (!result.ok) return fail(result.problems.join(" "));
    return { done: `${input.email} can work in the store as a collaborator (${words}) for ${input.collaborator_days} days. They sign in with their email at the admin's sign-in.`, link: staffLink(ctx.store) };
  }
  const result = await inviteStaff(member, input.email, choice.kind === "owner" ? "owner" : "admin", choice.kind === "role" ? choice.roleId : null);
  if (!result.ok) return fail(result.problems.join(" "));
  return { done: `${input.email} can work in the store as ${words}. They sign in with their email at the admin's sign-in.`, link: staffLink(ctx.store) };
}

type ChangeInput = { person: string; role: string };

export async function preflightChangeStaffRole(ctx: Ctx, input: ChangeInput): Promise<void> {
  await ownerMember(ctx);
  const person = await activeMember(ctx.store, input.person);
  const { choice } = await roleChoice(ctx.store, input.role);
  if (person.kind === "collaborator" && choice.kind === "owner") fail("A collaborator cannot be an owner.");
}

/** `change_staff_role`: through `assignRole()`; the store keeps one active owner (the database says so). */
export async function changeStaffRoleTool(ctx: Ctx, input: ChangeInput) {
  const member = await ownerMember(ctx);
  const person = await activeMember(ctx.store, input.person);
  const { choice, words } = await roleChoice(ctx.store, input.role);
  const result = await assignRole(member, person.accountId, choice);
  if (!result.ok) return fail(result.problems.join(" "));
  return { done: `${person.email} is now ${words} (was ${roleWords(person)}).`, link: staffLink(ctx.store) };
}

export async function preflightRemoveStaff(ctx: Ctx, { person }: { person: string }): Promise<void> {
  await ownerMember(ctx);
  const found = await activeMember(ctx.store, person);
  if (found.accountId === ctx.account.id) fail("You cannot remove your own access.");
}

/** `remove_staff`: their access ends at once; their account and what they did stay (the activity log). */
export async function removeStaffTool(ctx: Ctx, { person }: { person: string }) {
  const member = await ownerMember(ctx);
  const found = await activeMember(ctx.store, person);
  const result = await disableStaff(member, found.accountId);
  if (!result.ok) return fail(result.problems.join(" "));
  return { done: `${found.email} no longer has access to the store.`, link: staffLink(ctx.store) };
}
