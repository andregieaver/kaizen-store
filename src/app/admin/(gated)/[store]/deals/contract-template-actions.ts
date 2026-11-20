"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { featureOffText } from "@/lib/feature-labels";
import type { Membership } from "@/server/auth";
import { archiveTemplate, createTemplate, saveTemplate } from "@/server/contracts";
import { storeAction } from "@/server/store-action";
import { dealsOn } from "@/lib/extensions";
import { COMMON_WORDS } from "@/lib/admin-words/common";
import { DEALS_WORDS } from "@/lib/admin-words/deals";

/**
 * Contract templates' actions (D695 step 2): each through `storeAction()` with `customers:write`, Deals on, answered in the member's
 * language. A new template opens its page; saving draws the page again with its preview; putting one away goes back to the list.
 */

const uuid = z.uuid();
const failed = (message: string): FormState => ({ status: "error", messages: [message] });
const wordsOf = (member: Membership) => DEALS_WORDS[adminLangOf(member.account.adminLocale)].templates;
const offFor = (member: Membership): string | null =>
  dealsOn(member.store) ? null : featureOffText("sales", COMMON_WORDS[adminLangOf(member.account.adminLocale)].features);

export async function newTemplateAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "customers:write", extension: "deals", action: "contract.template_create", answer: failed }, async (member) => {
    const off = offFor(member);
    if (off) return failed(off);
    const made = await createTemplate(member, form.get("language") === "en" ? "en" : "nb");
    if (!made.ok) return failed(wordsOf(member).problems[made.problem]);
    redirect(`/admin/${member.store.slug}/deals/contract-templates/${made.id}`);
  });
}

export type TemplateSaveInput = { name: string; language: string; blocks: unknown; expiresDays: string; reminderDays: string };

export async function saveTemplateAction(storeSlug: string, templateId: string, input: TemplateSaveInput): Promise<{ ok: boolean; messages: string[] }> {
  const answer = (message: string) => ({ ok: false, messages: [message] });
  return storeAction({ store: storeSlug, key: "customers:write", extension: "deals", action: "contract.template_save", answer }, async (member) => {
    const off = offFor(member);
    if (off) return answer(off);
    const w = wordsOf(member);
    if (!uuid.safeParse(templateId).success) return answer(w.problems.not_found);
    const saved = await saveTemplate(member, templateId, input);
    if (!saved.ok) return answer(w.problems[saved.problem]);
    refresh();
    return { ok: true, messages: [w.saved] };
  });
}

export async function archiveTemplateAction(storeSlug: string, templateId: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const answer = (message: string) => ({ ok: false as const, problems: [message] });
  return storeAction({ store: storeSlug, key: "customers:write", extension: "deals", action: "contract.template_archive", answer }, async (member) => {
    const done = await archiveTemplate(member, templateId);
    if (!done.ok) return answer(wordsOf(member).problems[done.problem]);
    redirect(`/admin/${member.store.slug}/deals/contract-templates`);
  });
}
