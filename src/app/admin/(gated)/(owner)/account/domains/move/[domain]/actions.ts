"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import type { RevealShape, SwitchCheckShape } from "@/components/admin/domain-types";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { describeRecord } from "@/lib/dns-records";
import { disconnectDomain, nameserverSwitchCheck, revealTransferCode, stayHere, switchBack, switchNameservers } from "@/server/domain-move";
import { getAccount, signedInRecently } from "@/server/auth";
import { heldDomains } from "@/server/domain-account";
import { accountHolder } from "@/server/domain-holder";
import { createClient } from "@/lib/supabase/server";

/** Moving a domain away (D315 8) from *Your domains* (D317): the holder's, as everything about the domain is. */
const notOwner: FormState = { status: "error", messages: ["Sign in to move your domains."] };

const holderNow = async () => {
  const account = await getAccount();
  return account ? { account, holder: accountHolder(account.id) } : null;
};

const wordsOf = (locale: string | null | undefined) => adminText(adminLangOf(locale), "domains").move;

/** Asks the new nameservers for every record; nothing changes. */
export async function checkNameserversAction(apex: string, nameservers: string): Promise<SwitchCheckShape> {
  const member = await holderNow();
  if (!member) return { ok: false, problems: notOwner.messages };
  const check = await nameserverSwitchCheck(member.holder, apex, String(nameservers).slice(0, 2000));
  if (!check.ok) return check;
  return { ok: true, ready: check.ready, missing: check.missing.map((r) => describeRecord(r, apex)), unanswered: check.unanswered };
}

/** Switches the nameservers after the check passed (or the owner said the missing records may go). */
export async function switchNameserversAction(apex: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await holderNow();
  if (!member) return notOwner;
  const w = wordsOf(member.account.adminLocale).dns;
  const result = await switchNameservers(member.account, member.holder, apex, String(form.get("nameservers") ?? "").slice(0, 2000), {
    acceptMissing: form.get("accept") === "on",
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [result.how === "registrar" ? w.switchedRegistrar : w.switchedWatched] };
}

export async function switchBackAction(apex: string): Promise<FormState> {
  const member = await holderNow();
  if (!member) return notOwner;
  const result = await switchBack(member.account, member.holder, apex);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [wordsOf(member.account.adminLocale).dns.switchedBack] };
}

/**
 * The transfer code, to the owner's page only: after a sign-in from the last ten minutes, read live, never kept. It goes back in this
 * answer and nowhere else (no form state that is logged, no refresh carrying it).
 */
export async function revealCodeAction(apex: string): Promise<RevealShape> {
  const member = await holderNow();
  if (!member) return { ok: false, problems: notOwner.messages };
  if (!(await signedInRecently())) return { ok: false, problems: [wordsOf(member.account.adminLocale).transfer.signInAgain], signIn: true };
  return revealTransferCode(member.account, member.holder, apex);
}

export async function stayHereAction(apex: string): Promise<FormState> {
  const member = await holderNow();
  if (!member) return notOwner;
  const result = await stayHere(member.account, member.holder, apex);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [fillWords(wordsOf(member.account.adminLocale).transfer.stayed, { domain: apex })] };
}

export async function disconnectAction(apex: string): Promise<FormState> {
  const member = await holderNow();
  if (!member) return notOwner;
  // The store that uses the domain stops using it; the holder may ask that of any store using a domain they hold (D317).
  const store = (await heldDomains(member.account.id)).find((d) => d.apex === apex.toLowerCase())?.store;
  if (!store) return { status: "error", messages: [`No store uses ${apex}.`] };
  const result = await disconnectDomain(member.account, store.id, apex);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [fillWords(wordsOf(member.account.adminLocale).disconnect.done, { domain: apex })] };
}

/** Signs the owner out and back in, so the transfer code has a sign-in from the last ten minutes (as closing a store does). */
export async function signInAgainAction(apex: string): Promise<void> {
  const member = await holderNow();
  if (!member) redirect("/admin");
  const here = `/admin/account/domains/move/${encodeURIComponent(apex)}?goal=registrar`;
  try {
    await (await createClient()).auth.signOut();
  } finally {
    redirect(`/admin/sign-in?next=${encodeURIComponent(here)}`);
  }
}
