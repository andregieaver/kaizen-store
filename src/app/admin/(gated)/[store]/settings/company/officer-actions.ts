"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminText } from "@/lib/admin-text";
import { officerFields, readOfficerChoice } from "@/lib/privacy-officer";
import { setOfficer } from "@/server/privacy-officers";
import { storeAction } from "@/server/store-action";



/** A store's own data protection officer, or its account's (D763). The store's owner's. */
export async function setStoreOfficerAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "owner", action: "privacy.officer", answer: (message): FormState => ({ status: "error", messages: [message] }) }, async (member, lang) => {
    const w = adminText(lang, "privacyOfficer");
    const organisationId = member.store.organisationId;
    if (!organisationId) return { status: "error", messages: [w.notOwner] };
    const read = readOfficerChoice(officerFields(form), { store: true });
    if (!read.ok) return { status: "error", messages: read.problems };
    const result = await setOfficer(member.account.id, organisationId, member.store.id, read.choice);
    if (!result.ok) return { status: "error", messages: result.problems };
    refresh();
    return { status: "ok", messages: [w.saved] };
  });
}
