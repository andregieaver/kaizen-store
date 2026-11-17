"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { blankDraft, type FormDraft, type FormStatus } from "@/lib/form-records";
import { NO_ACCESS, checkPermission, requirePermission } from "@/server/permissions";
import { deleteForm, saveForm, setFormStatus, type DeleteFormOutcome, type SaveFormOutcome } from "@/server/forms-admin";
import { changeFormTemplate, deleteFormTemplate, makeFormFromTemplate, saveFormAsTemplate, updateTemplateFromForm, type TemplateOutcome } from "@/server/form-templates";
import type { TemplateMeta } from "@/lib/form-templates";
import { normaliseEmail } from "@/lib/email-address";

/** Where a new form sends: the store's contact address, else the owner's own, so it is ready to place. */
const ownAddress = (member: Awaited<ReturnType<typeof requirePermission>>) => {
  const address = member.store.details.contactEmail ?? member.account.email;
  return address ? [normaliseEmail(address)] : [];
};

/** Makes a form from a template (F4, `key` its id) or a blank one, and opens it (D705). */
export async function makeFormAction(storeSlug: string, key: string): Promise<void> {
  const member = await requirePermission(storeSlug, "website:write");
  const langs = [...new Set(member.store.markets.map((m) => m.lang))];
  const main = langs[0] ?? "en";
  const viewer = { accountId: member.account.id, storeId: member.store.id };
  const outcome =
    key === "blank"
      ? await saveForm(viewer, null, blankDraft("message", fillName(main), ownAddress(member)))
      : await makeFormFromTemplate(viewer, key, main, langs, ownAddress(member));
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

// ---------------------------------------------------------------------------------------------------------------------------------
// Templates (F4)

async function templateViewer(storeSlug: string) {
  const member = await checkPermission(storeSlug, "website:write");
  return member ? { member, viewer: { accountId: member.account.id, storeId: member.store.id } } : null;
}

export async function saveAsTemplateAction(storeSlug: string, formId: string, meta: TemplateMeta): Promise<TemplateOutcome> {
  const found = await templateViewer(storeSlug);
  if (!found) return { ok: false, problems: [NO_ACCESS] };
  const outcome = await saveFormAsTemplate(found.viewer, formId, meta, found.member.store.markets[0]?.lang ?? "en");
  if (outcome.ok) refresh();
  return outcome;
}

export async function updateTemplateAction(storeSlug: string, id: string): Promise<TemplateOutcome> {
  const found = await templateViewer(storeSlug);
  if (!found) return { ok: false, problems: [NO_ACCESS] };
  return updateTemplateFromForm(found.viewer, id);
}

export async function changeTemplateAction(storeSlug: string, id: string, meta: TemplateMeta): Promise<TemplateOutcome> {
  const found = await templateViewer(storeSlug);
  if (!found) return { ok: false, problems: [NO_ACCESS] };
  const outcome = await changeFormTemplate(found.viewer, id, meta);
  if (outcome.ok) refresh();
  return outcome;
}

export async function deleteTemplateAction(storeSlug: string, id: string): Promise<TemplateOutcome> {
  const found = await templateViewer(storeSlug);
  if (!found) return { ok: false, problems: [NO_ACCESS] };
  const outcome = await deleteFormTemplate(found.viewer, id);
  if (outcome.ok) refresh();
  return outcome;
}
