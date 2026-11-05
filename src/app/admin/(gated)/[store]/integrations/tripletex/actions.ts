"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { failureWords } from "@/lib/tripletex-errors";
import { BOOKING_KEYS, DEFAULT_BOOKING, isBookingKey, readSettings, type TripletexSettings } from "@/lib/tripletex-settings";
import type { SettingsProblem } from "@/lib/tripletex-setup";
import { actionAdminLang } from "@/server/admin-request-lang";
import type { Membership } from "@/server/auth";
import { checkOwnerRole } from "@/server/permissions";
import {
  checkTripletexSettings,
  connectTripletex,
  disconnectTripletex,
  getTripletexConnection,
  pauseTripletex,
  saveTripletexSettings,
  setTripletexSyncFrom,
  startTripletex,
} from "@/server/tripletex";
import { retryTripletex } from "@/server/tripletex-sync";

/**
 * Tripletex (D453): the owner's actions on the Tripletex page. A connection sends the store's invoices and its customers' names and
 * organisation numbers to another company's books, and keeps a token to them, so only an owner connects, changes, starts, pauses or
 * disconnects it, as with every integration (D41).
 */
async function asOwner(storeSlug: string): Promise<Membership | string> {
  return (await checkOwnerRole(storeSlug)) ?? adminText(await actionAdminLang(), "notifications").integrations.tripletex.ownerOnly;
}

const wordsOf = (member: Membership) => adminText(adminLangOf(member.account.adminLocale), "notifications").integrations.tripletex;

const refused = (message: string): FormState => ({ status: "error", messages: [message] });

/** Each problem in a line: the bucket's words, then why Tripletex would refuse it. */
function problemLines(member: Membership, problems: readonly SettingsProblem[]): string[] {
  const w = wordsOf(member);
  return problems.map((p) => `${p.key === "receivable" ? w.receivable : w.buckets[p.key]}: ${w.problemWords[p.problem]}`);
}

export async function connectTripletexAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  const w = wordsOf(owner);
  const result = await connectTripletex(owner.account.id, owner.store.id, String(form.get("token") ?? ""));
  if (!result.ok) {
    const message = result.problem === "failure" && result.failureKey ? failureWords({ key: result.failureKey, class: "transient" }, w.failures) : w.connectProblems[result.problem];
    return refused(message);
  }
  refresh();
  return { status: "ok", messages: [fillWords(w.connectedTo, { company: result.company.name })] };
}

/** Start: checked against the company first, so nothing starts that Tripletex would refuse. */
export async function startTripletexAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  const w = wordsOf(owner);
  const connection = await getTripletexConnection(owner.store.id);
  if (!connection?.settings) return refused(w.startProblems.settings);
  const check = await checkTripletexSettings(owner.store.id, connection.settings);
  if (!check.ok) return refused(fillWords(w.cannotCheck, { problem: failureWords({ key: check.failureKey, class: "transient" }, w.failures) }));
  const day = String(form.get("syncFrom") ?? "").trim();
  const result = await startTripletex(owner.account.id, owner.store.id, { problems: check.problems, ...(day ? { syncFrom: day } : {}) });
  if (!result.ok) return { status: "error", messages: [w.startProblems[result.problem], ...(result.problem === "problems" ? problemLines(owner, check.problems) : [])] };
  refresh();
  return { status: "ok", messages: [fillWords(w.started, { date: result.syncFrom })] };
}

export async function pauseTripletexAction(storeSlug: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  await pauseTripletex(owner.account.id, owner.store.id);
  refresh();
  return { status: "ok", messages: [wordsOf(owner).paused] };
}

