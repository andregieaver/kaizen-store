"use server";

import { revalidatePath } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePlatformAdmin, signedInRecently } from "@/server/auth";
import { isPlatformRole } from "@/lib/platform-access";
import { addPlatformAdmin, removePlatformAdmin, setPlatformRole, type TeamResult } from "@/server/platform-team";

type Problem = Extract<TeamResult, { ok: false }>["problem"];

/** Puts a person on the platform's team in a role (C1, D471, D510): asks for a sign-in in the last minutes first, as closing a store does. */
export async function addAdminAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "console").team;
  if (!(await signedInRecently())) return { status: "error", messages: [w.signInAgain] };
  // The least a person may do when no role came with the form (D510).
  const role = String(formData.get("role") ?? "read_only");
  const result = await addPlatformAdmin(admin, String(formData.get("email") ?? ""), String(formData.get("name") ?? ""), isPlatformRole(role) ? role : "read_only");
  if (!result.ok) return { status: "error", messages: [w.problems[result.problem as Problem]] };
  revalidatePath("/admin/platform/team");
  return { status: "ok", messages: [fillWords(w.added, { email: result.email })] };
}

/** Takes a platform admin's rights away (never one's own, never the last one's). */
export async function removeAdminAction(accountId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "console").team;
  const result = await removePlatformAdmin(admin, accountId);
  if (!result.ok) return { status: "error", messages: [w.problems[result.problem as Problem]] };
  revalidatePath("/admin/platform/team");
  return { status: "ok", messages: [fillWords(w.removed, { email: result.email })] };
}

/** Gives someone on the team another role (D510): an owner's, after a sign-in in the last minutes, never one's own, never the last owner's. */
export async function setRoleAction(accountId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "console").team;
  if (!(await signedInRecently())) return { status: "error", messages: [w.signInAgain] };
  const role = String(formData.get("role") ?? "");
  if (!isPlatformRole(role)) return { status: "error", messages: [w.problems.invalid] };
  const result = await setPlatformRole(admin, accountId, role);
  if (!result.ok) return { status: "error", messages: [w.problems[result.problem as Problem]] };
  revalidatePath("/admin/platform/team");
  return { status: "ok", messages: [fillWords(w.roleSet, { email: result.email, role: w.roles[role] })] };
}
