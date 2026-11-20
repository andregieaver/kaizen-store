"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { adminText } from "@/lib/admin-text";
import { flowFromAutomation, ownFlow, RECIPES, type RecipeKey } from "@/lib/flow-recipes";
import { checkWords, flowChecks } from "@/lib/flow-checks";
import { DATE_TRIGGER_DAYS, FLOW_TRIGGERS, isDateTrigger } from "@/lib/flow-triggers";
import { PICK_KINDS } from "@/lib/automation-kinds";
import { insertStep, moveStep, newStep, removeStep, withBlockText, withCondition, withEmailWords, withStepPicks, withWaitDays, type FlowCondition, type FlowStep } from "@/lib/flows";
import { getAutomation } from "@/server/automations";
import { getFlow, saveFlow, switchFlow, testFlow } from "@/server/flows";
import { listSegments } from "@/server/segments";
import { storeAction } from "@/server/store-action";

/**
 * Flows (D767 slice 2): starting the welcome series, testing a flow and switching it, each behind `marketing:write` through `storeAction()`.
 * Flows are part of the email automation extension (D748), as automations are.
 */

const refusal = (message: string): FormState => ({ status: "error", messages: [message] });

/** Makes a flow from a goal's recipe (D767 slice 3, M3.1) in the store's first language, switched off, and opens it. */
export async function startRecipeFlowAction(storeSlug: string, key: RecipeKey | "own"): Promise<FormState> {
  const made = await storeAction(
    { store: storeSlug, key: "marketing:write", action: "marketing.flow_saved", answer: refusal, extension: "email_automation" },
    async (member, lang) => {
      const locale = member.store.localization.locales[0] ?? "en-GB";
      // The owner's own automation, when they wrote one, keeps its words, days and follow-ups (slice 3, M2.2); else the recipe.
      if (key === "own") {
        const saved = await saveFlow(member.store.id, member.account.id, null, ownFlow(locale));
        return saved.ok ? { status: "ok" as const, messages: [saved.id] } : refusal(saved.problem);
      }
      const own = key in RECIPES ? await getAutomation(member.store, key) : null;
      const recipe = (own?.saved ? flowFromAutomation(key, own, locale) : null) ?? RECIPES[key]?.(locale);
      if (!recipe) return refusal(adminText(lang, "flows").problems.missing);
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
    // The checks before switching on (M3.6): a blocking one keeps the flow off, said in the same words as on the page.
    if (on) {
      const flow = await getFlow(member.store.id, flowId);
      const main = member.store.localization.locales[0] ?? "en-GB";
      const blocking = flow ? flowChecks(flow.steps, main).filter((c) => c.blocking) : [];
      if (blocking.length > 0) return { status: "error", messages: blocking.map((c) => checkWords(w, c)) };
    }
    const switched = await switchFlow(member.store.id, member.account.id, flowId, on);
    if (switched === "untested" || switched === "missing") return refusal(switched === "untested" ? w.problems.untested : w.problems.missing);
    refresh();
    return { status: "ok", messages: [switched === "replaced" ? `${w.switchedOn} ${w.automationOff}` : on ? w.switchedOn : w.switchedOff] };
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
    const saved = await saveFlow(member.store.id, member.account.id, flowId, { name: flow.name, trigger: flow.trigger, triggerDays: flow.triggerDays, steps, goals: flow.goals });
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
    const saved = await saveFlow(member.store.id, member.account.id, flowId, { name: flow.name, trigger: flow.trigger, triggerDays: flow.triggerDays, steps: withWaitDays(flow.steps, stepId, days), goals: flow.goals });
    if (!saved.ok) return refusal(saved.problem);
    refresh();
    return { status: "ok", messages: [w.savedTestAgain] };
  });
}

type Flow = NonNullable<Awaited<ReturnType<typeof getFlow>>>;

