"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { chatTag } from "@/server/chat-agent";
import { checkKaizenDesk } from "@/server/support-desk";
import { saveDeskSettings } from "@/server/support-settings";

/** Kaizen's own support settings (D216, 2.10): platform admins, each as an owner of Kaizen's desk. */
export async function saveKaizenSupportSettingsAction(_state: FormState, formData: FormData): Promise<FormState> {
  const staff = await checkKaizenDesk();
  if (!staff) return { status: "error", messages: ["You do not have access to this."] };
  const result = await saveDeskSettings(staff, Object.fromEntries(formData), { owner: true });
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(chatTag(null));
  refresh();
  return { status: "ok", messages: [result.ended > 0 ? `Saved. ${result.ended} open ${result.ended === 1 ? "conversation was" : "conversations were"} ended.` : "Saved."] };
}
