"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import { adminText } from "@/lib/admin-text";
import { featureOffText, featureOn } from "@/lib/store-features";
import { createActivity, deleteActivity, setActivityDone, updateActivity, type ActivityResult } from "@/server/activities";
import { actionAdminLang } from "@/server/admin-request-lang";
import type { Membership } from "@/server/auth";
import { checkPermission } from "@/server/permissions";

/**
 * Activities' actions (S3, D468), on a deal's, a person's and a company's page and on the store's home: each checks the member may change
 * customers and that Deals is on, whatever a stale page sends, and answers in the member's language.
 */

const uuid = z.uuid();
type Words = DealsMessages["activities"];

/** The member, when they may change customers and Deals is on; else the reason, in their words. */
async function writer(storeSlug: string): Promise<{ member: Membership; w: Words } | { refused: string }> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { refused: adminText(await actionAdminLang(), "deals").activities.problems.forbidden };
  const lang = adminLangOf(member.account.adminLocale);
  if (!featureOn(member.store, "sales")) return { refused: featureOffText("sales", adminText(lang, "common").features) };
  return { member, w: adminText(lang, "deals").activities };
}

/** Which field each problem is about, so the form marks it (`FormState.fields`). */
const FIELD = { kind: "kind", title: "title", note: "note", due: "dueOn", duration: "duration", assignee: "assigneeId" } as const;

function stateOf(w: Words, result: ActivityResult, success: string): FormState {
  if (result.ok) {
    refresh();
    return { status: "ok", messages: [success] };
  }
  const messages = [...new Set(result.problems.map((p) => w.problems[p]))];
  const fields = Object.fromEntries(result.problems.flatMap((p) => (p in FIELD ? [[FIELD[p as keyof typeof FIELD], w.problems[p]]] : [])));
  return { status: "error", messages, fields };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "");
const input = (form: FormData) => ({
  kind: text(form, "kind"),
  title: text(form, "title"),
  note: text(form, "note"),
  dueOn: text(form, "dueOn"),
  dueTime: text(form, "dueTime"),
  duration: text(form, "duration"),
  assigneeId: text(form, "assigneeId"),
  customerId: text(form, "customerId"),
  companyId: text(form, "companyId"),
  dealId: text(form, "dealId"),
});

/** A new activity, about what the page it was added on is about (the form's hidden fields). */
export async function addActivityAction(storeSlug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const who = await writer(storeSlug);
  if ("refused" in who) return { status: "error", messages: [who.refused] };
  return stateOf(who.w, await createActivity(who.member, input(form)), who.w.added);
}

/** An activity changed: what, when, for whom; what it is about stays as the form carries it. */
export async function changeActivityAction(storeSlug: string, id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const who = await writer(storeSlug);
  if ("refused" in who) return { status: "error", messages: [who.refused] };
  if (!uuid.safeParse(id).success) return { status: "error", messages: [who.w.problems.not_found] };
  return stateOf(who.w, await updateActivity(who.member, id, input(form)), who.w.saved);
}

/** Done, or not done again: one press from any list, the page drawn again. */
export async function activityDoneAction(storeSlug: string, id: string, done: boolean): Promise<void> {
  const who = await writer(storeSlug);
  if ("refused" in who || !uuid.safeParse(id).success) return;
  if ((await setActivityDone(who.member, id, done)).ok) refresh();
}

export async function deleteActivityAction(storeSlug: string, id: string): Promise<FormState> {
  const who = await writer(storeSlug);
  if ("refused" in who) return { status: "error", messages: [who.refused] };
  if (!uuid.safeParse(id).success) return { status: "error", messages: [who.w.problems.not_found] };
  return stateOf(who.w, await deleteActivity(who.member, id), who.w.saved);
}
