"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { normaliseEmail } from "@/lib/email-address";

import { blankDraft, type FormDraft, type FormStatus } from "@/lib/form-records";
import type { TemplateMeta } from "@/lib/form-templates";
import {
  adoptStarter,
  changeFormTemplate,
  deleteFormTemplate,
  makeFormFromTemplate,
  saveFormAsTemplate,
  setFormTemplateHidden,
  updateTemplateFromForm,
  type TemplateOutcome,
} from "@/server/form-templates";
import { getAccount, platformCan, requirePlatform } from "@/server/auth";
import {
  deleteForm,
  deleteResponses,
  saveForm,
  setFormStatus,
  setResponseState,
  type DeleteFormOutcome,
  type FormResponseRow,
  type SaveFormOutcome,
} from "@/server/forms-admin";
import { NO_ACCESS } from "@/server/permissions";

/** Someone on the platform's team who may change Kaizena Flow's website, or null. */
async function writer() {
  const account = await getAccount();
  return account && platformCan(account, "website", "write") ? account : null;
}

/**
 * The languages Kaizena Flow's forms carry words in: its starters' (F4), so a form made from one keeps every language, and updating the
 * starter from it loses none.
 */
const TEMPLATE_LANGS = ["en", "nb", "sv", "da"];

/** Makes one of Kaizena Flow's forms from one of its templates (or a blank one), sending to the maker's own address, and opens it (D705). */
export async function makePlatformFormAction(key: string): Promise<void> {
  const account = await requirePlatform("website");
  const to = account.email ? [normaliseEmail(account.email)] : [];
  const viewer = { accountId: account.id, storeId: null };
  const outcome =
    key === "blank" ? await saveForm(viewer, null, blankDraft("message", "New form", to)) : await makeFormFromTemplate(viewer, key, "en", TEMPLATE_LANGS, to);
  if (!outcome.ok) redirect(`/admin/platform/forms?problem=${encodeURIComponent(outcome.problems[0] ?? "")}`);
  redirect(`/admin/platform/forms/${outcome.id}`);
}

export async function savePlatformFormAction(id: string, draft: FormDraft): Promise<SaveFormOutcome> {
  const account = await writer();
  if (!account) return { ok: false, problems: [NO_ACCESS] };
  const outcome = await saveForm({ accountId: account.id, storeId: null }, id, draft);
  if (outcome.ok) refresh();
  return outcome;
}

export async function setPlatformFormStatusAction(id: string, status: FormStatus): Promise<boolean> {
  const account = await writer();
  const done = account ? await setFormStatus({ accountId: account.id, storeId: null }, id, status) : false;
  if (done) refresh();
  return done;
}

export async function deletePlatformFormAction(id: string): Promise<DeleteFormOutcome> {
  const account = await writer();
  return account ? deleteForm({ accountId: account.id, storeId: null }, id) : { ok: false, gone: true };
}

export async function setPlatformResponseStateAction(formId: string, ids: string[], state: FormResponseRow["state"]): Promise<number> {
  const account = await writer();
  const n = account ? await setResponseState({ accountId: account.id, storeId: null }, formId, ids.slice(0, 100), state) : 0;
  refresh();
  return n;
}

export async function deletePlatformResponsesAction(formId: string, ids: string[]): Promise<number> {
  const account = await writer();
  const n = account ? await deleteResponses({ accountId: account.id, storeId: null }, formId, ids.slice(0, 100)) : 0;
  refresh();
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Kaizena Flow's templates (F4)

const viewerOf = async () => {
  const account = await writer();
  return account ? { accountId: account.id, storeId: null } : null;
};
const denied: TemplateOutcome = { ok: false, problems: [NO_ACCESS] };

export async function savePlatformTemplateAction(formId: string, meta: TemplateMeta): Promise<TemplateOutcome> {
  const viewer = await viewerOf();
  if (!viewer) return denied;
  const outcome = await saveFormAsTemplate(viewer, formId, meta, "en");
  if (outcome.ok) refresh();
  return outcome;
}

export async function updatePlatformTemplateAction(id: string): Promise<TemplateOutcome> {
  const viewer = await viewerOf();
  return viewer ? updateTemplateFromForm(viewer, id) : denied;
}

export async function adoptPlatformStarterAction(formId: string): Promise<TemplateOutcome> {
  const viewer = await viewerOf();
  if (!viewer) return denied;
  const outcome = await adoptStarter(viewer, formId);
  if (outcome.ok) refresh();
  return outcome;
}

export async function changePlatformTemplateAction(id: string, meta: TemplateMeta): Promise<TemplateOutcome> {
  const viewer = await viewerOf();
  return viewer ? changeFormTemplate(viewer, id, meta) : denied;
}

export async function deletePlatformTemplateAction(id: string): Promise<TemplateOutcome> {
  const viewer = await viewerOf();
  if (!viewer) return denied;
  const outcome = await deleteFormTemplate(viewer, id);
  if (outcome.ok) refresh();
  return outcome;
}

/** Hides one of Kaizena Flow's templates, or a store's marketplace one, from every store's list, or shows it again. */
export async function hideFormTemplateAction(id: string, hidden: boolean): Promise<TemplateOutcome> {
  const account = await writer();
  if (!account) return denied;
  const outcome = await setFormTemplateHidden(account, id, hidden === true);
  if (outcome.ok) refresh();
  return outcome;
}
