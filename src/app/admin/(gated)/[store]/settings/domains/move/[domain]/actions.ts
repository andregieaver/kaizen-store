"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import type { RevealShape, SwitchCheckShape } from "@/components/admin/domain-types";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { describeRecord } from "@/lib/dns-records";
import { signedInRecently } from "@/server/auth";
import { disconnectDomain, nameserverSwitchCheck, revealTransferCode, stayHere, switchBack, switchNameservers } from "@/server/domain-move";
import { checkOwnerRole } from "@/server/permissions";
import { createClient } from "@/lib/supabase/server";

/** Moving a domain away (D315 8) is the owner's, as everything about the store's domains is. */
const notOwner: FormState = { status: "error", messages: ["Only an owner can move the store's domains."] };

const wordsOf = (locale: string | null | undefined) => adminText(adminLangOf(locale), "domains").move;

/** Asks the new nameservers for every record; nothing changes. */
export async function checkNameserversAction(storeSlug: string, apex: string, nameservers: string): Promise<SwitchCheckShape> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { ok: false, problems: notOwner.messages };
  const check = await nameserverSwitchCheck(member.store.id, apex, String(nameservers).slice(0, 2000));
  if (!check.ok) return check;
  return { ok: true, ready: check.ready, missing: check.missing.map((r) => describeRecord(r, apex)), unanswered: check.unanswered };
}

/** Switches the nameservers after the check passed (or the owner said the missing records may go). */
export async function switchNameserversAction(storeSlug: string, apex: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return notOwner;
  const w = wordsOf(member.account.adminLocale).dns;
  const result = await switchNameservers(member.account, member.store.id, apex, String(form.get("nameservers") ?? "").slice(0, 2000), {
    acceptMissing: form.get("accept") === "on",
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [result.how === "registrar" ? w.switchedRegistrar : w.switchedWatched] };
}

export async function switchBackAction(storeSlug: string, apex: string): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return notOwner;
  const result = await switchBack(member.account, member.store.id, apex);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [wordsOf(member.account.adminLocale).dns.switchedBack] };
}

/**
 * The transfer code, to the owner's page only: after a sign-in from the last ten minutes, read live, never kept. It goes back in this
 * answer and nowhere else (no form state that is logged, no refresh carrying it).
 */
export async function revealCodeAction(storeSlug: string, apex: string): Promise<RevealShape> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { ok: false, problems: notOwner.messages };
  if (!(await signedInRecently())) return { ok: false, problems: [wordsOf(member.account.adminLocale).transfer.signInAgain], signIn: true };
  return revealTransferCode(member.account, member.store.id, apex);
}

export async function stayHereAction(storeSlug: string, apex: string): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return notOwner;
  const result = await stayHere(member.account, member.store.id, apex);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [fillWords(wordsOf(member.account.adminLocale).transfer.stayed, { domain: apex })] };
}

export async function disconnectAction(storeSlug: string, apex: string): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return notOwner;
  const result = await disconnectDomain(member.account, member.store.id, apex);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [fillWords(wordsOf(member.account.adminLocale).disconnect.done, { domain: apex })] };
}

/** Signs the owner out and back in, so the transfer code has a sign-in from the last ten minutes (as closing a store does). */
export async function signInAgainAction(storeSlug: string, apex: string): Promise<void> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) redirect("/admin");
  const here = `/admin/${storeSlug}/settings/domains/move/${encodeURIComponent(apex)}?goal=registrar`;
  try {
    await (await createClient()).auth.signOut();
  } finally {
    redirect(`/admin/sign-in?next=${encodeURIComponent(here)}`);
  }
}
