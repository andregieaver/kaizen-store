"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { answerStep, cancelFollowUpFrom, changePlan, decideCall, dropGoalFrom, saveSettings } from "@/server/autopilot-actions";
import { requireOwnerRole } from "@/server/permissions";

/** The store's Autopilot page (D309): for the store's owners only, as the AI manager is. */
async function after(result: FormState): Promise<FormState> {
  if (result.status === "ok") refresh();
  return result;
}

export async function decideCallAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireOwnerRole(storeSlug);
  return after(await decideCall(member, form, (tag) => updateTag(tag)));
}

export async function answerStepAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return after(await answerStep(await requireOwnerRole(storeSlug), form));
}

export async function changePlanAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return after(await changePlan(await requireOwnerRole(storeSlug), form));
}

export async function cancelFollowUpAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return after(await cancelFollowUpFrom(await requireOwnerRole(storeSlug), form));
}

export async function dropGoalAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return after(await dropGoalFrom(await requireOwnerRole(storeSlug), form));
}

export async function saveSettingsAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return after(await saveSettings(await requireOwnerRole(storeSlug), form));
}
