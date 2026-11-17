"use server";

import { after } from "next/server";
import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminText } from "@/lib/admin-text";
import { refreshSiteKnowledge } from "@/server/knowledge";
import { storeAction } from "@/server/store-action";
import { answerUnanswered, dismissUnanswered, restoreUnanswered } from "@/server/unanswered-questions";

/**
 * The store's questions its chat assistant could not answer (ecosystem plan E4.3, D729): `support:write`, as the knowledge base's own
 * actions. The store's slug and the question are bound first.
 */

const refused = (message: string): FormState => ({ status: "error", messages: [message] });

/** *Write the answer*: a knowledge document from the answer, embedded after the response so the assistant finds it by meaning too. */
export async function answerQuestionAction(slug: string, id: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: slug, key: "support:write", action: "knowledge.question_answer", answer: refused }, async (member, lang) => {
    const w = adminText(lang, "support").questions;
    const result = await answerUnanswered(member.account, member.store.id, id, { title: String(form.get("title") ?? ""), answer: String(form.get("answer") ?? "") });
    if (!result.ok) return refused(result.problem === "gone" ? w.gone : result.problem === "invalid" ? w.invalid : (result.problems ?? [w.invalid]).join(" "));
    after(() => refreshSiteKnowledge(member.store.id));
    refresh();
    return { status: "ok", messages: [w.saved] };
  });
}

/** *Not a question for the assistant*: set aside, and kept so when asked again. */
export async function dismissQuestionAction(slug: string, id: string): Promise<FormState> {
  return storeAction({ store: slug, key: "support:write", action: "knowledge.question_dismiss", answer: refused }, async (member, lang) => {
    const w = adminText(lang, "support").questions;
    if (!(await dismissUnanswered(member.account, member.store.id, id))) return refused(w.gone);
    refresh();
    return { status: "ok", messages: [w.dismissedDone] };
  });
}

/** *Put it back*: a question set aside is open again. */
export async function restoreQuestionAction(slug: string, id: string): Promise<FormState> {
  return storeAction({ store: slug, key: "support:write", action: "knowledge.question_restore", answer: refused }, async (member, lang) => {
    const w = adminText(lang, "support").questions;
    if (!(await restoreUnanswered(member.account, member.store.id, id))) return refused(w.gone);
    refresh();
    return { status: "ok", messages: [w.putBackDone] };
  });
}
