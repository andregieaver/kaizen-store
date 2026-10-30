"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { fromTyped, isLimitKey, LIMITS } from "@/lib/limits";
import { requirePlatformAdmin } from "@/server/auth";
import { removeLimitOverride, setLimitOverride } from "@/server/limits-admin";

/**
 * A platform admin's override of one of a store's limits (D314, `docs/capacity.md` step 2.6): a value or Unlimited, a reason, an optional
 * end. `stores_owned` is an owner's and goes on the store's first owner.
 */
export async function setLimitOverrideAction(storeId: string, ownerId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "capacity");
  const key = form.get("key");
  if (!isLimitKey(key)) return { status: "error", messages: [w.overrides.needLimit] };
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 3) return { status: "error", messages: [w.overrides.needReason] };
  const unlimited = form.get("unlimited") === "on";
  const value = unlimited ? null : fromTyped(key, String(form.get("value") ?? ""));
  if (!unlimited && value === null) return { status: "error", messages: [w.editor.invalid.replace("{limit}", w.limits[key])] };
  const ends = String(form.get("ends") ?? "").trim();
  const endsAt = /^\d{4}-\d{2}-\d{2}$/.test(ends) ? new Date(`${ends}T23:59:59Z`) : null;
  if (LIMITS[key].scope === "owner") {
    if (!ownerId) return { status: "error", messages: [w.overrides.needLimit] };
    await setLimitOverride(admin, { accountId: ownerId }, key, value, reason, endsAt);
  } else {
    await setLimitOverride(admin, { storeId }, key, value, reason, endsAt);
  }
  refresh();
  return { status: "ok", messages: [w.overrides.saved] };
}

export async function removeLimitOverrideAction(storeId: string, id: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "capacity");
  await removeLimitOverride(admin, storeId, id);
  refresh();
  return { status: "ok", messages: [w.overrides.removed] };
}
