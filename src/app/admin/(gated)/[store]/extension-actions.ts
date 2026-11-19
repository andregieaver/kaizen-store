"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { COMMON_WORDS } from "@/lib/admin-words/common";
import { isExtensionId } from "@/lib/extensions";
import { startExtensionTrial } from "@/server/extensions";
import { storeAction } from "@/server/store-action";

/**
 * "Try free" on an extension's marker (D748 step E5): starts the extension's 14-day trial for the store's account. Only the account's
 * owner may (`startExtensionTrial()` checks the account); the store's billing key is the gate here, as a plan's is.
 */
export async function startTrialAction(storeSlug: string, extension: string): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "billing:write", action: "extension.trial_start", answer: (message): FormState => ({ status: "error", messages: [message] }) }, async (member, lang) => {
    const w = COMMON_WORDS[lang].extensions;
    if (!isExtensionId(extension) || !member.store.organisationId) return { status: "error", messages: [w.refusals.not_owner] };
    const result = await startExtensionTrial(member.account, member.store.organisationId, extension);
    if (!result.ok) return { status: "error", messages: [w.refusals[result.refusal]] };
    refresh();
    return { status: "ok", messages: [w.trialStarted] };
  });
}
