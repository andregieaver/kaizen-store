"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { FORM_STARTERS, blankDraft, draftFromStarter, type FormDraft, type FormStatus } from "@/lib/form-records";
import { NO_ACCESS, checkPermission, requirePermission } from "@/server/permissions";
import { deleteForm, saveForm, setFormStatus, type DeleteFormOutcome, type SaveFormOutcome } from "@/server/forms-admin";
import { normaliseEmail } from "@/lib/email-address";

/** Where a new form sends: the store's contact address, else the owner's own, so it is ready to place. */
const ownAddress = (member: Awaited<ReturnType<typeof requirePermission>>) => {
  const address = member.store.details.contactEmail ?? member.account.email;
  return address ? [normaliseEmail(address)] : [];
};

/** Makes a form from a starter (or a blank one) and opens it (D705). */
export async function makeFormAction(storeSlug: string, key: string): Promise<void> {
  const member = await requirePermission(storeSlug, "website:write");
  const langs = [...new Set(member.store.markets.map((m) => m.lang))];
  const main = langs[0] ?? "en";
  const starter = FORM_STARTERS.find((s) => s.key === key);
  const draft = starter ? draftFromStarter(starter, main, langs, ownAddress(member)) : blankDraft("message", fillName(main), ownAddress(member));
  const outcome = await saveForm({ accountId: member.account.id, storeId: member.store.id }, null, draft, starter ? `starter:${starter.key}` : null);
  if (!outcome.ok) redirect(`/admin/${member.store.slug}/forms?problem=${encodeURIComponent(outcome.problems[0] ?? "")}`);
  redirect(`/admin/${member.store.slug}/forms/${outcome.id}`);
}

const fillName = (lang: string) => ({ nb: "Nytt skjema", sv: "Nytt formulär", da: "Ny formular" })[lang] ?? "New form";

export async function saveFormAction(storeSlug: string, id: string, draft: FormDraft): Promise<SaveFormOutcome> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const outcome = await saveForm({ accountId: member.account.id, storeId: member.store.id }, id, draft);
  if (outcome.ok) refresh();
  return outcome;
}

export async function setFormStatusAction(storeSlug: string, id: string, status: FormStatus): Promise<boolean> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return false;
  const done = await setFormStatus({ accountId: member.account.id, storeId: member.store.id }, id, status);
  if (done) refresh();
  return done;
}

export async function deleteFormAction(storeSlug: string, id: string): Promise<DeleteFormOutcome> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, gone: true };
  return deleteForm({ accountId: member.account.id, storeId: member.store.id }, id);
}
