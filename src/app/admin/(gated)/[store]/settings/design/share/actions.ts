"use server";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { checkPermission } from "@/server/permissions";
import { submitTheme, submitThemeUpdate } from "@/server/theme-submissions";
import { actionAdminLang } from "@/server/admin-request-lang";

const text = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

/**
 * Sends the store's live look for review as a theme (D344): a new theme, or an update of one the person is the author of (`as` names it).
 * The look is taken now, on the server; the store's words go only in its published pages, and only when *Send my pages too* is ticked (D388).
 */
export async function submitThemeAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [adminText(await actionAdminLang(), "design").share.readOnly] };
  const w = adminText(adminLangOf(member.account.adminLocale), "design").share;
  const as = text(formData, "as");
  // The store's published pages as the theme's demo content (D388), only when ticked.
  const options = { pages: formData.get("pages") === "on" };
  const result =
    as && as !== "new"
      ? await submitThemeUpdate(member, as, { notes: text(formData, "notes"), authorName: text(formData, "authorName") }, options)
      : await submitTheme(member, {
          title: text(formData, "title"),
          summary: text(formData, "summary"),
          description: text(formData, "description"),
          authorName: text(formData, "authorName"),
        }, options);
  if (!result.ok) return { status: "error", messages: result.fields ? result.fields.map((field) => w.problems[field]) : result.problems };
  return { status: "ok", messages: [w.sent] };
}
