"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import { adminText } from "@/lib/admin-text";
import { featureOffText } from "@/lib/feature-labels";
import { featureOn } from "@/lib/store-features";
import type { Membership } from "@/server/auth";
import { signAsStore } from "@/server/contract-signing";
import { cancelContract, createContract, deleteDraft, newVersion, saveDraft, saveSigners, type ContractProblem } from "@/server/contracts";
import { storeAction } from "@/server/store-action";

/**
 * Contracts' actions (D695): each runs through `storeAction()` with `customers:write` (a deal's key), checks Deals is on whatever a stale
 * page sends, and answers in the member's language. Making, a new version and deleting go to the next page; saving refreshes the draft's
 * page, whose preview is drawn again from what was kept.
 */

const uuid = z.uuid();
const failed = (message: string): FormState => ({ status: "error", messages: [message] });
const wordsOf = (member: Membership): DealsMessages["contracts"] => adminText(adminLangOf(member.account.adminLocale), "deals").contracts;

/** Deals off for this store: the reason, in the member's words. */
const offFor = (member: Membership): string | null =>
  featureOn(member.store, "sales") ? null : featureOffText("sales", adminText(adminLangOf(member.account.adminLocale), "common").features);

const problemText = (w: DealsMessages["contracts"], problem: ContractProblem): string => w.problems[problem];

/** A new contract on the deal from the store's template; its page next. */
export async function newContractAction(storeSlug: string, dealId: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "customers:write", extension: "deals", action: "contract.create", answer: failed }, async (member) => {
    const off = offFor(member);
    if (off) return failed(off);
    const w = wordsOf(member);
    if (!uuid.safeParse(dealId).success) return failed(w.problems.not_found);
    const chosen = String(form.get("template") ?? "");
    const made = await createContract(member, dealId, uuid.safeParse(chosen).success ? chosen : null);
    if (!made.ok) return failed(problemText(w, made.problem));
    redirect(`/admin/${member.store.slug}/deals/${dealId}/contracts/${made.id}`);
  });
}

export type ContractSaveInput = { title: string; blocks: unknown; signers: unknown[] };
export type ContractSaveState = { ok: boolean; messages: string[] };

/** A draft's title, words and signers kept together; the page is drawn again with its preview. */
export async function saveContractAction(storeSlug: string, contractId: string, input: ContractSaveInput): Promise<ContractSaveState> {
  const answer = (message: string): ContractSaveState => ({ ok: false, messages: [message] });
  return storeAction({ store: storeSlug, key: "customers:write", extension: "deals", action: "contract.save", answer }, async (member) => {
    const off = offFor(member);
    if (off) return answer(off);
    const w = wordsOf(member);
    if (!uuid.safeParse(contractId).success) return answer(w.problems.not_found);
    const saved = await saveDraft(member, contractId, { title: input.title, blocks: input.blocks });
    if (!saved.ok) return answer(problemText(w, saved.problem));
    const signed = await saveSigners(member, contractId, Array.isArray(input.signers) ? input.signers : []);
    if (!signed.ok) return answer(problemText(w, signed.problem));
    refresh();
    return { ok: true, messages: [w.saved] };
  });
}

/** A draft deleted; back to its deal. */
export async function deleteContractAction(storeSlug: string, dealId: string, contractId: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const answer = (message: string) => ({ ok: false as const, problems: [message] });
  return storeAction({ store: storeSlug, key: "customers:write", extension: "deals", action: "contract.delete", answer }, async (member) => {
    const w = wordsOf(member);
    const gone = await deleteDraft(member, contractId);
    if (!gone.ok) return answer(problemText(w, gone.problem));
    redirect(`/admin/${member.store.slug}/deals/${dealId}`);
  });
}

/** A sent contract cancelled; its page is drawn again. */
export async function cancelContractAction(storeSlug: string, contractId: string): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "customers:write", extension: "deals", action: "contract.cancel", answer: failed }, async (member) => {
    const w = wordsOf(member);
    const done = await cancelContract(member, contractId);
    if (!done.ok) return failed(problemText(w, done.problem));
    refresh();
    return { status: "ok", messages: [] };
  });
}

/** A new version of a sent, declined or expired contract: a draft with its words and signers; its page next. */
export async function newVersionAction(storeSlug: string, dealId: string, contractId: string): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "customers:write", extension: "deals", action: "contract.new_version", answer: failed }, async (member) => {
    const off = offFor(member);
    if (off) return failed(off);
    const w = wordsOf(member);
    const made = await newVersion(member, contractId);
    if (!made.ok) return failed(problemText(w, made.problem));
    redirect(`/admin/${member.store.slug}/deals/${dealId}/contracts/${made.id}`);
  });
}

/** The store's signer signs inside the admin (D695 step 3): their name and agreement, their session as the proof; the customer is asked next. */
export async function signForStoreAction(storeSlug: string, contractId: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "customers:write", extension: "deals", action: "contract.sign_for_store", answer: failed }, async (member) => {
    const w = wordsOf(member);
    const h = await headers();
    const signed = await signAsStore(
      member,
      contractId,
      { name: String(form.get("name") ?? ""), agree: form.get("agree") === "on" },
      { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || null, userAgent: h.get("user-agent") },
    );
    if (!signed.ok) return { status: "error", messages: [w.signProblems[signed.problem]], fields: { name: String(form.get("name") ?? "") } };
    refresh();
    return { status: "ok", messages: [] };
  });
}
