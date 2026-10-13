"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { checkKaizenDesk } from "@/server/support-desk";
import { deleteReply, saveReply } from "@/server/support-replies";

/** Adds or changes one of Kaizen's desk's saved replies (D216, step 13): platform admins. */
export async function saveKaizenReplyAction(_state: FormState, form: FormData): Promise<FormState> {
  const staff = await checkKaizenDesk();
  if (!staff) return { status: "error", messages: ["You do not have access to this."] };
  const result = await saveReply(staff, Object.fromEntries(form));
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [form.get("id") ? "Saved." : "Added."] };
}

/** Deletes one of Kaizen's desk's saved replies: platform admins. */
export async function deleteKaizenReplyAction(_state: FormState, form: FormData): Promise<FormState> {
  const staff = await checkKaizenDesk();
  if (!staff) return { status: "error", messages: ["You do not have access to this."] };
  if (!(await deleteReply(staff, String(form.get("id") ?? "")))) return { status: "error", messages: ["That saved reply is gone."] };
  refresh();
  return { status: "ok", messages: ["Deleted."] };
}
