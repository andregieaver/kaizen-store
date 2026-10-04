"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import type { Membership } from "@/server/auth";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { cancelRequest, closeNoData, extendRequest, logRequest, markIdentityDoubt, refuseRequest, type ActionResult } from "@/server/privacy-requests";

/**
 * What staff do with a privacy request (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 4). Each action asks `customers:write` first (a store
 * the account is not a member of, or a role without the key, gets the plain refusal), reads the form into the shape the server's own schema
 * checks again, and leaves the audit entry and the person's email to the server function. A request is never deleted from here.
 */

const failed = (message: string): FormState => ({ status: "error", messages: [message] });
const text = (form: FormData, name: string): string => String(form.get(name) ?? "").trim();

/** The membership when the member may change customers and the id is one, else the plain sentence to show. */
async function guarded(storeSlug: string, requestId: string): Promise<Membership | string> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return NO_ACCESS;
  if (!z.uuid().safeParse(requestId).success) return "This request no longer exists.";
  return member;
}

function stateOf(result: ActionResult, done: string, notEmailed?: string): FormState {
  if (!result.ok) return failed(result.problem);
  refresh();
  return { status: "ok", messages: [result.emailed || !notEmailed ? done : notEmailed] };
}

/** Logs a request that arrived by email, post or phone, with the day it was received, and opens it. */
export async function logRequestAction(storeSlug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return failed(NO_ACCESS);
  const result = await logRequest(
    { storeId: member.store.id, accountId: member.account.id },
    { kind: text(form, "kind"), email: text(form, "email"), receivedOn: text(form, "receivedOn"), note: text(form, "note") },
  );
  if (!result.ok) return failed(result.problem);
  redirect(`/admin/${member.store.slug}/privacy/${result.id}`);
}

/** Extends the answer once (a reason; the person is emailed). */
export async function extendRequestAction(storeSlug: string, requestId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const g = await guarded(storeSlug, requestId);
  if (typeof g === "string") return failed(g);
  return stateOf(
    await extendRequest({ storeId: g.store.id, accountId: g.account.id }, requestId, { reason: text(form, "reason") }),
    "The answer is extended. The person has been told.",
    "The answer is extended, but the person could not be emailed. Tell them yourself.",
  );
}

/** Refuses with a reason from the closed list (the person is emailed the reasons and their rights). */
export async function refuseRequestAction(storeSlug: string, requestId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const g = await guarded(storeSlug, requestId);
  if (typeof g === "string") return failed(g);
  return stateOf(
    await refuseRequest({ storeId: g.store.id, accountId: g.account.id }, requestId, { reason: text(form, "reason"), note: text(form, "note") }),
    "The request is refused. The person has been told.",
    "The request is refused, but the person could not be emailed. Tell them yourself, with the reasons and their right to complain.",
  );
}

/** Closes a request as "no data held" (only when the store holds nothing about the person). */
export async function closeNoDataAction(storeSlug: string, requestId: string): Promise<FormState> {
  const g = await guarded(storeSlug, requestId);
  if (typeof g === "string") return failed(g);
  return stateOf(await closeNoData({ storeId: g.store.id, accountId: g.account.id }, requestId), "Closed as no data held. Tell the person.");
}

/** Cancels a request logged by mistake. It stays in the log. */
export async function cancelRequestAction(storeSlug: string, requestId: string): Promise<FormState> {
  const g = await guarded(storeSlug, requestId);
  if (typeof g === "string") return failed(g);
  return stateOf(await cancelRequest({ storeId: g.store.id, accountId: g.account.id }, requestId), "The request is cancelled.");
}

/** Notes the day staff began to doubt the person's identity. */
export async function identityDoubtAction(storeSlug: string, requestId: string): Promise<FormState> {
  const g = await guarded(storeSlug, requestId);
  if (typeof g === "string") return failed(g);
  return stateOf(await markIdentityDoubt({ storeId: g.store.id, accountId: g.account.id }, requestId), "The date is noted.");
}
