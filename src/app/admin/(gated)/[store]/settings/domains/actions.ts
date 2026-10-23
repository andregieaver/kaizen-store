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
import { applyDnsChange, previewDnsChange, setDnsAuto, undoDnsChange, zoneRecords } from "@/server/domain-dns";
import { effectText, type DnsChange } from "@/lib/dns-plan";
import { describeRecord } from "@/lib/dns-records";
import { parseRecordLines, recipeChanges, RECIPE_IDS, type RecipeId } from "@/lib/dns-recipes";

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

// ---------------------------------------------------------------------------
// DNS kept by Kaizena Flow (D315 phase 3): owners only, every change checked first.
// ---------------------------------------------------------------------------

export type DnsDraft =
  | { kind: "records"; add: string; remove: string[] }
  | { kind: "recipe"; recipe: RecipeId; values: Record<string, string> };

export type DnsCheck = { ok: true; effects: string[]; lines: string[]; rev: string; touchesEmail: boolean } | { ok: false; problems: string[] };

/** The changes a draft stands for, on the zone's live records. */
async function draftChanges(storeId: string, apex: string, draft: DnsDraft): Promise<{ ok: true; changes: DnsChange[] } | { ok: false; problems: string[] }> {
  const read = await zoneRecords(storeId, apex);
  if (!read.ok) return read;
  if (draft.kind === "recipe") {
    if (!(RECIPE_IDS as string[]).includes(draft.recipe)) return { ok: false, problems: ["Choose what to set up."] };
    return recipeChanges(draft.recipe, draft.values ?? {}, read.records);
  }
  const parsed = parseRecordLines(String(draft.add ?? "").slice(0, 8000));
  if (parsed.problems.length > 0) return { ok: false, problems: parsed.problems };
  const removes = read.records.filter((r) => (draft.remove ?? []).includes(r.id));
  return { ok: true, changes: [...removes.map((r): DnsChange => ({ op: "remove", record: r })), ...parsed.records.map((r): DnsChange => ({ op: "add", record: r }))] };
}

/** Checks a DNS change and says what it does, in the owner's language; nothing is changed. */
export async function checkDnsAction(storeSlug: string, apex: string, draft: DnsDraft): Promise<DnsCheck> {
  const member = await asOwner(storeSlug);
  if (!member) return { ok: false, problems: notOwner.messages };
  const words = adminText(adminLangOf(member.account.adminLocale), "domains").dns;
  const made = await draftChanges(member.store.id, apex, draft);
  if (!made.ok) return made;
  const preview = await previewDnsChange(member.store.id, apex, made.changes);
  if (!preview.ok) return preview;
  const { plan } = preview;
  if (!plan.ok) return { ok: false, problems: plan.problems.length > 0 ? plan.problems : [words.nothing] };
  return {
    ok: true,
    effects: plan.effects.map((e) => effectText(e, words.effects)),
    lines: [...plan.removes.map((r) => `− ${describeRecord(r, apex)}`), ...plan.adds.map((r) => `+ ${describeRecord(r, apex)}`)],
    rev: plan.rev,
    touchesEmail: plan.touchesEmail,
  };
}

/** Makes a checked DNS change: refused when the records moved since the check (`rev`). */
export async function applyDnsAction(storeSlug: string, apex: string, draft: DnsDraft, rev: string): Promise<FormState> {
  const member = await asOwner(storeSlug);
  if (!member) return notOwner;
  const words = adminText(adminLangOf(member.account.adminLocale), "domains").dns;
  const made = await draftChanges(member.store.id, apex, draft);
  if (!made.ok) return { status: "error", messages: made.problems };
  const result = await applyDnsChange(member.account, member.store.id, apex, made.changes, { source: draft.kind === "recipe" ? "recipe" : "editor", rev });
  if (!result.ok) return { status: "error", messages: result.problems };
  return done([words.done]);
}

/** Undoes a DNS change while the records are as it left them. */
export async function undoDnsAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await asOwner(storeSlug);
  if (!member) return notOwner;
  const result = await undoDnsChange(member.account, member.store.id, String(form.get("change") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  return done([adminText(adminLangOf(member.account.adminLocale), "domains").dns.done]);
}

/** The owner's switch: the AI manager changes DNS records without asking (D315 decision 5). */
export async function dnsAutoAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await asOwner(storeSlug);
  if (!member) return notOwner;
  await setDnsAuto(member.account, member.store.id, form.get("on") === "on");
  return done([adminText(adminLangOf(member.account.adminLocale), "domains").registrations.saved]);
}
