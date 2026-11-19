"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { adminText } from "@/lib/admin-text";
import { moveAccount } from "@/server/account-move";
import { platformAction } from "@/server/store-action";

/** Moves one account to one plan (D748 step E4 part four), at the platform's plans area, write; the box says the other plans end now. */
export async function moveAccountAction(organisationId: string, _state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "plans", action: "platform.account_move", answer: (message): FormState => ({ status: "error", messages: [message] }) }, async (account, lang) => {
    const w = adminText(lang, "screens").platformAccounts;
    if (!z.uuid().safeParse(organisationId).success) return { status: "error", messages: [w.pick] };
    if (form.get("understand") !== "on") return { status: "error", messages: [w.pick] };
    const result = await moveAccount(account, organisationId);
    if (!result.ok) return { status: "error", messages: result.problems };
    refresh();
    return { status: "ok", messages: [result.note ?? w.moved] };
  });
}
