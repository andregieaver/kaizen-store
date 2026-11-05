"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { BOOKING_KEYS, isBookingKey } from "@/lib/accounting-docs";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { FIKEN_STATE_COOKIE, FIKEN_STATE_MINUTES, FIKEN_STATE_PATH } from "@/lib/fiken";
import { fikenFailureWords } from "@/lib/fiken-errors";
import { DEFAULT_FIKEN_BOOKING, isFikenVatType, readFikenSettings, type FikenSettings } from "@/lib/fiken-settings";
import type { FikenSettingsProblem } from "@/lib/fiken-setup";
import { actionAdminLang } from "@/server/admin-request-lang";
import type { Membership } from "@/server/auth";
import { DOCUMENT_KINDS } from "@/server/accounting-documents";
import {
  checkFikenSettingsNow,
  chooseFikenCompany,
  disconnectFiken,
  getFikenConnection,
  pauseFiken,
  saveFikenSettings,
  setFikenSyncFrom,
  startFiken,
  startFikenConnect,
} from "@/server/fiken";
import { postFikenAgain, retryFiken } from "@/server/fiken-sync";
import { checkOwnerRole } from "@/server/permissions";

/**
 * Fiken (D460): the owner's actions on the Fiken page. A connection sends the store's invoices and its customers' names and organisation
 * numbers to the company's books in Fiken, and keeps a grant to them, so only an owner connects, chooses the company, changes, starts,
 * pauses or disconnects it, as with every integration (D41).
 */
async function asOwner(storeSlug: string): Promise<Membership | string> {
  return (await checkOwnerRole(storeSlug)) ?? adminText(await actionAdminLang(), "fiken").ownerOnly;
}

const wordsOf = (member: Membership) => adminText(adminLangOf(member.account.adminLocale), "fiken");

const refused = (message: string): FormState => ({ status: "error", messages: [message] });

function problemLines(member: Membership, problems: readonly FikenSettingsProblem[]): string[] {
  const w = wordsOf(member);
  return problems.map((p) => `${w.buckets[p.key]}: ${w.problemWords[p.problem]}`);
}

/** Connect Fiken: the state cookie set here, then Fiken's own consent page. */
export async function connectFikenAction(storeSlug: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  const start = await startFikenConnect(owner);
  if (!start.ok) return refused(wordsOf(owner).connectProblems[start.problem]);
  (await cookies()).set(FIKEN_STATE_COOKIE, start.cookie, { httpOnly: true, secure: true, sameSite: "lax", path: FIKEN_STATE_PATH, maxAge: FIKEN_STATE_MINUTES * 60 });
  redirect(start.url);
}

/** The company the store's books are in, from those the grant opens. */
export async function chooseCompanyAction(storeSlug: string, slug: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  const w = wordsOf(owner);
  const chosen = await chooseFikenCompany(owner.account.id, owner.store.id, slug);
  if (!chosen.ok) return refused(chosen.problem === "failure" && chosen.failureKey ? fikenFailureWords({ key: chosen.failureKey, class: "transient" }, w.failures) : w.chooseProblems[chosen.problem]);
  refresh();
  return { status: "ok", messages: [fillWords(w.chosen, { company: chosen.company.name })] };
}

/** Start: checked against the company first, so nothing starts that Fiken would refuse. */
export async function startFikenAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  const w = wordsOf(owner);
  const connection = await getFikenConnection(owner.store.id);
  if (!connection?.settings) return refused(w.startProblems.settings);
  const check = await checkFikenSettingsNow(owner.store.id, connection.settings);
  if (!check.ok) return refused(fillWords(w.cannotCheck, { problem: fikenFailureWords({ key: check.failureKey, class: "transient" }, w.failures) }));
  const day = String(form.get("syncFrom") ?? "").trim();
  const result = await startFiken(owner.account.id, owner.store.id, { problems: check.problems, ...(day ? { syncFrom: day } : {}) });
  if (!result.ok) return { status: "error", messages: [w.startProblems[result.problem], ...(result.problem === "problems" ? problemLines(owner, check.problems) : [])] };
  refresh();
  return { status: "ok", messages: [fillWords(w.started, { date: result.syncFrom })] };
}

