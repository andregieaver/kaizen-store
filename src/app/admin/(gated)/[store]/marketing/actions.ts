"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminText } from "@/lib/admin-text";
import { saveContactPolicy } from "@/server/contact-policy";
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

/** Saves the store's contact policy (D764): `marketing:write`, its two numbers and quiet hours in the audit log. */
export async function contactPolicyAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction(
    { store: storeSlug, key: "marketing:write", action: "marketing.contact_policy", answer: (message): FormState => ({ status: "error", messages: [message] }) },
    async (member, lang) => {
      const saved = await saveContactPolicy(member.store.id, member.account.id, {
        perWeek: form.get("perWeek"),
        spacingHours: form.get("spacingHours"),
        quietHours: form.get("quietHours"),
      });
      if (!saved.ok) return { status: "error", messages: [saved.problem] };
      refresh();
      return { status: "ok", messages: [adminText(lang, "marketing").contactPolicy.saved] };
    },
  );
}
