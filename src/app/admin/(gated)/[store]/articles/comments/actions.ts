"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { MODERATIONS, type Moderation } from "@/lib/blog-comments";
import { actionAdminLang } from "@/server/admin-request-lang";
import { commentsTag, deleteComment, moderateComment } from "@/server/blog-comments";
import { checkPageTypeAccess } from "@/server/permissions";

/**
 * Staff decide on visitors' comments (wave 7 unit G, D341): approve (shown), refuse, mark as spam, or delete, only through
 * `src/server/blog-comments.ts`, by members who may change articles. The articles' comments are refreshed at once.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function moderateCommentAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPageTypeAccess(storeSlug, "article", "write");
  if (!member) return { status: "error", messages: [adminText(await actionAdminLang(), "blog").noChange] };
  const w = adminText(adminLangOf(member.account.adminLocale), "blog").moderation;
  const id = formData.get("id");
  const action = formData.get("action");
  if (typeof id !== "string" || !UUID.test(id)) return { status: "error", messages: [w.gone] };
  if (action === "delete") {
    if (!(await deleteComment(member.account, member.store.id, id))) return { status: "error", messages: [w.gone] };
    updateTag(commentsTag(member.store.id));
    refresh();
    return { status: "ok", messages: [w.removed] };
  }
  if (typeof action !== "string" || !(MODERATIONS as readonly string[]).includes(action)) return { status: "error", messages: [w.gone] };
  const moderation = action as Moderation;
  if (!(await moderateComment(member.account, member.store.id, id, moderation))) return { status: "error", messages: [w.gone] };
  updateTag(commentsTag(member.store.id));
  refresh();
  return { status: "ok", messages: [moderation === "approve" ? w.approved : moderation === "reject" ? w.rejected : w.marked] };
}
