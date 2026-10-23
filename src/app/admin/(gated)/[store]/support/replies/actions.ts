"use server";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { checkPermission } from "@/server/permissions";
import { memberDesk } from "@/server/support-desk";
import { deleteReply, saveReply } from "@/server/support-replies";

/** Adds or changes one of the store's desk's saved replies (D216, step 13): `support:write`. The store's slug is bound first. */
export async function saveReplyAction(
  slug: string,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const w = adminText(await actionAdminLang(), "support").problems;
  const member = await checkPermission(slug, "support:write");
  if (!member) return { status: "error", messages: [w.noAccess] };
  const result = await saveReply(memberDesk(member), Object.fromEntries(form));
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [form.get("id") ? w.saved : w.added] };
}

/** Deletes one of the store's desk's saved replies: `support:write`. */
export async function deleteReplyAction(
  slug: string,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const w = adminText(await actionAdminLang(), "support").problems;
  const member = await checkPermission(slug, "support:write");
  if (!member) return { status: "error", messages: [w.noAccess] };
  if (!(await deleteReply(memberDesk(member), String(form.get("id") ?? ""))))
    return { status: "error", messages: [w.replyGone] };
  refresh();
  return { status: "ok", messages: [w.deleted] };
}
