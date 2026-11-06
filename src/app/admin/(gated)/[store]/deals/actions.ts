"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import { adminText } from "@/lib/admin-text";
import { DEAL_LINK_KINDS, type DealLinkKind } from "@/lib/deals";
import { featureOffText, featureOn } from "@/lib/store-features";
import { actionAdminLang } from "@/server/admin-request-lang";
import type { Membership } from "@/server/auth";
import {
  closeDeal,
  createDeal,
  createPipeline,
  deletePipeline,
  deleteDeal,
  linkThing,
  moveDeal,
  pipelinesOf,
  renamePipeline,
  reopenDeal,
  saveStages,
  searchWho,
  unlinkThing,
  updateDeal,
  type DealProblem,
  type DealResult,
  type PipelineResult,
  type StageInput,
  type WhoChoice,
} from "@/server/deals";
import { checkPermission } from "@/server/permissions";

/**
 * Deals' actions (S2, D464): each checks the member may change customers and that Deals is on, whatever a stale page sends, and answers in
 * the member's language. The board's moves answer as data (its client part shows them); the forms as a `FormState`.
 */

const uuid = z.uuid();

type Words = DealsMessages;
const wordsOf = (member: Membership): Words => adminText(adminLangOf(member.account.adminLocale), "deals");

/** The member, when they may change customers and Deals is on; else the reason, in their words. */
async function writer(storeSlug: string): Promise<{ member: Membership; w: Words } | { refused: string }> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { refused: adminText(await actionAdminLang(), "deals").problems.forbidden };
  if (!featureOn(member.store, "sales")) {
    return { refused: featureOffText("sales", adminText(adminLangOf(member.account.adminLocale), "common").features) };
  }
  return { member, w: wordsOf(member) };
}

const problemsOf = (w: Words, problems: readonly DealProblem[]) => [...new Set(problems.map((p) => w.problems[p]))];
const pipelineProblem = (w: Words, result: PipelineResult) => (result.ok ? null : w.pipelineProblems[result.problem]);

function stateOf(w: Words, result: DealResult, success: string): FormState {
  if (!result.ok) return { status: "error", messages: problemsOf(w, result.problems) };
  refresh();
  return { status: "ok", messages: [success] };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

/** What a deal form sent, as `cleanDealInput()` reads it; the pipeline is the chosen stage's. */
async function dealInput(storeId: string, form: FormData): Promise<Record<string, unknown>> {
  const stageId = text(form, "stageId");
  const pipeline = (await pipelinesOf(storeId)).find((p) => p.stages.some((s) => s.id === stageId));
  return {
    title: text(form, "title"),
    customerId: text(form, "customerId"),
    companyId: text(form, "companyId"),
    ownerId: text(form, "ownerId"),
    estimate: text(form, "estimate"),
    expectedCloseOn: text(form, "expectedCloseOn"),
    pipelineId: pipeline?.id ?? "",
    stageId,
  };
}

/** A new deal; its page next, where a quote or an order is linked to it. */
export async function createDealAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const ok = await writer(storeSlug);
  if ("refused" in ok) return { status: "error", messages: [ok.refused] };
  const { member, w } = ok;
  const result = await createDeal(member, await dealInput(member.store.id, form));
  if (!result.ok) return { status: "error", messages: problemsOf(w, result.problems) };
  redirect(`/admin/${member.store.slug}/deals/${result.id}`);
}

/** A deal's details changed: title, who, owner, estimate and expected close. */
export async function updateDealAction(storeSlug: string, dealId: string, _state: FormState, form: FormData): Promise<FormState> {
  const ok = await writer(storeSlug);
  if ("refused" in ok) return { status: "error", messages: [ok.refused] };
  const { member, w } = ok;
  if (!uuid.safeParse(dealId).success) return { status: "error", messages: [w.problems.not_found] };
  const raw = await dealInput(member.store.id, form);
  return stateOf(w, await updateDeal(member, dealId, raw), w.form.saved);
}

export type PlaceResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * A deal put where the board or its page says: a stage (an open deal moves; a closed one opens again there), or won or lost (a lost one
 * with its reason). The one action the board's drag and its "Move to" both call.
 */
export async function placeDealAction(storeSlug: string, dealId: string, target: string, reason: string | null = null): Promise<PlaceResult> {
  const ok = await writer(storeSlug);
  if ("refused" in ok) return { ok: false, message: ok.refused };
  const { member, w } = ok;
  if (!uuid.safeParse(dealId).success) return { ok: false, message: w.problems.not_found };
  const fail = (result: DealResult): PlaceResult | null => (result.ok ? null : { ok: false, message: problemsOf(w, result.problems).join(" ") });
  if (target === "won" || target === "lost") {
    let result = await closeDeal(member, dealId, target, reason);
    // A deal closed the other way is opened again and closed this way.
    if (!result.ok && result.problems.includes("closed")) {
      const reopened = await reopenDeal(member, dealId);
      result = reopened.ok ? await closeDeal(member, dealId, target, reason) : reopened;
    }
    const failed = fail(result);
    if (failed) return failed;
    refresh();
    return { ok: true, message: fillWords(w.board.moved, { stage: w.statuses[target] }) };
  }
  if (!uuid.safeParse(target).success) return { ok: false, message: w.problems.stage };
  let result = await moveDeal(member, dealId, target);
  if (!result.ok && result.problems.includes("closed")) {
    const reopened = await reopenDeal(member, dealId);
    result = reopened.ok ? await moveDeal(member, dealId, target) : reopened;
  }
  const failed = fail(result);
  if (failed) return failed;
  refresh();
  const stage = (await pipelinesOf(member.store.id)).flatMap((p) => p.stages).find((s) => s.id === target);
  return { ok: true, message: fillWords(w.board.moved, { stage: stage?.name ?? "" }) };
}

