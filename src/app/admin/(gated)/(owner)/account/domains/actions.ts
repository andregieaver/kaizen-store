"use server";

import { refresh } from "next/cache";
import { after } from "next/server";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { effectText } from "@/lib/dns-plan";
import { describeRecord } from "@/lib/dns-records";
import { DOMAINS_WORDS } from "@/lib/admin-words/domains";
import { requireAccount } from "@/server/auth";
import { linkableStores, linkDomain, unlinkDomain } from "@/server/domain-account";
import { setHolding } from "@/server/holding";
import { confirmHolderProposal, holderTurn, type HolderAnswer, type HolderMessage } from "@/server/holder-assistant";
import { createAccessRequest } from "@/server/platform";
import { heldDomains } from "@/server/domain-account";
import { applyDnsChange, previewDnsChange, setDnsAuto, undoDnsChange } from "@/server/domain-dns";
import { accountHolder } from "@/server/domain-holder";
import { chargeDomainPurchases, renewDomainNow, setDomainRenewal } from "@/server/domain-purchases";
import { draftChanges, type DnsDraft } from "@/server/dns-draft";
import { NOTIFICATIONS_WORDS } from "@/lib/admin-words/notifications";
import { ownedAccount } from "@/server/privacy-officers";
import { sendingDomainForm } from "@/server/sending-domain-form";

/**
 * *Your domains* (D317): everything here acts as the signed-in account, on the domains it holds; a domain another account holds is simply
 * not found. A store's own Domains page stays its owners' (D315).
 */
const holderNow = async () => {
  const account = await requireAccount();
  return { account, holder: accountHolder(account.id), words: DOMAINS_WORDS[adminLangOf(account.adminLocale)] };
};

const done = (messages: string[]): FormState => {
  refresh();
  return { status: "ok", messages };
};

export async function linkDomainAction(_state: FormState, form: FormData): Promise<FormState> {
  const { account, words } = await holderNow();
  const apex = String(form.get("domain") ?? "");
  const storeId = String(form.get("store") ?? "");
  const result = await linkDomain(account, apex, storeId);
  if (!result.ok) return { status: "error", messages: result.problems };
  const store = (await linkableStores(account.id)).find((s) => s.id === storeId)?.name ?? "";
  return done([fillWords(result.connected ? words.account.linkedConnected : words.account.linked, { store, domain: apex })]);
}

export async function unlinkDomainAction(_state: FormState, form: FormData): Promise<FormState> {
  const { account, words } = await holderNow();
  const apex = String(form.get("domain") ?? "");
  const result = await unlinkDomain(account, apex);
  if (!result.ok) return { status: "error", messages: result.problems };
  return done([fillWords(words.account.unlinked, { domain: apex })]);
}

export async function accountRenewalAction(_state: FormState, form: FormData): Promise<FormState> {
  const { account, holder, words } = await holderNow();
  const result = await setDomainRenewal(account, holder, String(form.get("domain") ?? ""), form.get("renew") === "on");
  if (!result.ok) return { status: "error", messages: result.problems };
  return done([words.registrations.saved]);
}

