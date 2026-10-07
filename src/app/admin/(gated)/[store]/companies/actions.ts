"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { INVITES_PER_BATCH, parseInviteEmails } from "@/lib/customer-tiers";
import { featureOn } from "@/lib/store-features";
import { NO_ACCESS, checkPermission, requirePermission } from "@/server/permissions";
import { lookupCompany, searchCompanies, type BrregLookup, type BrregSearch } from "@/server/brreg";
import { addMainAccount, createInvites, deleteCompany, removeMember, revokeInvite, saveCompany, staffEmailMarket } from "@/server/companies";
import type { SaveResult } from "@/server/settings";

const id = z.uuid();

function toState(result: SaveResult, success: string): FormState {
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [success] };
}

/** Company accounts are part of selling to businesses (D178): refused while it is switched off, whatever a stale page sends. */
const BUSINESS_OFF: FormState = { status: "error", messages: ["Selling to businesses is switched off under Settings, Features."] };

const bad = (what: string): FormState => ({ status: "error", messages: [`Unknown ${what}.`] });

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
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  if (!featureOn(member.store, "business")) return BUSINESS_OFF;
  if (companyId !== null && !id.safeParse(companyId).success) return bad("company");
  const result = await saveCompany(member, companyId, companyValues(form, companyId === null));
  if (!result.ok) return toState(result, "");
  if (companyId === null && result.id) {
    const main = String(form.get("mainAccount") ?? "").trim();
    if (main) {
      const added = await addMainAccount(member, result.id, main);
      if (!added.ok) return { status: "error", messages: [`The company was made, but its main account was not set: ${added.problems.join(" ")}`] };
    }
    redirect(`/admin/${member.store.slug}/companies/${result.id}`);
  }
  return toState(result, "Saved.");
}

export async function deleteCompanyAction(storeSlug: string, companyId: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  if (!featureOn(member.store, "business")) return BUSINESS_OFF;
  if (!id.safeParse(companyId).success) return bad("company");
  const result = await deleteCompany(member, companyId);
  if (result.ok) redirect(`/admin/${member.store.slug}/companies`);
  return toState(result, "Deleted.");
}

/** Makes an account the company's main account. */
export async function setMainAccountAction(storeSlug: string, companyId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  if (!featureOn(member.store, "business")) return BUSINESS_OFF;
  if (!id.safeParse(companyId).success) return bad("company");
  return toState(await addMainAccount(member, companyId, String(form.get("email") ?? "")), "Main account added.");
}

/** Takes an account out of the company, a main account too: their discount stops at once. */
export async function removeCompanyMemberAction(storeSlug: string, companyId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  if (!featureOn(member.store, "business")) return BUSINESS_OFF;
  const customerId = id.safeParse(form.get("customerId"));
  if (!id.safeParse(companyId).success || !customerId.success) return bad("account");
  const done = await removeMember(member.store.id, companyId, customerId.data, { allowOwner: true, market: await staffEmailMarket(member.store.id) });
  if (!done) return { status: "error", messages: ["That account is not in the company."] };
  refresh();
  return { status: "ok", messages: ["Removed from the company."] };
}

/** Invites employees on the company's behalf, as the store. */
export async function inviteToCompanyAction(storeSlug: string, companyId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  if (!featureOn(member.store, "business")) return BUSINESS_OFF;
  if (!id.safeParse(companyId).success) return bad("company");
  const { emails, invalid } = parseInviteEmails(String(form.get("emails") ?? ""));
  if (invalid.length > 0) return { status: "error", messages: [`Not email addresses: ${invalid.slice(0, 5).join(", ")}`] };
  if (emails.length === 0) return { status: "error", messages: ["Write at least one email address."] };
  const market = await staffEmailMarket(member.store.id);
  if (!market) return { status: "error", messages: ["The store has no market to write the email in."] };
  const result = await createInvites(member.store.id, companyId, emails.slice(0, INVITES_PER_BATCH), { invitedBy: null, inviterName: member.store.name, market });
  if (!result.ok) return { status: "error", messages: ["The company is switched off."] };
  const count = (outcome: string) => result.results.filter((r) => r.outcome === outcome).length;
  refresh();
  const notes = [
    count("sent") > 0 && `${count("sent")} sent`,
    count("resent") > 0 && `${count("resent")} sent again`,
    count("member") > 0 && `${count("member")} already in the company`,
    count("full") > 0 && `${count("full")} not invited: the company is full`,
    count("limit") > 0 && `${count("limit")} not invited: too many today`,
  ].filter(Boolean);
  return { status: count("sent") + count("resent") > 0 ? "ok" : "error", messages: [notes.join(", ")] };
}

export async function revokeCompanyInviteAction(storeSlug: string, companyId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  if (!featureOn(member.store, "business")) return BUSINESS_OFF;
  const inviteId = id.safeParse(form.get("inviteId"));
  if (!id.safeParse(companyId).success || !inviteId.success) return bad("invitation");
  const done = await revokeInvite(member.store.id, companyId, inviteId.data);
  if (!done) return { status: "error", messages: ["That invitation is no longer open."] };
  refresh();
  return { status: "ok", messages: ["Invitation withdrawn."] };
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
