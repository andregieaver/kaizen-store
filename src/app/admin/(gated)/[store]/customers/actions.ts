"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { customerFormFields, staffProblemText } from "@/lib/customer-staff";
import { actionAdminLang } from "@/server/admin-request-lang";
import { createCustomer } from "@/server/customer-staff";
import { listCustomers } from "@/server/customer-admin";
import { BULK_TAG_MAX, tagMany } from "@/server/segments";
import { tagKey } from "@/lib/order-tags";
import { countWords, fillWords } from "@/lib/admin-fill";
import { CUSTOMERS_WORDS } from "@/lib/admin-words/customers";
import { cancelJob, registerCustomerImport, startCustomerApply, startCustomerCheck, startCustomerUpload } from "@/server/data-jobs";
import { checkPermission } from "@/server/permissions";

/**
 * Adding customers (wave 10 unit C, D366): the staff form (`customers:write`) and the customer import's steps (the owner's: a customer
 * file holds personal data), each with the store's slug as its bound first argument. The import's steps only start the work: the job runs
 * after the response, in the open page's ticks and in the five-minute job.
 */

const noAccess = async () => CUSTOMERS_WORDS[await actionAdminLang()].saved.noAccess;

type Step = { ok: true } | { ok: false; problem: string };

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

/** Adds a customer from the form and opens their page. */
export async function createCustomerAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { status: "error", messages: [await noAccess()] };
  const result = await createCustomer(member, customerFormFields(form));
  if (!result.ok) return { status: "error", messages: [staffProblemText(result.problem, CUSTOMERS_WORDS[adminLangOf(member.account.adminLocale)].staff.problems)] };
  redirect(`/admin/${member.store.slug}/customers/${result.id}`);
}

export async function startCustomerUploadAction(storeSlug: string, fileName: string) {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false as const, problem: await noAccess() };
  return startCustomerUpload(member, text(fileName, 200));
}

export async function registerCustomerUploadAction(storeSlug: string, input: { path: string; name: string }) {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false as const, problems: [await noAccess()] };
  const result = await registerCustomerImport(member, { path: text(input?.path, 600), name: text(input?.name, 200) });
  if (result.ok) refresh();
  return result;
}

export async function checkCustomerImportAction(storeSlug: string, jobId: string): Promise<Step> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, problem: await noAccess() };
  const result = await startCustomerCheck(member, text(jobId, 60));
  if (result.ok) refresh();
  return result;
}

export async function applyCustomerImportAction(storeSlug: string, jobId: string): Promise<Step> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, problem: await noAccess() };
  const result = await startCustomerApply(member, text(jobId, 60));
  if (result.ok) refresh();
  return result;
}

export async function cancelCustomerImportAction(storeSlug: string, jobId: string): Promise<Step> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, problem: await noAccess() };
  const result = await cancelJob(member, text(jobId, 60));
  refresh();
  return result;
}

/**
 * Adds a tag to, or takes it off, everyone the list's search, tag and view find on all its pages (D380, D834, `customers:write`): the people are read again here from the
 * same filter, never sent from the browser, at most `BULK_TAG_MAX`.
 */
export async function bulkTagAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { status: "error", messages: [await noAccess()] };
  const w = CUSTOMERS_WORDS[adminLangOf(member.account.adminLocale)].staff;
  const q = text(form.get("q"), 100);
  const tagText = text(form.get("filterTag"), 80);
  const filter = tagText ? tagKey(tagText) : null;
  // The list's view (D603) too, so "everyone" is everyone the list finds on all its pages (D834).
  const shown = form.get("show");
  const show = shown === "new" || shown === "back" || shown === "subscribed" ? shown : null;
  const mode = form.get("mode") === "remove" ? "remove" : "add";
  const people = await listCustomers(member.store.id, { q, tag: filter, show, limit: BULK_TAG_MAX + 1 });
  if (people.length > BULK_TAG_MAX) return { status: "error", messages: [w.bulk.tooMany] };
  const result = await tagMany(member.store.id, member.account.id, people.map((p) => p.email), text(form.get("tag"), 200), mode);
  if (!result.ok) return { status: "error", messages: [result.problem === "too_many" ? w.bulk.tooMany : w.bulk.badTag] };
  refresh();
  const done = countWords(result.changed, w.bulk.done);
  return { status: "ok", messages: [result.full > 0 ? done + fillWords(w.bulk.full, { n: String(result.full) }) : done] };
}

/** Round 3 (D603): a tag added to, or taken off, the people ticked on the list (their emails, at most one page of them). */
export async function tagTickedAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { status: "error", messages: [await noAccess()] };
  const w = CUSTOMERS_WORDS[adminLangOf(member.account.adminLocale)].staff;
  const emails = form.getAll("email").flatMap((value) => (typeof value === "string" && value ? [value.slice(0, 320)] : [])).slice(0, BULK_TAG_MAX + 1);
  if (emails.length > BULK_TAG_MAX) return { status: "error", messages: [w.bulk.tooMany] };
  const mode = form.get("mode") === "remove" ? "remove" : "add";
  const result = await tagMany(member.store.id, member.account.id, emails, text(form.get("tag"), 200), mode);
  if (!result.ok) return { status: "error", messages: [result.problem === "too_many" ? w.bulk.tooMany : w.bulk.badTag] };
  refresh();
  const done = countWords(result.changed, w.bulk.done);
  return { status: "ok", messages: [result.full > 0 ? done + fillWords(w.bulk.full, { n: String(result.full) }) : done] };
}