export async function accountRenewAction(_state: FormState, form: FormData): Promise<FormState> {
  const { account, holder, words } = await holderNow();
  const domain = String(form.get("domain") ?? "");
  const result = await renewDomainNow(account, holder, domain, 1, String(form.get("agreed") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  after(() => chargeDomainPurchases({ purchaseId: result.purchase.id }).then(() => undefined));
  return done([words.registrations.renewing.replaceAll("{domain}", domain)]);
}

export type AccountDnsCheck = { ok: true; effects: string[]; lines: string[]; rev: string; touchesEmail: boolean } | { ok: false; problems: string[] };

export async function accountCheckDnsAction(apex: string, draft: DnsDraft): Promise<AccountDnsCheck> {
  const { holder, words } = await holderNow();
  const made = await draftChanges(holder, apex, draft);
  if (!made.ok) return made;
  const preview = await previewDnsChange(holder, apex, made.changes);
  if (!preview.ok) return preview;
  const { plan } = preview;
  if (!plan.ok) return { ok: false, problems: plan.problems.length > 0 ? plan.problems : [words.dns.nothing] };
  return {
    ok: true,
    effects: plan.effects.map((e) => effectText(e, words.dns.effects)),
    lines: [...plan.removes.map((r) => `− ${describeRecord(r, apex)}`), ...plan.adds.map((r) => `+ ${describeRecord(r, apex)}`)],
    rev: plan.rev,
    touchesEmail: plan.touchesEmail,
  };
}

export async function accountApplyDnsAction(apex: string, draft: DnsDraft, rev: string): Promise<FormState> {
  const { account, holder, words } = await holderNow();
  const made = await draftChanges(holder, apex, draft);
  if (!made.ok) return { status: "error", messages: made.problems };
  const result = await applyDnsChange(account, holder, apex, made.changes, { source: draft.kind === "recipe" ? "recipe" : "editor", rev });
  if (!result.ok) return { status: "error", messages: result.problems };
  return done([words.dns.done]);
}

export async function accountUndoDnsAction(_state: FormState, form: FormData): Promise<FormState> {
  const { account, holder, words } = await holderNow();
  const result = await undoDnsChange(account, holder, String(form.get("change") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  return done([words.dns.done]);
}

export async function accountDnsAutoAction(_state: FormState, form: FormData): Promise<FormState> {
  const { account, holder, words } = await holderNow();
  await setDnsAuto(account, holder, form.get("on") === "on");
  return done([words.registrations.saved]);
}

/** What a domain no store uses shows (D317 8). */
export async function holdingAction(_state: FormState, form: FormData): Promise<FormState> {
  const { account, words } = await holderNow();
  const result = await setHolding(account, String(form.get("domain") ?? ""), String(form.get("mode") ?? ""), String(form.get("to") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  return done([words.account.holdingSaved]);
}

/**
 * *Start a store on {domain}* (D317 decision 3): a request for a store, as sign-up makes, with the domain on it; approving it connects the
 * domain to the new store at once. Only for a domain the account holds that no store uses.
 */
export async function startStoreAction(_state: FormState, form: FormData): Promise<FormState> {
  const { account, words } = await holderNow();
  const apex = String(form.get("domain") ?? "").toLowerCase();
  const storeName = String(form.get("storeName") ?? "").trim().slice(0, 80);
  if (!storeName) return { status: "error", messages: [words.account.storeName] };
  const held = (await heldDomains(account.id)).find((d) => d.apex === apex);
  if (!held || held.store) return { status: "error", messages: [fillWords(words.account.notYours, { domain: apex })] };
  await createAccessRequest({
    name: account.name ?? account.email,
    email: account.email,
    storeName,
    message: "",
    lang: account.adminLocale === "nb-NO" ? "nb" : "en",
    domain: apex,
  });
  return done([fillWords(words.account.startStoreSent, { domain: apex })]);
}

/** A message to the holder's assistant (D317 phase 5): the tab's conversation and the new message; nothing is changed by it. */
export async function askHolderAction(history: HolderMessage[], message: string): Promise<HolderAnswer> {
  const { account } = await holderNow();
  const clean = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12);
  return holderTurn(account, clean, String(message ?? ""));
}

/** The person's yes to a change the assistant proposed. */
export async function confirmHolderAction(token: string): Promise<FormState> {
  const { account, words } = await holderNow();
  const result = await confirmHolderProposal(account, String(token ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  return done([fillWords(words.assistant.confirmed, { domain: result.domain })]);
}

/**
 * The account's own sending domain (D874): only the account's owner sets it, for every store of the account without its own. Another
 * person gets the card's refusal.
 */
export async function accountSendingDomainAction(_state: FormState, form: FormData): Promise<FormState> {
  const account = await requireAccount();
  const w = NOTIFICATIONS_WORDS[adminLangOf(account.adminLocale)].sendingDomain;
  const organisation = await ownedAccount(account.id);
  if (!organisation) return { status: "error", messages: [w.noAccess] };
  const answer = await sendingDomainForm(account, { organisationId: organisation.id }, form, w);
  if (answer.status === "ok") refresh();
  return answer;
}