/** One question answered: the account the owner chose for a bucket (or for the receivable), with the bucket's standard VAT code. */
export async function chooseAccountAction(storeSlug: string, key: string, _state: FormState, form: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  const w = wordsOf(owner);
  const connection = await getTripletexConnection(owner.store.id);
  const account = Number(form.get("account"));
  if (!connection?.settings || !Number.isSafeInteger(account) || account < 1000 || account > 99999) return refused(w.invalid);
  const next: TripletexSettings =
    key === "receivable"
      ? { ...connection.settings, receivableAccount: account }
      : isBookingKey(key)
        ? { ...connection.settings, bookings: { ...connection.settings.bookings, [key]: { account, vatCode: connection.settings.bookings[key]?.vatCode ?? DEFAULT_BOOKING[key].vatCode } } }
        : connection.settings;
  return saveChecked(owner, next);
}

async function saveChecked(owner: Membership, next: TripletexSettings): Promise<FormState> {
  const w = wordsOf(owner);
  const check = await checkTripletexSettings(owner.store.id, next);
  if (!check.ok) return refused(fillWords(w.cannotCheck, { problem: failureWords({ key: check.failureKey, class: "transient" }, w.failures) }));
  const saved = await saveTripletexSettings(owner.account.id, owner.store.id, next, check.problems);
  if (!saved.ok) return { status: "error", messages: saved.problems.length > 0 ? [w.saveProblems, ...problemLines(owner, saved.problems)] : [w.invalid] };
  // Documents that waited for a place for their VAT, or for the settings, are sent now.
  await retryTripletex(owner.store.id, { errorKeys: ["vat_unmapped", "settings_problem"] });
  refresh();
  return { status: "ok", messages: [w.saved] };
}

/** Customise: every bucket's account and code (both empty: no place for it), the receivable, the language and the switches. */
export async function saveTripletexSettingsAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  const w = wordsOf(owner);
  const connection = await getTripletexConnection(owner.store.id);
  if (!connection?.settings) return refused(w.startProblems.settings);
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const bookings: TripletexSettings["bookings"] = {};
  for (const key of BOOKING_KEYS) {
    const account = text(`account_${key}`);
    const code = text(`vat_${key}`);
    if (account === "" && code === "") continue;
    bookings[key] = { account: Number(account), vatCode: code };
  }
  const next = readSettings({
    ...connection.settings,
    bookings,
    receivableAccount: Number(text("receivable")),
    language: text("language") === "en" ? "en" : "nb",
    sendContactEmail: form.get("sendContactEmail") === "on",
    sources: { work: form.get("sourceWork") === "on", shop: form.get("sourceShop") === "on" },
  });
  if (!next) return refused(w.invalid);
  const day = text("syncFrom");
  if (day && day !== connection.syncFrom) {
    const moved = await setTripletexSyncFrom(owner.account.id, owner.store.id, day);
    if (!moved.ok) return refused(w.startProblems[moved.problem]);
  }
  return saveChecked(owner, next);
}

export async function retryTripletexAction(storeSlug: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  const w = wordsOf(owner);
  const count = await retryTripletex(owner.store.id, { accountId: owner.account.id });
  refresh();
  return { status: "ok", messages: [count === 0 ? w.nothingToRetry : countWords(count, w.retried)] };
}

export async function disconnectTripletexAction(storeSlug: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, problems: [owner] };
  await disconnectTripletex(owner.account.id, owner.store.id);
  redirect(`/admin/${storeSlug}/integrations`);
}

const DOCUMENT_KINDS = ["work_invoice", "work_credit_note", "shop_invoice", "shop_credit_note"] as const;

/** Try again for one document, from its own page (a Work invoice, a shop invoice): the owner's press, audited. */
export async function retryTripletexDocumentAction(storeSlug: string, kind: string, localId: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  const w = wordsOf(owner);
  const known = DOCUMENT_KINDS.find((k) => k === kind);
  if (!known || !/^[0-9a-f-]{36}$/.test(localId)) return refused(w.nothingToRetry);
  const count = await retryTripletex(owner.store.id, { kind: known, localId, accountId: owner.account.id });
  refresh();
  return { status: "ok", messages: [count === 0 ? w.nothingToRetry : countWords(count, w.retried)] };
}
