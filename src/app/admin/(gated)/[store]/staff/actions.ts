"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { parseRoleChoice, roleFromForm } from "@/lib/role-form";
import { checkOwnerRole, NO_ACCESS } from "@/server/permissions";
import { assignRole, createRole, deleteRole, extendCollaborator, inviteCollaborator, updateRole } from "@/server/store-roles";
import { disableStaff, inviteStaff } from "@/server/settings";
import { setTwoStepRequirement } from "@/server/two-step";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";
import type { Membership } from "@/server/auth";
import { actionAdminLang } from "@/server/admin-request-lang";

/**
 * The team and its roles (wave 1, 1f, docs/wave-1-trust.md 2.7): every action is the owner's, asks for itself (`checkOwnerRole`) and
 * answers in words. The server functions underneath hold the same rule again (`staff:write` is the owner role's alone) and the database
 * holds the rest: one active owner, a collaborator never an owner, a role in use cannot be deleted. Actions take the store's slug first.
 */

/** The refusal for someone who is not an owner here, in the language the request asks for. */
async function denied(): Promise<FormState> {
  const lang = await actionAdminLang();
  return { status: "error", messages: [lang === "en" ? NO_ACCESS : adminText(lang, "staff").actions.noAccess] };
}

/** The account's words for the team (D312 A8). */
const wordsOf = (member: Membership) => adminText(adminLangOf(member.account.adminLocale), "staff").actions;
const email = z.email();
const id = z.uuid();

const done = (message: string): FormState => {
  refresh();
  return { status: "ok", messages: [message] };
};
const refused = (problems: readonly string[]): FormState => ({ status: "error", messages: [...problems] });

/** Invites someone as staff: an owner, an admin with everything but the team and the plan, or an admin holding one of the store's roles. */
export async function inviteStaffAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const w = wordsOf(member);
  const address = email.safeParse(String(formData.get("email") ?? "").trim());
  const choice = parseRoleChoice(formData.get("role"));
  if (!address.success || !choice) return refused([w.inviteInvalid]);
  const result = await inviteStaff(member, address.data, choice.kind === "owner" ? "owner" : "admin", choice.kind === "role" ? choice.roleId : null);
  return result.ok ? done(fillWords(w.invited, { email: address.data })) : refused(result.problems);
}

/** Invites an email as a collaborator (an agency's account): a role that is never owner, and an end date 1 to 365 days away. */
export async function inviteCollaboratorAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const w = wordsOf(member);
  const address = email.safeParse(String(formData.get("email") ?? "").trim());
  const choice = parseRoleChoice(formData.get("role"));
  if (!address.success || !choice || choice.kind === "owner") return refused([w.collaboratorInvalid]);
  const result = await inviteCollaborator(member, address.data, choice.kind === "role" ? choice.roleId : null, String(formData.get("days") ?? ""));
  return result.ok ? done(fillWords(w.collaboratorInvited, { email: address.data, days: String(formData.get("days") ?? "").trim() })) : refused(result.problems);
}

/** Gives a collaborator more time from today. */
export async function extendCollaboratorAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const w = wordsOf(member);
  const account = id.safeParse(formData.get("accountId"));
  if (!account.success) return refused([w.unknownCollaborator]);
  const result = await extendCollaborator(member, account.data, String(formData.get("days") ?? ""));
  return result.ok ? done(w.extended) : refused(result.problems);
}

export async function disableStaffAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const w = wordsOf(member);
  const account = id.safeParse(formData.get("accountId"));
  if (!account.success) return refused([w.unknownStaff]);
  const result = await disableStaff(member, account.data);
  return result.ok ? done(w.removed) : refused(result.problems);
}

/** Changes a member's role. The store always keeps one active owner. */
export async function assignRoleAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const w = wordsOf(member);
  const account = id.safeParse(formData.get("accountId"));
  const choice = parseRoleChoice(formData.get("role"));
  if (!account.success || !choice) return refused([w.choosePerson]);
  const result = await assignRole(member, account.data, choice);
  return result.ok ? done(w.roleChanged) : refused(result.problems);
}

/** Requires two-step sign-in of everyone who works in the store, or stops requiring it. Switching it on needs the owner's own second step passed in this session. */
export async function setTwoStepRequirementAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const w = wordsOf(member);
  const required = formData.get("required") === "on";
  const result = await setTwoStepRequirement(member, required);
  return result.ok ? done(required ? w.twoStepOn : w.twoStepOff) : refused([result.problem]);
}

export async function createRoleAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const w = wordsOf(member);
  const result = await createRole(member, roleFromForm((name) => formData.get(name)));
  return result.ok ? done(w.roleMade) : refused(result.problems);
}

export async function updateRoleAction(storeSlug: string, roleId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const w = wordsOf(member);
  if (!id.safeParse(roleId).success) return refused([w.unknownRole]);
  const result = await updateRole(member, roleId, roleFromForm((name) => formData.get(name)));
  return result.ok ? done(w.roleSaved) : refused(result.problems);
}

export async function deleteRoleAction(storeSlug: string, roleId: string): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const w = wordsOf(member);
  if (!id.safeParse(roleId).success) return refused([w.unknownRole]);
  const result = await deleteRole(member, roleId);
  return result.ok ? done(w.roleDeleted) : refused(result.problems);
}
