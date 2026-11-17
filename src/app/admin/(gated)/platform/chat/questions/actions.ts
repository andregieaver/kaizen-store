"use server";

import { after } from "next/server";
import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminText } from "@/lib/admin-text";
import { refreshSiteKnowledge } from "@/server/knowledge";
import { platformAction } from "@/server/store-action";
import { answerUnanswered, dismissUnanswered, restoreUnanswered } from "@/server/unanswered-questions";

/**
 * The questions Kaizena Flow's own chat assistant could not answer (ecosystem plan E4.3, D729): the support area's (D510), as Kaizena
 * Flow's knowledge base is changed from its chat page. The question is bound first.
 */

const refused = (message: string): FormState => ({ status: "error", messages: [message] });

/** *Write the answer*: a document in Kaizena Flow's knowledge base, embedded after the response. */
export async function answerPlatformQuestionAction(id: string, _state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "support", action: "knowledge.question_answer", answer: refused }, async (account, lang) => {
    const w = adminText(lang, "support").questions;
    const result = await answerUnanswered(account, null, id, { title: String(form.get("title") ?? ""), answer: String(form.get("answer") ?? "") });
    if (!result.ok) return refused(result.problem === "gone" ? w.gone : result.problem === "invalid" ? w.invalid : (result.problems ?? [w.invalid]).join(" "));
    after(() => refreshSiteKnowledge(null));
    refresh();
    return { status: "ok", messages: [w.saved] };
  });
}

/** *Not a question for the assistant*: set aside, and kept so when asked again. */
export async function dismissPlatformQuestionAction(id: string): Promise<FormState> {
  return platformAction({ area: "support", action: "knowledge.question_dismiss", answer: refused }, async (account, lang) => {
    const w = adminText(lang, "support").questions;
    if (!(await dismissUnanswered(account, null, id))) return refused(w.gone);
    refresh();
    return { status: "ok", messages: [w.dismissedDone] };
  });
}

/** *Put it back*: a question set aside is open again. */
export async function restorePlatformQuestionAction(id: string): Promise<FormState> {
  return platformAction({ area: "support", action: "knowledge.question_restore", answer: refused }, async (account, lang) => {
    const w = adminText(lang, "support").questions;
    if (!(await restoreUnanswered(account, null, id))) return refused(w.gone);
    refresh();
    return { status: "ok", messages: [w.putBackDone] };
  });
}
