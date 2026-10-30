"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requirePlatformAdmin } from "@/server/auth";
import { answerStep, cancelFollowUpFrom, changePlan, decideCall, dropGoalFrom, saveSettings } from "@/server/autopilot-actions";
import type { Principal } from "@/server/owner-assistant";

/** Kaizena Flow's own Autopilot page (D309): for platform admins only. */
async function principal(): Promise<Principal> {
  return { account: await requirePlatformAdmin(), store: null };
}

async function after(result: FormState): Promise<FormState> {
  if (result.status === "ok") refresh();
  return result;
}

export async function decideCallAction(_state: FormState, form: FormData): Promise<FormState> {
  return after(await decideCall(await principal(), form, (tag) => updateTag(tag)));
}

export async function answerStepAction(_state: FormState, form: FormData): Promise<FormState> {
  return after(await answerStep(await principal(), form));
}

export async function changePlanAction(_state: FormState, form: FormData): Promise<FormState> {
  return after(await changePlan(await principal(), form));
}

export async function cancelFollowUpAction(_state: FormState, form: FormData): Promise<FormState> {
  return after(await cancelFollowUpFrom(await principal(), form));
}

export async function dropGoalAction(_state: FormState, form: FormData): Promise<FormState> {
  return after(await dropGoalFrom(await principal(), form));
}

export async function saveSettingsAction(_state: FormState, form: FormData): Promise<FormState> {
  return after(await saveSettings(await principal(), form));
}
