"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminText } from "@/lib/admin-text";
import { sendingDomainForm } from "@/server/sending-domain-form";
import { platformAction } from "@/server/store-action";

/** Kaizena Flow's own sending domain (D727), as a store's: the platform's settings area, write. */
export async function platformSendingDomainAction(_state: FormState, form: FormData): Promise<FormState> {
  return platformAction(
    { area: "settings", action: "platform.sending_domain", answer: (message): FormState => ({ status: "error", messages: [message] }) },
    async (account, lang) => {
      const answer = await sendingDomainForm(account, null, form, adminText(lang, "notifications").sendingDomain);
      if (answer.status === "ok") refresh();
      return answer;
    },
  );
}