/** A deal deleted, after its page asked; the board next. */
export async function deleteDealAction(storeSlug: string, dealId: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const ok = await writer(storeSlug);
  if ("refused" in ok) return { ok: false, problems: [ok.refused] };
  if (!uuid.safeParse(dealId).success) return { ok: false, problems: [ok.w.problems.not_found] };
  const result = await deleteDeal(ok.member, dealId);
  if (!result.ok) return { ok: false, problems: problemsOf(ok.w, result.problems) };
  redirect(`/admin/${ok.member.store.slug}/deals`);
}

/** An order, a quote or a Work assignment linked to a deal: the choice is `{kind}:{id}`. */
export async function linkThingAction(storeSlug: string, dealId: string, _state: FormState, form: FormData): Promise<FormState> {
  const ok = await writer(storeSlug);
  if ("refused" in ok) return { status: "error", messages: [ok.refused] };
  const { member, w } = ok;
  const [kind, thingId] = text(form, "thing").split(":");
  if (!(DEAL_LINK_KINDS as readonly string[]).includes(kind) || !uuid.safeParse(dealId).success) return { status: "error", messages: [w.problems.not_found] };
  return stateOf(w, await linkThing(member, dealId, kind as DealLinkKind, thingId ?? ""), w.form.saved);
}

/** A link taken off a deal. */
export async function unlinkThingAction(storeSlug: string, dealId: string, linkId: string): Promise<FormState> {
  const ok = await writer(storeSlug);
  if ("refused" in ok) return { status: "error", messages: [ok.refused] };
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(linkId).success) return { status: "error", messages: [ok.w.problems.not_found] };
  return stateOf(ok.w, await unlinkThing(ok.member, dealId, linkId), ok.w.form.saved);
}

/** Who a new deal may be with, as the form's search asks (two letters or more). */
export async function searchWhoAction(storeSlug: string, query: string): Promise<WhoChoice[]> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member || !featureOn(member.store, "sales")) return [];
  return searchWho(member.store.id, String(query ?? ""));
}

// ---------------------------------------------------------------------------
// Pipelines (Lisa's)
// ---------------------------------------------------------------------------

const pipelineState = (w: Words, result: PipelineResult): FormState => {
  const problem = pipelineProblem(w, result);
  if (problem) return { status: "error", messages: [problem] };
  refresh();
  return { status: "ok", messages: [w.pipelinesPage.saved] };
};

/** The stages a form sent, as JSON from the stage editor; anything else is no stages. */
function stagesOf(form: FormData): StageInput[] {
  const parsed = z
    .array(z.object({ id: z.uuid().nullable(), name: z.string(), probability: z.number().int().nullable(), quoteStage: z.boolean() }))
    .max(50)
    .safeParse((() => {
      try {
        return JSON.parse(text(form, "stages"));
      } catch {
        return null;
      }
    })());
  return parsed.success ? parsed.data : [];
}

/** A new pipeline with the stages typed. */
export async function createPipelineAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const ok = await writer(storeSlug);
  if ("refused" in ok) return { status: "error", messages: [ok.refused] };
  return pipelineState(ok.w, await createPipeline(ok.member, text(form, "name"), stagesOf(form)));
}

/** A pipeline renamed. */
export async function renamePipelineAction(storeSlug: string, pipelineId: string, _state: FormState, form: FormData): Promise<FormState> {
  const ok = await writer(storeSlug);
  if ("refused" in ok) return { status: "error", messages: [ok.refused] };
  if (!uuid.safeParse(pipelineId).success) return { status: "error", messages: [ok.w.pipelineProblems.not_found] };
  return pipelineState(ok.w, await renamePipeline(ok.member, pipelineId, text(form, "name")));
}

/** A pipeline's stages saved in their new order. */
export async function saveStagesAction(storeSlug: string, pipelineId: string, _state: FormState, form: FormData): Promise<FormState> {
  const ok = await writer(storeSlug);
  if ("refused" in ok) return { status: "error", messages: [ok.refused] };
  if (!uuid.safeParse(pipelineId).success) return { status: "error", messages: [ok.w.pipelineProblems.not_found] };
  return pipelineState(ok.w, await saveStages(ok.member, pipelineId, stagesOf(form)));
}

/** A pipeline deleted, after the page asked. */
export async function deletePipelineAction(storeSlug: string, pipelineId: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const ok = await writer(storeSlug);
  if ("refused" in ok) return { ok: false, problems: [ok.refused] };
  if (!uuid.safeParse(pipelineId).success) return { ok: false, problems: [ok.w.pipelineProblems.not_found] };
  const result = await deletePipeline(ok.member, pipelineId);
  const problem = pipelineProblem(ok.w, result);
  if (problem) return { ok: false, problems: [problem] };
  refresh();
  return { ok: true };
}
