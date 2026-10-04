"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { NO_ACCESS, checkOwnerRole, checkPermission } from "@/server/permissions";
import { addRule, recommendTag, removeRule, saveRecommendSettings, type SaveResult } from "@/server/recommend-settings";

function toState(result: SaveResult, success: string): FormState {
  if (!result.ok) return { status: "error", messages: result.problems };
  return { status: "ok", messages: [success] };
}

/** Saves the recommendation settings (D139). Owners decide what the site spends its AI on and what shoppers are shown. */
export async function saveRecommendSettingsAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { status: "error", messages: ["Only an owner can change the recommendations."] };
  const result = await saveRecommendSettings(member.account, member.store.id, form);
  if (result.ok) {
    updateTag(recommendTag(member.store.id));
    refresh();
  }
  return toState(result, "Saved.");
}

/** Adds a pairing, an exclusion or a hidden product (D139). */
export async function addRuleAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await addRule(member.account, member.store.id, {
    kind: String(form.get("kind") ?? ""),
    productId: String(form.get("productId") ?? ""),
    otherProductId: String(form.get("otherProductId") ?? "") || null,
    both: form.get("both") === "on",
  });
  if (result.ok) {
    updateTag(recommendTag(member.store.id));
    refresh();
  }
  return toState(result, "Added.");
}

export async function removeRuleAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await removeRule(member.account, member.store.id, String(form.get("ruleId") ?? ""));
  if (result.ok) {
    updateTag(recommendTag(member.store.id));
    refresh();
  }
  return toState(result, "Removed.");
}
