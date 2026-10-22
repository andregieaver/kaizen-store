"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import type { CustomersMessages } from "@/lib/admin-messages/customers.en";
import { adminText } from "@/lib/admin-text";
import { INVITES_PER_BATCH, parseInviteEmails } from "@/lib/customer-tiers";
import { mainCurrency } from "@/lib/markets";
import { parsePrice } from "@/lib/product-input";
import { featureOn } from "@/lib/store-features";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission, requirePermission } from "@/server/permissions";
import { lookupCompany, searchCompanies, type BrregLookup, type BrregSearch } from "@/server/brreg";
import { addMainAccount, createInvites, deleteCompany, removeMember, revokeInvite, saveCompany, staffEmailMarket } from "@/server/companies";
import { saveCompanyTerms } from "@/server/payment-terms";
import type { SaveResult } from "@/server/settings";

const id = z.uuid();

function toState(result: SaveResult, success: string): FormState {
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [success] };
}

type Words = CustomersMessages["saved"];
const wordsOf = (member: { account: { adminLocale?: string | null } }): Words => adminText(adminLangOf(member.account.adminLocale), "customers").saved;
const noAccess = async (): Promise<FormState> => ({ status: "error", messages: [adminText(await actionAdminLang(), "customers").saved.noAccess] });
const fail = (message: string): FormState => ({ status: "error", messages: [message] });

/** Company accounts are part of selling to businesses (D178): refused while it is switched off, whatever a stale page sends. */
const businessOff = (words: Words): FormState => fail(words.businessOff);

function companyValues(form: FormData, creating: boolean) {
  return {
    name: String(form.get("name") ?? ""),
    organisationNumber: String(form.get("organisationNumber") ?? ""),
    tierId: String(form.get("tierId") ?? ""),
    employeeSharePercent: String(form.get("employeeSharePercent") ?? "100") as unknown as number,
    maxMembers: String(form.get("maxMembers") ?? "25") as unknown as number,
    active: creating ? true : form.get("active") === "on",
  };
}

/** Makes a company (id null) with its main account, or changes one (D108). */
export async function saveCompanyAction(storeSlug: string, companyId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const words = wordsOf(member);
  if (!featureOn(member.store, "business")) return businessOff(words);
  if (companyId !== null && !id.safeParse(companyId).success) return fail(words.unknownCompany);
  const result = await saveCompany(member, companyId, companyValues(form, companyId === null));
  if (!result.ok) return toState(result, "");
  if (companyId === null && result.id) {
    const main = String(form.get("mainAccount") ?? "").trim();
    if (main) {
      const added = await addMainAccount(member, result.id, main);
      if (!added.ok) return { status: "error", messages: [fillWords(words.madeWithoutMain, { problems: added.problems.join(" ") })] };
    }
    redirect(`/admin/${member.store.slug}/companies/${result.id}`);
  }
  return toState(result, words.saved);
}

/** Sets a company's payment terms and credit limit (D293), the limit typed in the store's main currency. */
export async function saveCompanyTermsAction(storeSlug: string, companyId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const words = wordsOf(member);
  if (!featureOn(member.store, "business")) return businessOff(words);
  if (!id.safeParse(companyId).success) return fail(words.unknownCompany);
  const currency = mainCurrency(member.store);
  const terms = String(form.get("terms") ?? "");
  const typed = String(form.get("creditLimit") ?? "").trim();
  const limit = typed === "" ? null : parsePrice(typed, currency);
  if (typed !== "" && limit === null) return { status: "error", messages: [fillWords(words.notAnAmount, { typed, currency })] };
  const result = await saveCompanyTerms(member, companyId, { terms: terms || null, creditLimitMinor: limit }, currency);
  if (!result.ok) return { status: "error", messages: [result.problem] };
  refresh();
  return { status: "ok", messages: [words.saved] };
}

export async function deleteCompanyAction(storeSlug: string, companyId: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const words = wordsOf(member);
  if (!featureOn(member.store, "business")) return businessOff(words);
  if (!id.safeParse(companyId).success) return fail(words.unknownCompany);
  const result = await deleteCompany(member, companyId);
  if (result.ok) redirect(`/admin/${member.store.slug}/companies`);
  return toState(result, words.deleted);
}

