"use server";

import { revalidatePath } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { DREAM_STEP_IDS, type DreamStepId } from "@/lib/dream-factory";
import { answerDreamBrief, confirmDreamBrief, retryDreamStep, startDreamRun, stopDreamRun } from "@/server/dream-factory";
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
