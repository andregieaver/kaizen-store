"use server";

import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { adminText } from "@/lib/admin-text";
import { deleteRecording } from "@/server/recordings-admin";
import { storeAction } from "@/server/store-action";

const failed = (message: string): FormState => ({ status: "error", messages: [message] });

/** The owner deletes one recording (D656 step 11; audited `analytics.recording_deleted`), then goes back to the list. */
export async function deleteRecordingAction(storeSlug: string, id: string): Promise<FormState> {
  const answer = await storeAction({ store: storeSlug, key: "owner", action: "analytics.recording_deleted", answer: failed }, async (member, lang) => {
    const result = await deleteRecording(member, id);
    if (!result.ok) return failed(result.problem);
    return { status: "ok" as const, messages: [adminText(lang, "recordings").player.deleted] };
  });
  if (answer.status === "ok") redirect(`/admin/${storeSlug}/analytics/recordings`);
  return answer;
}
