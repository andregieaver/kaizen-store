"use server";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { checkKaizenDesk } from "@/server/support-desk";
import { deleteReply, saveReply } from "@/server/support-replies";

/** Adds or changes one of Kaizen's desk's saved replies (D216, step 13): platform admins. */
export async function saveKaizenReplyAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const w = adminText(await actionAdminLang(), "support").problems;
  const staff = await checkKaizenDesk();
  if (!staff) return { status: "error", messages: [w.noAccess] };
  const result = await saveReply(staff, Object.fromEntries(form));
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [form.get("id") ? w.saved : w.added] };
}

/** Deletes one of Kaizen's desk's saved replies: platform admins. */
export async function deleteKaizenReplyAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const w = adminText(await actionAdminLang(), "support").problems;
  const staff = await checkKaizenDesk();
  if (!staff) return { status: "error", messages: [w.noAccess] };
  if (!(await deleteReply(staff, String(form.get("id") ?? ""))))
    return { status: "error", messages: [w.replyGone] };
  refresh();
  return { status: "ok", messages: [w.deleted] };
}
