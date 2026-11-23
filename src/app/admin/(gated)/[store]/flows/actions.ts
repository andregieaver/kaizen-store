"use server";

import { keepWay } from "@/lib/flow-split";
import { refresh } from "next/cache";
import { z } from "zod";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import type { RecipeKey } from "@/lib/flow-recipes";
import { checkWords, flowChecks } from "@/lib/flow-checks";
import { ADDED_BLOCKS } from "@/lib/flow-blocks";
import { DATE_TRIGGER_DAYS, FLOW_TRIGGERS, isDateTrigger } from "@/lib/flow-triggers";
import { PICK_KINDS } from "@/lib/automation-kinds";
import { findStep, insertStep, moveStep, newStep, removeStep, withBlockAt, withBlockText, withLanguageCopy, withLanguageContent, withCondition, withEmailWords, withStepPicks, withTag, withUntil, withWaitDays, type FactBlock, type FlowCondition, type FlowStep } from "@/lib/flows";
import { REWRITE_TONES, suggestionBlocks, type RewriteTone } from "@/lib/broadcasts";
import { broadcastBlockSchema } from "@/lib/broadcasts-schema";
import { earnedWords, flowAudience } from "@/lib/flow-audience";
import { marketingProblem } from "@/lib/marketing-words";
import { MARKETING_WORDS } from "@/lib/admin-words/marketing";
import { rewriteEmail, suggestBroadcast, suggestSubjects, translateEmail } from "@/server/broadcasts";
import { checkPermission } from "@/server/permissions";
import { FLOWS_WORDS } from "@/lib/admin-words/flows";
import { adminLangOf } from "@/lib/admin-lang";
import { flowReport, getFlow, saveFlow, startRecipeFlow, switchFlow, testFlow } from "@/server/flows";
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
    async (member) => {
      const saved = await startRecipeFlow(member.store, member.account.id, key);
      return saved.ok ? { status: "ok" as const, messages: [saved.id] } : refusal(saved.problem);
    },
  );
  if (made.status === "ok" && made.messages[0]) redirect(`/admin/${storeSlug}/flows/${made.messages[0]}`);
  return made;
}

