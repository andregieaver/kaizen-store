"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { chatTag } from "@/server/chat-agent";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { memberDesk } from "@/server/support-desk";
import { saveDeskSettings } from "@/server/support-settings";

/**
 * The store's support settings (D216, 2.10): `support:write`; how long transcripts are kept is the owner's alone. The chat on the
 * store's pages follows the desk's mode, so its cache is refreshed.
 */
export async function saveSupportSettingsAction(slug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(slug, "support:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const owner = await checkPermission(slug, "owner");
  const result = await saveDeskSettings(memberDesk(member), Object.fromEntries(formData), { owner: owner !== null });
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(chatTag(member.store.id));
  refresh();
  return { status: "ok", messages: [result.ended > 0 ? `Saved. ${result.ended} open ${result.ended === 1 ? "conversation was" : "conversations were"} ended.` : "Saved."] };
}
