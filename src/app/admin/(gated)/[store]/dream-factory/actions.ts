"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { DREAM_STEP_IDS, LOOK_ASKS, type DreamStepId, type LookAsk } from "@/lib/dream-factory";
import { answerDreamBrief, approveLook, askLookChange, confirmDreamBrief, retryDreamStep, startDreamOver, startDreamRun, stopDreamRun } from "@/server/dream-factory";
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
  if (!(DREAM_STEP_IDS as readonly string[]).includes(step)) return { status: "error", messages: ["That step is not waiting."] };
  return answer(await retryDreamStep(member, runId, step as DreamStepId), storeSlug);
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