/** Saves the flow's tree after one change from the canvas (D767 slice 2): a new version, switched off until tested again. Null: refused. */
async function saveTree(
  storeSlug: string,
  flowId: string,
  change: (flow: Flow, storeId: string) => Promise<FlowStep[] | null> | FlowStep[] | null,
  over: { trigger?: string; triggerDays?: number | null } = {},
): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "marketing:write", action: "marketing.flow_saved", answer: refusal, extension: "email_automation" }, async (member, lang) => {
    const w = adminText(lang, "flows");
    const flow = await getFlow(member.store.id, flowId);
    if (!flow) return refusal(w.problems.missing);
    const steps = await change(flow, member.store.id);
    if (!steps) return refusal(w.problems.step);
    const saved = await saveFlow(member.store.id, member.account.id, flowId, {
      name: flow.name,
      trigger: over.trigger ?? flow.trigger,
      triggerDays: over.triggerDays !== undefined ? over.triggerDays : flow.triggerDays,
      steps,
      goals: flow.goals,
    });
    if (!saved.ok) return refusal(saved.problem);
    refresh();
    return { status: "ok", messages: [w.savedTestAgain] };
  });
}

const KINDS = ["email", "wait", "if", "end"] as const;

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

/** Saves a date trigger's days (slice 4): without an order, or after a view. A new version, switched off until tested again. */
export async function changeFlowLapseAction(storeSlug: string, flowId: string, _state: FormState, form: FormData): Promise<FormState> {
  const days = Number(form.get("days"));
  return saveTree(storeSlug, flowId, (flow) => flow.steps, { triggerDays: days });
}

/** Changes what starts a flow (slice 4, M2.3): one of `FLOW_TRIGGERS`; a date trigger starts at its days (`DATE_TRIGGER_DAYS`). A new version, off until tested. */
export async function changeFlowTriggerAction(storeSlug: string, flowId: string, _state: FormState, form: FormData): Promise<FormState> {
  const trigger = FLOW_TRIGGERS.find((t) => t === form.get("trigger"));
  // No such trigger: the tree change is refused in the owner's words (`problems.step`).
  const days = trigger && isDateTrigger(trigger) ? DATE_TRIGGER_DAYS[trigger].start : null;
  return saveTree(storeSlug, flowId, (flow) => (trigger ? flow.steps : null), trigger ? { trigger, triggerDays: days } : {});
}

/** Puts products picked for each reader in one email (slice 4, D653): `cross_sell`, `replenish`, `browse`, or `none`. A new version, off until tested. */
export async function changeFlowPicksAction(storeSlug: string, flowId: string, stepId: string, _state: FormState, form: FormData): Promise<FormState> {
  const value = form.get("picks");
  const picks = PICK_KINDS.find((k) => k === value) ?? null;
  return saveTree(storeSlug, flowId, (flow) => (picks || value === "none" ? withStepPicks(flow.steps, stepId, picks) : null));
}

/** A place on the canvas as the browser sends it, checked before it is used. */
const placeSchema = z.union([
  z.object({ start: z.literal(true) }),
  z.object({ afterId: z.string().max(80) }),
  z.object({ into: z.string().max(80), branch: z.enum(["then", "else"]) }),
]);

/** Moves a step to a place on the canvas (drag and drop): a new version, switched off until tested. A place inside the step itself is refused. */
export async function moveFlowStepAction(storeSlug: string, flowId: string, stepId: string, place: unknown): Promise<FormState> {
  const parsed = placeSchema.safeParse(place);
  return saveTree(storeSlug, flowId, (flow) => {
    if (!parsed.success) return null;
    const moved = moveStep(flow.steps, stepId, parsed.data);
    return JSON.stringify(moved) === JSON.stringify(flow.steps) ? null : moved;
  });
}

/** Adds a step of a kind dropped on the canvas from its palette: as `addFlowStepAction()`, from a place the browser sends. */
export async function dropFlowStepAction(storeSlug: string, flowId: string, kind: string, place: unknown, locale: string, words: { subject: string; text: string }): Promise<FormState> {
  const parsed = placeSchema.safeParse(place);
  const k = KINDS.find((x) => x === kind);
  return saveTree(storeSlug, flowId, (flow) => (parsed.success && k ? insertStep(flow.steps, newStep(flow.steps, k, locale, words), parsed.data) : null));
}

/**
 * One piece of an email's words changed where it is on the canvas (email plan M3.4): the subject (`index` -1) or a heading's, paragraph's or
 * button's words, in one language. Empty is refused; the lengths are the email's own (`broadcastContentSchema`, checked by the save).
 */
export async function changeFlowBlockAction(storeSlug: string, flowId: string, stepId: string, locale: string, index: number, text: string): Promise<FormState> {
  const words = text.replace(/\s+/g, " ").trim();
  return saveTree(storeSlug, flowId, (flow) => (words ? withBlockText(flow.steps, stepId, locale, index, words) : null));
}
