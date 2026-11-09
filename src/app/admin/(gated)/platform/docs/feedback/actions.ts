"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { isUuid } from "@/lib/admin-api";
import { requirePlatform } from "@/server/auth";
import { removeDocsComment } from "@/server/docs-feedback";
import { removeDocsMiss } from "@/server/docs-search";

/** Takes a reader's sentence off the docs' feedback (D442), keeping its yes or no: for a sentence that names someone. */
export async function removeDocsCommentAction(id: string): Promise<FormState> {
  const admin = await requirePlatform("website");
  const w = adminText(adminLangOf(admin.adminLocale), "platform").docsFeedback;
  if (!isUuid(id) || !(await removeDocsComment(admin, id))) return { status: "error", messages: [w.gone] };
  refresh();
  return { status: "ok", messages: [w.removed] };
}

/** Takes a search off the docs' gap list (D443): a page answers it now, or its words name someone. */
export async function removeDocsMissAction(query: string, lang: string): Promise<FormState> {
  const admin = await requirePlatform("website");
  const w = adminText(adminLangOf(admin.adminLocale), "platform").docsFeedback;
  if (typeof query !== "string" || query.length > 100 || (lang !== "en" && lang !== "nb") || !(await removeDocsMiss(admin, query, lang))) {
    return { status: "error", messages: [w.missGone] };
  }
  refresh();
  return { status: "ok", messages: [w.missRemoved] };
}
