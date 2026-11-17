"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { normaliseEmail } from "@/lib/email-address";

import { FORM_STARTERS, blankDraft, draftFromStarter, type FormDraft, type FormStatus } from "@/lib/form-records";
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

/** Makes one of Kaizena Flow's forms from a starter (or a blank one), sending to the maker's own address, and opens it (D705). */
export async function makePlatformFormAction(key: string): Promise<void> {
  const account = await requirePlatform("website");
  const starter = FORM_STARTERS.find((s) => s.key === key);
  const to = account.email ? [normaliseEmail(account.email)] : [];
  const draft = starter ? draftFromStarter(starter, "en", ["en"], to) : blankDraft("message", "New form", to);
  const outcome = await saveForm({ accountId: account.id, storeId: null }, null, draft, starter ? `starter:${starter.key}` : null);
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