/** Makes an account the company's main account. */
export async function setMainAccountAction(storeSlug: string, companyId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const words = wordsOf(member);
  if (!featureOn(member.store, "business")) return businessOff(words);
  if (!id.safeParse(companyId).success) return fail(words.unknownCompany);
  return toState(await addMainAccount(member, companyId, String(form.get("email") ?? "")), words.mainAdded);
}

/** Takes an account out of the company, a main account too: their discount stops at once. */
export async function removeCompanyMemberAction(storeSlug: string, companyId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const words = wordsOf(member);
  if (!featureOn(member.store, "business")) return businessOff(words);
  const customerId = id.safeParse(form.get("customerId"));
  if (!id.safeParse(companyId).success || !customerId.success) return fail(words.unknownAccount);
  const done = await removeMember(member.store.id, companyId, customerId.data, { allowOwner: true, market: await staffEmailMarket(member.store.id) });
  if (!done) return { status: "error", messages: [words.notInCompany] };
  refresh();
  return { status: "ok", messages: [words.removedFromCompany] };
}

/** Invites employees on the company's behalf, as the store. */
export async function inviteToCompanyAction(storeSlug: string, companyId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const words = wordsOf(member);
  if (!featureOn(member.store, "business")) return businessOff(words);
  if (!id.safeParse(companyId).success) return fail(words.unknownCompany);
  const { emails, invalid } = parseInviteEmails(String(form.get("emails") ?? ""));
  if (invalid.length > 0) return { status: "error", messages: [fillWords(words.notEmails, { list: invalid.slice(0, 5).join(", ") })] };
  if (emails.length === 0) return { status: "error", messages: [words.writeOne] };
  const market = await staffEmailMarket(member.store.id);
  if (!market) return { status: "error", messages: [words.noMarket] };
  const result = await createInvites(member.store.id, companyId, emails.slice(0, INVITES_PER_BATCH), { invitedBy: null, inviterName: member.store.name, market });
  if (!result.ok) return { status: "error", messages: [words.companyOff] };
  const count = (outcome: string) => result.results.filter((r) => r.outcome === outcome).length;
  refresh();
  const notes = [
    count("sent") > 0 && fillWords(words.invites.sent, { n: count("sent") }),
    count("resent") > 0 && fillWords(words.invites.resent, { n: count("resent") }),
    count("member") > 0 && fillWords(words.invites.member, { n: count("member") }),
    count("full") > 0 && fillWords(words.invites.full, { n: count("full") }),
    count("limit") > 0 && fillWords(words.invites.limit, { n: count("limit") }),
  ].filter(Boolean);
  return { status: count("sent") + count("resent") > 0 ? "ok" : "error", messages: [notes.join(", ")] };
}

export async function revokeCompanyInviteAction(storeSlug: string, companyId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const words = wordsOf(member);
  if (!featureOn(member.store, "business")) return businessOff(words);
  const inviteId = id.safeParse(form.get("inviteId"));
  if (!id.safeParse(companyId).success || !inviteId.success) return fail(words.unknownInvitation);
  const done = await revokeInvite(member.store.id, companyId, inviteId.data);
  if (!done) return { status: "error", messages: [words.inviteGone] };
  refresh();
  return { status: "ok", messages: [words.withdrawn] };
}

/**
 * A company from Brønnøysundregistrene by organisation number, to fill in a company account's name and number
 * (D124). Store staff only; only the number goes to the register.
 */
export async function lookupRegisterCompanyAction(storeSlug: string, input: string): Promise<BrregLookup> {
  await requirePermission(storeSlug, "customers:write");
  return lookupCompany(String(input).slice(0, 60));
}

/** The same by name: up to eight companies to choose from. */
export async function searchRegisterCompaniesAction(storeSlug: string, input: string): Promise<BrregSearch> {
  await requirePermission(storeSlug, "customers:write");
  return searchCompanies(String(input).slice(0, 120));
}