/** Walks the newest subscriber through the flow, sending nothing, and says which emails they would get. */
export async function testFlowAction(storeSlug: string, flowId: string): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "marketing:write", action: "marketing.flow_tested", answer: refusal, extension: "email_automation" }, async (member, lang) => {
    const w = FLOWS_WORDS[lang];
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
    const w = FLOWS_WORDS[lang];
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
    const w = FLOWS_WORDS[lang];
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
    const w = FLOWS_WORDS[lang];
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
  change: (flow: Flow, storeId: string, member: Parameters<Parameters<typeof storeAction>[1]>[0]) => Promise<FlowStep[] | string | null> | FlowStep[] | string | null,
  over: { trigger?: string; triggerDays?: number | null } = {},
): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "marketing:write", action: "marketing.flow_saved", answer: refusal, extension: "email_automation" }, async (member, lang) => {
    const w = FLOWS_WORDS[lang];
    const flow = await getFlow(member.store.id, flowId);
    if (!flow) return refusal(w.problems.missing);
    const steps = await change(flow, member.store.id, member);
    if (!steps) return refusal(w.problems.step);
    // A change may answer with its own reason, already in the member's words.
    if (typeof steps === "string") return refusal(steps);
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

const KINDS = ["email", "wait", "until", "tag", "if", "end"] as const;

/** Keeps one way of a split test (M2.5, D868): the split's place takes that way's steps, the other way's go. A new version, off until tested. */
export async function keepFlowWayAction(storeSlug: string, flowId: string, stepId: string, way: "then" | "else"): Promise<FormState> {
  return saveTree(storeSlug, flowId, (flow) => (way === "then" || way === "else" ? keepWay(flow.steps, stepId, way) : null));
}

/** Removes one step (an `if` with both its branches). */
export async function removeFlowStepAction(storeSlug: string, flowId: string, stepId: string): Promise<FormState> {
  return saveTree(storeSlug, flowId, (flow) => removeStep(flow.steps, stepId));
}

/** Sets an `if`'s condition: `ordered`, `clicked`, `split` (half and half, M2.5), or `segment:{id}` of one of the store's own segments. */
export async function changeFlowConditionAction(storeSlug: string, flowId: string, stepId: string, _state: FormState, form: FormData): Promise<FormState> {
  const value = String(form.get("condition") ?? "");
  const tag = form.get("tag");
  return saveTree(storeSlug, flowId, async (flow, storeId) => {
    // The same action carries the two new steps' one setting each (M2.1), so they add no server reference: a tag's name, a wait-until's event.
    if (typeof tag === "string") return withTag(flow.steps, stepId, tag);
    if (findStep(flow.steps, stepId)?.kind === "until" && (value === "ordered" || value === "clicked")) return withUntil(flow.steps, stepId, value);
    let condition: FlowCondition | null = null;
    if (value === "ordered") condition = { kind: "ordered_since_entry" };
    else if (value === "clicked") condition = { kind: "clicked_flow_email" };
    else if (value === "split") condition = { kind: "split" };
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
  // A new tag step is named after its flow (M2.1), which the owner may change; an email starts from the words the browser sends.
  return saveTree(storeSlug, flowId, (flow) => (parsed.success && k ? insertStep(flow.steps, newStep(flow.steps, k, locale, k === "tag" ? { subject: flow.name, text: "" } : words), parsed.data) : null));
}

/**
 * One piece of an email's words changed where it is on the canvas (email plan M3.4): the subject (`index` -1) or a heading's, paragraph's or
 * button's words, in one language. Empty is refused; the lengths are the email's own (`broadcastContentSchema`, checked by the save).
 */
export async function changeFlowBlockAction(storeSlug: string, flowId: string, stepId: string, locale: string, index: number, text: string): Promise<FormState> {
  const words = text.replace(/\s+/g, " ").trim();
  return saveTree(storeSlug, flowId, (flow) => (words ? withBlockText(flow.steps, stepId, locale, index, words) : null));
}

/** A change to an email's blocks as the browser sends it (M3.4), checked before it is used. */
const blockChangeSchema = z.union([
  z.object({ add: z.enum(ADDED_BLOCKS), at: z.number().int().min(0).max(200), words: z.string().max(200) }),
  z.object({
    fact: broadcastBlockSchema.refine((b) => b.type === "product" || b.type === "campaign") as z.ZodType<FactBlock>,
    at: z.number().int().min(0).max(200),
  }),
  z.object({ remove: z.number().int().min(0).max(200) }),
]);

/** Adds a block between an email's blocks, or removes one (email plan M3.4), in one language: a new version, off until tested. */
export async function changeFlowBlocksAction(storeSlug: string, flowId: string, stepId: string, locale: string, change: unknown): Promise<FormState> {
  const parsed = blockChangeSchema.safeParse(change);
  return saveTree(storeSlug, flowId, (flow) => (parsed.success ? withBlockAt(flow.steps, stepId, locale, parsed.data) : null));
}

/** Starts an email in a language not yet written from another (M3.4), to change in place: a new version, off until tested. */
export async function startFlowLanguageAction(storeSlug: string, flowId: string, stepId: string, from: string, to: string): Promise<FormState> {
  return saveTree(storeSlug, flowId, (flow) => withLanguageCopy(flow.steps, stepId, from, to));
}

/**
 * Writes an email's words with AI (email plan M3.7) in one language, from what the owner says it is about: the store's writer
 * (`suggestBroadcast()`, its facts, its brand and its rules) told who the email reaches and when (`flowAudience()`). The words replace that
 * language's as a new version, off until tested, the owner's to change in place. An email whose products are picked for each reader keeps
 * its picks and takes none the writer chose.
 */
export async function writeFlowEmailAction(storeSlug: string, flowId: string, stepId: string, locale: string, brief: string): Promise<FormState> {
  return saveTree(storeSlug, flowId, async (flow, _storeId, member) => {
    const problems = MARKETING_WORDS[adminLangOf(member.account.adminLocale)].problems;
    if (typeof brief !== "string" || typeof locale !== "string" || !member.store.localization.keptLocales.includes(locale)) return problems.storeLanguage;
    const step = findStep(flow.steps, stepId);
    if (!step || step.kind !== "email") return null;
    // What its emails earned (M3.7): read before the writer suggests, the numbers counted in code.
    const earned = earnedWords(await flowReport(member.store.id, flow.id), flow.steps);
    const audience = [flowAudience(flow.steps, stepId, flow.trigger, flow.triggerDays), earned].filter(Boolean).join(" ");
    const suggested = await suggestBroadcast(member.store, member.account.id, brief, locale, { audience });
    if (!suggested.ok) return marketingProblem(suggested.problem, problems);
    const s = suggested.suggestion;
    const blocks = suggestionBlocks(step.picks ? { ...s, products: [] } : s);
    return withLanguageContent(flow.steps, stepId, locale, { subject: s.subject, preview: s.preview, blocks });
  });
}

/**
 * Subject lines to choose from for an email (email plan M3.7), from its words in one language and who it reaches: nothing is saved; the
 * owner presses one to make it the subject (`changeFlowBlockAction()`).
 */
export async function suggestFlowSubjectsAction(storeSlug: string, flowId: string, stepId: string, locale: string): Promise<{ ok: true; subjects: string[] } | { ok: false; problem: string }> {
  const member = await checkPermission(storeSlug, "marketing:write", "email_automation");
  if (!member) return { ok: false, problem: FLOWS_WORDS.en.problems.missing };
  const problems = MARKETING_WORDS[adminLangOf(member.account.adminLocale)].problems;
  const flow = await getFlow(member.store.id, flowId);
  const step = flow ? findStep(flow.steps, stepId) : null;
  const content = step?.kind === "email" && typeof locale === "string" ? step.content[locale] : undefined;
  if (!flow || !content) return { ok: false, problem: FLOWS_WORDS[adminLangOf(member.account.adminLocale)].problems.step };
  const words = content.blocks.flatMap((b) => ("text" in b && typeof b.text === "string" ? [b.text] : "label" in b && b.label ? [b.label] : []));
  const result = await suggestSubjects(member.store, member.account.id, { subject: content.subject, words }, locale, flowAudience(flow.steps, stepId, flow.trigger, flow.triggerDays));
  return result.ok ? result : { ok: false, problem: marketingProblem(result.problem, problems) };
}

/** An email's words in one language rewritten shorter, warmer or more direct (email plan M3.7): a new version, off until tested. */
export async function rewriteFlowEmailAction(storeSlug: string, flowId: string, stepId: string, locale: string, tone: RewriteTone): Promise<FormState> {
  return saveTree(storeSlug, flowId, async (flow, _storeId, member) => {
    const problems = MARKETING_WORDS[adminLangOf(member.account.adminLocale)].problems;
    if (!REWRITE_TONES.includes(tone)) return null;
    const step = findStep(flow.steps, stepId);
    const content = step?.kind === "email" && typeof locale === "string" ? step.content[locale] : undefined;
    if (!content) return null;
    const result = await rewriteEmail(member.store, member.account.id, content, locale, tone);
    if (!result.ok) return marketingProblem(result.problem, problems);
    return withLanguageContent(flow.steps, stepId, locale, result.content);
  });
}

/**
 * An email written in a language it lacks, translated with AI from one it has (email plan M3.7), for the owner to read over in place: a
 * new version, off until tested. Never over words already written in that language.
 */
export async function translateFlowEmailAction(storeSlug: string, flowId: string, stepId: string, from: string, to: string): Promise<FormState> {
  return saveTree(storeSlug, flowId, async (flow, _storeId, member) => {
    const problems = MARKETING_WORDS[adminLangOf(member.account.adminLocale)].problems;
    if (typeof to !== "string" || !member.store.localization.keptLocales.includes(to)) return problems.storeLanguage;
    const step = findStep(flow.steps, stepId);
    if (step?.kind !== "email" || typeof from !== "string" || !step.content[from] || step.content[to]) return null;
    const result = await translateEmail(member.store, member.account.id, step.content[from], from, to);
    if (!result.ok) return marketingProblem(result.problem, problems);
    return withLanguageContent(flow.steps, stepId, to, result.content);
  });
}
