"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { adminText } from "@/lib/admin-text";
import { welcomeSeries } from "@/lib/flow-recipes";
import { insertStep, newStep, removeStep, withCondition, withEmailWords, withWaitDays, type FlowCondition, type FlowStep } from "@/lib/flows";
import { getFlow, saveFlow, switchFlow, testFlow } from "@/server/flows";
import { listSegments } from "@/server/segments";
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

type Place = { afterId: string } | { into: string; branch: "then" | "else" };
type Flow = NonNullable<Awaited<ReturnType<typeof getFlow>>>;

/** Saves the flow's tree after one change from the canvas (D767 slice 2): a new version, switched off until tested again. Null: refused. */
async function saveTree(storeSlug: string, flowId: string, change: (flow: Flow, storeId: string) => Promise<FlowStep[] | null> | FlowStep[] | null): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "marketing:write", action: "marketing.flow_saved", answer: refusal, extension: "email_automation" }, async (member, lang) => {
    const w = adminText(lang, "flows");
    const flow = await getFlow(member.store.id, flowId);
    if (!flow) return refusal(w.problems.missing);
    const steps = await change(flow, member.store.id);
    if (!steps) return refusal(w.problems.step);
    const saved = await saveFlow(member.store.id, member.account.id, flowId, { name: flow.name, trigger: flow.trigger, steps, goals: flow.goals });
    if (!saved.ok) return refusal(saved.problem);
    refresh();
    return { status: "ok", messages: [w.savedTestAgain] };
  });
}

const KINDS = ["email", "wait", "if", "end"] as const;

/** Adds a step of the kind chosen at a place of the tree; a new email starts with words in the flow's first language. */
export async function addFlowStepAction(
  storeSlug: string,
  flowId: string,
  place: Place,
  locale: string,
  words: { subject: string; text: string },
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const kind = KINDS.find((k) => k === form.get("kind"));
  return saveTree(storeSlug, flowId, (flow) => (kind ? insertStep(flow.steps, newStep(flow.steps, kind, locale, words), place) : null));
}

/** Removes one step (an `if` with both its branches). */
export async function removeFlowStepAction(storeSlug: string, flowId: string, stepId: string): Promise<FormState> {
  return saveTree(storeSlug, flowId, (flow) => removeStep(flow.steps, stepId));
}

/** Sets an `if`'s condition: `ordered`, `clicked`, or `segment:{id}` of one of the store's own segments. */
export async function changeFlowConditionAction(storeSlug: string, flowId: string, stepId: string, _state: FormState, form: FormData): Promise<FormState> {
  const value = String(form.get("condition") ?? "");
  return saveTree(storeSlug, flowId, async (flow, storeId) => {
    let condition: FlowCondition | null = null;
    if (value === "ordered") condition = { kind: "ordered_since_entry" };
    else if (value === "clicked") condition = { kind: "clicked_flow_email" };
    else if (value.startsWith("segment:")) {
      const segmentId = value.slice("segment:".length);
      if ((await listSegments(storeId)).some((s) => s.id === segmentId)) condition = { kind: "in_segment", segmentId };
    }
    return condition ? withCondition(flow.steps, stepId, condition) : null;
  });
}
