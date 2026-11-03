"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { isUuid } from "@/lib/admin-api";
import { requirePlatformAdmin } from "@/server/auth";
import { removeDocsComment } from "@/server/docs-feedback";

/** Takes a reader's sentence off the docs' feedback (D442), keeping its yes or no: for a sentence that names someone. */
export async function removeDocsCommentAction(id: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "platform").docsFeedback;
  if (!isUuid(id) || !(await removeDocsComment(admin, id))) return { status: "error", messages: [w.gone] };
  refresh();
  return { status: "ok", messages: [w.removed] };
}
