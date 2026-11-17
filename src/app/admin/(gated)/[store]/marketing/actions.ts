"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminText } from "@/lib/admin-text";
import { resumeSending } from "@/server/sending-guard";
import { storeAction } from "@/server/store-action";

/** Resumes the store's marketing email after the sending guard held it (D730): `marketing:write`, and the guard counts afresh from now. */
export async function resumeSendingAction(storeSlug: string): Promise<FormState> {
  return storeAction(
    { store: storeSlug, key: "marketing:write", action: "marketing.sending_resumed", answer: (message): FormState => ({ status: "error", messages: [message] }) },
    async (member, lang) => {
      await resumeSending(member.account, member.store.id);
      refresh();
      return { status: "ok", messages: [adminText(lang, "marketing").sendingGuard.resumed] };
    },
  );
}
