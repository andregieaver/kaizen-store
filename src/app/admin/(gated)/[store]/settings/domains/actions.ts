"use server";

import { refresh } from "next/cache";
import { after } from "next/server";

import type { FormState } from "@/components/admin/action-form";
import { NO_ACCESS, checkOwnerRole, checkPermission } from "@/server/permissions";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { domainLanguages } from "@/lib/custom-domains";
import { addStoreDomain, checkStoreDomain, listStoreDomains, removeStoreDomain, setDomainLanguage, setPrimaryDomain } from "@/server/domains";
import { domainPricingRows, storeDomainCurrency } from "@/server/domain-prices";
import { chargeDomainPurchases, renewDomainNow, setDomainRenewal, startDomainPurchase } from "@/server/domain-purchases";
import { storeRegistrations } from "@/server/domain-registrations";
import { searchDomains, type SearchAnswer } from "@/server/domain-search";

/** A store's own domains (P8) are the owner's: they decide where the store lives. */
const asOwner = (storeSlug: string) => checkOwnerRole(storeSlug);

const notOwner: FormState = { status: "error", messages: ["Only an owner can change the store's domains."] };
const done = (messages: string[]): FormState => {
  refresh();
  return { status: "ok", messages };
};

export async function addDomainAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await asOwner(storeSlug);
  if (!member) return notOwner;
  const result = await addStoreDomain(member.account, member.store.id, { hostname: String(form.get("hostname") ?? "") });
  if (!result.ok) return { status: "error", messages: result.problems };
  return done([`${result.domain.hostname} added. Create the DNS records below at your domain's DNS provider.`]);
}

/** Anyone on the staff may ask for a check: it changes nothing the DNS does not already say. */
export async function checkDomainAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await checkStoreDomain(member.store.id, String(form.get("id") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  return done([
    result.domain.status === "active"
      ? `${result.domain.hostname} is ready. Your store appears there within a few minutes.`
      : "Checked. Not every record is in place yet: DNS changes can take a while to show.",
  ]);
}

export async function primaryDomainAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await asOwner(storeSlug);
  if (!member) return notOwner;
  const id = String(form.get("id") ?? "");
  const result = await setPrimaryDomain(member.account, member.store.id, id || null);
  if (!result.ok) return { status: "error", messages: result.problems };
  return done(["Saved. The store moves to its new address within a few minutes."]);
}

export async function removeDomainAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await asOwner(storeSlug);
  if (!member) return notOwner;
  const result = await removeStoreDomain(member.account, member.store.id, String(form.get("id") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  return done(["Removed."]);
}

/** Makes a domain one language's own address (D313), or every language's again. */
export async function languageDomainAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await asOwner(storeSlug);
  if (!member) return notOwner;
  const language = String(form.get("language") ?? "") || null;
  const allowed = domainLanguages(member.store).map((l) => l.lang);
  const result = await setDomainLanguage(member.account, member.store.id, String(form.get("id") ?? ""), language, allowed);
  if (!result.ok) return { status: "error", messages: result.problems };
  return done([language ? "Saved. The domain shows that language within a few minutes once it is active." : "Saved. The domain leads to your address."]);
}

/** Searches for a name to buy (D315 4.2): anyone who may change the store's settings (a search spends the store's hourly searches); buying is the owner's. */
export async function searchDomainsAction(storeSlug: string, query: string): Promise<SearchAnswer> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, reason: "empty", message: NO_ACCESS };
  const storeId = member.store.id;
  const [domains, registrations, priced] = await Promise.all([listStoreDomains(storeId), storeRegistrations(storeId), domainPricingRows()]);
  const owned = [...domains.map((d) => d.hostname), ...registrations.map((r) => r.apex)];
  const currency = await storeDomainCurrency(storeId, priced.map((p) => p.currency));
  return searchDomains(String(query ?? "").slice(0, 200), { asker: { store: storeId }, currency, owned });
}

/** Buys a name for the store (D315 4.4): owners only; the price on the button must still be the price. Invoicing follows after the answer. */
export async function buyDomainAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await asOwner(storeSlug);
  if (!member) return notOwner;
  const words = adminText(adminLangOf(member.account.adminLocale), "domains");
  const value = (key: string) => String(form.get(key) ?? "");
  const result = await startDomainPurchase(member.account, member.store.id, {
    domain: value("domain"),
    years: Number(value("years")) || 1,
    agreed: value("agreed"),
    connect: form.get("connect") === "on",
    registrant: {
      kind: value("kind") === "company" ? "company" : "person",
      firstName: value("firstName"),
      lastName: value("lastName"),
      companyName: value("companyName"),
      orgNumber: value("orgNumber"),
      email: value("email"),
      phone: value("phone"),
      address1: value("address1"),
      address2: value("address2"),
      city: value("city"),
      state: value("state"),
      postalCode: value("postalCode"),
      country: value("country"),
    },
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  after(() => chargeDomainPurchases({ storeId: member.store.id }).then(() => undefined));
  return done([words.get.started.replaceAll("{domain}", result.quote.domain)]);
}

/** Turns a registration's renewal on or off (D315 9.1): owners only. */
export async function domainRenewalAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await asOwner(storeSlug);
  if (!member) return notOwner;
  const result = await setDomainRenewal(member.account, member.store.id, String(form.get("domain") ?? ""), form.get("renew") === "on");
  if (!result.ok) return { status: "error", messages: result.problems };
  return done([adminText(adminLangOf(member.account.adminLocale), "domains").registrations.saved]);
}

/** Renews a registration a year now at the price the button named (D315 9.1): owners only. */
export async function renewDomainAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await asOwner(storeSlug);
  if (!member) return notOwner;
  const domain = String(form.get("domain") ?? "");
  const result = await renewDomainNow(member.account, member.store.id, domain, 1, String(form.get("agreed") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  after(() => chargeDomainPurchases({ storeId: member.store.id }).then(() => undefined));
  return done([adminText(adminLangOf(member.account.adminLocale), "domains").registrations.renewing.replaceAll("{domain}", domain)]);
}
