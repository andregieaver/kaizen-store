"use server";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { countWords } from "@/lib/admin-fill";
import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { chatTag } from "@/server/chat-agent";
import { checkKaizenDesk } from "@/server/support-desk";
import { saveDeskSettings } from "@/server/support-settings";

/** Kaizen's own support settings (D216, 2.10): platform admins, each as an owner of Kaizen's desk. */
export async function saveKaizenSupportSettingsAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const w = adminText(await actionAdminLang(), "support").problems;
  const staff = await checkKaizenDesk();
  if (!staff) return { status: "error", messages: [w.noAccess] };
  const result = await saveDeskSettings(staff, Object.fromEntries(formData), {
    owner: true,
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(chatTag(null));
  refresh();
  return {
    status: "ok",
    messages: [
      result.ended > 0 ? countWords(result.ended, w.savedEnded) : w.saved,
    ],
  };
}