export async function pauseFikenAction(storeSlug: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  await pauseFiken(owner.account.id, owner.store.id);
  refresh();
  return { status: "ok", messages: [wordsOf(owner).paused] };
}

/** One question answered: the account the owner chose for a bucket, with the bucket's VAT type as it was (or its standard one). */
export async function chooseFikenAccountAction(storeSlug: string, key: string, _state: FormState, form: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  const w = wordsOf(owner);
  const connection = await getFikenConnection(owner.store.id);
  const account = String(form.get("account") ?? "").trim();
  if (!connection?.settings || !isBookingKey(key) || !/^\d{4}$/.test(account)) return refused(w.invalid);
  const vatType = connection.settings.bookings[key]?.vatType ?? DEFAULT_FIKEN_BOOKING[key].vatType;
  return saveChecked(owner, { ...connection.settings, bookings: { ...connection.settings.bookings, [key]: { account, vatType } } });
}

async function saveChecked(owner: Membership, next: FikenSettings): Promise<FormState> {
  const w = wordsOf(owner);
  const check = await checkFikenSettingsNow(owner.store.id, next);
  if (!check.ok) return refused(fillWords(w.cannotCheck, { problem: fikenFailureWords({ key: check.failureKey, class: "transient" }, w.failures) }));
  const saved = await saveFikenSettings(owner.account.id, owner.store.id, next, check.problems);
  if (!saved.ok) return { status: "error", messages: saved.problems.length > 0 ? [w.saveProblems, ...problemLines(owner, saved.problems)] : [w.invalid] };
  // Documents that waited for a place for their VAT, or for the settings, are sent now.
  await retryFiken(owner.store.id, { errorKeys: ["vat_unmapped", "settings_problem"] });
  refresh();
  return { status: "ok", messages: [w.saved] };
}

/** Customise: every bucket's account and VAT type (an empty account: no place for it), the language and the switches. */
export async function saveFikenSettingsAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  const w = wordsOf(owner);
  const connection = await getFikenConnection(owner.store.id);
  if (!connection?.settings) return refused(w.startProblems.settings);
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const bookings: FikenSettings["bookings"] = {};
  for (const key of BOOKING_KEYS) {
    const account = text(`account_${key}`);
    const vatType = text(`vat_${key}`);
    if (account === "") continue;
    if (!/^\d{4}$/.test(account) || !isFikenVatType(vatType)) return refused(w.invalid);
    bookings[key] = { account, vatType };
  }
  const next = readFikenSettings({
    ...connection.settings,
    bookings,
    language: text("language") === "en" ? "en" : "nb",
    sendContactEmail: form.get("sendContactEmail") === "on",
    attachPdf: form.get("attachPdf") === "on",
    sources: { work: form.get("sourceWork") === "on", shop: form.get("sourceShop") === "on" },
  });
  if (!next) return refused(w.invalid);
  const day = text("syncFrom");
  if (day && day !== connection.syncFrom) {
    const moved = await setFikenSyncFrom(owner.account.id, owner.store.id, day);
    if (!moved.ok) return refused(w.startProblems[moved.problem]);
  }
  return saveChecked(owner, next);
}

export async function retryFikenAction(storeSlug: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  const w = wordsOf(owner);
  const count = await retryFiken(owner.store.id, { accountId: owner.account.id });
  refresh();
  return { status: "ok", messages: [count === 0 ? w.nothingToRetry : countWords(count, w.retried)] };
}

/** Post again: a sale deleted in Fiken booked anew (the owner's choice, audited). */
export async function postFikenAgainAction(storeSlug: string, kind: string, localId: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return refused(owner);
  const w = wordsOf(owner);
  const known = DOCUMENT_KINDS.find((k) => k === kind);
  if (!known || !/^[0-9a-f-]{36}$/.test(localId) || !(await postFikenAgain(owner.store.id, known, localId, owner.account.id))) return refused(w.nothingToRetry);
  refresh();
  return { status: "ok", messages: [w.postedAgain] };
}

export async function disconnectFikenAction(storeSlug: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, problems: [owner] };
  await disconnectFiken(owner.account.id, owner.store.id);
  redirect(`/admin/${storeSlug}/integrations`);
}
