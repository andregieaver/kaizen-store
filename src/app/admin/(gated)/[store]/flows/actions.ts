"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { adminText } from "@/lib/admin-text";
import { welcomeSeries } from "@/lib/flow-recipes";
import { withEmailWords, withWaitDays } from "@/lib/flows";
import { getFlow, saveFlow, switchFlow, testFlow } from "@/server/flows";
import { storeAction } from "@/server/store-action";

/**
 * Flows (D767 slice 2): starting the welcome series, testing a flow and switching it, each behind `marketing:write` through `storeAction()`.
 * Flows are part of the email automation extension (D748), as automations are.
 */

const refusal = (message: string): FormState => ({ status: "error", messages: [message] });

/** Makes the welcome series in the store's first language, switched off, and opens it. */
export async function startWelcomeFlowAction(storeSlug: string): Promise<FormState> {
  const made = await storeAction(
    { store: storeSlug, key: "marketing:write", action: "marketing.flow_saved", answer: refusal, extension: "email_automation" },
    async (member) => {
      const recipe = welcomeSeries(member.store.localization.locales[0] ?? "en-GB");
      const saved = await saveFlow(member.store.id, member.account.id, null, recipe);
      return saved.ok ? { status: "ok" as const, messages: [saved.id] } : refusal(saved.problem);
    },
  );
  if (made.status === "ok" && made.messages[0]) redirect(`/admin/${storeSlug}/flows/${made.messages[0]}`);
  return made;
}

/** Walks the newest subscriber through the flow, sending nothing, and says which emails they would get. */
export async function testFlowAction(storeSlug: string, flowId: string): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "marketing:write", action: "marketing.flow_tested", answer: refusal, extension: "email_automation" }, async (member, lang) => {
    const w = adminText(lang, "flows");
    const result = await testFlow(member.store.id, flowId);
    if (!result.ok) return refusal(w.problems.missing);
    refresh();
    const emails = result.emails.join(", ");
    const said = result.person ? w.tested.replace("{person}", result.person).replace("{emails}", emails) : w.testedNobody.replace("{emails}", emails);
    return { status: "ok", messages: [`${said} ${w.ends[result.ends]}`] };
  });
}

/** Switches the flow on (only once tested) or off. */
export async function switchFlowAction(storeSlug: string, flowId: string, on: boolean): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "marketing:write", action: on ? "marketing.flow_on" : "marketing.flow_off", answer: refusal, extension: "email_automation" }, async (member, lang) => {
    const w = adminText(lang, "flows");
    const switched = await switchFlow(member.store.id, member.account.id, flowId, on);
    if (switched !== "ok") return refusal(switched === "untested" ? w.problems.untested : w.problems.missing);
    refresh();
    return { status: "ok", messages: [on ? w.switchedOn : w.switchedOff] };
  });
}

/**
 * Saves new words for one email of a flow, in one language (D767 slice 2, words changed where they are): a new version, switched off until
 * it is tested again, as every save is.
 */
export async function changeFlowEmailAction(storeSlug: string, flowId: string, stepId: string, locale: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "marketing:write", action: "marketing.flow_saved", answer: refusal, extension: "email_automation" }, async (member, lang) => {
    const w = adminText(lang, "flows");
    const flow = await getFlow(member.store.id, flowId);
    if (!flow) return refusal(w.problems.missing);
    const subject = String(form.get("subject") ?? "").trim();
    const text = String(form.get("text") ?? "").trim();
    if (!subject || !text) return refusal(w.problems.words);
    const steps = withEmailWords(flow.steps, stepId, locale, { subject: subject.slice(0, 200), text: text.slice(0, 5000) });
    const saved = await saveFlow(member.store.id, member.account.id, flowId, { name: flow.name, trigger: flow.trigger, steps, goals: flow.goals });
    if (!saved.ok) return refusal(saved.problem);
    refresh();
    return { status: "ok", messages: [w.savedTestAgain] };
  });
}

/** Saves a new number of days for one wait of a flow (D767 slice 2): a new version, switched off until tested again. */
export async function changeFlowWaitAction(storeSlug: string, flowId: string, stepId: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "marketing:write", action: "marketing.flow_saved", answer: refusal, extension: "email_automation" }, async (member, lang) => {
    const w = adminText(lang, "flows");
    const flow = await getFlow(member.store.id, flowId);
    if (!flow) return refusal(w.problems.missing);
    const days = Number(form.get("days"));
    if (!Number.isInteger(days) || days < 1 || days > 365) return refusal(w.problems.days);
    const saved = await saveFlow(member.store.id, member.account.id, flowId, { name: flow.name, trigger: flow.trigger, steps: withWaitDays(flow.steps, stepId, days), goals: flow.goals });
    if (!saved.ok) return refusal(saved.problem);
    refresh();
    return { status: "ok", messages: [w.savedTestAgain] };
  });
}
