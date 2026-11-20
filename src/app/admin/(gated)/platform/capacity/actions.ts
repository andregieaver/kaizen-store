"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { setRecordingsOpen } from "@/server/recordings-admin";
import { platformAction } from "@/server/store-action";
import { CAPACITY_WORDS } from "@/lib/admin-words/capacity";

const failed = (message: string): FormState => ({ status: "error", messages: [message] });

/** Opens or closes recordings of visits to every store (D656, `docs/heatmaps-and-recordings.md` 11): the platform's owner role only. */
export async function recordingsOpenAction(_state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "settings", action: "platform.recordings_open_set", answer: failed }, async (account, lang) => {
    const w = CAPACITY_WORDS[lang].recordings;
    const choice = form.get("open");
    if (choice !== "on" && choice !== "off") return failed(w.choose);
    await setRecordingsOpen(account, choice === "on");
    refresh();
    return { status: "ok", messages: [choice === "on" ? w.opened : w.closedNow] };
  });
}
