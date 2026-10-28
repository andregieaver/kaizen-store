"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import type { BonusResult } from "@/lib/bonus";
import { CUSTOMER_NOTE_MAX, cleanEmail, customerFormFields, staffProblemText, type MergeCounts } from "@/lib/customer-staff";
import { formatMoney } from "@/lib/money";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { adjustBonus, bonusProgram } from "@/server/bonus";
import { db } from "@/db/client";
import { customerIdByEmail, mergeCustomers, mergePreview } from "@/server/customer-merge";
import { addGuestAsCustomer, addNote, deleteNote, updateCustomer } from "@/server/customer-staff";
import { findCustomer } from "@/server/customer-admin";
import { saveStaffFields } from "@/server/field-entities";
import { addTag, removeTag } from "@/server/segments";
import type { SaveResult } from "@/server/settings";

const wordsOf = (member: { account: { adminLocale?: string | null } }) => adminText(adminLangOf(member.account.adminLocale), "customers").saved;
const noAccess = async () => adminText(await actionAdminLang(), "customers").saved.noAccess;

/**
 * Saves staff's custom fields for a customer with an account (D120). They are
 * for staff only and never shown on the site, so no cache tag is touched; the
 * server checks everything against the store's own groups.
 */
export async function saveCustomerFieldsAction(storeSlug: string, customerId: string, changes: unknown): Promise<SaveResult> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  if (!z.uuid().safeParse(customerId).success) return { ok: false, problems: [wordsOf(member).unknownCustomer] };
  const result = await saveStaffFields(member, "customer", customerId, changes);
  if (result.ok) refresh();
  return result;
}

/**
 * Adds credits to a customer's bonus balance, or takes some away (negative), with a reason the history keeps (D130).
 * Owners and admins both may; the server keeps the balance from going below zero and writes the audit log.
 */
export async function adjustBonusAction(storeSlug: string, customerId: string, amountMinor: number, note: string): Promise<BonusResult> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  if (!z.uuid().safeParse(customerId).success) return { ok: false, problems: [wordsOf(member).unknownCustomer] };
  if (!Number.isSafeInteger(amountMinor) || amountMinor === 0) return { ok: false, problems: [wordsOf(member).bonusAmount] };
  const result = await adjustBonus(member.account, member.store.id, customerId, amountMinor, String(note ?? ""));
  if (result.ok) refresh();
  return result;
}

/** Tags the person (D296), found by the page's own key; the address is read on the server, never sent by the browser. */
export async function addCustomerTagAction(storeSlug: string, key: string, form: FormData): Promise<void> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member || !z.uuid().safeParse(key).success) return;
  const ref = await findCustomer(member.store.id, key);
  if (!ref) return;
  await addTag(member.store.id, member.account.id, ref.email, String(form.get("tag") ?? ""));
  refresh();
}

export async function removeCustomerTagAction(storeSlug: string, key: string, tag: string): Promise<void> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member || !z.uuid().safeParse(key).success) return;
  const ref = await findCustomer(member.store.id, key);
  if (!ref) return;
  await removeTag(member.store.id, member.account.id, ref.email, tag);
  refresh();
}

const staffWords = (member: { account: { adminLocale?: string | null } }) => adminText(adminLangOf(member.account.adminLocale), "customers").staff;

/** Staff change a customer's details (wave 10 unit C, D366): the form's whole state, checked and written by `updateCustomer()`. */
export async function updateCustomerAction(storeSlug: string, customerId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { status: "error", messages: [await noAccess()] };
  const w = staffWords(member);
  if (!z.uuid().safeParse(customerId).success) return { status: "error", messages: [w.problems.not_found] };
  const result = await updateCustomer(member, customerId, customerFormFields(form));
  if (!result.ok) return { status: "error", messages: [staffProblemText(result.problem, w.problems)] };
  refresh();
  return { status: "ok", messages: [w.form.saved] };
}

/** Gives a guest (a person with orders and no account) an account by their own address, read on the server, and opens it. */
export async function addGuestAction(storeSlug: string, key: string): Promise<void> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member || !z.uuid().safeParse(key).success) return;
  const result = await addGuestAsCustomer(member, key);
  if (result.ok) redirect(`/admin/${member.store.slug}/customers/${result.id}`);
  refresh();
}

/** Adds a note on the person, found by the page's own key. */
export async function addNoteAction(storeSlug: string, key: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { status: "error", messages: [await noAccess()] };
  const w = staffWords(member).notes;
  if (!z.uuid().safeParse(key).success) return { status: "error", messages: [w.not_found] };
  const result = await addNote(member, key, form.get("note"));
  if (!result.ok) return { status: "error", messages: [fillWords(w[result.problem], { max: CUSTOMER_NOTE_MAX })] };
  refresh();
  return { status: "ok", messages: [] };
}

export async function deleteNoteAction(storeSlug: string, key: string, noteId: string): Promise<void> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member || !z.uuid().safeParse(key).success || !z.uuid().safeParse(noteId).success) return;
  await deleteNote(member, key, noteId);
  refresh();
}

/** What a merge would move, as the page shows it: the counts, the bonus as an amount, and the other account's id and email (typed by staff). */
export type MergeAsk = { ok: true; other: string; email: string; counts: MergeCounts; bonus: string | null } | { ok: false; problem: string };

/** The merge's preview: the other customer by the email staff typed, and what folding them in would move, or why it cannot. Changes nothing. */
export async function previewMergeAction(storeSlug: string, keep: string, email: string): Promise<MergeAsk> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { ok: false, problem: await noAccess() };
  const w = staffWords(member).merge;
  const typed = cleanEmail(email);
  if (!typed) return { ok: false, problem: staffWords(member).problems.email };
  const other = await customerIdByEmail(member.store.id, typed);
  if (!other) return { ok: false, problem: w.notFound };
  const plan = await mergePreview(member, keep, other);
  if (!plan.ok) return { ok: false, problem: w.refusals[plan.refusal] };
  const bonus = plan.counts.bonusMinor > 0 ? formatMoney(plan.counts.bonusMinor, (await bonusProgram(db(), member.store.id)).currency, member.store.markets[0]?.locale ?? "nb-NO") : null;
  return { ok: true, other, email: typed, counts: plan.counts, bonus };
}

/** Folds the other customer into this one, the plan read again under both rows' locks, and opens the customer kept. */
export async function mergeCustomersAction(storeSlug: string, keep: string, remove: string): Promise<{ ok: false; problem: string }> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { ok: false, problem: await noAccess() };
  const plan = await mergeCustomers(member, keep, remove);
  if (!plan.ok) return { ok: false, problem: staffWords(member).merge.refusals[plan.refusal] };
  redirect(`/admin/${member.store.slug}/customers/${keep}?merged=1`);
}
