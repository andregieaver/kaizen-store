"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requireAccount } from "@/server/auth";
import { storeTag } from "@/server/stores";
import { switchWorkModule } from "@/server/work-owner";

/**
 * Switches Work on or off in one store from the owner's Work settings (D123, docs/work.md 5.1). Only an owner of
 * the store can: `switchWorkModule()` reads the account's membership itself, so the slug the browser sends can only
 * ever change a store the account owns, and a store it does not belong to answers as one that does not exist. Off
 * hides Work and keeps everything; the change is audited (`work.enabled` / `work.disabled`). Bound to the store's
 * slug as the first argument, like every store action.
 */
export async function switchWorkAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const account = await requireAccount();
  const enabled = formData.get("work") === "on";
  const result = await switchWorkModule(account, storeSlug, enabled);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(storeTag(storeSlug));
  refresh();
  return {
    status: "ok",
    messages: [enabled ? "Work is on for this store." : "Work is off for this store. Everything you saved is kept."],
  };
}
