"use server";

import { revalidatePath } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePlatformAdmin, signedInRecently } from "@/server/auth";
import { addPlatformAdmin, removePlatformAdmin, type TeamResult } from "@/server/platform-team";

type Problem = Extract<TeamResult, { ok: false }>["problem"];

/** Makes a person a platform admin (C1, D471): asks for a sign-in in the last minutes first, as closing a store does. */
export async function addAdminAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "console").team;
  if (!(await signedInRecently())) return { status: "error", messages: [w.signInAgain] };
  const result = await addPlatformAdmin(admin, String(formData.get("email") ?? ""), String(formData.get("name") ?? ""));
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
