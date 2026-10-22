"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import type { PrivacyMessages } from "@/lib/admin-messages/privacy.en";
import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import type { Membership } from "@/server/auth";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { cancelRequest, closeNoData, extendRequest, logRequest, markIdentityDoubt, refuseRequest, type ActionResult } from "@/server/privacy-requests";

/**
 * What staff do with a privacy request (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 4). Each action asks `customers:write` first (a store
 * the account is not a member of, or a role without the key, gets the plain refusal), reads the form into the shape the server's own schema
 * checks again, and leaves the audit entry and the person's email to the server function. A request is never deleted from here.
 */

const failed = (message: string): FormState => ({ status: "error", messages: [message] });
/** The member's words for the privacy screens (D312 A6): what an action answers is in the language they read the admin in. */
const wordsOf = (member: Membership): PrivacyMessages => adminText(adminLangOf(member.account.adminLocale), "privacy");
/** A server sentence (English) in the reader's language, where the catalogue has it. */
const inWords = (w: PrivacyMessages, sentence: string): string => w.problems[sentence] ?? sentence;
/** The plain refusal before a member is known, in the request's language. */
const noAccess = async (): Promise<FormState> => failed(inWords(adminText(await actionAdminLang(), "privacy"), NO_ACCESS));
const text = (form: FormData, name: string): string => String(form.get(name) ?? "").trim();

/** The membership when the member may change customers and the id is one, else the plain sentence to show. */
async function guarded(storeSlug: string, requestId: string): Promise<{ member: Membership; w: PrivacyMessages } | FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const w = wordsOf(member);
  if (!z.uuid().safeParse(requestId).success) return failed(w.actions.gone);
  return { member, w };
}

function stateOf(w: PrivacyMessages, result: ActionResult, done: string, notEmailed?: string): FormState {
  if (!result.ok) return failed(inWords(w, result.problem));
  refresh();
  return { status: "ok", messages: [result.emailed || !notEmailed ? done : notEmailed] };
}

/** Logs a request that arrived by email, post or phone, with the day it was received, and opens it. */
export async function logRequestAction(storeSlug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const result = await logRequest(
    { storeId: member.store.id, accountId: member.account.id },
    { kind: text(form, "kind"), email: text(form, "email"), receivedOn: text(form, "receivedOn"), note: text(form, "note") },
  );
  if (!result.ok) return failed(inWords(wordsOf(member), result.problem));
  redirect(`/admin/${member.store.slug}/privacy/${result.id}`);
}

/** Extends the answer once (a reason; the person is emailed). */
export async function extendRequestAction(storeSlug: string, requestId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const g = await guarded(storeSlug, requestId);
  if (!("member" in g)) return g;
  const { member, w } = g;
  return stateOf(
    w,
    await extendRequest({ storeId: member.store.id, accountId: member.account.id }, requestId, { reason: text(form, "reason") }),
    w.forms.extended,
    w.actions.extendedNotEmailed,
  );
}

/** Refuses with a reason from the closed list (the person is emailed the reasons and their rights). */
export async function refuseRequestAction(storeSlug: string, requestId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const g = await guarded(storeSlug, requestId);
  if (!("member" in g)) return g;
  const { member, w } = g;
  return stateOf(
    w,
    await refuseRequest({ storeId: member.store.id, accountId: member.account.id }, requestId, { reason: text(form, "reason"), note: text(form, "note") }),
    w.forms.refused,
    w.actions.refusedNotEmailed,
  );
}

/** Closes a request as "no data held" (only when the store holds nothing about the person). */
export async function closeNoDataAction(storeSlug: string, requestId: string): Promise<FormState> {
  const g = await guarded(storeSlug, requestId);
  if (!("member" in g)) return g;
  const { member, w } = g;
  return stateOf(w, await closeNoData({ storeId: member.store.id, accountId: member.account.id }, requestId), w.actions.closedNoData);
}

/** Cancels a request logged by mistake. It stays in the log. */
export async function cancelRequestAction(storeSlug: string, requestId: string): Promise<FormState> {
  const g = await guarded(storeSlug, requestId);
  if (!("member" in g)) return g;
  const { member, w } = g;
  return stateOf(w, await cancelRequest({ storeId: member.store.id, accountId: member.account.id }, requestId), w.detail.cancelled);
}

/** Notes the day staff began to doubt the person's identity. */
export async function identityDoubtAction(storeSlug: string, requestId: string): Promise<FormState> {
  const g = await guarded(storeSlug, requestId);
  if (!("member" in g)) return g;
  const { member, w } = g;
  return stateOf(w, await markIdentityDoubt({ storeId: member.store.id, accountId: member.account.id }, requestId), w.detail.noteDate);
}
