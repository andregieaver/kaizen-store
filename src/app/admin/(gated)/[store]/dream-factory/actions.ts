"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { DREAM_STEP_IDS, LOOK_ASKS, REWORK_STEP_IDS, type AnyStepId, type LookAsk } from "@/lib/dream-factory";
import {
  agreeReworkPlan,
  answerDreamBrief,
  applyRework,
  approveLook,
  askLookChange,
  askReworkChange,
  confirmDreamBrief,
  retryDreamStep,
  startDreamOver,
  startDreamRework,
  startDreamRun,
  stopDreamRun,
} from "@/server/dream-factory";
import { startAppearance } from "@/server/page-looks";
import { closeStore } from "@/server/store-closure";
import { NO_ACCESS, checkPermission } from "@/server/permissions";

/** The Dream Factory page's presses (D409): owners only, each read again here. */

async function owner(storeSlug: string) {
  return checkPermission(storeSlug, "owner");
}

const answer = (result: { ok: true } | { ok: false; problem: string }, slug: string): FormState => {
  revalidatePath(`/admin/${slug}/dream-factory`);
  return result.ok ? { status: "ok", messages: [] } : { status: "error", messages: [result.problem] };
};

export async function startDreamAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await owner(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  return answer(await startDreamRun(member, String(formData.get("prompt") ?? "")), storeSlug);
}

export async function answerDreamAction(storeSlug: string, runId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await owner(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  const countries = text("countries")
    .split(/[\s,]+/)
    .map((c) => c.toUpperCase())
    .filter(Boolean);
  return answer(
    await answerDreamBrief(member, runId, {
      legalName: text("legalName"),
      organisationNumber: text("organisationNumber"),
      postalAddress: text("postalAddress"),
      contactEmail: text("contactEmail"),
      ...(text("country") && { country: text("country") }),
      ...(countries.length > 0 && { countries }),
    }),
    storeSlug,
  );
}

export async function confirmDreamAction(storeSlug: string, runId: string): Promise<FormState> {
  const member = await owner(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  return answer(await confirmDreamBrief(member, runId), storeSlug);
}

export async function retryDreamAction(storeSlug: string, runId: string, step: string): Promise<FormState> {
  const member = await owner(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  if (![...DREAM_STEP_IDS, ...REWORK_STEP_IDS].includes(step as AnyStepId)) return { status: "error", messages: ["That step is not waiting."] };
  return answer(await retryDreamStep(member, runId, step as AnyStepId), storeSlug);
}

export async function stopDreamAction(storeSlug: string, runId: string): Promise<FormState> {
  const member = await owner(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  return answer(await stopDreamRun(member, runId), storeSlug);
}

/** Start over (D421): what the run made is cleared and a new run starts from the edited description. */
export async function startDreamOverAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await owner(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  return answer(await startDreamOver(member, String(formData.get("prompt") ?? "")), storeSlug);
}

/** Discard (D421): the store is closed as its owner closes it (the address typed to confirm), then the owner is taken to Your stores. */
export async function discardDreamStoreAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await owner(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await closeStore(member.account, member.store.id, { by: "owner", typed: String(formData.get("typed") ?? "") });
  if (!result.ok) return { status: "error", messages: result.problems };
  redirect("/admin/stores");
}

/** A change to the look (D422): a quick ask (other colours, fonts or layout) or the owner's own words. */
export async function askLookAction(storeSlug: string, runId: string, kind: LookAsk | "own", _state: FormState, formData: FormData): Promise<FormState> {
  const member = await owner(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const ask = kind === "own" ? String(formData.get("ask") ?? "") : (LOOK_ASKS[kind] ?? "");
  return answer(await askLookChange(member, runId, ask), storeSlug);
}

/** *This is it* (D422): stage 2 starts in the look the owner agreed to. */
export async function approveLookAction(storeSlug: string, runId: string): Promise<FormState> {
  const member = await owner(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  return answer(await approveLook(member, runId), storeSlug);
}


/** A rework (D527): what the owner wants changed in a store that exists. */
export async function startReworkAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await owner(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  return answer(await startDreamRework(member, String(formData.get("prompt") ?? "")), storeSlug);
}

/** The owner's yes to a rework's plan. */
export async function agreeReworkAction(storeSlug: string, runId: string): Promise<FormState> {
  const member = await owner(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  return answer(await agreeReworkPlan(member, runId), storeSlug);
}

/** One more change while reviewing a rework, in the owner's words. */
export async function askReworkAction(storeSlug: string, runId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await owner(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  return answer(await askReworkChange(member, runId, String(formData.get("ask") ?? "")), storeSlug);
}

/** *Make it live*: what the rework prepared is published within the minute. */
export async function applyReworkAction(storeSlug: string, runId: string): Promise<FormState> {
  const member = await owner(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  return answer(await applyRework(member, runId), storeSlug);
}

/** *Analyse existing* (D528): the site is photographed and assessed after this answer; the page shows it when it is done. */
export async function analyseExistingAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await owner(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const aspects = formData.getAll("aspects").map(String);
  if (aspects.length === 0) return { status: "error", messages: ["Tick at least one of design, copy and images."] };
  const started = await startAppearance({ account: member.account, store: member.store }, after, {}, aspects);
  return answer(started.ok ? { ok: true } : started, storeSlug);
}
